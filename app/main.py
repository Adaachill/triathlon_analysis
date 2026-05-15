"""FastAPIメインアプリケーション"""
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select, func
from app.database import init_db, engine
from app.deps import get_db
from app.models import Race, Result
from app.routers import admin, races, athletes, rankings, predict, world_ranking, wt_import

app = FastAPI(
    title="Triathlon Analysis API",
    description="レース結果分析API（MVP）",
    version="0.1.0",
)

# CORS設定（GitHub Pagesからのアクセス用）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # MVPでは全許可、本番では適切に制限
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ルーターを登録
app.include_router(admin.router)
app.include_router(races.router)
app.include_router(athletes.router)
app.include_router(rankings.router)
app.include_router(predict.router)
app.include_router(world_ranking.router)
app.include_router(wt_import.router)


@app.on_event("startup")
async def startup_event():
    """起動時にDBを初期化してALSキャッシュを事前ウォームアップ"""
    init_db()
    try:
        from app.services.als_optimizer import (
            load_als_from_db, compute_optimized_unified, save_als_to_db, _CACHE
        )
        with Session(engine) as session:
            db_result = load_als_from_db(session)
            if db_result and db_result.get("program_results"):
                _CACHE["__unified__"] = db_result
            else:
                unified = compute_optimized_unified(session)
                save_als_to_db(session, unified)
                _CACHE["__unified__"] = unified
    except Exception:
        pass


@app.get("/")
async def root():
    """ルートエンドポイント（warm-up Ping にも利用）"""
    return {
        "message": "Triathlon Analysis API",
        "docs": "/docs",
    }


@app.get("/programs")
async def list_programs(session: Session = Depends(get_db)):
    """Program Name 一覧（Finished かつ total_sec ありの結果から）"""
    rows = session.exec(
        select(Result.program_name).where(
            Result.status == "Finished",
            Result.total_sec.isnot(None),
        ).distinct()
    ).all()
    programs = sorted(p for p in rows if p and p.startswith("PT"))
    return {"programs": programs}


@app.get("/stats")
async def get_stats(session: Session = Depends(get_db)):
    """サイト全体の統計情報（ホーム画面ダッシュボード用）"""
    race_count = session.exec(select(func.count()).select_from(Race)).one()
    athlete_count = session.exec(
        select(func.count(func.distinct(Result.athlete_id))).where(
            Result.status == "Finished",
            Result.total_sec.isnot(None),
        )
    ).one()
    result_count = session.exec(
        select(func.count()).select_from(Result).where(Result.status == "Finished")
    ).one()
    program_count = session.exec(
        select(func.count(func.distinct(Result.program_name))).where(
            Result.status == "Finished",
            Result.total_sec.isnot(None),
        )
    ).one()
    last_race_date = session.exec(select(func.max(Race.date))).one()

    return {
        "race_count": int(race_count or 0),
        "athlete_count": int(athlete_count or 0),
        "result_count": int(result_count or 0),
        "program_count": int(program_count or 0),
        "last_race_date": str(last_race_date) if last_race_date else None,
    }
