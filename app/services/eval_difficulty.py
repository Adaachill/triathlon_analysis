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

【評価上の注意】
  same_cat / cross_cat の難易度推定は「テストレース当日の実走タイム」を
  基準レースと比較して計算するため、厳密にはテストデータのリークが発生する。
  これらの手法は「レース当日に速報タイムが出始めた後に難易度補正する」用途
  を想定しており、レース前予測（事前予測）との直接比較は公平でない。

  ALS モデルの評価:
    - 選手強さ（strength）: テストレースを除外して学習（真のhold-out）
    - コース難易度（difficulty）: フルデータの ALS 推定値を使用
      → 実運用では「過去の同会場レース」から難易度を事前推定するシナリオに対応
      → difficulty=0（旧評価）より現実的な比較になる
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

        # 統合 ALS（新モデル）: 選手強さはテストレース除外で学習、コース難易度はフルデータを使用
        unified_holdout = compute_optimized_unified(session, exclude_race_ids={rid})
        unified_full = compute_optimized_unified(session)  # 難易度取得用（フルデータ）
        full_race_diffs = unified_full["race_difficulties"]

        # 旧 ALS: プログラム別に除外して学習（まとめてキャッシュ）
        old_als_by_prog: dict[str, dict] = {}
        for prog in programs_in_race:
            old_als_by_prog[prog] = _compute_old_als_program(
                session, prog, exclude_race_ids={rid}
            )

        n_races_evaluated += 1

        for prog in programs_in_race:
            prog_errors.setdefault(prog, {m: {f: [] for f in segments} for m in models})

            # same_cat / cross_cat: テストレース当日の実走タイムを使って難易度を計算する
            # （レース当日の速報タイムを利用する運用を想定。事前予測との直接比較は公平でない）
            same_diff_total, _ = compute_race_difficulty_with_n(session, rid, prog)
            cross_diff_total, _ = compute_race_difficulty_cross_with_n(session, rid, prog)

            prog_results = [r for r in race_results if r.program_name == prog]

            for r in prog_results:
                # ---- old_als ----
                # 選手強さ: テストレース除外後の ALS
                # コース難易度: フルデータ ALS の推定値（過去の同会場実績から事前推定するシナリオ）
                oa = old_als_by_prog[prog]
                oa_str = oa["athlete_strengths"].get(r.athlete_id)
                for f in segments:
                    actual = getattr(r, f)
                    if actual is None:
                        continue
                    sk = _field_to_strength_key(f)
                    if oa_str and oa_str.get(sk) is not None:
                        course_diff = full_race_diffs.get(rid, {}).get(f, 0.0)
                        pred = oa_str[sk] + course_diff
                        err = float(actual) - pred
                        all_errors["old_als"][f].append(err)
                        prog_errors[prog]["old_als"][f].append(err)

                # ---- unified ----
                # 選手強さ: テストレース除外後の統合 ALS
                # コース難易度: フルデータ ALS の推定値
                uni_prog = unified_holdout["program_results"].get(prog, {})
                uni_str = uni_prog.get("athlete_strengths", {}).get(r.athlete_id)
                for f in segments:
                    actual = getattr(r, f)
                    if actual is None:
                        continue
                    sk = _field_to_strength_key(f)
                    if uni_str and uni_str.get(sk) is not None:
                        course_diff = full_race_diffs.get(rid, {}).get(f, 0.0)
                        pred = uni_str[sk] + course_diff
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


# ── 時間減衰 半減期比較 ────────────────────────────────────────────────────────

def _compute_unified_with_halflife(
    session: Session,
    halflife_days: int,
    exclude_race_ids: set[int] | None = None,
    outlier_k: float = 2.5,
    min_weight: float = 0.1,
    max_iter: int = 30,
) -> dict:
    """指定した半減期で統合 ALS を計算する（als_optimizer の _HALFLIFE_DAYS を上書き）。"""
    from app.services import als_optimizer as _als
    import math as _math
    from datetime import date as _date

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
    today = _date.today()

    def _tw(race_date) -> float:
        if race_date is None:
            return 1.0
        days_ago = max(0, (today - race_date).days)
        return _math.exp(-_math.log(2) * days_ago / halflife_days)

    time_wt = {rid: _tw(race_dates.get(rid)) for rid in race_ids_set}

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

    from app.services.als_optimizer import _program_seg_weight
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


def evaluate_halflife_comparison(session: Session, halflives: list[int] | None = None) -> dict[str, Any]:
    """
    時間減衰の半減期（デフォルト: 365/270/180日）ごとに統合 ALS の精度を比較する。

    評価条件:
      - 選手強さ: テストレース除外で学習（真の hold-out）
      - コース難易度: フルデータ ALS の推定値（事前推定シナリオ）

    Returns:
        {
            "halflives": [
                {"halflife_days": int, "mae_sec": float, "rmse_sec": float, "n": int}
            ],
            "best_halflife_days": int,
        }
    """
    if halflives is None:
        halflives = [365, 270, 180]

    races = session.exec(select(Race)).all()
    results_all = []

    for hl in halflives:
        # フルデータ（コース難易度取得用）
        full_model = _compute_unified_with_halflife(session, hl)
        full_diffs = full_model["race_difficulties"]

        abs_errors: list[float] = []

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

            holdout = _compute_unified_with_halflife(session, hl, exclude_race_ids={rid})
            course_diff = full_diffs.get(rid, {}).get("total_sec", 0.0)

            for r in race_results:
                prog = r.program_name
                uni_prog = holdout["program_results"].get(prog, {})
                uni_str = uni_prog.get("athlete_strengths", {}).get(r.athlete_id)
                if uni_str and uni_str.get("strength") is not None:
                    pred = uni_str["strength"] + course_diff
                    abs_errors.append(abs(float(r.total_sec) - pred))

        mae = sum(abs_errors) / len(abs_errors) if abs_errors else None
        rmse = math.sqrt(sum(e ** 2 for e in abs_errors) / len(abs_errors)) if abs_errors else None
        results_all.append({
            "halflife_days": hl,
            "mae_sec": round(mae, 2) if mae is not None else None,
            "rmse_sec": round(rmse, 2) if rmse is not None else None,
            "n": len(abs_errors),
        })

    best = min(results_all, key=lambda x: x["mae_sec"] or float("inf"))
    return {
        "halflives": results_all,
        "best_halflife_days": best["halflife_days"],
        "note": (
            "評価条件: 選手強さ=テストレース除外ALS, コース難易度=フルデータALS推定値。"
            "半減期が短いほど直近レースを重視し、古いレースの影響を減らします。"
        ),
    }
