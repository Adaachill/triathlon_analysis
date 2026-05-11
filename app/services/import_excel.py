"""Excelファイルからレース結果をインポートするサービス"""
import os
import pandas as pd
from pathlib import Path
from sqlmodel import Session, select, delete
from app.models import Race, Result

REFERENCE_EVENT_ID = "188993"  # 2025世界選手権

EXPECTED_COLUMNS = [
    "Event ID", "Athlete ID", "Athlete First Name", "Athlete Last Name",
    "Country", "Program ID", "Program Name", "Start Number", "Swim", "T1",
    "Bike", "T2", "Run", "Position", "Status", "Total Time",
]


def time_to_seconds(value) -> int | None:
    """時間文字列（hh:mm:ss または mm:ss）を秒数に変換"""
    if value is None or pd.isna(value):
        return None
    s = str(value).strip()
    if not s:
        return None
    # 例: "1:23:45" or "23:45"
    parts = s.split(":")
    try:
        parts = [int(p) for p in parts]
    except (ValueError, AttributeError):
        return None
    if len(parts) == 3:
        h, m, sec = parts
    elif len(parts) == 2:
        h = 0
        m, sec = parts
    else:
        return None
    return h * 3600 + m * 60 + sec


def normalize_event_id(raw) -> str:
    """pandasがExcelの数値IDをfloatで読む問題を回避して整数文字列に正規化する。
    例: 188993.0 -> "188993"。変換不能な場合はそのままstringにする。"""
    try:
        return str(int(float(str(raw).strip())))
    except (ValueError, TypeError):
        return str(raw).strip()


def import_excel_file(
    path: str,
    session: Session,
    race_name: str = "",
    race_date_str: str = "",
    points: int | None = None,
    note: str = "",
    force: bool = False,
) -> dict:
    """Excelファイルを読み込んでDBにインポート（最初のシートのみ）。
    既存レースがある場合は force=True のときのみ上書き、それ以外はスキップ。"""
    from datetime import date as date_type

    df = pd.read_excel(path, sheet_name=0)

    missing = [c for c in EXPECTED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"必須カラムが不足しています: {missing}")

    event_id = normalize_event_id(df["Event ID"].iloc[0])

    parsed_date: date_type | None = None
    if race_date_str:
        try:
            parsed_date = date_type.fromisoformat(race_date_str)
        except ValueError:
            pass

    # Raceを取得 or 作成し、メタデータを上書き
    race = session.exec(
        select(Race).where(Race.event_id == event_id)
    ).first()
    is_new_race = race is None

    # 既存レースかつ force=False → スキップ
    if not is_new_race and not force:
        return {
            "race_id": race.id,
            "event_id": event_id,
            "added_results": 0,
            "skipped": True,
        }

    if is_new_race:
        race = Race(event_id=event_id)
        if event_id == REFERENCE_EVENT_ID:
            race.is_reference = True
        session.add(race)

    if race_name:
        race.name = race_name
    if parsed_date:
        race.date = parsed_date
    if points is not None:
        race.points = points
    if note:
        race.note = note

    session.commit()
    session.refresh(race)

    # 再インポート（force=True）時のみ既存結果を削除する。
    # アップロードファイルに含まれるプログラムのみ対象にすることで、
    # 同じevent_idの別カテゴリデータを消さない。
    if not is_new_race:
        programs_in_file = list({str(v) for v in df["Program Name"].dropna().unique()})
        session.exec(
            delete(Result).where(
                Result.race_id == race.id,
                Result.program_name.in_(programs_in_file),
            )
        )
    # 削除と追加を同一トランザクションにまとめる（中間コミットしない）

    # PT系カテゴリのみ対象（"PT"で始まらないプログラムはスキップ）
    df = df[df["Program Name"].astype(str).str.startswith("PT")]

    # 行ごとにResultを追加
    added_count = 0
    for _, row in df.iterrows():
        # Status: 空/NaN で total_sec があれば Finished 扱い（Excel形式による）
        status_val = row["Status"]
        if pd.isna(status_val) or str(status_val).strip() in ("", "nan"):
            status_val = "Finished"  # 空はFinished扱い
        status_str = str(status_val).strip()

        result = Result(
            race_id=race.id,
            event_id=event_id,
            athlete_id=str(row["Athlete ID"]),
            first_name=str(row["Athlete First Name"]),
            last_name=str(row["Athlete Last Name"]),
            country=str(row["Country"]),
            program_id=str(row["Program ID"]),
            program_name=str(row["Program Name"]),
            start_number=int(row["Start Number"]) if not pd.isna(row["Start Number"]) else None,
            swim_sec=time_to_seconds(row["Swim"]),
            t1_sec=time_to_seconds(row["T1"]),
            bike_sec=time_to_seconds(row["Bike"]),
            t2_sec=time_to_seconds(row["T2"]),
            run_sec=time_to_seconds(row["Run"]),
            total_sec=time_to_seconds(row["Total Time"]),
            position=int(row["Position"]) if not pd.isna(row["Position"]) else None,
            status=status_str,
        )
        session.add(result)
        added_count += 1

    session.commit()
    return {
        "race_id": race.id,
        "event_id": event_id,
        "added_results": added_count,
        "skipped": False,
    }


def import_all_from_raw_excel(session: Session) -> list[dict]:
    """raw_excelディレクトリ内の全Excelファイルをインポート"""
    project_root = Path(__file__).parent.parent.parent
    raw_excel_dir = project_root / "raw_excel"

    if not raw_excel_dir.exists():
        raise FileNotFoundError(f"raw_excel directory not found: {raw_excel_dir}")

    results = []
    for excel_file in raw_excel_dir.glob("*.xlsx"):
        try:
            result = import_excel_file(str(excel_file), session)
            result["file"] = excel_file.name
            results.append(result)
        except Exception as e:
            results.append({
                "file": excel_file.name,
                "error": str(e),
            })

    return results


if __name__ == "__main__":
    # スクリプトとして実行した場合
    from sqlmodel import Session as SQLSession
    from app.database import engine, init_db

    init_db()
    with SQLSession(engine) as session:
        results = import_all_from_raw_excel(session)
        for r in results:
            if "error" in r:
                print(f"[NG] {r['file']}: {r['error']}")
            else:
                print(
                    f"[OK] {r['file']}: {r['added_results']} results added "
                    f"(race_id={r['race_id']})"
                )
