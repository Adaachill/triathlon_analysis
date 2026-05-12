"""時間減衰半減期（365/270/180日）による精度比較スクリプト

Usage:
    cd /home/user/triathlon_analysis
    python -m scripts.compare_halflife
"""
import sys
import math
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from sqlmodel import Session, create_engine, select
from app.models import Result, Race
from app.services.als_optimizer import _OPT_FIELDS, _field_to_strength_key
from sqlmodel import create_engine
engine = create_engine("sqlite:////home/user/triathlon_analysis/app.db", echo=False, connect_args={"check_same_thread": False})


# ── 半減期パラメータ付き ALS ──────────────────────────────────────────────────

from datetime import date as date_type


def _time_weight_custom(race_date, halflife_days: int, today: date_type | None = None) -> float:
    if today is None:
        today = date_type.today()
    if race_date is None:
        return 1.0
    days_ago = max(0, (today - race_date).days)
    return math.exp(-math.log(2) * days_ago / halflife_days)


def _program_seg_weight(program_name: str, field: str) -> float:
    if "PTWC" in program_name and field in ("bike_sec", "run_sec", "t1_sec", "t2_sec"):
        return 0.3
    return 1.0


def compute_unified_with_halflife(
    session: Session,
    halflife_days: int,
    exclude_race_ids: set[int] | None = None,
    outlier_k: float = 2.5,
    min_weight: float = 0.1,
    max_iter: int = 30,
) -> dict:
    """指定した半減期で統合 ALS を計算する"""
    all_results = session.exec(
        select(Result).where(
            Result.status == "Finished",
            Result.total_sec.isnot(None),
        )
    ).all()
    if exclude_race_ids:
        all_results = [r for r in all_results if r.race_id not in exclude_race_ids]
    if not all_results:
        return {"race_difficulties": {}, "program_results": {}}

    race_ids_set = {r.race_id for r in all_results}
    race_objs = session.exec(select(Race).where(Race.id.in_(list(race_ids_set)))).all()
    race_dates = {r.id: r.date for r in race_objs}
    today = date_type.today()
    time_wt = {
        rid: _time_weight_custom(race_dates.get(rid), halflife_days, today)
        for rid in race_ids_set
    }

    prog_data: dict[str, dict[str, dict[int, dict[str, float]]]] = {}
    for r in all_results:
        p, a, rr = r.program_name, r.athlete_id, r.race_id
        prog_data.setdefault(p, {}).setdefault(a, {}).setdefault(rr, {})
        for f in _OPT_FIELDS:
            v = getattr(r, f)
            if v is not None:
                prog_data[p][a][rr][f] = float(v)

    programs = list(prog_data.keys())
    all_race_ids = list(race_ids_set)

    diff = {r: {f: 0.0 for f in _OPT_FIELDS} for r in all_race_ids}
    strength: dict[str, dict[str, dict[str, float]]] = {}
    for p in programs:
        strength[p] = {}
        for a in prog_data[p]:
            strength[p][a] = {}
            for f in _OPT_FIELDS:
                vals = [prog_data[p][a][r][f] for r in prog_data[p][a] if f in prog_data[p][a][r]]
                strength[p][a][f] = sum(vals) / len(vals) if vals else 0.0

    ow = {p: {a: {r: 1.0 for r in prog_data[p][a]} for a in prog_data[p]} for p in programs}

    for _ in range(max_iter):
        for p in programs:
            for a in prog_data[p]:
                for f in _OPT_FIELDS:
                    num = den = 0.0
                    for r in prog_data[p][a]:
                        if f in prog_data[p][a][r]:
                            w = ow[p][a].get(r, 1.0) * time_wt.get(r, 1.0)
                            num += w * (prog_data[p][a][r][f] - diff[r][f])
                            den += w
                    strength[p][a][f] = num / den if den > 0 else 0.0

        for r in all_race_ids:
            for f in _OPT_FIELDS:
                num = den = 0.0
                for p in programs:
                    pw = _program_seg_weight(p, f)
                    if pw == 0.0:
                        continue
                    for a in prog_data[p]:
                        if r in prog_data[p][a] and f in prog_data[p][a][r]:
                            w = ow[p][a].get(r, 1.0) * time_wt.get(r, 1.0) * pw
                            num += w * (prog_data[p][a][r][f] - strength[p][a][f])
                            den += w
                diff[r][f] = num / den if den > 0 else 0.0

        if all_race_ids:
            for f in _OPT_FIELDS:
                mean_d = sum(diff[r][f] for r in all_race_ids) / len(all_race_ids)
                for r in all_race_ids:
                    diff[r][f] -= mean_d
                for p in programs:
                    for a in prog_data[p]:
                        strength[p][a][f] += mean_d

        for p in programs:
            abs_res, pairs = [], []
            for a in prog_data[p]:
                for r in prog_data[p][a]:
                    if "total_sec" in prog_data[p][a][r]:
                        res = prog_data[p][a][r]["total_sec"] - (
                            strength[p][a]["total_sec"] + diff[r]["total_sec"]
                        )
                        abs_res.append(abs(res))
                        pairs.append((a, r))
            if abs_res:
                n = len(abs_res)
                s = sorted(abs_res)
                mad = s[n // 2] if n % 2 == 1 else (s[n // 2 - 1] + s[n // 2]) / 2
                thr = outlier_k * mad * 1.4826
                for (a, r), ar in zip(pairs, abs_res):
                    ow[p][a][r] = max(min_weight, thr / ar) if thr > 0 and ar > thr else 1.0

    race_difficulties = {r: {f: diff[r][f] for f in _OPT_FIELDS} for r in all_race_ids}
    program_results = {}
    for p in programs:
        program_results[p] = {
            "race_difficulties": race_difficulties,
            "athlete_strengths": {
                a: {_field_to_strength_key(f): strength[p][a][f] for f in _OPT_FIELDS}
                for a in prog_data[p]
            },
        }
    return {"race_difficulties": race_difficulties, "program_results": program_results}


# ── 評価ループ ────────────────────────────────────────────────────────────────

def evaluate_halflife(session: Session, halflife_days: int) -> dict:
    """指定半減期で LOOCV を実行し MAE/RMSE を返す"""
    races = session.exec(select(Race)).all()

    errors: list[float] = []
    n_evaluated = 0

    # フルデータ（難易度取得用）
    full_model = compute_unified_with_halflife(session, halflife_days)
    full_diffs = full_model["race_difficulties"]

    for race in races:
        rid = race.id
        race_results = session.exec(
            select(Result).where(
                Result.race_id == rid,
                Result.status == "Finished",
                Result.total_sec.isnot(None),
            )
        ).all()
        if not race_results:
            continue

        holdout = compute_unified_with_halflife(session, halflife_days, exclude_race_ids={rid})
        course_diff = full_diffs.get(rid, {}).get("total_sec", 0.0)

        for r in race_results:
            prog = r.program_name
            uni_prog = holdout["program_results"].get(prog, {})
            uni_str = uni_prog.get("athlete_strengths", {}).get(r.athlete_id)
            if uni_str and uni_str.get("strength") is not None:
                pred = uni_str["strength"] + course_diff
                errors.append(abs(float(r.total_sec) - pred))
                n_evaluated += 1

    mae = sum(errors) / len(errors) if errors else None
    rmse = math.sqrt(sum(e ** 2 for e in errors) / len(errors)) if errors else None
    return {
        "halflife_days": halflife_days,
        "mae_sec": round(mae, 2) if mae is not None else None,
        "rmse_sec": round(rmse, 2) if rmse is not None else None,
        "n": n_evaluated,
    }


def main():
    halflives = [365, 270, 180]
    results = []

    with Session(engine) as session:
        for hl in halflives:
            print(f"  半減期 {hl}日 を計算中...", flush=True)
            r = evaluate_halflife(session, hl)
            results.append(r)
            print(f"    MAE={r['mae_sec']}秒  RMSE={r['rmse_sec']}秒  N={r['n']}")

    print("\n=== 時間減衰 半減期別 精度比較（新統合ALS） ===")
    print(f"{'半減期':>8}  {'MAE(秒)':>10}  {'RMSE(秒)':>10}  {'N':>6}")
    print("-" * 44)
    for r in results:
        print(f"{r['halflife_days']:>6}日  {r['mae_sec']:>10.2f}  {r['rmse_sec']:>10.2f}  {r['n']:>6}")

    best = min(results, key=lambda x: x["mae_sec"])
    print(f"\n最良: 半減期 {best['halflife_days']}日  MAE={best['mae_sec']}秒")


if __name__ == "__main__":
    main()
