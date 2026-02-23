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


def import_excel_file(path: str, session: Session) -> dict:
    """Excelファイルを読み込んでDBにインポート（最初のシートのみ）"""
    # sheet_name=0 で最初のシートのみを読み込む（2つ目以降のシートは無視）
    df = pd.read_excel(path, sheet_name=0)

    # フォーマットチェック
    missing = [c for c in EXPECTED_COLUMNS if c not in df.columns]
    if missing:
        raise ValueError(f"Columns missing in {path}: {missing}")

    # Event IDはこのファイル全行で同じと想定
    event_id = str(df["Event ID"].iloc[0])

    # Raceを取得 or 作成
    race = session.exec(
        select(Race).where(Race.event_id == event_id)
    ).first()
    if race is None:
        race = Race(event_id=event_id)
        if event_id == REFERENCE_EVENT_ID:
            race.is_reference = True
        session.add(race)
        session.commit()
        session.refresh(race)

    # 既存結果を削除
    session.exec(delete(Result).where(Result.race_id == race.id))
    session.commit()

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
