"""ランキングAPI"""
from fastapi import APIRouter, Query, Depends
from sqlmodel import Session, select
from app.deps import get_db
from app.models import Result
from app.services.als_optimizer import get_optimized_program, compute_optimized_program

router = APIRouter(prefix="/rankings", tags=["rankings"])


@router.get("/top")
async def get_top_athletes(
    program_name: str = Query(..., description="Program Name（必須）"),
    limit: int = Query(50, ge=1, le=200, description="取得件数"),
    session: Session = Depends(get_db),
):
    """
    強さランキング（ALS最適化による strength が短い順）
    """
    # ALS 最適化で全選手の strength を一括取得
    opt = get_optimized_program(session, program_name)
    athlete_strengths = opt["athlete_strengths"]

    # 選手名・国情報を取得（各選手の最初の Result から）
    q_names = select(Result).where(
        Result.program_name == program_name,
        Result.status == "Finished",
    )
    name_by_id: dict[str, dict] = {}
    for r in session.exec(q_names).all():
        if r.athlete_id not in name_by_id:
            name_by_id[r.athlete_id] = {
                "first_name": r.first_name,
                "last_name": r.last_name,
                "country": r.country,
            }

    # ランキングを組み立て
    rankings = []
    for athlete_id, s_data in athlete_strengths.items():
        if s_data.get("strength") is not None:
            info = name_by_id.get(athlete_id, {})
            rankings.append({
                "athlete_id": athlete_id,
                "first_name": info.get("first_name", ""),
                "last_name": info.get("last_name", ""),
                "country": info.get("country", ""),
                "strength": s_data["strength"],
                "strength_swim": s_data.get("strength_swim"),
                "strength_t1": s_data.get("strength_t1"),
                "strength_bike": s_data.get("strength_bike"),
                "strength_t2": s_data.get("strength_t2"),
                "strength_run": s_data.get("strength_run"),
            })

    # strength 昇順（タイムが短い順）にソート
    rankings.sort(key=lambda x: x["strength"])

    return {
        "program_name": program_name,
        "rankings": rankings[:limit],
    }


@router.get("/diff")
async def get_rankings_diff(
    program_name: str = Query(..., description="Program Name（必須）"),
    new_race_id: int = Query(..., description="追加されたレースのrace_id"),
    session: Session = Depends(get_db),
):
    """
    指定レースを追加する前後でランキングがどう変わったかを返す。
    rank_change = rank_before - rank_after（正=上昇, 負=下降）
    """
    # 選手名・国情報
    q_names = select(Result).where(
        Result.program_name == program_name,
        Result.status == "Finished",
    )
    name_by_id: dict[str, dict] = {}
    for r in session.exec(q_names).all():
        if r.athlete_id not in name_by_id:
            name_by_id[r.athlete_id] = {
                "first_name": r.first_name,
                "last_name": r.last_name,
                "country": r.country,
            }

    # 追加後（現在）のランキング
    opt_after = get_optimized_program(session, program_name)
    strengths_after = opt_after["athlete_strengths"]

    # 追加前（new_race_id を除外）のランキング
    opt_before = compute_optimized_program(
        session, program_name, exclude_race_ids={new_race_id}
    )
    strengths_before = opt_before["athlete_strengths"]

    def _make_ranking(strengths: dict) -> dict[str, int]:
        """strength 昇順で順位辞書を返す"""
        ordered = sorted(
            [(aid, s["strength"]) for aid, s in strengths.items() if s.get("strength") is not None],
            key=lambda x: x[1],
        )
        return {aid: rank + 1 for rank, (aid, _) in enumerate(ordered)}

    rank_after_map = _make_ranking(strengths_after)
    rank_before_map = _make_ranking(strengths_before)

    # 全選手（追加後のランキングに存在するもの）を対象
    entries = []
    for athlete_id, rank_after in rank_after_map.items():
        s_after = strengths_after.get(athlete_id, {})
        s_before = strengths_before.get(athlete_id, {})
        rank_before = rank_before_map.get(athlete_id)
        strength_after = s_after.get("strength")
        strength_before = s_before.get("strength") if s_before else None

        rank_change = (rank_before - rank_after) if rank_before is not None else None
        strength_change = (
            (strength_before - strength_after)
            if strength_before is not None and strength_after is not None
            else None
        )

        info = name_by_id.get(athlete_id, {})
        entries.append({
            "athlete_id": athlete_id,
            "first_name": info.get("first_name", ""),
            "last_name": info.get("last_name", ""),
            "country": info.get("country", ""),
            "rank_after": rank_after,
            "rank_before": rank_before,
            "rank_change": rank_change,
            "strength_after": strength_after,
            "strength_before": strength_before,
            "strength_change": strength_change,
        })

    entries.sort(key=lambda x: x["rank_after"])

    return {
        "program_name": program_name,
        "new_race_id": new_race_id,
        "entries": entries,
    }
