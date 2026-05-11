import os
from sqlmodel import create_engine, SQLModel, Session

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./app.db")

# Neon / 旧Heroku は "postgres://" で始まる場合がある
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, echo=False, connect_args=connect_args)


def init_db() -> None:
    """データベーステーブルを作成"""
    SQLModel.metadata.create_all(engine)


def get_session():
    """DBセッションを取得（依存性注入用）"""
    with Session(engine) as session:
        yield session
