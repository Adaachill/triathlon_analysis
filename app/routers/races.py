"""レース関連API"""
from typing import Optional
from datetime import date
from fastapi import APIRouter, Query, Depends
from pydantic import BaseModel
from sqlmodel import Session, select
from app.deps import get_db
from app.models import Race, Result
from app.services.difficulty import (
    compute_race_difficulty_with_n,
    compute_race_difficulty_segments_with_n,
    compute_race_difficulty_cross_with_n,
    compute_race_difficulty_segments_cross_with_n,
    get_standard_total_sec,
    SEGMENT_FIELDS,
)
from app.services.als_optimizer import get_optimized_program

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
    difficulty_n: int = 0
    difficulty_segments = None
    difficulty_segments_n: dict[str, int] | None = None
    difficulty_cross: float | None = None
    difficulty_n_cross: int = 0
    difficulty_segments_cross: dict[str, float | None] | None = None
    difficulty_segments_n_cross: dict[str, int] | None = None

    difficulty_als: float | None = None
    difficulty_n_als: int = 0
    difficulty_segments_als: dict[str, float | None] | None = None

    strength_rank_map: dict[str, int] = {}
    als_race_diffs: dict[str, float] = {}

    if program_name:
        difficulty, difficulty_n = compute_race_difficulty_with_n(session, race_id, program_name)
        difficulty_segments, difficulty_segments_n = compute_race_difficulty_segments_with_n(
            session, race_id, program_name
        )
        difficulty_cross, difficulty_n_cross = compute_race_difficulty_cross_with_n(
            session, race_id, program_name
        )
        difficulty_segments_cross, difficulty_segments_n_cross = (
            compute_race_difficulty_segments_cross_with_n(session, race_id, program_name)
        )

        # ALS 最適化で難易度・強さを取得
        opt = get_optimized_program(session, program_name)
        als_race_diffs = opt["race_difficulties"].get(race_id, {})
        als_strengths = opt["athlete_strengths"]
        als_counts = opt["athlete_race_counts"]
        als_outlier_weights = opt["outlier_weights"]

        difficulty_als = als_race_diffs.get("total_sec")
        difficulty_segments_als = {f: als_race_diffs.get(f) for f in SEGMENT_FIELDS}

        # ALS N: レースの完走選手のうち athlete_race_counts >= 2 の人数
        difficulty_n_als = sum(
            1
            for r in results
            if r.status == "Finished"
            and r.total_sec is not None
            and als_counts.get(r.athlete_id, 0) >= 2
        )

        # strength_rank: ALS strength を使用
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

        if program_name:
            # outlier_weight（ALS外れ値の重み）
            result_dict["outlier_weight"] = (
                als_outlier_weights.get(race_id, {}).get(r.athlete_id, 1.0)
            )

            # 予想セグメントタイム = ALS strength + ALS difficulty
            als_str = als_strengths.get(r.athlete_id, {})
            for seg in _SEGS:
                strength_val = als_str.get(f"strength_{seg}")
                diff_val = als_race_diffs.get(f"{seg}_sec", 0.0)
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
        "difficulty_n": difficulty_n,
        "difficulty_segments": difficulty_segments,
        "difficulty_segments_n": difficulty_segments_n,
        "difficulty_cross": difficulty_cross,
        "difficulty_n_cross": difficulty_n_cross,
        "difficulty_segments_cross": difficulty_segments_cross,
        "difficulty_segments_n_cross": difficulty_segments_n_cross,
        "difficulty_als": difficulty_als,
        "difficulty_n_als": difficulty_n_als,
        "difficulty_segments_als": difficulty_segments_als,
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
