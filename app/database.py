import os
from sqlmodel import create_engine, SQLModel, Session

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./app.db")

# Neon / 旧Heroku は "postgres://" で始まる場合がある
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, echo=False, connect_args=connect_args)


def init_db() -> None:
    """データベーステーブルを作成し、カラム追加マイグレーションを実行"""
    from sqlalchemy import inspect, text
    SQLModel.metadata.create_all(engine)
    insp = inspect(engine)
    if "race" in insp.get_table_names():
        existing = [c["name"] for c in insp.get_columns("race")]
        if "points" not in existing:
            with engine.connect() as conn:
                conn.execute(text("ALTER TABLE race ADD COLUMN points INTEGER"))
                conn.commit()
        # event_id に UNIQUE インデックスが存在しない場合は追加する
        existing_indexes = [idx["name"] for idx in insp.get_indexes("race")]
        if "uq_race_event_id" not in existing_indexes:
            with engine.connect() as conn:
                conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_race_event_id ON race (event_id)"))
                conn.commit()


def get_session():
    """DBセッションを取得（依存性注入用）"""
    with Session(engine) as session:
        yield session
