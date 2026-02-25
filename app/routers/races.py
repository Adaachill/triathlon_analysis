"""レース関連API"""
from typing import Optional
from datetime import date
from fastapi import APIRouter, Query, Depends
from pydantic import BaseModel
from sqlmodel import Session, select
from app.deps import get_db
from app.models import Race, Result
from app.services.difficulty import (
    compute_race_difficulty,
    compute_race_difficulty_segments,
    get_standard_total_sec,
    compute_athlete_strength_full,
)

router = APIRouter(prefix="/races", tags=["races"])


class RaceUpdate(BaseModel):
    model_config = {"extra": "ignore"}

    name: Optional[str] = None
    date: Optional[str] = None  # "YYYY-MM-DD" 形式
    location: Optional[str] = None
    note: Optional[str] = None


@router.get("")
async def list_races(session: Session = Depends(get_db)):
    """レース一覧を取得"""
    races = session.exec(select(Race)).all()
    return [{
        "id": r.id,
        "event_id": r.event_id,
        "name": r.name,
        "date": str(r.date) if r.date else None,
        "location": r.location,
        "is_reference": r.is_reference,
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

    # 結果を取得
    q = select(Result).where(Result.race_id == race_id)
    if program_name:
        q = q.where(Result.program_name == program_name)

    results = session.exec(q).all()

    # 難易度を計算（program_name指定時のみ）
    difficulty = None
    difficulty_segments = None
    athlete_strength_cache: dict[str, Optional[dict]] = {}
    strength_rank_map: dict[str, int] = {}

    if program_name:
        difficulty = compute_race_difficulty(session, race_id, program_name)
        difficulty_segments = compute_race_difficulty_segments(session, race_id, program_name)

        # 完走選手の強さ指標を取得して strength_rank を計算
        finished = [r for r in results if r.status == "Finished" and r.total_sec is not None]
        athletes_with_strength: list[tuple[str, float]] = []
        for r in finished:
            if r.athlete_id not in athlete_strength_cache:
                athlete_strength_cache[r.athlete_id] = compute_athlete_strength_full(
                    session, r.athlete_id, program_name
                )
            s = athlete_strength_cache[r.athlete_id]
            if s and s.get("strength") is not None:
                athletes_with_strength.append((r.athlete_id, s["strength"]))

        athletes_sorted = sorted(athletes_with_strength, key=lambda x: x[1])
        strength_rank_map = {aid: i + 1 for i, (aid, _) in enumerate(athletes_sorted)}

    _SEGS = ["swim", "t1", "bike", "t2", "run"]

    # 結果に標準化タイム・strength_rank・予想タイムを追加
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
        if difficulty is not None and r.total_sec is not None:
            result_dict["standard_total_sec"] = get_standard_total_sec(
                r.total_sec, difficulty
            )
        # 予想セグメントタイム = 選手のstrength_segment + レースのsegment難易度
        if difficulty_segments is not None:
            s_data = athlete_strength_cache.get(r.athlete_id)
            for seg in _SEGS:
                strength_val = s_data.get(f"strength_{seg}") if s_data else None
                diff_val = difficulty_segments.get(f"{seg}_sec", 0.0)
                result_dict[f"pred_{seg}_sec"] = (
                    float(strength_val + diff_val) if strength_val is not None else None
                )
        result_list.append(result_dict)

    return {
        "race": {
            "id": race.id,
            "event_id": race.event_id,
            "name": race.name,
            "date": str(race.date) if race.date else None,
            "location": race.location,
            "is_reference": race.is_reference,
            "note": race.note,
        },
        "difficulty_offset": difficulty,
        "difficulty_segments": difficulty_segments,
        "results": result_list,
    }


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
            "note": race.note,
        },
    }
