"""選手関連API"""
from fastapi import APIRouter, Query, Depends
from sqlmodel import Session, select
from app.deps import get_db
from app.models import Result, Race
from app.services.difficulty import (
    compute_race_difficulty,
    get_standard_total_sec,
    compute_athlete_strength_full,
)

router = APIRouter(prefix="/athletes", tags=["athletes"])


@router.get("/{athlete_id}")
async def get_athlete(
    athlete_id: str,
    program_name: str = Query(..., description="Program Name（必須）"),
    session: Session = Depends(get_db),
):
    """選手詳細を取得（直近1年の標準化Total平均とレース履歴）"""
    # 選手の結果を取得（DB内全レース = 直近1年）
    q = select(Result).where(
        Result.athlete_id == athlete_id,
        Result.program_name == program_name,
        Result.status == "Finished",
    )
    results = session.exec(q).all()

    if not results:
        return {
            "error": "No results found",
            "athlete_id": athlete_id,
            "program_name": program_name,
        }

    # 選手基本情報（最初のレコードから取得）
    first_result = results[0]

    # 強さ指標を計算（Total + セグメント別）
    strength_data = compute_athlete_strength_full(session, athlete_id, program_name)
    strength = strength_data["strength"] if strength_data else None

    # レースごとの詳細を取得
    difficulty_cache: dict[int, float] = {}
    race_details = []

    for r in results:
        # レース情報を取得
        race = session.get(Race, r.race_id)
        if not race:
            continue

        # 難易度を計算（キャッシュ）
        if r.race_id not in difficulty_cache:
            difficulty_cache[r.race_id] = compute_race_difficulty(
                session, r.race_id, program_name
            )

        difficulty = difficulty_cache[r.race_id]
        standard_total = get_standard_total_sec(r.total_sec, difficulty)

        race_details.append({
            "race_id": race.id,
            "race_name": race.name,
            "event_id": race.event_id,
            "date": str(race.date) if race.date else None,
            "total_sec": r.total_sec,
            "standard_total_sec": standard_total,
            "swim_sec": r.swim_sec,
            "bike_sec": r.bike_sec,
            "run_sec": r.run_sec,
            "position": r.position,
            "difficulty_offset": difficulty,
        })

    return {
        "athlete_id": athlete_id,
        "first_name": first_result.first_name,
        "last_name": first_result.last_name,
        "country": first_result.country,
        "program_name": program_name,
        "strength": strength,
        "strength_swim": strength_data.get("strength_swim") if strength_data else None,
        "strength_t1": strength_data.get("strength_t1") if strength_data else None,
        "strength_bike": strength_data.get("strength_bike") if strength_data else None,
        "strength_t2": strength_data.get("strength_t2") if strength_data else None,
        "strength_run": strength_data.get("strength_run") if strength_data else None,
        "race_count": len(race_details),
        "races": race_details,
    }
