"""
FastAPI 用の DB 依存性

database.get_session をそのまま依存性として再公開する。
"""
from app.database import get_session


# FastAPI の Depends にはジェネレーター関数をそのまま渡せるので、
# get_session をエイリアスして使う。
get_db = get_session

