"""予想タイム・順位 API"""
from io import BytesIO

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlmodel import Session, select

from app.deps import get_db
from app.models import Race, Startlist
from app.services.als_optimizer import get_optimized_program

router = APIRouter(prefix="/predict", tags=["predict"])

COMPETITION_PROGRAMS = {
    "PTWC Men", "PTWC Women",
    "PTS2 Men", "PTS2 Women",
    "PTS3 Men", "PTS3 Women",
    "PTS4 Men", "PTS4 Women",
    "PTS5 Men", "PTS5 Women",
    "PTVI Men", "PTVI Women",
}

PROGRAM_ORDER = [
    "PTWC Men", "PTWC Women",
    "PTS2 Men", "PTS2 Women",
    "PTS3 Men", "PTS3 Women",
    "PTS4 Men", "PTS4 Women",
    "PTS5 Men", "PTS5 Women",
    "PTVI Men", "PTVI Women",
]

_SEGS = ["swim", "t1", "bike", "t2", "run"]


# ── スタートリスト解析 ────────────────────────────────────────────────────────
def _parse_startlist(source: BytesIO) -> list[dict]:
    """
    Excel（Path または BytesIO）からスタートリストを解析する。

    対応カラム名:
      - 選手ID  : "Member ID" または "Athlete ID"
      - 名前    : "First Name" / "Athlete First Name"
      - 苗字    : "Last Name"  / "Athlete Last Name"
      - 国      : "Country"
      - プログラム: "Program Name"
      - スタート番号: "Start Number"
    """
    df = pd.read_excel(source)
    athletes = []
    for _, row in df.iterrows():
        pname = str(row.get("Program Name", "")).strip()
        if pname not in COMPETITION_PROGRAMS:
            continue

        # 選手 ID（Member ID / Athlete ID どちらも許容）
        raw_id = row.get("Member ID") if pd.notna(row.get("Member ID", None)) else row.get("Athlete ID")
        if raw_id is None or pd.isna(raw_id):
            continue

        # 名前（フォーマットが違う場合も対応）
        first = str(row.get("First Name") or row.get("Athlete First Name") or "")
        last  = str(row.get("Last Name")  or row.get("Athlete Last Name")  or "")

        start_num = row.get("Start Number")
        athletes.append({
            "athlete_id": str(int(raw_id)),
            "first_name": first,
            "last_name": last,
            "country": str(row.get("Country", "")),
            "program_name": pname,
            "start_number": int(start_num) if pd.notna(start_num) else None,
        })
    return athletes


# ── 予想計算（共通ロジック） ──────────────────────────────────────────────────
def _build_prediction(s_data: dict | None, diff: dict) -> dict:
    """strength + difficulty で予想タイムを組み立てる"""
    if s_data is None or s_data.get("strength") is None:
        return {"total_sec": None, **{f"{seg}_sec": None for seg in _SEGS}}
    d_total = diff.get("total_sec", 0.0) or 0.0
    pred: dict = {"total_sec": float(s_data["strength"] + d_total)}
    for seg in _SEGS:
        d_seg = diff.get(f"{seg}_sec", 0.0) or 0.0
        s_seg = s_data.get(f"strength_{seg}")
        pred[f"{seg}_sec"] = float(s_seg + d_seg) if s_seg is not None else None
    return pred


def _assign_ranks(athletes: list[dict], pred_key: str, rank_key: str) -> None:
    ranked = sorted(
        [(a, a[pred_key]["total_sec"]) for a in athletes if a[pred_key]["total_sec"] is not None],
        key=lambda x: x[1],
    )
    for rank, (a, _) in enumerate(ranked, 1):
        a[rank_key] = rank
    for a in athletes:
        if rank_key not in a:
            a[rank_key] = None


def _compute_predictions(startlist: list[dict], session: Session) -> dict:
    """
    スタートリストと DB から予想タイム・順位を計算して返す（共通処理）。
    """
    by_program: dict[str, list[dict]] = {}
    for a in startlist:
        by_program.setdefault(a["program_name"], []).append(a)

    categories: dict[str, list[dict]] = {}

    for prog in PROGRAM_ORDER:
        if prog not in by_program:
            continue

        opt = get_optimized_program(session, prog)
        als_strengths = opt["athlete_strengths"]

        result_athletes = []
        for a in by_program[prog]:
            s_data = als_strengths.get(a["athlete_id"])
            entry: dict = {
                **a,
                "has_history": s_data is not None,
                "strength":      s_data.get("strength")       if s_data else None,
                "strength_swim": s_data.get("strength_swim")  if s_data else None,
                "strength_t1":   s_data.get("strength_t1")    if s_data else None,
                "strength_bike": s_data.get("strength_bike")  if s_data else None,
                "strength_t2":   s_data.get("strength_t2")    if s_data else None,
                "strength_run":  s_data.get("strength_run")   if s_data else None,
                "pred_avg": _build_prediction(s_data, {}),
            }
            result_athletes.append(entry)

        _assign_ranks(result_athletes, "pred_avg", "rank_avg")
        categories[prog] = result_athletes

    return {"categories": categories}


# ── エンドポイント ─────────────────────────────────────────────────────────────
@router.post("/upload-startlist")
async def upload_startlist(
    file: UploadFile = File(...),
    race_id: int | None = Query(default=None),
    event_id: str | None = Query(default=None),
    session: Session = Depends(get_db),
):
    """
    スタートリスト Excel をアップロードして予想タイム・順位を返す。
    race_id/event_id が指定される場合は、Startlist テーブルに保存する。

    対応カラム: "Member ID"（または "Athlete ID"）, "First Name", "Last Name",
               "Country", "Program Name", "Start Number"
    """
    if not (file.filename or "").endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="xlsx ファイルのみ受け付けます")

    content = await file.read()
    try:
        startlist = _parse_startlist(BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"ファイル解析エラー: {e}")

    if not startlist:
        raise HTTPException(
            status_code=422,
            detail="競技カテゴリの選手が見つかりません。ファイル形式を確認してください。",
        )

    # race_id / event_id 指定時は Startlist テーブルに保存
    if race_id or event_id:
        race = None
        if race_id:
            race = session.exec(select(Race).where(Race.id == race_id)).first()
        elif event_id:
            race = session.exec(select(Race).where(Race.event_id == event_id)).first()

        # Race が存在しない場合は、Algolia event_id から仮の Race を作成
        if not race and event_id:
            race = Race(event_id=event_id)
            session.add(race)
            session.flush()

        if race:
            for old in session.exec(
                select(Startlist).where(Startlist.event_id == race.event_id)
            ).all():
                session.delete(old)

            for athlete_data in startlist:
                sl = Startlist(
                    race_id=race.id,
                    event_id=race.event_id,
                    athlete_id=athlete_data["athlete_id"],
                    first_name=athlete_data["first_name"],
                    last_name=athlete_data["last_name"],
                    country=athlete_data["country"],
                    program_name=athlete_data["program_name"],
                    start_number=athlete_data.get("start_number"),
                )
                session.add(sl)
            session.commit()

    result = _compute_predictions(startlist, session)
    result["source_label"] = f"アップロード: {file.filename}"
    result["source_filename"] = file.filename
    return result
