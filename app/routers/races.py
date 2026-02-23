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
    if program_name:
        difficulty = compute_race_difficulty(session, race_id, program_name)
        difficulty_segments = compute_race_difficulty_segments(session, race_id, program_name)

    # 結果に標準化タイムを追加
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
        }
        if difficulty is not None and r.total_sec is not None:
            result_dict["standard_total_sec"] = get_standard_total_sec(
                r.total_sec, difficulty
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
