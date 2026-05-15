"""レース関連API"""
from typing import Optional
from datetime import date
from fastapi import APIRouter, Query, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlmodel import Session, select, col
from app.deps import get_db
from app.models import Race, Result
from app.services.als_optimizer import get_optimized_program
from app.services.difficulty import SEGMENT_FIELDS

router = APIRouter(prefix="/races", tags=["races"])


class RaceUpdate(BaseModel):
    model_config = {"extra": "ignore"}

    name: Optional[str] = None
    date: Optional[str] = None  # "YYYY-MM-DD" 形式
    location: Optional[str] = None
    points: Optional[int] = None
    note: Optional[str] = None


@router.get("")
async def list_races(
    include_future: bool = Query(default=False, description="未来のレースを含める"),
    session: Session = Depends(get_db),
):
    """レース一覧を取得。デフォルトでは今日以前のレースのみ返す。"""
    q = select(Race)
    if not include_future:
        today = date.today()
        q = q.where(col(Race.date).is_(None) | (Race.date <= today))
    races = session.exec(q).all()
    return [{
        "id": r.id,
        "event_id": r.event_id,
        "name": r.name,
        "date": str(r.date) if r.date else None,
        "location": r.location,
        "is_reference": r.is_reference,
        "points": r.points,
        "note": r.note,
    } for r in races]


@router.get("/{race_id}")
async def get_race(
    race_id: int,
    program_name: Optional[str] = Query(None, description="Program Nameでフィルタ"),
    session: Session = Depends(get_db),
):
    """レース詳細を取得"""
    race = session.get(Race, race_id)
    if not race:
        return {"error": "Race not found"}

    q = select(Result).where(Result.race_id == race_id)
    if program_name:
        q = q.where(Result.program_name == program_name)
    results = session.exec(q).all()

    difficulty_als: float | None = None
    difficulty_n_als: int = 0
    difficulty_segments_als: dict[str, float | None] | None = None
    strength_rank_map: dict[str, int] = {}
    als_race_diffs: dict[str, float] = {}
    als_strengths: dict = {}
    als_outlier_weights: dict = {}

    if program_name:
        opt = get_optimized_program(session, program_name)
        als_race_diffs = opt["race_difficulties"].get(race_id, {})
        als_strengths = opt["athlete_strengths"]
        als_counts = opt["athlete_race_counts"]
        als_outlier_weights = opt["outlier_weights"]

        difficulty_als = als_race_diffs.get("total_sec")
        difficulty_segments_als = {f: als_race_diffs.get(f) for f in SEGMENT_FIELDS}

        difficulty_n_als = sum(
            1
            for r in results
            if r.status == "Finished"
            and r.total_sec is not None
            and als_counts.get(r.athlete_id, 0) >= 2
        )

        finished = [r for r in results if r.status == "Finished" and r.total_sec is not None]
        athletes_with_strength: list[tuple[str, float]] = [
            (r.athlete_id, als_strengths[r.athlete_id]["strength"])
            for r in finished
            if r.athlete_id in als_strengths
            and als_strengths[r.athlete_id].get("strength") is not None
        ]
        athletes_sorted = sorted(athletes_with_strength, key=lambda x: x[1])
        strength_rank_map = {aid: i + 1 for i, (aid, _) in enumerate(athletes_sorted)}

    _SEGS = ["swim", "t1", "bike", "t2", "run"]

    result_list = []
    for r in results:
        result_dict = {
            "athlete_id": r.athlete_id,
            "first_name": r.first_name,
            "last_name": r.last_name,
            "country": r.country,
            "program_name": r.program_name,
            "swim_sec": r.swim_sec,
            "t1_sec": r.t1_sec,
            "bike_sec": r.bike_sec,
            "t2_sec": r.t2_sec,
            "run_sec": r.run_sec,
            "total_sec": r.total_sec,
            "position": r.position,
            "status": r.status,
            "strength_rank": strength_rank_map.get(r.athlete_id),
        }

        # ALS難易度を使った標準化タイム
        if difficulty_als is not None and r.total_sec is not None:
            result_dict["standard_total_sec"] = float(r.total_sec) - difficulty_als

        # セグメント毎の標準化タイム
        if difficulty_als is not None:
            for seg in _SEGS:
                seg_key = f"{seg}_sec"
                actual_val = getattr(r, seg_key, None)
                seg_diff = als_race_diffs.get(seg_key, 0.0)
                result_dict[f"standard_{seg}_sec"] = (
                    float(actual_val) - seg_diff if actual_val is not None else None
                )

        if program_name:
            result_dict["outlier_weight"] = (
                als_outlier_weights.get(race_id, {}).get(r.athlete_id, 1.0)
            )
            als_str = als_strengths.get(r.athlete_id, {})
            for seg in _SEGS:
                strength_val = als_str.get(f"strength_{seg}")
                diff_val = als_race_diffs.get(f"{seg}_sec", 0.0)
                result_dict[f"pred_{seg}_sec"] = (
                    float(strength_val + diff_val) if strength_val is not None else None
                )

        result_list.append(result_dict)

    return JSONResponse(
        content={
            "race": {
                "id": race.id,
                "event_id": race.event_id,
                "name": race.name,
                "date": str(race.date) if race.date else None,
                "location": race.location,
                "is_reference": race.is_reference,
                "points": race.points,
                "note": race.note,
            },
            "difficulty_als": difficulty_als,
            "difficulty_n_als": difficulty_n_als,
            "difficulty_segments_als": difficulty_segments_als,
            "results": result_list,
        },
        headers={"Cache-Control": "public, max-age=60"},
    )


@router.patch("/{race_id}")
async def update_race(
    race_id: int,
    body: RaceUpdate,
    session: Session = Depends(get_db),
):
    """レース情報を手動で更新（name, date, location, note）"""
    race = session.get(Race, race_id)
    if not race:
        return {"error": "Race not found"}

    if body.name is not None:
        race.name = body.name if body.name else None
    if body.date is not None:
        if body.date:
            race.date = date.fromisoformat(body.date)
        else:
            race.date = None
    if body.location is not None:
        race.location = body.location if body.location else None
    if body.points is not None:
        if not (150 <= body.points <= 750):
            from fastapi import HTTPException
            raise HTTPException(status_code=422, detail="pointsは150〜750の整数で指定してください")
        race.points = body.points
    if body.note is not None:
        race.note = body.note if body.note else None

    session.add(race)
    session.commit()
    session.refresh(race)

    return {
        "race": {
            "id": race.id,
            "event_id": race.event_id,
            "name": race.name,
            "date": str(race.date) if race.date else None,
            "location": race.location,
            "is_reference": race.is_reference,
            "points": race.points,
            "note": race.note,
        },
    }
