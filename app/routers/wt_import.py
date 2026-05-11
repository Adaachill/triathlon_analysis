"""World Triathlonから過去のParatriathlonレース結果を自動インポート"""
import os
import tempfile
import time

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select

from app.deps import get_db
from app.models import Race
from app.services.import_excel import import_excel_file

router = APIRouter(prefix="/admin/wt", tags=["wt-import"])

_ALGOLIA_APP_ID = "GAVNABD4CQ"
_ALGOLIA_API_KEY = "a3a9ddd1c59b3f5474c08dec7839c8fb"
_ALGOLIA_INDEX = "tri_prod_events"
_WT_EXPORT_BASE = "https://events.triathlon.org/api/export/download-event-results"

# event_categories キーワード → 優勝ポイント（長い順に評価して誤マッチを防ぐ）
_POINTS_MAP = [
    ("world championships", 700),
    ("continental championships", 500),
    ("world para series", 550),
    ("world para cup", 450),
    ("continental para cup", 350),
]


def _detect_points(event_categories: list[str]) -> int | None:
    cats_lower = " | ".join(event_categories).lower()
    for keyword, pts in _POINTS_MAP:
        if keyword in cats_lower:
            return pts
    return None


@router.get("/para-events")
async def list_wt_para_events(
    years_back: int = Query(3, ge=1, le=10),
    session: Session = Depends(get_db),
):
    """
    過去の Paratriathlon Triathlon イベントを Algolia から取得し、
    DBのインポート状況（event_id の有無）を付与して返す。
    """
    now_ts = int(time.time())
    past_ts = now_ts - years_back * 365 * 86400

    algolia_url = (
        f"https://{_ALGOLIA_APP_ID.lower()}-dsn.algolia.net/1/indexes/*/queries"
        f"?x-algolia-api-key={_ALGOLIA_API_KEY}&x-algolia-application-id={_ALGOLIA_APP_ID}"
    )
    body = {
        "requests": [{
            "indexName": _ALGOLIA_INDEX,
            "query": "",
            "page": 0,
            "hitsPerPage": 200,
            "numericFilters": [
                f"start_date_timestamp >= {past_ts}",
                f"start_date_timestamp <= {now_ts}",
            ],
            "facetFilters": [
                ["sport_categories:Triathlon"],
                ["specification_categories:Paratriathlon"],
                ["results_available:true"],
            ],
        }]
    }

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(algolia_url, json=body)
        if not resp.is_success:
            raise HTTPException(502, f"Algolia error: {resp.status_code}")
        data = resp.json()

    hits = data.get("results", [{}])[0].get("hits", [])

    # DB に登録済みの event_id を取得
    imported_ids: set[str] = {
        r.event_id
        for r in session.exec(select(Race)).all()
        if r.event_id is not None
    }

    events = []
    for hit in hits:
        win_points = _detect_points(hit.get("event_categories", []))
        events.append({
            "id": hit["id"],
            "name": hit["name"],
            "start_date": hit["start_date"],
            "city": hit.get("city"),
            "country_name": hit.get("country_name"),
            "event_categories": hit.get("event_categories", []),
            "win_points": win_points,
            "imported": str(hit["id"]) in imported_ids,
        })

    events.sort(key=lambda x: x["start_date"], reverse=True)
    return {"events": events}


@router.post("/import/{wt_event_id}")
async def import_wt_event(
    wt_event_id: int,
    win_points: int = Query(..., description="優勝ポイント"),
    race_name: str = Query(..., description="大会名"),
    race_date: str = Query(..., description="開催日 YYYY-MM-DD"),
    note: str = Query("", description="補足メモ"),
    session: Session = Depends(get_db),
):
    """
    World Triathlon の大会 Excel を自動ダウンロードして DB にインポートする。
    """
    download_url = f"{_WT_EXPORT_BASE}/{wt_event_id}"

    async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
        resp = await client.get(download_url)
        if not resp.is_success:
            raise HTTPException(
                502,
                f"Excel取得失敗 (HTTP {resp.status_code}): {download_url}",
            )
        excel_bytes = resp.content

    with tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx") as tmp:
        tmp.write(excel_bytes)
        tmp_path = tmp.name

    try:
        result = import_excel_file(
            tmp_path,
            session,
            race_name=race_name,
            race_date_str=race_date,
            points=win_points,
            note=note,
        )
    except ValueError as e:
        raise HTTPException(422, str(e))
    except Exception as e:
        raise HTTPException(500, str(e))
    finally:
        os.unlink(tmp_path)

    return {"message": "Import successful", **result}
