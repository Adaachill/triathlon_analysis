"""FastAPIメインアプリケーション"""
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select
from app.database import init_db, engine
from app.deps import get_db
from app.models import Result
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
    # ALS計算を事前実行してキャッシュに格納（最初のAPIリクエストの遅延を防ぐ）
    try:
        from app.services.als_optimizer import compute_optimized_unified, _CACHE
        with Session(engine) as session:
            _CACHE["__unified__"] = compute_optimized_unified(session)
    except Exception:
        pass  # DB未初期化などの場合は無視


@app.get("/")
async def root():
    """ルートエンドポイント"""
    return {
        "message": "Triathlon Analysis API",
        "docs": "/docs",
    }


@app.get("/programs")
async def list_programs(session: Session = Depends(get_db)):
    """Program Name 一覧（Finished かつ total_sec ありの結果から）"""
    from sqlalchemy import text as sa_text
    rows = session.exec(
        select(Result.program_name).where(
            Result.status == "Finished",
            Result.total_sec.isnot(None),
        ).distinct()
    ).all()
    programs = sorted(p for p in rows if p and p.startswith("PT"))
    return {"programs": programs}
