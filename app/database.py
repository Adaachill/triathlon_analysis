import os
from sqlmodel import create_engine, SQLModel, Session

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./app.db")

# Neon / 旧Heroku は "postgres://" で始まる場合がある
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}

engine = create_engine(DATABASE_URL, echo=False, connect_args=connect_args)


def init_db() -> None:
    """データベーステーブルを作成し、カラム追加・データ整合性マイグレーションを実行"""
    from sqlalchemy import inspect, text
    SQLModel.metadata.create_all(engine)
    insp = inspect(engine)
    if "race" not in insp.get_table_names():
        return

    existing_cols = [c["name"] for c in insp.get_columns("race")]
    with engine.connect() as conn:
        if "points" not in existing_cols:
            conn.execute(text("ALTER TABLE race ADD COLUMN points INTEGER"))
            conn.commit()

        # event_id の float形式（例: "188993.0"）を整数文字列（"188993"）に正規化する。
        # 重複が発生した場合は Results を canonical な Race に集約して float側を削除する。
        _migrate_normalize_event_ids(conn, text)

        # event_id に UNIQUE インデックスが存在しない場合は追加する
        existing_indexes = [idx["name"] for idx in insp.get_indexes("race")]
        if "uq_race_event_id" not in existing_indexes:
            conn.execute(text(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_race_event_id ON race (event_id)"
            ))
            conn.commit()


def _migrate_normalize_event_ids(conn, text) -> None:
    """Race.event_id / Result.event_id の float形式を正規化し、
    重複 Race が存在する場合は Results を集約して孤立 Race を削除する。"""
    races = conn.execute(text("SELECT id, event_id FROM race ORDER BY id")).fetchall()

    for race_id, event_id in races:
        # 正規化: "100.0" -> "100"
        try:
            normalized = str(int(float(event_id)))
        except (ValueError, TypeError):
            continue
        if normalized == event_id:
            continue  # 既に正規化済み

        # 正規化済み event_id を持つ Race がすでに存在するか確認
        canonical = conn.execute(
            text("SELECT id FROM race WHERE event_id = :eid"),
            {"eid": normalized},
        ).fetchone()

        if canonical:
            # 正規版が存在する → float版の Results を正規版に移し替えて float版を削除
            canon_id = canonical[0]
            conn.execute(
                text("UPDATE result SET race_id = :new_id, event_id = :new_eid WHERE race_id = :old_id"),
                {"new_id": canon_id, "new_eid": normalized, "old_id": race_id},
            )
            conn.execute(text("DELETE FROM race WHERE id = :id"), {"id": race_id})
        else:
            # 正規版が存在しない → この Race の event_id を正規化するだけ
            conn.execute(
                text("UPDATE race SET event_id = :new_eid WHERE id = :id"),
                {"new_eid": normalized, "id": race_id},
            )
            conn.execute(
                text("UPDATE result SET event_id = :new_eid WHERE race_id = :id"),
                {"new_eid": normalized, "id": race_id},
            )

    conn.commit()


def get_session():
    """DBセッションを取得（依存性注入用）"""
    with Session(engine) as session:
        yield session
