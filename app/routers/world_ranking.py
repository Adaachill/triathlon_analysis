"""世界ランキングAPI（開発中）"""
from datetime import date, timedelta
from fastapi import APIRouter, Query, Depends
from sqlmodel import Session, select
from app.deps import get_db
from app.models import Race, Result

router = APIRouter(prefix="/world-ranking", tags=["world-ranking"])

DECAY = 0.925  # 順位ごとのポイント減衰率


def _calc_position_points(win_points: int, position: int) -> float:
    """順位に応じたポイントを計算。1位=win_points, n位=win_points * 0.925^(n-1)"""
    return win_points * (DECAY ** (position - 1))


@router.get("")
async def get_world_ranking(
    as_of_date: str = Query(..., description="基準日 (YYYY-MM-DD)"),
    program_name: str = Query(..., description="カテゴリ名"),
    session: Session = Depends(get_db),
):
    """
    指定日時点での世界ランキングを計算する。

    - Period1: 基準日から過去365日以内のレース（全ポイント）
    - Period2: 基準日から366〜730日前のレース（ポイントの1/3）
    - 各期間の上位3大会のみ加算
    """
    as_of = date.fromisoformat(as_of_date)
    period1_start = as_of - timedelta(days=365)
    period2_start = as_of - timedelta(days=730)

    # ポイントが設定されているレースを取得
    races = session.exec(
        select(Race).where(Race.points.isnot(None), Race.date.isnot(None))
    ).all()

    # 期間ごとに分類（基準日以前のみ）
    period1_race_ids: set[int] = set()
    period2_race_ids: set[int] = set()
    race_info: dict[int, dict] = {}

    for r in races:
        if r.date is None or r.points is None or r.id is None:
            continue
        race_info[r.id] = {"name": r.name, "date": str(r.date), "points": r.points}
        if period1_start < r.date <= as_of:
            period1_race_ids.add(r.id)
        elif period2_start < r.date <= period1_start:
            period2_race_ids.add(r.id)

    all_race_ids = period1_race_ids | period2_race_ids
    if not all_race_ids:
        return _empty_response(program_name, as_of_date, period1_start, period2_start)

    # 対象レースの完走結果を取得
    results = session.exec(
        select(Result).where(
            Result.race_id.in_(list(all_race_ids)),
            Result.program_name == program_name,
            Result.status == "Finished",
            Result.position.isnot(None),
        )
    ).all()

    # 選手ごと・レースごとにポイントを集計
    # athlete_id -> race_id -> points earned
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
            [{"race_id": rid, "race_name": race_info[rid]["name"], "date": race_info[rid]["date"], "points": pts}
             for rid, pts in p1_pts.items()],
            key=lambda x: x["points"], reverse=True
        )
        p2_races = sorted(
            [{"race_id": rid, "race_name": race_info[rid]["name"], "date": race_info[rid]["date"], "points": pts}
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
        "current_start": str(period1_start + timedelta(days=1)),
        "current_end": as_of_date,
        "previous_start": str(period2_start + timedelta(days=1)),
        "previous_end": str(period1_start),
        "rankings": rankings,
    }


def _empty_response(program_name: str, as_of_date: str, period1_start: date, period2_start: date) -> dict:
    return {
        "program_name": program_name,
        "as_of_date": as_of_date,
        "current_start": str(period1_start + timedelta(days=1)),
        "current_end": as_of_date,
        "previous_start": str(period2_start + timedelta(days=1)),
        "previous_end": str(period1_start),
        "rankings": [],
    }
