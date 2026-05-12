"""選手関連API"""
from typing import Optional
from fastapi import APIRouter, Query, Depends
from sqlmodel import Session, select
from app.deps import get_db
from app.models import Result, Race
from app.services.als_optimizer import get_optimized_program

router = APIRouter(prefix="/athletes", tags=["athletes"])


@router.get("/{athlete_id}")
async def get_athlete(
    athlete_id: str,
    program_name: str = Query(..., description="Program Name（必須）"),
    session: Session = Depends(get_db),
):
    """選手詳細を取得（ALS strength とレース履歴）"""
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

    first_result = results[0]

    # ALS 最適化で strength・難易度を取得
    opt = get_optimized_program(session, program_name)
    als_strengths = opt["athlete_strengths"]
    als_race_diffs = opt["race_difficulties"]

    strength_data = als_strengths.get(athlete_id)
    strength = strength_data.get("strength") if strength_data else None

    # レースを一括取得（N+1クエリを回避）
    race_ids = list({r.race_id for r in results})
    races_list = session.exec(select(Race).where(Race.id.in_(race_ids))).all()
    race_map: dict[int, Race] = {race.id: race for race in races_list if race.id is not None}

    all_race_athletes_cache: dict[int, list] = {}
    race_details = []

    for r in results:
        race = race_map.get(r.race_id)
        if not race:
            continue

        # ALS 難易度で標準化タイムを計算
        race_diffs = als_race_diffs.get(r.race_id, {})
        als_diff = race_diffs.get("total_sec")
        standard_total = (
            float(r.total_sec - als_diff)
            if r.total_sec is not None and als_diff is not None
            else None
        )

        # 同レースの全選手を取得して ALS strength 順位を計算
        if r.race_id not in all_race_athletes_cache:
            all_race_athletes_cache[r.race_id] = session.exec(
                select(Result).where(
                    Result.race_id == r.race_id,
                    Result.program_name == program_name,
                    Result.status == "Finished",
                    Result.total_sec.isnot(None),
                )
            ).all()

        athletes_with_strength: list[tuple[str, float]] = [
            (race_res.athlete_id, als_strengths[race_res.athlete_id]["strength"])
            for race_res in all_race_athletes_cache[r.race_id]
            if race_res.athlete_id in als_strengths
            and als_strengths[race_res.athlete_id].get("strength") is not None
        ]
        athletes_sorted = sorted(athletes_with_strength, key=lambda x: x[1])
        strength_rank: Optional[int] = next(
            (i + 1 for i, (aid, _) in enumerate(athletes_sorted) if aid == athlete_id),
            None,
        )

        # セグメント別 ALS 標準化タイム・予想タイム
        _seg_fields = ["swim_sec", "t1_sec", "bike_sec", "t2_sec", "run_sec"]
        standard_segs = {}
        pred_segs = {}
        for sf in _seg_fields:
            val = getattr(r, sf)
            seg_diff = race_diffs.get(sf)
            # 標準化: actual - diff（実績の難易度補正）
            standard_segs[f"standard_{sf}"] = (
                float(val - seg_diff) if val is not None and seg_diff is not None else None
            )
            # 予想タイム: strength + diff（レースページと同じ計算）
            seg_key = sf.replace("_sec", "")
            strength_seg = strength_data.get(f"strength_{seg_key}") if strength_data else None
            pred_segs[f"pred_{sf}"] = (
                float(strength_seg + seg_diff)
                if strength_seg is not None and seg_diff is not None
                else None
            )

        # 予想合計 = strength_total + diff_total（セグメント合計ではなくtotal_secモデルを使う）
        strength_total_val = strength_data.get("strength") if strength_data else None
        pred_total = (
            float(strength_total_val + als_diff)
            if strength_total_val is not None and als_diff is not None
            else None
        )

        race_details.append({
            "race_id": race.id,
            "race_name": race.name,
            "event_id": race.event_id,
            "date": str(race.date) if race.date else None,
            "total_sec": r.total_sec,
            "standard_total_sec": standard_total,
            "pred_total_sec": pred_total,
            "swim_sec": r.swim_sec,
            "t1_sec": r.t1_sec,
            "bike_sec": r.bike_sec,
            "t2_sec": r.t2_sec,
            "run_sec": r.run_sec,
            **standard_segs,
            **pred_segs,
            "position": r.position,
            "difficulty_offset": als_diff if als_diff is not None else 0.0,
            "strength_rank": strength_rank,
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
