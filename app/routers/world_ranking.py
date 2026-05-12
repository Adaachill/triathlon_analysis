"""世界ランキングAPI（開発中）"""
from datetime import date, timedelta
from fastapi import APIRouter, Query, Depends
from sqlmodel import Session, select
from app.deps import get_db
from app.models import Race, Result
from app.services.als_optimizer import get_optimized_program

router = APIRouter(prefix="/world-ranking", tags=["world-ranking"])

DECAY = 0.925  # 順位ごとのポイント減衰率

# 予測に使用する最大出場選手数（強さ上位N名を仮想参加者とする）
_PREDICTION_MAX_ATHLETES = 30


def _calc_position_points(win_points: int, position: int) -> float:
    """順位に応じたポイントを計算。1位=win_points, n位=win_points * 0.925^(n-1)"""
    return win_points * (DECAY ** (position - 1))


@router.get("")
async def get_world_ranking(
    as_of_date: str = Query(..., description="基準日 (YYYY-MM-DD)"),
    program_name: str = Query(..., description="カテゴリ名"),
    prediction_mode: str = Query(
        "none",
        description="未来レースの予測モード: none / all / startlist_only",
    ),
    startlist_event_ids: str = Query(
        "",
        description="スタートリスト公開済みのAlgolia event_id（カンマ区切り）。prediction_mode=startlist_onlyのとき使用",
    ),
    session: Session = Depends(get_db),
):
    """
    指定日時点での世界ランキングを計算する。

    - Period1: 基準日から過去365日以内のレース（全ポイント）
    - Period2: 基準日から366〜730日前のレース（ポイントの1/3）
    - 各期間の上位3大会のみ加算

    prediction_mode:
    - none: 今日以前の実績レースのみ使用（デフォルト）
    - all: 基準日までの未来レースをすべて強さランク順で予測
    - startlist_only: startlist_event_ids で指定したレースのみ予測
    """
    as_of = date.fromisoformat(as_of_date)
    today = date.today()
    period1_start = as_of - timedelta(days=365)
    period2_start = as_of - timedelta(days=730)

    include_predictions = prediction_mode != "none"

    # ポイントが設定されているレースを取得
    races = session.exec(
        select(Race).where(Race.points.isnot(None), Race.date.isnot(None))
    ).all()

    cutoff = as_of if include_predictions else min(as_of, today)

    # startlist_only モードのとき、フロントエンドが渡した event_id セットを保持
    startlist_ids: set[str] = set()
    if prediction_mode == "startlist_only" and startlist_event_ids:
        startlist_ids = {eid.strip() for eid in startlist_event_ids.split(",") if eid.strip()}

    period1_race_ids: set[int] = set()
    period2_race_ids: set[int] = set()
    race_info: dict[int, dict] = {}
    future_race_ids: set[int] = set()

    for r in races:
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
        if period1_start < r.date <= cutoff:
            # 未来レースで startlist_only モードの場合、startlist_ids に含まれないものはスキップ
            if is_future and prediction_mode == "startlist_only":
                if r.event_id and r.event_id in startlist_ids:
                    period1_race_ids.add(r.id)
                    future_race_ids.add(r.id)
            else:
                period1_race_ids.add(r.id)
                if is_future:
                    future_race_ids.add(r.id)
        elif period2_start < r.date <= period1_start:
            period2_race_ids.add(r.id)

    all_race_ids = period1_race_ids | period2_race_ids
    if not all_race_ids:
        return _empty_response(program_name, as_of_date, period1_start, period2_start, prediction_mode)

    # 対象レースの実績結果を取得（過去レースのみ）
    past_race_ids = {rid for rid in all_race_ids if rid not in future_race_ids}
    results = []
    if past_race_ids:
        results = session.exec(
            select(Result).where(
                Result.race_id.in_(list(past_race_ids)),
                Result.program_name == program_name,
                Result.status == "Finished",
                Result.position.isnot(None),
            )
        ).all()

    # 選手ごと・レースごとにポイントを集計
    athlete_race_points: dict[str, dict[int, float]] = {}
    athlete_info: dict[str, dict] = {}

    for r in results:
        if r.race_id not in race_info or r.position is None:
            continue
        win_pts = race_info[r.race_id]["points"]
        earned = _calc_position_points(win_pts, r.position)
        athlete_race_points.setdefault(r.athlete_id, {})[r.race_id] = earned
        if r.athlete_id not in athlete_info:
            athlete_info[r.athlete_id] = {
                "first_name": r.first_name,
                "last_name": r.last_name,
                "country": r.country,
            }

    # 未来レースの予測ポイントを追加（強さランク順を予測順位として使用）
    if include_predictions and future_race_ids:
        _apply_prediction(
            session=session,
            program_name=program_name,
            future_race_ids=future_race_ids,
            race_info=race_info,
            athlete_race_points=athlete_race_points,
            athlete_info=athlete_info,
        )

    # 選手ごとにランキングポイントを計算
    rankings = []
    for athlete_id, race_pts in athlete_race_points.items():
        # Period1: 上位3大会
        p1_pts = {rid: pts for rid, pts in race_pts.items() if rid in period1_race_ids}
        p1_top3 = sorted(p1_pts.values(), reverse=True)[:3]
        p1_total = sum(p1_top3)

        # Period2: 上位3大会（合計の1/3）
        p2_pts = {rid: pts for rid, pts in race_pts.items() if rid in period2_race_ids}
        p2_top3 = sorted(p2_pts.values(), reverse=True)[:3]
        p2_total = sum(p2_top3) / 3

        total = p1_total + p2_total

        # 貢献レース詳細
        p1_races = sorted(
            [{"race_id": rid, "race_name": race_info[rid]["name"], "date": race_info[rid]["date"],
              "points": pts, "is_future": race_info[rid]["is_future"]}
             for rid, pts in p1_pts.items()],
            key=lambda x: x["points"], reverse=True
        )
        p2_races = sorted(
            [{"race_id": rid, "race_name": race_info[rid]["name"], "date": race_info[rid]["date"],
              "points": pts, "is_future": race_info[rid]["is_future"]}
             for rid, pts in p2_pts.items()],
            key=lambda x: x["points"], reverse=True
        )

        info = athlete_info[athlete_id]
        rankings.append({
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
        })

    rankings.sort(key=lambda x: x["total_points"], reverse=True)

    return {
        "program_name": program_name,
        "as_of_date": as_of_date,
        "prediction_mode": prediction_mode,
        "current_start": str(period1_start + timedelta(days=1)),
        "current_end": as_of_date,
        "previous_start": str(period2_start + timedelta(days=1)),
        "previous_end": str(period1_start),
        "rankings": rankings,
    }


def _apply_prediction(
    session: Session,
    program_name: str,
    future_race_ids: set[int],
    race_info: dict[int, dict],
    athlete_race_points: dict[str, dict[int, float]],
    athlete_info: dict[str, dict],
) -> None:
    """強さランク順を予測順位として未来レースのポイントを athlete_race_points に追加する（破壊的更新）"""
    try:
        opt = get_optimized_program(session, program_name)
    except Exception:
        return

    athlete_strengths = opt.get("athlete_strengths", {})
    if not athlete_strengths:
        return

    # 強さでソート（値が小さいほど速い = 上位）
    ranked_athletes = sorted(
        [(aid, s["strength"]) for aid, s in athlete_strengths.items() if s.get("strength") is not None],
        key=lambda x: x[1],
    )[:_PREDICTION_MAX_ATHLETES]

    if not ranked_athletes:
        return

    # 名前・国情報を取得（既存の athlete_info を流用、なければ Result から補完）
    known_ids = set(athlete_info.keys())
    missing_ids = {aid for aid, _ in ranked_athletes} - known_ids
    if missing_ids:
        name_rows = session.exec(
            select(Result).where(
                Result.athlete_id.in_(list(missing_ids)),
                Result.program_name == program_name,
            )
        ).all()
        for row in name_rows:
            if row.athlete_id not in athlete_info:
                athlete_info[row.athlete_id] = {
                    "first_name": row.first_name,
                    "last_name": row.last_name,
                    "country": row.country,
                }

    for race_id in future_race_ids:
        ri = race_info.get(race_id)
        if ri is None:
            continue
        win_pts = ri["points"]
        for position, (athlete_id, _) in enumerate(ranked_athletes, 1):
            if athlete_id not in athlete_info:
                continue
            earned = _calc_position_points(win_pts, position)
            # 実績がある場合は実績を優先（上書きしない）
            existing = athlete_race_points.get(athlete_id, {})
            if race_id not in existing:
                athlete_race_points.setdefault(athlete_id, {})[race_id] = earned


def _empty_response(
    program_name: str, as_of_date: str, period1_start: date, period2_start: date, prediction_mode: str = "none"
) -> dict:
    return {
        "program_name": program_name,
        "as_of_date": as_of_date,
        "prediction_mode": prediction_mode,
        "current_start": str(period1_start + timedelta(days=1)),
        "current_end": as_of_date,
        "previous_start": str(period2_start + timedelta(days=1)),
        "previous_end": str(period1_start),
        "rankings": [],
    }
