"""2026 Devonport 予想タイム・順位 API"""
from io import BytesIO
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from sqlmodel import Session, select

from app.deps import get_db
from app.models import Race
from app.services.als_optimizer import get_optimized_program

router = APIRouter(prefix="/predict", tags=["predict"])

# ── パス定数 ──────────────────────────────────────────────────────────────────
UPLOAD_DIR = Path(__file__).parent.parent.parent / "raw_excel"
DEFAULT_STARTLIST_PATH = UPLOAD_DIR / "event_startlist_195131.xlsx"
# アップロードされたスタートリストの保存先（最新1件を上書き保存）
UPLOADED_STARTLIST_PATH = UPLOAD_DIR / "uploaded_startlist_latest.xlsx"

DEVONPORT_2025_EVENT_ID = "194210"

COMPETITION_PROGRAMS = {
    "PTWC Men", "PTWC Women",
    "PTS2 Men", "PTS2 Women",
    "PTS3 Men", "PTS3 Women",
    "PTS4 Men", "PTS4 Women",
    "PTS5 Men", "PTS5 Women",
    "PTVI Men", "PTVI Women",
}

PROGRAM_ORDER = [
    "PTWC Men", "PTWC Women",
    "PTS2 Men", "PTS2 Women",
    "PTS3 Men", "PTS3 Women",
    "PTS4 Men", "PTS4 Women",
    "PTS5 Men", "PTS5 Women",
    "PTVI Men", "PTVI Women",
]

_SEGS = ["swim", "t1", "bike", "t2", "run"]


# ── ストレージ抽象化 ──────────────────────────────────────────────────────────
def _save_uploaded_startlist(content: bytes) -> Path:
    """
    アップロードされたスタートリストを保存する。

    【現在（ローカル開発）】
        raw_excel/uploaded_startlist_latest.xlsx に上書き保存。

    【将来（本番環境）への変更方法】
        1. この関数の実装をクラウドストレージ（AWS S3, GCS 等）への
           アップロードに置き換える。
        2. 戻り値を Path の代わりにダウンロード用の一時 URL (str) にする。
        3. 呼び出し側 (_parse_startlist) の引数型を Union[Path, str] にし、
           str の場合は requests.get() / boto3 等でダウンロードして BytesIO で読む。
        4. DB にアップロード履歴（ファイル名・日時・URL）を保存すれば
           複数のスタートリストを切り替えられるようになる。
    """
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    UPLOADED_STARTLIST_PATH.write_bytes(content)
    return UPLOADED_STARTLIST_PATH


# ── スタートリスト解析 ────────────────────────────────────────────────────────
def _parse_startlist(source: Path | BytesIO) -> list[dict]:
    """
    Excel（Path または BytesIO）からスタートリストを解析する。

    対応カラム名:
      - 選手ID  : "Member ID" または "Athlete ID"
      - 名前    : "First Name" / "Athlete First Name"
      - 苗字    : "Last Name"  / "Athlete Last Name"
      - 国      : "Country"
      - プログラム: "Program Name"
      - スタート番号: "Start Number"
    """
    df = pd.read_excel(source if isinstance(source, BytesIO) else str(source))
    athletes = []
    for _, row in df.iterrows():
        pname = str(row.get("Program Name", "")).strip()
        if pname not in COMPETITION_PROGRAMS:
            continue

        # 選手 ID（Member ID / Athlete ID どちらも許容）
        raw_id = row.get("Member ID") if pd.notna(row.get("Member ID", None)) else row.get("Athlete ID")
        if raw_id is None or pd.isna(raw_id):
            continue

        # 名前（フォーマットが違う場合も対応）
        first = str(row.get("First Name") or row.get("Athlete First Name") or "")
        last  = str(row.get("Last Name")  or row.get("Athlete Last Name")  or "")

        start_num = row.get("Start Number")
        athletes.append({
            "athlete_id": str(int(raw_id)),
            "first_name": first,
            "last_name": last,
            "country": str(row.get("Country", "")),
            "program_name": pname,
            "start_number": int(start_num) if pd.notna(start_num) else None,
        })
    return athletes


# ── 予想計算（共通ロジック） ──────────────────────────────────────────────────
def _build_prediction(s_data: dict | None, diff: dict) -> dict:
    """strength + difficulty で予想タイムを組み立てる"""
    if s_data is None or s_data.get("strength") is None:
        return {"total_sec": None, **{f"{seg}_sec": None for seg in _SEGS}}
    d_total = diff.get("total_sec", 0.0) or 0.0
    pred: dict = {"total_sec": float(s_data["strength"] + d_total)}
    for seg in _SEGS:
        d_seg = diff.get(f"{seg}_sec", 0.0) or 0.0
        s_seg = s_data.get(f"strength_{seg}")
        pred[f"{seg}_sec"] = float(s_seg + d_seg) if s_seg is not None else None
    return pred


def _assign_ranks(athletes: list[dict], pred_key: str, rank_key: str) -> None:
    ranked = sorted(
        [(a, a[pred_key]["total_sec"]) for a in athletes if a[pred_key]["total_sec"] is not None],
        key=lambda x: x[1],
    )
    for rank, (a, _) in enumerate(ranked, 1):
        a[rank_key] = rank
    for a in athletes:
        if rank_key not in a:
            a[rank_key] = None


def _compute_predictions(startlist: list[dict], session: Session) -> dict:
    """
    スタートリストと DB から予想タイム・順位を計算して返す（共通処理）。
    GET / POST どちらのエンドポイントもこの関数を呼び出す。
    """
    devonport_race = session.exec(
        select(Race).where(Race.event_id == DEVONPORT_2025_EVENT_ID)
    ).first()
    devonport_race_id = devonport_race.id if devonport_race else None

    by_program: dict[str, list[dict]] = {}
    for a in startlist:
        by_program.setdefault(a["program_name"], []).append(a)

    categories: dict[str, list[dict]] = {}
    devonport_difficulties: dict[str, dict] = {}

    for prog in PROGRAM_ORDER:
        if prog not in by_program:
            continue

        opt = get_optimized_program(session, prog)
        als_strengths = opt["athlete_strengths"]
        als_race_diffs = opt["race_difficulties"]

        devonport_diff = als_race_diffs.get(devonport_race_id, {}) if devonport_race_id else {}
        devonport_difficulties[prog] = devonport_diff

        result_athletes = []
        for a in by_program[prog]:
            s_data = als_strengths.get(a["athlete_id"])
            entry: dict = {
                **a,
                "has_history": s_data is not None,
                "strength":      s_data.get("strength")       if s_data else None,
                "strength_swim": s_data.get("strength_swim")  if s_data else None,
                "strength_t1":   s_data.get("strength_t1")    if s_data else None,
                "strength_bike": s_data.get("strength_bike")  if s_data else None,
                "strength_t2":   s_data.get("strength_t2")    if s_data else None,
                "strength_run":  s_data.get("strength_run")   if s_data else None,
                "pred_avg":       _build_prediction(s_data, {}),
                "pred_devonport": _build_prediction(s_data, devonport_diff),
            }
            result_athletes.append(entry)

        _assign_ranks(result_athletes, "pred_avg",       "rank_avg")
        _assign_ranks(result_athletes, "pred_devonport", "rank_devonport")
        categories[prog] = result_athletes

    return {
        "categories": categories,
        "devonport_race_id": devonport_race_id,
        "devonport_difficulties": devonport_difficulties,
    }


# ── エンドポイント ─────────────────────────────────────────────────────────────
@router.get("/2026-devonport")
async def predict_devonport(session: Session = Depends(get_db)):
    """取込済スタートリスト（event_startlist_195131.xlsx）から予想タイム・順位を返す"""
    startlist = _parse_startlist(DEFAULT_STARTLIST_PATH)
    result = _compute_predictions(startlist, session)
    result["source_label"] = "2026 Devonport（取込済スタートリスト）"
    result["source_filename"] = DEFAULT_STARTLIST_PATH.name
    return result


@router.post("/upload-startlist")
async def upload_startlist(
    file: UploadFile = File(...),
    session: Session = Depends(get_db),
):
    """
    スタートリスト Excel をアップロードして予想タイム・順位を返す。

    受け付けるフォーマット:
      - .xlsx のみ
      - カラム: "Member ID"（または "Athlete ID"）, "First Name", "Last Name",
                "Country", "Program Name", "Start Number"
    """
    if not (file.filename or "").endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="xlsx ファイルのみ受け付けます")

    content = await file.read()

    # ファイルを保存（将来: クラウドストレージへ変更 → _save_uploaded_startlist 参照）
    saved_path = _save_uploaded_startlist(content)

    # BytesIO から直接解析（保存済みファイルを再読みしても同じ）
    try:
        startlist = _parse_startlist(BytesIO(content))
    except Exception as e:
        raise HTTPException(status_code=422, detail=f"ファイル解析エラー: {e}")

    if not startlist:
        raise HTTPException(
            status_code=422,
            detail="競技カテゴリの選手が見つかりません。ファイル形式を確認してください。",
        )

    result = _compute_predictions(startlist, session)
    result["source_label"] = f"アップロード: {file.filename}"
    result["source_filename"] = file.filename
    return result


@router.get("/uploaded-startlist")
async def predict_uploaded(session: Session = Depends(get_db)):
    """最後にアップロードされたスタートリストから予想タイム・順位を返す"""
    if not UPLOADED_STARTLIST_PATH.exists():
        raise HTTPException(status_code=404, detail="アップロード済みのスタートリストがありません")
    startlist = _parse_startlist(UPLOADED_STARTLIST_PATH)
    result = _compute_predictions(startlist, session)
    result["source_label"] = f"アップロード: {UPLOADED_STARTLIST_PATH.name}"
    result["source_filename"] = UPLOADED_STARTLIST_PATH.name
    return result
