"""FastAPIメインアプリケーション"""
from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlmodel import Session, select
from app.database import init_db
from app.deps import get_db
from app.models import Result
from app.routers import admin, races, athletes, rankings, predict, world_ranking

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


@app.on_event("startup")
async def startup_event():
    """起動時にDBを初期化"""
    init_db()


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
    q = select(Result).where(
        Result.status == "Finished",
        Result.total_sec.isnot(None),
    ).limit(1000)
    results = session.exec(q).all()
    programs = sorted(set(r.program_name for r in results if r.program_name))
    return {"programs": programs}
