"""世界ランキングAPI（開発中）"""
import re
from datetime import date, timedelta
from fastapi import APIRouter, Query, Depends
from sqlmodel import Session, select
from app.deps import get_db
from app.models import Race, Result, Startlist
from app.services.als_optimizer import get_optimized_program

router = APIRouter(prefix="/world-ranking", tags=["world-ranking"])

DECAY = 0.925  # 順位ごとのポイント減衰率
_PREDICTION_MODES = ("none", "previous_year", "startlist")


def _calc_position_points(win_points: int, position: int) -> float:
    return win_points * (DECAY ** (position - 1))


def _normalize_race_name(name: str | None) -> str:
    """年号（4桁数字）を除去して正規化"""
    if not name:
        return ""
    return re.sub(r"\b\d{4}\b", "", name).strip().lower()


def _find_prev_year_race(future_race: Race, all_races: list[Race]) -> Race | None:
    """前年の同一大会（年号以外のレース名が一致）を検索"""
    if not future_race.date or not future_race.name:
        return None
    target_year = future_race.date.year
    target_norm = _normalize_race_name(future_race.name)
    if not target_norm:
        return None
    best: Race | None = None
    for r in all_races:
        if r.date and r.date.year == target_year - 1 and r.id != future_race.id:
            if _normalize_race_name(r.name) == target_norm:
                if best is None or r.date > best.date:
                    best = r
    return best


def _compute_rankings(
    session: Session,
    program_name: str,
    cutoff: date,
    period1_start: date,
    period2_start: date,
    prediction_mode: str,
    all_races: list[Race],
    today: date,
) -> tuple[list[dict], list[dict]]:
    """
    ランキングを計算して (rankings, predicted_races) を返す。

    predicted_races: 予測に使った未来レースの情報リスト
    """
    period1_race_ids: set[int] = set()
    period2_race_ids: set[int] = set()
    future_race_ids: set[int] = set()
    race_info: dict[int, dict] = {}
    race_obj_map: dict[int, Race] = {}

    for r in all_races:
        if r.date is None or r.points is None or r.id is None:
            continue
        is_future = r.date > today
        race_info[r.id] = {
            "name": r.name,
            "date": str(r.date),
            "points": r.points,
            "is_future": is_future,
            "event_id": r.event_id or "",
        }
        race_obj_map[r.id] = r

        if period1_start < r.date <= cutoff:
            if is_future and prediction_mode != "none":
                period1_race_ids.add(r.id)
                future_race_ids.add(r.id)
            elif not is_future:
                period1_race_ids.add(r.id)
        elif period2_start < r.date <= period1_start:
            period2_race_ids.add(r.id)

    all_race_ids = period1_race_ids | period2_race_ids
    if not all_race_ids:
        return [], []

    # 過去レースの実績結果を取得
    past_race_ids = {rid for rid in all_race_ids if rid not in future_race_ids}
    athlete_race_points: dict[str, dict[int, float]] = {}
    athlete_info: dict[str, dict] = {}

    if past_race_ids:
        for r in session.exec(
            select(Result).where(
                Result.race_id.in_(list(past_race_ids)),
                Result.program_name == program_name,
                Result.status == "Finished",
                Result.position.isnot(None),
            )
        ).all():
            if r.race_id not in race_info or r.position is None:
                continue
            earned = _calc_position_points(race_info[r.race_id]["points"], r.position)
            athlete_race_points.setdefault(r.athlete_id, {})[r.race_id] = earned
            if r.athlete_id not in athlete_info:
                athlete_info[r.athlete_id] = {
                    "first_name": r.first_name,
                    "last_name": r.last_name,
                    "country": r.country,
                }

    # 未来レースの予測
    predicted_races: list[dict] = []
    if prediction_mode != "none" and future_race_ids:
        if prediction_mode == "startlist":
            predicted_races = _apply_prediction_from_startlist(
                session=session,
                program_name=program_name,
                future_race_ids=future_race_ids,
                race_info=race_info,
                race_obj_map=race_obj_map,
                athlete_race_points=athlete_race_points,
                athlete_info=athlete_info,
            )
        else:
            # previous_year: 前年同一大会の参加者で予測
            predicted_races = _apply_prediction_from_prev_year(
                session=session,
                program_name=program_name,
                future_race_ids=future_race_ids,
                all_races=all_races,
                race_info=race_info,
                race_obj_map=race_obj_map,
                athlete_race_points=athlete_race_points,
                athlete_info=athlete_info,
            )

    # ランキング計算
    rankings = []
    for athlete_id, race_pts in athlete_race_points.items():
        p1_pts = {rid: pts for rid, pts in race_pts.items() if rid in period1_race_ids}
        p1_top3 = sorted(p1_pts.values(), reverse=True)[:3]
        p1_total = sum(p1_top3)

        p2_pts = {rid: pts for rid, pts in race_pts.items() if rid in period2_race_ids}
        p2_top3 = sorted(p2_pts.values(), reverse=True)[:3]
        p2_total = sum(p2_top3) / 3

        total = p1_total + p2_total

        p1_races = sorted(
            [
                {
                    "race_id": rid,
                    "race_name": race_info[rid]["name"],
                    "date": race_info[rid]["date"],
                    "points": pts,
                    "is_future": race_info[rid]["is_future"],
                    "is_counted": idx < 3,
                }
                for idx, (rid, pts) in enumerate(
                    sorted(p1_pts.items(), key=lambda x: x[1], reverse=True)
                )
            ],
            key=lambda x: x["points"],
            reverse=True,
        )
        p2_races = sorted(
            [
                {
                    "race_id": rid,
                    "race_name": race_info[rid]["name"],
                    "date": race_info[rid]["date"],
                    "points": pts,
                    "is_future": race_info[rid]["is_future"],
                    "is_counted": idx < 3,
                }
                for idx, (rid, pts) in enumerate(
                    sorted(p2_pts.items(), key=lambda x: x[1], reverse=True)
                )
            ],
            key=lambda x: x["points"],
            reverse=True,
        )

        info = athlete_info[athlete_id]
        rankings.append(
            {
                "athlete_id": athlete_id,
                "first_name": info["first_name"],
                "last_name": info["last_name"],
                "country": info["country"],
                "total_points": round(total, 2),
                "period1_points": round(p1_total, 2),
                "period2_points_raw": round(sum(p2_top3), 2),
                "period2_points": round(p2_total, 2),
                "period1_races": p1_races,
                "period2_races": p2_races,
            }
        )

    rankings.sort(key=lambda x: x["total_points"], reverse=True)
    return rankings, predicted_races


def _apply_prediction_from_startlist(
    session: Session,
    program_name: str,
    future_race_ids: set[int],
    race_info: dict[int, dict],
    race_obj_map: dict[int, Race],
    athlete_race_points: dict[str, dict[int, float]],
    athlete_info: dict[str, dict],
) -> list[dict]:
    """Startlist テーブルから参加者を取得し、強さランク順で順位を決定して予測ポイントを計算。"""
    try:
        opt = get_optimized_program(session, program_name)
        strength_map: dict[str, float] = {
            aid: s["strength"]
            for aid, s in opt.get("athlete_strengths", {}).items()
            if s.get("strength") is not None
        }
    except Exception:
        strength_map = {}

    predicted_races: list[dict] = []

    for race_id in future_race_ids:
        ri = race_info.get(race_id)
        future_race = race_obj_map.get(race_id)
        if ri is None or future_race is None or not future_race.event_id:
            continue

        startlist_entries = session.exec(
            select(Startlist).where(
                Startlist.event_id == future_race.event_id,
                Startlist.program_name == program_name,
            )
        ).all()

        if not startlist_entries:
            continue

        sorted_entries = sorted(
            startlist_entries,
            key=lambda x: strength_map.get(x.athlete_id, float("inf")),
        )

        win_pts = ri["points"]
        added_count = 0

        for position, entry in enumerate(sorted_entries, 1):
            earned = _calc_position_points(win_pts, position)
            if race_id not in athlete_race_points.get(entry.athlete_id, {}):
                athlete_race_points.setdefault(entry.athlete_id, {})[race_id] = earned
                added_count += 1
            if entry.athlete_id not in athlete_info:
                athlete_info[entry.athlete_id] = {
                    "first_name": entry.first_name,
                    "last_name": entry.last_name,
                    "country": entry.country,
                }

        if added_count > 0:
            predicted_races.append(
                {
                    "race_id": race_id,
                    "race_name": ri["name"],
                    "date": ri["date"],
                    "points": ri["points"],
                    "based_on_race_id": None,
                    "based_on_race_name": None,
                    "participants_count": added_count,
                    "is_startlist": True,
                }
            )

    return predicted_races


def _apply_prediction_from_prev_year(
    session: Session,
    program_name: str,
    future_race_ids: set[int],
    all_races: list[Race],
    race_info: dict[int, dict],
    race_obj_map: dict[int, Race],
    athlete_race_points: dict[str, dict[int, float]],
    athlete_info: dict[str, dict],
) -> list[dict]:
    """前年同一大会の参加者リストを取得し、強さランク順で順位を決定して予測ポイントを計算。"""
    try:
        opt = get_optimized_program(session, program_name)
        strength_map: dict[str, float] = {
            aid: s["strength"]
            for aid, s in opt.get("athlete_strengths", {}).items()
            if s.get("strength") is not None
        }
    except Exception:
        strength_map = {}

    predicted_races: list[dict] = []

    for race_id in future_race_ids:
        ri = race_info.get(race_id)
        future_race = race_obj_map.get(race_id)
        if ri is None or future_race is None:
            continue

        prev_race = _find_prev_year_race(future_race, all_races)
        if prev_race is None:
            continue

        prev_results = session.exec(
            select(Result).where(
                Result.race_id == prev_race.id,
                Result.program_name == program_name,
                Result.status == "Finished",
                Result.position.isnot(None),
            )
        ).all()
        if not prev_results:
            continue

        sorted_results = sorted(
            prev_results,
            key=lambda x: strength_map.get(x.athlete_id, float("inf")),
        )

        win_pts = ri["points"]
        added_count = 0

        for position, result in enumerate(sorted_results, 1):
            earned = _calc_position_points(win_pts, position)
            if race_id not in athlete_race_points.get(result.athlete_id, {}):
                athlete_race_points.setdefault(result.athlete_id, {})[race_id] = earned
                added_count += 1
            if result.athlete_id not in athlete_info:
                athlete_info[result.athlete_id] = {
                    "first_name": result.first_name,
                    "last_name": result.last_name,
                    "country": result.country,
                }

        if added_count > 0:
            predicted_races.append(
                {
                    "race_id": race_id,
                    "race_name": ri["name"],
                    "date": ri["date"],
                    "points": ri["points"],
                    "based_on_race_id": prev_race.id,
                    "based_on_race_name": prev_race.name,
                    "participants_count": added_count,
                    "is_startlist": False,
                }
            )

    return predicted_races


@router.get("")
async def get_world_ranking(
    as_of_date: str = Query(..., description="基準日 (YYYY-MM-DD)"),
    program_name: str = Query(..., description="カテゴリ名"),
    prediction_mode: str = Query(
        "none",
        description="予測モード: none / previous_year / startlist",
    ),
    session: Session = Depends(get_db),
):
    """
    指定日時点での世界ランキングを計算する。

    - Period1: 基準日から過去365日以内（全ポイント、上位3大会）
    - Period2: 基準日から366〜730日前（ポイントの1/3、上位3大会）

    prediction_mode:
    - none: 実績のみ（デフォルト）
    - previous_year: 前年同一大会の参加者で予測
    - startlist: Startlist テーブルのエントリーリストから予測（要アップロード）

    未来日付の場合、今日時点のベースラインランキングも baseline_rankings として返す。
    """
    as_of = date.fromisoformat(as_of_date)
    today = date.today()
    period1_start = as_of - timedelta(days=365)
    period2_start = as_of - timedelta(days=730)

    all_races = session.exec(
        select(Race).where(Race.points.isnot(None), Race.date.isnot(None))
    ).all()

    include_predictions = prediction_mode != "none"
    cutoff = as_of if include_predictions else min(as_of, today)

    rankings, predicted_races = _compute_rankings(
        session=session,
        program_name=program_name,
        cutoff=cutoff,
        period1_start=period1_start,
        period2_start=period2_start,
        prediction_mode=prediction_mode,
        all_races=list(all_races),
        today=today,
    )

    baseline_rankings: list[dict] | None = None
    if as_of > today and include_predictions:
        baseline_period1_start = today - timedelta(days=365)
        baseline_period2_start = today - timedelta(days=730)
        baseline_rankings, _ = _compute_rankings(
            session=session,
            program_name=program_name,
            cutoff=today,
            period1_start=baseline_period1_start,
            period2_start=baseline_period2_start,
            prediction_mode="none",
            all_races=list(all_races),
            today=today,
        )

    return {
        "program_name": program_name,
        "as_of_date": as_of_date,
        "prediction_mode": prediction_mode,
        "current_start": str(period1_start + timedelta(days=1)),
        "current_end": as_of_date,
        "previous_start": str(period2_start + timedelta(days=1)),
        "previous_end": str(period1_start),
        "rankings": rankings,
        "predicted_races": predicted_races,
        "baseline_rankings": baseline_rankings,
    }
