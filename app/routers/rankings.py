"""ランキングAPI"""
from fastapi import APIRouter, Query, Depends
from sqlmodel import Session, select
from app.deps import get_db
from app.models import Result
from app.services.difficulty import compute_athlete_strength_full

router = APIRouter(prefix="/rankings", tags=["rankings"])


@router.get("/top")
async def get_top_athletes(
    program_name: str = Query(..., description="Program Name（必須）"),
    limit: int = Query(50, ge=1, le=200, description="取得件数"),
    session: Session = Depends(get_db),
):
    """
    強さランキング（標準化Totalタイム平均が短い順）
    MVPではDB内全レース（=直近1年）の標準化Total平均で評価
    """
    # 該当program_nameの全選手IDを取得
    q = select(Result).where(
        Result.program_name == program_name,
        Result.status == "Finished",
    )
    athlete_ids = list(dict.fromkeys(r.athlete_id for r in session.exec(q).all()))

    # 選手IDから名前を取得（各選手の最初のResultから）
    q_names = select(Result).where(
        Result.program_name == program_name,
        Result.status == "Finished",
    )
    name_by_id = {}
    for r in session.exec(q_names).all():
        if r.athlete_id not in name_by_id:
            name_by_id[r.athlete_id] = {
                "first_name": r.first_name,
                "last_name": r.last_name,
                "country": r.country,
            }

    # 各選手の強さを計算（Total + セグメント別）
    rankings = []
    for athlete_id in athlete_ids:
        strength_data = compute_athlete_strength_full(session, athlete_id, program_name)
        if strength_data is not None and strength_data.get("strength") is not None:
            info = name_by_id.get(athlete_id, {})
            rankings.append({
                "athlete_id": athlete_id,
                "first_name": info.get("first_name", ""),
                "last_name": info.get("last_name", ""),
                "country": info.get("country", ""),
                "strength": strength_data["strength"],
                "strength_swim": strength_data.get("strength_swim"),
                "strength_t1": strength_data.get("strength_t1"),
                "strength_bike": strength_data.get("strength_bike"),
                "strength_t2": strength_data.get("strength_t2"),
                "strength_run": strength_data.get("strength_run"),
            })

    # 短い順にソート
    rankings.sort(key=lambda x: x["strength"])

    # 上位N件を返す
    return {
        "program_name": program_name,
        "rankings": rankings[:limit],
    }
