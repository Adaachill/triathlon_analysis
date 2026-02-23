"""
レース結果 → ランキング計算 までの検証フロー

実行: python -m scripts.verify_flow
"""
import sys
from pathlib import Path

# プロジェクトルートをパスに追加
project_root = Path(__file__).parent.parent
sys.path.insert(0, str(project_root))

from sqlmodel import Session, select
from app.database import engine, init_db
from app.models import Race, Result
from app.services.difficulty import (
    get_reference_race,
    compute_race_difficulty,
    get_standard_total_sec,
    compute_athlete_strength,
)


def step1_races_and_results(session: Session) -> bool:
    """Step 1: レースと結果がDBに入っているか"""
    print("\n" + "=" * 60)
    print("Step 1: レース・結果のDB確認")
    print("=" * 60)

    races = session.exec(select(Race)).all()
    if not races:
        print("[NG] レースが0件です。raw_excel からインポートしてください。")
        return False

    print(f"[OK] レース数: {len(races)}")
    for r in races:
        ref_mark = " [基準レース]" if r.is_reference else ""
        print(f"   - id={r.id}, event_id={r.event_id}, name={r.name}{ref_mark}")

    results = session.exec(select(Result)).all()
    if not results:
        print("[NG] 結果が0件です。")
        return False

    print(f"[OK] 結果数: {len(results)}")

    # 結果の内訳
    by_race = {}
    by_status = {}
    by_program = {}
    for r in results:
        by_race[r.race_id] = by_race.get(r.race_id, 0) + 1
        by_status[r.status] = by_status.get(r.status, 0) + 1
        by_program[r.program_name] = by_program.get(r.program_name, 0) + 1

    print("\n  【race_id 別】")
    for rid, cnt in sorted(by_race.items()):
        print(f"     race_id={rid}: {cnt}件")

    print("\n  【Status 別】※ athletes/rankings は 'Finished' のみ対象")
    for st, cnt in sorted(by_status.items()):
        marker = " <- これが使われる" if st == "Finished" else ""
        print(f"     '{st}': {cnt}件{marker}")

    print("\n  【Program Name 別】※ API呼び出し時の program_name はこれと完全一致させる")
    for pn, cnt in sorted(by_program.items()):
        print(f"     '{pn}': {cnt}件")

    return True


def step2_reference_race(session: Session) -> tuple[bool, str | None]:
    """Step 2: 基準レースが設定されているか。サンプル program_name も返す"""
    print("\n" + "=" * 60)
    print("Step 2: 基準レースの確認")
    print("=" * 60)

    ref = get_reference_race(session)
    if ref is None:
        print("[NG] 基準レースがありません。")
        print("   Event ID 188993 (2025世界選手権) のExcelをインポートするか、")
        print("   既存レースのいずれかを is_reference=True に設定してください。")
        return False, None

    print(f"[OK] 基準レース: id={ref.id}, event_id={ref.event_id}, name={ref.name}")

    ref_results = session.exec(
        select(Result).where(
            Result.race_id == ref.id,
            Result.status == "Finished",
            Result.total_sec.isnot(None),
        )
    ).all()
    print(f"   基準レースの Finished 結果: {len(ref_results)}件")

    sample_program = None
    if ref_results:
        prog_names = list(set(r.program_name for r in ref_results))
        sample_program = prog_names[0]
        print(f"   含まれる program_name: {prog_names}")
    return True, sample_program


def step3_program_name(session: Session, sample_from_step2: str | None) -> str | None:
    """Step 3: 利用可能な program_name を確定する"""
    print("\n" + "=" * 60)
    print("Step 3: 利用可能な Program Name")
    print("=" * 60)

    # Step2 から渡された値を使う（distinct() の Row 取得問題を回避）
    if sample_from_step2:
        print(f"[OK] Step2 から取得: program_name='{sample_from_step2}'")
        return sample_from_step2

    # フォールバック: 基準レースが無い場合
    q = select(Result).where(
        Result.status == "Finished",
        Result.total_sec.isnot(None),
    ).limit(100)
    results = session.exec(q).all()
    if not results:
        print("[NG] Finished かつ total_sec ありの結果が0件です。")
        q_status = select(Result).where(Result.total_sec.isnot(None))
        rows = session.exec(q_status).all()
        status_counts = {}
        for r in rows:
            st = r.status
            key = str(st) if st else "(empty)"
            status_counts[key] = status_counts.get(key, 0) + 1
        print("   【原因】total_sec はあるが Status が 'Finished' でない:")
        for k, v in sorted(status_counts.items(), key=lambda x: -x[1]):
            print(f"      Status={k}: {v}件")
        return None

    names = list(set(r.program_name for r in results))
    print(f"[OK] APIで使える program_name: {names}")
    return names[0]


def step4_race_difficulty(session: Session, program_name: str) -> bool:
    """Step 4: レース難易度が計算できるか"""
    print("\n" + "=" * 60)
    print("Step 4: レース難易度の計算")
    print("=" * 60)

    ref = get_reference_race(session)
    if not ref:
        print("[NG] 基準レースがないためスキップ")
        return False

    races = session.exec(select(Race)).all()
    for race in races:
        d = compute_race_difficulty(session, race.id, program_name)
        # 共通選手数を見るため簡易チェック
        q_race = select(Result).where(
            Result.race_id == race.id,
            Result.program_name == program_name,
            Result.status == "Finished",
            Result.total_sec.isnot(None),
        )
        q_ref = select(Result).where(
            Result.race_id == ref.id,
            Result.program_name == program_name,
            Result.status == "Finished",
            Result.total_sec.isnot(None),
        )
        race_ids = {r.athlete_id for r in session.exec(q_race).all()}
        ref_ids = {r.athlete_id for r in session.exec(q_ref).all()}
        common = len(race_ids & ref_ids)
        marker = " (基準)" if race.id == ref.id else ""
        warn = " [共通選手0->難易度0]" if common == 0 and race.id != ref.id else ""
        print(f"   race_id={race.id} ({race.event_id}): difficulty={d:.1f}秒, "
              f"共通選手={common}人{marker}{warn}")
    print("[OK] 難易度計算は実行可能")
    return True


def step5_athlete_strength(session: Session, program_name: str) -> bool:
    """Step 5: 選手強さが計算できるか"""
    print("\n" + "=" * 60)
    print("Step 5: 選手強さの計算")
    print("=" * 60)

    q = select(Result).where(
        Result.program_name == program_name,
        Result.status == "Finished",
        Result.total_sec.isnot(None),
    ).limit(50)
    results_sample = session.exec(q).all()
    athlete_ids = list(dict.fromkeys(r.athlete_id for r in results_sample))[:5]

    if not athlete_ids:
        print("[NG] 該当選手がいません。")
        return False

    print(f"   program_name='{program_name}' でサンプル5人を計算:")
    for aid in athlete_ids:
        strength = compute_athlete_strength(session, aid, program_name)
        if strength is not None:
            m, s = divmod(int(strength), 60)
            h, m = divmod(m, 60)
            print(f"     athlete_id={aid}: strength={strength:.1f}秒 ({h}:{m:02d}:{s:02d}) [OK]")
        else:
            print(f"     athlete_id={aid}: None [NG]")
    return True


def step6_rankings(session: Session, program_name: str) -> bool:
    """Step 6: ランキングが取得できるか"""
    print("\n" + "=" * 60)
    print("Step 6: ランキング取得")
    print("=" * 60)

    q = select(Result).where(
        Result.program_name == program_name,
        Result.status == "Finished",
    )
    athlete_ids = list(dict.fromkeys(r.athlete_id for r in session.exec(q).all()))

    rankings = []
    for aid in athlete_ids:
        s = compute_athlete_strength(session, aid, program_name)
        if s is not None:
            rankings.append((aid, s))

    rankings.sort(key=lambda x: x[1])
    print(f"[OK] ランキング算出: {len(rankings)}人")
    if rankings:
        print("   上位5人:")
        for i, (aid, st) in enumerate(rankings[:5], 1):
            m, s = divmod(int(st), 60)
            h, m = divmod(m, 60)
            print(f"     {i}. athlete_id={aid}: {st:.1f}秒 ({h}:{m:02d}:{s:02d})")
    return True


def main():
    print("\n" + "#" * 60)
    print("# レース結果 → ランキング 検証フロー")
    print("#" * 60)

    init_db()
    with Session(engine) as session:
        if not step1_races_and_results(session):
            print("\n>>> Step 1 で停止。インポートを確認してください。")
            return

        ok, sample_program = step2_reference_race(session)
        if not ok:
            print("\n>>> Step 2 で停止。基準レースを確認してください。")
            return

        program_name = step3_program_name(session, sample_program)
        if not program_name:
            print("\n>>> Step 3 で停止。")
            return

        step4_race_difficulty(session, program_name)
        step5_athlete_strength(session, program_name)
        step6_rankings(session, program_name)

    print("\n" + "=" * 60)
    print("API呼び出し例")
    print("=" * 60)
    print(f"""
  GET /rankings/top?program_name={program_name!r}
  GET /athletes/<athlete_id>?program_name={program_name!r}
  GET /races/<race_id>?program_name={program_name!r}

※ program_name は上記の Step 3 で表示された値と完全一致させる必要があります。
  空白や大文字小文字の違いがあるとマッチしません。
""")


if __name__ == "__main__":
    main()
