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

パフォーマンス最適化（v3）:
  - フルデータ ALS をループ外で1回だけ計算（以前はループ内で R回計算していたバグ）
  - since_date: 評価対象を直近 N 年に絞れる（デフォルト None = 全期間）
  - min_athlete_races: 疎な選手を除外（デフォルト 1 = 除外なし）
  - halflife比較: sample_ratio でレースをサブサンプリングして高速化
"""
from __future__ import annotations

import math
import random
from datetime import date as date_type, timedelta
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


# ── 旧プログラム別 ALS（als_optimizer v1 相当、比較用） ────────────────────────

def _compute_old_als_program(
    session: Session,
    program_name: str,
    outlier_k: float = 2.5,
    min_weight: float = 0.1,
    max_iter: int = 30,
    tol: float = 0.5,
    exclude_race_ids: set[int] | None = None,
    since_date: date_type | None = None,
    min_athlete_races: int = 1,
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

    # since_date フィルタ
    if since_date is not None:
        race_ids_set_all = {r.race_id for r in results}
        race_objs = session.exec(select(Race).where(Race.id.in_(list(race_ids_set_all)))).all()
        race_dates_map = {r.id: r.date for r in race_objs}
        valid_rids = {
            rid for rid, rd in race_dates_map.items()
            if rd is None or rd >= since_date
        }
        results = [r for r in results if r.race_id in valid_rids]

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

    # min_athlete_races フィルタ
    if min_athlete_races > 1:
        data = {a: races for a, races in data.items() if len(races) >= min_athlete_races}

    if not data:
        return {"race_difficulties": {}, "athlete_strengths": {}, "athlete_race_counts": {}}

    athlete_ids = list(data.keys())
    race_ids = list({r.race_id for r in results if r.athlete_id in data})

    diff = {r: {f: 0.0 for f in _OPT_FIELDS} for r in race_ids}
    strength: dict[str, dict[str, float]] = {}
    for a in athlete_ids:
        strength[a] = {}
        for f in _OPT_FIELDS:
            vals = [data[a][r][f] for r in data[a] if f in data[a][r]]
            strength[a][f] = sum(vals) / len(vals) if vals else 0.0

    weights = {a: {r: 1.0 for r in data[a]} for a in athlete_ids}

    for _ in range(max_iter):
        prev = {a: strength[a]["total_sec"] for a in athlete_ids}

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

        if tol > 0:
            max_change = max(abs(strength[a]["total_sec"] - prev[a]) for a in athlete_ids)
            if max_change < tol:
                break

    return {
        "race_difficulties": {r: {f: diff[r][f] for f in _OPT_FIELDS} for r in race_ids},
        "athlete_strengths": {
            a: {_field_to_strength_key(f): strength[a][f] for f in _OPT_FIELDS}
            for a in athlete_ids
        },
        "athlete_race_counts": {a: len(data[a]) for a in athlete_ids},
    }


# ── 集計ユーティリティ ─────────────────────────────────────────────────────────

def _mae(errors: list[float]) -> float | None:
    return sum(abs(e) for e in errors) / len(errors) if errors else None


def _rmse(errors: list[float]) -> float | None:
    return math.sqrt(sum(e ** 2 for e in errors) / len(errors)) if errors else None


def _agg(errs: list[float]) -> dict:
    mae = _mae(errs)
    rmse = _rmse(errs)
    return {
        "mae_sec": round(mae, 2) if mae is not None else None,
        "rmse_sec": round(rmse, 2) if rmse is not None else None,
        "n": len(errs),
    }


def _rank(values: list[float]) -> list[float]:
    """昇順ランク（1始まり、同順位は平均ランク）。"""
    indexed = sorted(enumerate(values), key=lambda x: x[1])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(indexed):
        j = i
        while j < len(indexed) - 1 and indexed[j + 1][1] == indexed[i][1]:
            j += 1
        avg_rank = (i + j) / 2 + 1
        for k in range(i, j + 1):
            ranks[indexed[k][0]] = avg_rank
        i = j + 1
    return ranks


def _spearman_r(xs: list[float], ys: list[float]) -> float | None:
    """Spearman ランク相関係数。"""
    n = len(xs)
    if n < 2:
        return None
    rx, ry = _rank(xs), _rank(ys)
    d_sq = sum((a - b) ** 2 for a, b in zip(rx, ry))
    denom = n * (n ** 2 - 1)
    return 1.0 - 6.0 * d_sq / denom if denom > 0 else None


def _pairwise_agg(errs: list[float]) -> dict:
    mae = _mae(errs)
    rmse = _rmse(errs)
    return {
        "mae_sec": round(mae, 2) if mae is not None else None,
        "rmse_sec": round(rmse, 2) if rmse is not None else None,
        "n_pairs": len(errs),
    }


# ── メイン評価関数 ─────────────────────────────────────────────────────────────

def evaluate_difficulty_models(
    session: Session,
    since_years: int | None = None,
    min_athlete_races: int = 1,
) -> dict[str, Any]:
    """
    全レース・全プログラムについてレースアウト CV を実行し、
    4 モデルの予測精度を比較する。

    引数:
        since_years: None なら全期間。整数を渡すと直近 N 年のレースのみ評価対象にする。
            ALS の学習データも同じ期間に絞ることで計算量を大幅に削減できる。
        min_athlete_races: 出場レース数がこの値未満の選手を ALS から除外する。
            2 以上にすると疎な選手が減り高速化する。

    Returns: {
        "summary": {model_name: {"mae_sec", "rmse_sec", "n"}},
        "by_segment": {model_name: {segment: {...}}},
        "by_program": {program_name: {model_name: {...}}},
        "pairwise_summary": {model_name: {"mae_sec", "rmse_sec", "n_pairs"}},
        "pairwise_by_segment": {model_name: {segment: {...}}},
        "rank_correlation": {model_name: {"mean_spearman_r", "n_races"}},
        "n_races_evaluated": int,
        "filters": {"since_years": ..., "min_athlete_races": ...},
    }

    pairwise_summary / pairwise_by_segment はコース難易度がキャンセルされるため
    difficulty 推定不要。同一レース内の全選手ペアの strength 差 vs 実タイム差を集計。
    rank_correlation は各レースの Spearman ρ の平均（1.0 = 完全一致）。
    """
    since_date: date_type | None = None
    if since_years is not None:
        since_date = date_type.today() - timedelta(days=since_years * 365)

    races = session.exec(select(Race)).all()

    # ── フルデータ ALS を1回だけ計算（ループ外）──────────────────────────────
    # コース難易度の推定に使用。ループ内に置くとR倍遅くなる（前回のバグ）。
    unified_full = compute_optimized_unified(
        session,
        since_date=since_date,
        min_athlete_races=min_athlete_races,
    )
    full_race_diffs = unified_full["race_difficulties"]

    models = ["old_als", "unified", "same_cat", "cross_cat"]
    pw_models = ["old_als", "unified"]
    segments = _OPT_FIELDS
    all_errors: dict[str, dict[str, list[float]]] = {
        m: {f: [] for f in segments} for m in models
    }
    prog_errors: dict[str, dict[str, dict[str, list[float]]]] = {}

    # ペアワイズ誤差・ランク相関の収集（difficulty 不要）
    all_pw_errors: dict[str, dict[str, list[float]]] = {
        m: {f: [] for f in segments} for m in pw_models
    }
    all_rho: dict[str, list[float]] = {m: [] for m in pw_models}

    n_races_evaluated = 0

    for race in races:
        rid = race.id

        # since_date フィルタ: 評価対象レースも絞る
        if since_date is not None and race.date is not None and race.date < since_date:
            continue

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

        # 統合 ALS（新モデル）: 選手強さはテストレース除外で学習
        unified_holdout = compute_optimized_unified(
            session,
            exclude_race_ids={rid},
            since_date=since_date,
            min_athlete_races=min_athlete_races,
        )

        # 旧 ALS: プログラム別に除外して学習
        old_als_by_prog: dict[str, dict] = {}
        for prog in programs_in_race:
            old_als_by_prog[prog] = _compute_old_als_program(
                session,
                prog,
                exclude_race_ids={rid},
                since_date=since_date,
                min_athlete_races=min_athlete_races,
            )

        n_races_evaluated += 1

        for prog in programs_in_race:
            prog_errors.setdefault(prog, {m: {f: [] for f in segments} for m in models})

            # same_cat / cross_cat: テストレース当日の実走タイムを使って難易度を計算する
            # （「速報補正」用途。事前予測との直接比較は公平でない — コードコメント参照）
            same_diff_total, _ = compute_race_difficulty_with_n(session, rid, prog)
            cross_diff_total, _ = compute_race_difficulty_cross_with_n(session, rid, prog)

            prog_results = [r for r in race_results if r.program_name == prog]
            oa = old_als_by_prog[prog]
            oa_strengths = oa["athlete_strengths"]
            uni_strengths = (
                unified_holdout["program_results"]
                .get(prog, {})
                .get("athlete_strengths", {})
            )

            for r in prog_results:
                # ---- old_als ----
                # 強さ=hold-out、コース難易度=フルデータALS推定（事前推定シナリオ）
                oa_str = oa_strengths.get(r.athlete_id)
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
                # 強さ=hold-out、コース難易度=フルデータALS推定
                uni_str = uni_strengths.get(r.athlete_id)
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

                # ---- same_cat ----（当日データ利用 = リークあり）
                actual_total = r.total_sec
                if actual_total is not None and same_diff_total is not None:
                    oa_str_check = oa_strengths.get(r.athlete_id)
                    if oa_str_check and oa_str_check.get("strength") is not None:
                        pred = oa_str_check["strength"] + same_diff_total
                        err = float(actual_total) - pred
                        all_errors["same_cat"]["total_sec"].append(err)
                        prog_errors[prog]["same_cat"]["total_sec"].append(err)

                # ---- cross_cat ----（当日データ利用 = リークあり）
                if actual_total is not None and cross_diff_total is not None:
                    oa_str_check = oa_strengths.get(r.athlete_id)
                    if oa_str_check and oa_str_check.get("strength") is not None:
                        pred = oa_str_check["strength"] + cross_diff_total
                        err = float(actual_total) - pred
                        all_errors["cross_cat"]["total_sec"].append(err)
                        prog_errors[prog]["cross_cat"]["total_sec"].append(err)

            # ---- ペアワイズ評価（difficulty 不要・真のホールドアウト）----
            # 同一レース内の全選手ペアで strength 差 vs 実タイム差を比較。
            # difficulty は (actual_i - actual_j) - (strength_i - strength_j) でキャンセル。
            oa_data = [
                (r, oa_strengths[r.athlete_id])
                for r in prog_results
                if r.athlete_id in oa_strengths
                and oa_strengths[r.athlete_id].get("strength") is not None
            ]
            uni_data = [
                (r, uni_strengths[r.athlete_id])
                for r in prog_results
                if r.athlete_id in uni_strengths
                and uni_strengths[r.athlete_id].get("strength") is not None
            ]

            for model_tag, athlete_data in (("old_als", oa_data), ("unified", uni_data)):
                for fi, (ri, si) in enumerate(athlete_data):
                    for rj, sj in athlete_data[fi + 1 :]:
                        for f in segments:
                            act_i = getattr(ri, f)
                            act_j = getattr(rj, f)
                            sk = _field_to_strength_key(f)
                            str_i = si.get(sk)
                            str_j = sj.get(sk)
                            if act_i is None or act_j is None or str_i is None or str_j is None:
                                continue
                            pw_err = abs((float(act_i) - float(act_j)) - (str_i - str_j))
                            all_pw_errors[model_tag][f].append(pw_err)

            # ランク相関（total_sec、プログラム×レースごと）
            for model_tag, athlete_data in (("old_als", oa_data), ("unified", uni_data)):
                if len(athlete_data) < 2:
                    continue
                actuals = [float(r.total_sec) for r, _ in athlete_data]
                preds = [s["strength"] for _, s in athlete_data]
                rho = _spearman_r(actuals, preds)
                if rho is not None:
                    all_rho[model_tag].append(rho)

    summary = {m: _agg(all_errors[m]["total_sec"]) for m in models}

    by_segment = {
        m: {f: _agg(all_errors[m][f]) for f in segments}
        for m in ["old_als", "unified"]
    }

    by_program = {
        prog: {m: _agg(prog_errors[prog][m]["total_sec"]) for m in models}
        for prog in sorted(prog_errors.keys())
    }

    pairwise_summary = {
        m: _pairwise_agg(all_pw_errors[m]["total_sec"]) for m in pw_models
    }

    pairwise_by_segment = {
        m: {f: _pairwise_agg(all_pw_errors[m][f]) for f in segments}
        for m in pw_models
    }

    rank_correlation = {
        m: {
            "mean_spearman_r": (
                round(sum(all_rho[m]) / len(all_rho[m]), 4) if all_rho[m] else None
            ),
            "n_races": len(all_rho[m]),
        }
        for m in pw_models
    }

    return {
        "summary": summary,
        "by_segment": by_segment,
        "by_program": by_program,
        "pairwise_summary": pairwise_summary,
        "pairwise_by_segment": pairwise_by_segment,
        "rank_correlation": rank_correlation,
        "n_races_evaluated": n_races_evaluated,
        "filters": {
            "since_years": since_years,
            "min_athlete_races": min_athlete_races,
        },
    }


# ── 時間減衰 半減期比較 ────────────────────────────────────────────────────────

def evaluate_halflife_comparison(
    session: Session,
    halflives: list[int] | None = None,
    since_years: int | None = None,
    min_athlete_races: int = 1,
    sample_ratio: float = 1.0,
    seed: int = 42,
) -> dict[str, Any]:
    """
    時間減衰の半減期（デフォルト: 365/270/180日）ごとに統合 ALS の精度を比較する。

    引数:
        halflives: 比較する半減期のリスト（日数）。
        since_years: 直近 N 年のレースのみ評価対象にする（None = 全期間）。
        min_athlete_races: 疎な選手の除外閾値。
        sample_ratio: 0〜1 の範囲で評価するレースの割合を指定。
            1.0 なら全レースを LOOCV、0.3 なら 30% をランダムサンプリング。
            高速化したい場合は 0.3〜0.5 を推奨。
        seed: サブサンプリング用の乱数シード。

    評価条件:
      - 選手強さ: テストレース除外で学習（真の hold-out）
      - コース難易度: フルデータ ALS の推定値（事前推定シナリオ）

    Returns:
        {
            "halflives": [{"halflife_days", "mae_sec", "rmse_sec", "n"}, ...],
            "best_halflife_days": int,
            "filters": {...},
            "note": str,
        }
    """
    if halflives is None:
        halflives = [365, 270, 180]

    since_date: date_type | None = None
    if since_years is not None:
        since_date = date_type.today() - timedelta(days=since_years * 365)

    all_races = session.exec(select(Race)).all()

    # since_date フィルタ
    if since_date is not None:
        all_races = [
            r for r in all_races
            if r.date is None or r.date >= since_date
        ]

    # サブサンプリング
    if 0.0 < sample_ratio < 1.0:
        rng = random.Random(seed)
        k = max(1, int(len(all_races) * sample_ratio))
        all_races = rng.sample(all_races, k)

    results_all = []

    for hl in halflives:
        # フルデータ ALS（コース難易度取得用）をループ外で1回計算
        full_model = compute_optimized_unified(
            session,
            halflife_days=hl,
            since_date=since_date,
            min_athlete_races=min_athlete_races,
        )
        full_diffs = full_model["race_difficulties"]

        abs_errors: list[float] = []

        for race in all_races:
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

            holdout = compute_optimized_unified(
                session,
                halflife_days=hl,
                exclude_race_ids={rid},
                since_date=since_date,
                min_athlete_races=min_athlete_races,
            )
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
        "filters": {
            "since_years": since_years,
            "min_athlete_races": min_athlete_races,
            "sample_ratio": sample_ratio,
            "n_races_sampled": len(all_races),
        },
        "note": (
            "評価条件: 選手強さ=テストレース除外ALS, コース難易度=フルデータALS推定値。"
            "半減期が短いほど直近レースを重視し、古いレースの影響を減らします。"
            f"sample_ratio={sample_ratio} のため全レースの {int(sample_ratio*100)}% をサンプリング評価。"
        ),
    }
