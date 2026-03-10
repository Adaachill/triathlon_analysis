"""ランキングAPI"""
from fastapi import APIRouter, Query, Depends
from sqlmodel import Session, select
from app.deps import get_db
from app.models import Result
from app.services.als_optimizer import get_optimized_program

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
