"""
ALS 難易度 vs 基準レース難易度：k-fold CV 予測精度比較検定

使い方:
    py -3.11 scripts/validate_difficulty.py [program_name] [n_folds]

例:
    py -3.11 scripts/validate_difficulty.py "PTS4 Men" 5
"""

import sys
import os
import random
import math

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
from sqlmodel import Session, create_engine, select
from app.models import Result, Race

# ---------------------------------------------------------------------------
# DB 接続
# ---------------------------------------------------------------------------
DB_URL = os.environ.get("DATABASE_URL", "sqlite:///./app.db")
engine = create_engine(DB_URL)

FIELD = "total_sec"           # 比較対象フィールド
_OPT_FIELDS = ["total_sec", "swim_sec", "t1_sec", "bike_sec", "t2_sec", "run_sec"]


# ---------------------------------------------------------------------------
# データ構造ビルダ
# ---------------------------------------------------------------------------
def build_data(results):
    """Result リスト → data[athlete_id][race_id][field] = value"""
    data = {}
    for r in results:
        a, rr = r.athlete_id, r.race_id
        data.setdefault(a, {}).setdefault(rr, {})
        for f in _OPT_FIELDS:
            v = getattr(r, f)
            if v is not None:
                data[a][rr][f] = float(v)
    return data


# ---------------------------------------------------------------------------
# ALS+IRLS（データ dict を直接受け取る、単一フィールド版）
# ---------------------------------------------------------------------------
def als_from_data(data, field=FIELD, outlier_k=2.5, min_weight=0.1, max_iter=30):
    athlete_ids = list(data)
    race_ids = list(dict.fromkeys(r for a in data for r in data[a]))

    diff = {r: 0.0 for r in race_ids}
    strength = {}
    for a in athlete_ids:
        vals = [data[a][r][field] for r in data[a] if field in data[a][r]]
        strength[a] = sum(vals) / len(vals) if vals else 0.0

    weights = {a: {r: 1.0 for r in data[a]} for a in athlete_ids}

    for _ in range(max_iter):
        # strength 更新
        for a in athlete_ids:
            num = den = 0.0
            for r in data[a]:
                if field in data[a][r]:
                    w = weights[a].get(r, 1.0)
                    num += w * (data[a][r][field] - diff[r])
                    den += w
            strength[a] = num / den if den > 0 else 0.0

        # difficulty 更新
        for r in race_ids:
            num = den = 0.0
            for a in athlete_ids:
                if r in data.get(a, {}) and field in data[a][r]:
                    w = weights[a].get(r, 1.0)
                    num += w * (data[a][r][field] - strength[a])
                    den += w
            diff[r] = num / den if den > 0 else 0.0

        # 平均センタリング
        if race_ids:
            mean_d = sum(diff[r] for r in race_ids) / len(race_ids)
            for r in race_ids:
                diff[r] -= mean_d
            for a in athlete_ids:
                strength[a] += mean_d

        # 外れ値 downweight
        abs_res, pairs = [], []
        for a in athlete_ids:
            for r in data[a]:
                if field in data[a][r]:
                    abs_res.append(abs(data[a][r][field] - (strength[a] + diff[r])))
                    pairs.append((a, r))
        if abs_res:
            s = sorted(abs_res)
            n = len(s)
            mad = s[n // 2] if n % 2 == 1 else (s[n // 2 - 1] + s[n // 2]) / 2
            thr = outlier_k * mad * 1.4826
            for (a, r), e in zip(pairs, abs_res):
                weights[a][r] = max(min_weight, thr / e) if thr > 0 and e > thr else 1.0

    return strength, diff


# ---------------------------------------------------------------------------
# 基準レース方式（データ dict で動作）
# ---------------------------------------------------------------------------
def ref_from_data(data, ref_race_id, field=FIELD):
    athlete_ids = list(data)
    race_ids = list(dict.fromkeys(r for a in data for r in data[a]))

    # difficulty[r] = mean_a(actual[a,r] - actual[a,ref]) for common athletes
    diff = {}
    for r in race_ids:
        if r == ref_race_id:
            diff[r] = 0.0
            continue
        deltas = [
            data[a][r][field] - data[a][ref_race_id][field]
            for a in athlete_ids
            if r in data.get(a, {}) and field in data[a][r]
            and ref_race_id in data.get(a, {}) and field in data[a][ref_race_id]
        ]
        diff[r] = sum(deltas) / len(deltas) if deltas else None  # None = 推定不可

    # strength[a] = mean_r(actual[a,r] - difficulty[r])
    strength = {}
    for a in athlete_ids:
        std = [
            data[a][r][field] - diff[r]
            for r in data[a]
            if field in data[a][r] and r in diff and diff[r] is not None
        ]
        strength[a] = sum(std) / len(std) if std else None

    return strength, diff


# ---------------------------------------------------------------------------
# Wilcoxon 符号順位検定（scipy なし実装）
# ---------------------------------------------------------------------------
def wilcoxon_signed_rank(x, y):
    """
    対応サンプル Wilcoxon 符号順位検定
    H0: median(x - y) = 0  H1: x < y（one-tailed, 検定統計量 W-）
    正規近似（n >= 10 を推奨）
    """
    d = np.array(x) - np.array(y)
    d = d[d != 0]
    n = len(d)
    if n == 0:
        return float("nan"), float("nan"), 0

    ranks = np.empty(n)
    abs_d = np.abs(d)
    order = np.argsort(abs_d, stable=True)
    i = 0
    while i < n:
        j = i
        while j < n and abs_d[order[j]] == abs_d[order[i]]:
            j += 1
        avg_rank = (i + j + 1) / 2  # 1-indexed
        for k in range(i, j):
            ranks[order[k]] = avg_rank
        i = j

    W_plus = float(np.sum(ranks[d > 0]))
    W_minus = float(np.sum(ranks[d < 0]))
    W = min(W_plus, W_minus)

    # 正規近似
    mean_W = n * (n + 1) / 4
    var_W = n * (n + 1) * (2 * n + 1) / 24
    z = (W - mean_W) / math.sqrt(var_W)
    # two-tailed → one-tailed (ALS が小さい方向)
    p_two = 2 * _norm_cdf(min(z, -z))
    p_one = p_two / 2  # ALS の誤差が小さい方向
    return W, p_one, n


def _norm_cdf(z):
    """標準正規 CDF (math.erfc ベース)"""
    return 0.5 * math.erfc(-z / math.sqrt(2))


# ---------------------------------------------------------------------------
# Bootstrap MAE 信頼区間
# ---------------------------------------------------------------------------
def bootstrap_ci(errors, n_boot=2000, ci=0.95, seed=0):
    rng = np.random.default_rng(seed)
    e = np.array(errors)
    means = [np.mean(rng.choice(e, size=len(e), replace=True)) for _ in range(n_boot)]
    lo = np.percentile(means, (1 - ci) / 2 * 100)
    hi = np.percentile(means, (1 + ci) / 2 * 100)
    return float(np.mean(e)), lo, hi


# ---------------------------------------------------------------------------
# k-fold CV 本体
# ---------------------------------------------------------------------------
def run_cv(data, ref_race_id, n_folds=5, random_seed=42):
    """
    k-fold CV で (athlete, race) ペアを分割し、
    両手法の予測誤差（秒）を収集して返す。
    """
    pairs = [
        (a, r)
        for a in data
        for r in data[a]
        if FIELD in data[a][r]
    ]
    random.seed(random_seed)
    random.shuffle(pairs)
    folds = [pairs[i::n_folds] for i in range(n_folds)]

    als_errors, ref_errors = [], []
    fold_stats = []

    for fold_idx in range(n_folds):
        test_set = set(folds[fold_idx])
        train_set = [(a, r) for i, f in enumerate(folds) if i != fold_idx for a, r in f]

        # 訓練データ dict 構築
        train_data = {}
        for a, r in train_set:
            train_data.setdefault(a, {}).setdefault(r, {})
            for f2 in _OPT_FIELDS:
                if f2 in data[a].get(r, {}):
                    train_data[a][r][f2] = data[a][r][f2]

        als_s, als_d = als_from_data(train_data)
        ref_s, ref_d = ref_from_data(train_data, ref_race_id)

        fold_als, fold_ref = [], []
        for a, r in test_set:
            actual = data[a][r][FIELD]
            sa, da = als_s.get(a), als_d.get(r)
            sr, dr = ref_s.get(a), ref_d.get(r)

            # 両方が推定可能なペアのみ比較（公平性）
            if (sa is not None and da is not None
                    and sr is not None and dr is not None):
                fold_als.append(abs(actual - (sa + da)))
                fold_ref.append(abs(actual - (sr + dr)))

        als_errors.extend(fold_als)
        ref_errors.extend(fold_ref)
        fold_stats.append({
            "fold": fold_idx + 1,
            "n": len(fold_als),
            "mae_als": np.mean(fold_als) if fold_als else float("nan"),
            "mae_ref": np.mean(fold_ref) if fold_ref else float("nan"),
        })
        print(f"  fold {fold_idx + 1}/{n_folds}  n={len(fold_als)}"
              f"  MAE_ALS={np.mean(fold_als):.1f}s"
              f"  MAE_Ref={np.mean(fold_ref):.1f}s")

    return als_errors, ref_errors, fold_stats


# ---------------------------------------------------------------------------
# カバレッジ（推定可能なレース数）
# ---------------------------------------------------------------------------
def coverage_check(data, ref_race_id):
    race_ids = list(dict.fromkeys(r for a in data for r in data[a]))
    n_total = len(race_ids)

    # 基準レース方式: ref_race との共通選手がいるレース
    ref_athletes = {a for a in data if ref_race_id in data.get(a, {}) and FIELD in data[a][ref_race_id]}
    covered_ref = sum(
        1 for r in race_ids
        if r == ref_race_id or any(
            r in data.get(a, {}) and FIELD in data[a][r]
            for a in ref_athletes
        )
    )

    # ALS: データがある全レース（常に推定可能）
    covered_als = n_total

    return n_total, covered_ref, covered_als


# ---------------------------------------------------------------------------
# メイン
# ---------------------------------------------------------------------------
def main():
    program_name = sys.argv[1] if len(sys.argv) > 1 else "PTS4 Men"
    n_folds = int(sys.argv[2]) if len(sys.argv) > 2 else 5

    print("=" * 60)
    print(f"  ALS vs 基準レース方式 比較検定")
    print(f"  プログラム : {program_name}")
    print(f"  フォールド数 : {n_folds}")
    print("=" * 60)

    with Session(engine) as session:
        ref_race = session.exec(
            select(Race).where(Race.is_reference == True)  # noqa: E712
        ).first()
        if ref_race is None:
            print("ERROR: 基準レースが設定されていません")
            sys.exit(1)

        print(f"  基準レース : {ref_race.name} (id={ref_race.id})")

        results = session.exec(
            select(Result).where(
                Result.program_name == program_name,
                Result.status == "Finished",
                Result.total_sec.isnot(None),
            )
        ).all()

    if not results:
        print(f"ERROR: {program_name} のデータがありません")
        sys.exit(1)

    data = build_data(results)
    n_athletes = len(data)
    n_races = len({r for a in data for r in data[a]})
    n_pairs = sum(len(data[a]) for a in data)

    print(f"\n  データ概要")
    print(f"    選手数   : {n_athletes}")
    print(f"    レース数 : {n_races}")
    print(f"    (選手,レース)ペア数 : {n_pairs}")

    # --- カバレッジ ---
    n_total, cov_ref, cov_als = coverage_check(data, ref_race.id)
    print(f"\n  カバレッジ（難易度推定可能レース数）")
    print(f"    基準レース方式 : {cov_ref} / {n_total}  ({100*cov_ref/n_total:.1f}%)")
    print(f"    ALS方式       : {cov_als} / {n_total}  ({100*cov_als/n_total:.1f}%)")

    # --- k-fold CV ---
    print(f"\n  {n_folds}-fold CV 予測誤差（秒）")
    als_errors, ref_errors, fold_stats = run_cv(data, ref_race.id, n_folds=n_folds)

    if not als_errors:
        print("ERROR: 有効な比較ペアがありません（基準レースと共通選手がいない等）")
        sys.exit(1)

    # --- MAE / RMSE ---
    als_mae, als_lo, als_hi = bootstrap_ci(als_errors)
    ref_mae, ref_lo, ref_hi = bootstrap_ci(ref_errors)
    als_rmse = float(np.sqrt(np.mean(np.array(als_errors) ** 2)))
    ref_rmse = float(np.sqrt(np.mean(np.array(ref_errors) ** 2)))

    print(f"\n  全体集計 (n={len(als_errors)} ペア)")
    print(f"  {'':20s}  {'ALS':>10s}  {'基準レース方式':>14s}")
    print(f"  {'MAE (秒)':20s}  {als_mae:>10.2f}  {ref_mae:>14.2f}")
    print(f"  {'MAE 95%CI':20s}  [{als_lo:.2f}, {als_hi:.2f}]  [{ref_lo:.2f}, {ref_hi:.2f}]")
    print(f"  {'RMSE (秒)':20s}  {als_rmse:>10.2f}  {ref_rmse:>14.2f}")

    mae_diff = ref_mae - als_mae
    rmse_diff = ref_rmse - als_rmse
    print(f"\n  改善量 (基準 - ALS):")
    print(f"    MAE  改善 : {mae_diff:+.2f} 秒  ({100*mae_diff/ref_mae:+.1f}%)")
    print(f"    RMSE 改善 : {rmse_diff:+.2f} 秒  ({100*rmse_diff/ref_rmse:+.1f}%)")

    # --- Wilcoxon 符号順位検定 ---
    W, p_one, n_nonzero = wilcoxon_signed_rank(ref_errors, als_errors)
    print(f"\n  Wilcoxon 符号順位検定")
    print(f"    H0: 両手法の予測誤差の中央値は等しい")
    print(f"    H1: ALS の予測誤差が小さい（一側検定）")
    print(f"    n (差ゼロを除く) : {n_nonzero}")
    print(f"    W 統計量         : {W:.1f}")
    print(f"    p 値 (一側)      : {p_one:.4f}")
    if p_one < 0.001:
        sig = "*** (p < 0.001)"
    elif p_one < 0.01:
        sig = "**  (p < 0.01)"
    elif p_one < 0.05:
        sig = "*   (p < 0.05)"
    elif p_one < 0.10:
        sig = ".   (p < 0.10, 傾向あり)"
    else:
        sig = "n.s. (有意差なし)"
    print(f"    有意性           : {sig}")

    # --- ペア別勝敗 ---
    als_arr = np.array(als_errors)
    ref_arr = np.array(ref_errors)
    n_als_wins = int(np.sum(als_arr < ref_arr))
    n_ref_wins = int(np.sum(ref_arr < als_arr))
    n_ties     = int(np.sum(als_arr == ref_arr))
    total = len(als_errors)
    print(f"\n  ペア別誤差の勝敗 (n={total})")
    print(f"    ALS 勝        : {n_als_wins:5d} ({100*n_als_wins/total:.1f}%)")
    print(f"    基準方式 勝   : {n_ref_wins:5d} ({100*n_ref_wins/total:.1f}%)")
    print(f"    引き分け      : {n_ties:5d} ({100*n_ties/total:.1f}%)")

    # --- 外れ値カバレッジ差（全ペア - 共通ペア）---
    n_all_pairs = n_pairs
    n_comparable = len(als_errors)
    n_als_only = n_all_pairs - n_comparable  # ref 方式が推定できなかった分
    print(f"\n  ALS のみ予測可能（基準方式が NA）: {n_als_only} ペア")

    print("\n" + "=" * 60)
    if p_one < 0.05 and mae_diff > 0:
        print("  結論: ALS は基準レース方式より統計的に有意に優れている")
    elif p_one < 0.10 and mae_diff > 0:
        print("  結論: ALS の方が優れる傾向あり（有意傾向 p<0.10）")
    elif mae_diff > 0:
        print("  結論: ALS の MAE は小さいが有意差なし（サンプル不足の可能性）")
    else:
        print("  結論: 有意な改善は確認できなかった")
    print("=" * 60)


if __name__ == "__main__":
    main()
