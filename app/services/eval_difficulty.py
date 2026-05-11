"""難易度推定モデルの予測精度評価（レースアウト交差検証）

評価方法:
    各レース r をテストセットとし、r を除いたデータで各モデルを学習/計算して
    r の難易度を推定する。難易度推定値と選手強さから予想タイムを作り、
    実タイムとの MAE / RMSE を集計する。

対象モデル:
    - old_als   : 旧プログラム別 ALS
    - unified   : 新統合 ALS（全プログラム横断 + 時間減衰）
    - same_cat  : 同一カテゴリ難易度（基準レースとの比較）
    - cross_cat : クロスカテゴリ難易度（PTWC 除き全プログラムで %差分）
"""
from __future__ import annotations

import math
from typing import Any
from sqlmodel import Session, select

from app.models import Result, Race
from app.services.difficulty import (
    compute_race_difficulty_with_n,
    compute_race_difficulty_cross_with_n,
)
from app.services.als_optimizer import (
    compute_optimized_unified,
    _OPT_FIELDS,
    _field_to_strength_key,
)

# 旧プログラム別 ALS（als_optimizer v1 相当）を内部で再実装
def _compute_old_als_program(
    session: Session,
    program_name: str,
    outlier_k: float = 2.5,
    min_weight: float = 0.1,
    max_iter: int = 30,
    exclude_race_ids: set[int] | None = None,
) -> dict:
    """旧来のプログラム単独 ALS（比較用）。"""
    results = session.exec(
        select(Result).where(
            Result.program_name == program_name,
            Result.status == "Finished",
            Result.total_sec.isnot(None),
        )
    ).all()
    if exclude_race_ids:
        results = [r for r in results if r.race_id not in exclude_race_ids]
    if not results:
        return {"race_difficulties": {}, "athlete_strengths": {}, "athlete_race_counts": {}}

    data: dict[str, dict[int, dict[str, float]]] = {}
    for r in results:
        a, rr = r.athlete_id, r.race_id
        data.setdefault(a, {}).setdefault(rr, {})
        for f in _OPT_FIELDS:
            v = getattr(r, f)
            if v is not None:
                data[a][rr][f] = float(v)

    athlete_ids = list(data.keys())
    race_ids = list({r.race_id for r in results})

    diff = {r: {f: 0.0 for f in _OPT_FIELDS} for r in race_ids}
    strength: dict[str, dict[str, float]] = {}
    for a in athlete_ids:
        strength[a] = {}
        for f in _OPT_FIELDS:
            vals = [data[a][r][f] for r in data[a] if f in data[a][r]]
            strength[a][f] = sum(vals) / len(vals) if vals else 0.0

    weights = {a: {r: 1.0 for r in data[a]} for a in athlete_ids}

    for _ in range(max_iter):
        for a in athlete_ids:
            for f in _OPT_FIELDS:
                num = den = 0.0
                for r in data[a]:
                    if f in data[a][r]:
                        w = weights[a].get(r, 1.0)
                        num += w * (data[a][r][f] - diff[r][f])
                        den += w
                strength[a][f] = num / den if den > 0 else 0.0

        for r in race_ids:
            for f in _OPT_FIELDS:
                num = den = 0.0
                for a in athlete_ids:
                    if r in data.get(a, {}) and f in data[a][r]:
                        w = weights[a].get(r, 1.0)
                        num += w * (data[a][r][f] - strength[a][f])
                        den += w
                diff[r][f] = num / den if den > 0 else 0.0

        if race_ids:
            for f in _OPT_FIELDS:
                mean_d = sum(diff[r][f] for r in race_ids) / len(race_ids)
                for r in race_ids:
                    diff[r][f] -= mean_d
                for a in athlete_ids:
                    strength[a][f] += mean_d

        abs_residuals, pairs = [], []
        for a in athlete_ids:
            for r in data[a]:
                if "total_sec" in data[a][r]:
                    res = data[a][r]["total_sec"] - (strength[a]["total_sec"] + diff[r]["total_sec"])
                    abs_residuals.append(abs(res))
                    pairs.append((a, r))
        if abs_residuals:
            n = len(abs_residuals)
            s = sorted(abs_residuals)
            mad = s[n // 2] if n % 2 == 1 else (s[n // 2 - 1] + s[n // 2]) / 2
            thr = outlier_k * mad * 1.4826
            for (a, r), ar in zip(pairs, abs_residuals):
                weights[a][r] = max(min_weight, thr / ar) if thr > 0 and ar > thr else 1.0

    return {
        "race_difficulties": {r: {f: diff[r][f] for f in _OPT_FIELDS} for r in race_ids},
        "athlete_strengths": {
            a: {_field_to_strength_key(f): strength[a][f] for f in _OPT_FIELDS}
            for a in athlete_ids
        },
        "athlete_race_counts": {a: len(data[a]) for a in athlete_ids},
    }


def _mae(errors: list[float]) -> float | None:
    return sum(abs(e) for e in errors) / len(errors) if errors else None


def _rmse(errors: list[float]) -> float | None:
    return math.sqrt(sum(e ** 2 for e in errors) / len(errors)) if errors else None


def evaluate_difficulty_models(session: Session) -> dict[str, Any]:
    """
    全レース・全プログラムについてレースアウト CV を実行し、
    4 モデルの予測精度を比較する。

    Returns: {
        "summary": {
            model_name: {"mae_sec": float, "rmse_sec": float, "n": int}
        },
        "by_segment": {
            model_name: {
                segment: {"mae_sec": float, "rmse_sec": float, "n": int}
            }
        },
        "by_program": {
            program_name: {
                model_name: {"mae_sec": float, "rmse_sec": float, "n": int}
            }
        },
        "n_races_evaluated": int,
    }
    """
    races = session.exec(select(Race)).all()
    programs_with_data: set[str] = {
        r.program_name
        for r in session.exec(
            select(Result).where(
                Result.status == "Finished",
                Result.total_sec.isnot(None),
            )
        ).all()
    }

    # errors[model][field] = [error_seconds, ...]
    models = ["old_als", "unified", "same_cat", "cross_cat"]
    segments = _OPT_FIELDS
    all_errors: dict[str, dict[str, list[float]]] = {
        m: {f: [] for f in segments} for m in models
    }
    # prog_errors[program][model][field]
    prog_errors: dict[str, dict[str, dict[str, list[float]]]] = {}

    n_races_evaluated = 0

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

        programs_in_race = {r.program_name for r in race_results}

        # 統合 ALS（新モデル）: レース r を除いて学習
        unified = compute_optimized_unified(session, exclude_race_ids={rid})
        # 旧 ALS: プログラム別に除外して学習（まとめてキャッシュ）
        old_als_by_prog: dict[str, dict] = {}
        for prog in programs_in_race:
            old_als_by_prog[prog] = _compute_old_als_program(
                session, prog, exclude_race_ids={rid}
            )

        n_races_evaluated += 1

        for prog in programs_in_race:
            prog_errors.setdefault(prog, {m: {f: [] for f in segments} for m in models})

            # same_cat: 同一カテゴリ難易度（基準レースとの比較、学習除外不要）
            same_diff_total, _ = compute_race_difficulty_with_n(session, rid, prog)
            # cross_cat
            cross_diff_total, _ = compute_race_difficulty_cross_with_n(session, rid, prog)

            prog_results = [r for r in race_results if r.program_name == prog]

            for r in prog_results:
                # ---- old_als ----
                oa = old_als_by_prog[prog]
                oa_str = oa["athlete_strengths"].get(r.athlete_id)
                oa_diffs = oa["race_difficulties"]  # 空の場合あり（レース除外後）
                # レース r は除外されているので難易度は「そのモデルでの外挿」が必要。
                # 外挿困難なため total_sec には mean_difficulty = 0 を使う
                for f in segments:
                    actual = getattr(r, f)
                    if actual is None:
                        continue
                    sk = _field_to_strength_key(f)
                    if oa_str and oa_str.get(sk) is not None:
                        # r を除外後のモデルに r の難易度はないので 0 で近似
                        pred = oa_str[sk] + 0.0
                        err = float(actual) - pred
                        all_errors["old_als"][f].append(err)
                        prog_errors[prog]["old_als"][f].append(err)

                # ---- unified ----
                uni_prog = unified["program_results"].get(prog, {})
                uni_str = uni_prog.get("athlete_strengths", {}).get(r.athlete_id)
                for f in segments:
                    actual = getattr(r, f)
                    if actual is None:
                        continue
                    sk = _field_to_strength_key(f)
                    if uni_str and uni_str.get(sk) is not None:
                        pred = uni_str[sk] + 0.0
                        err = float(actual) - pred
                        all_errors["unified"][f].append(err)
                        prog_errors[prog]["unified"][f].append(err)

                # ---- same_cat ----
                actual_total = r.total_sec
                if actual_total is not None and same_diff_total is not None:
                    # same_cat の強さ = 旧 ALS の strength（r 除外後）
                    if oa_str and oa_str.get("strength") is not None:
                        pred = oa_str["strength"] + same_diff_total
                        err = float(actual_total) - pred
                        all_errors["same_cat"]["total_sec"].append(err)
                        prog_errors[prog]["same_cat"]["total_sec"].append(err)

                # ---- cross_cat ----
                if actual_total is not None and cross_diff_total is not None:
                    if oa_str and oa_str.get("strength") is not None:
                        pred = oa_str["strength"] + cross_diff_total
                        err = float(actual_total) - pred
                        all_errors["cross_cat"]["total_sec"].append(err)
                        prog_errors[prog]["cross_cat"]["total_sec"].append(err)

    # 集計
    def _agg(errs: list[float]) -> dict:
        mae = _mae(errs)
        rmse = _rmse(errs)
        return {
            "mae_sec": round(mae, 2) if mae is not None else None,
            "rmse_sec": round(rmse, 2) if rmse is not None else None,
            "n": len(errs),
        }

    summary = {m: _agg(all_errors[m]["total_sec"]) for m in models}

    by_segment = {
        m: {f: _agg(all_errors[m][f]) for f in segments}
        for m in ["old_als", "unified"]  # same/cross は total_sec のみ
    }

    by_program = {
        prog: {
            m: _agg(prog_errors[prog][m]["total_sec"])
            for m in models
        }
        for prog in sorted(prog_errors.keys())
    }

    return {
        "summary": summary,
        "by_segment": by_segment,
        "by_program": by_program,
        "n_races_evaluated": n_races_evaluated,
    }
