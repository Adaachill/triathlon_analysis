from sqlmodel import create_engine, SQLModel, Session

DATABASE_URL = "sqlite:///./app.db"

engine = create_engine(
    DATABASE_URL, echo=False, connect_args={"check_same_thread": False}
)


def init_db() -> None:
    """データベーステーブルを作成"""
    SQLModel.metadata.create_all(engine)


def get_session():
    """DBセッションを取得（依存性注入用）"""
    with Session(engine) as session:
        yield session
