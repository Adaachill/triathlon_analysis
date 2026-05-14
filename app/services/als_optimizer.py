"""統合ALS + IRLS による難易度・強さ指標の最適化

改良点（v2）:
  1. 時間減衰ウェイト: 経過年数に応じて指数減衰（半減期 1 年）。直近の対戦
     ペアほど難易度推定に強く寄与する。
  2. 全プログラム横断難易度: 難易度パラメータを全プログラム共通とすることで
     サンプル数の少ないカテゴリの推定精度を向上。
     PTWC のバイク・ランはハンドサイクル・車いすのため貢献ウェイトを低減。
  3. 強さパラメータは従来通りプログラム別（各カテゴリのランキングに使用）。

改良点（v3）:
  4. since_date: 指定日以降のレースのみを使用（精度チェックの高速化に利用）。
  5. min_athlete_races: 出場レース数が少ない選手を除外（疎な選手は難易度推定に
     寄与しにくい）。
  6. tol: 連続する反復間の最大変化量が tol 秒未満になったら早期終了。
"""
import math
from datetime import date as date_type
from sqlmodel import Session, select
from app.models import Result, Race

_OPT_FIELDS = ["total_sec", "swim_sec", "t1_sec", "bike_sec", "t2_sec", "run_sec"]

# 統合キャッシュ。キー "__unified__" に全プログラム分の結果を格納。
_CACHE: dict[str, dict] = {}

# 時間減衰の半減期（日数）
_HALFLIFE_DAYS = 365


def _field_to_strength_key(f: str) -> str:
    if f == "total_sec":
        return "strength"
    return "strength_" + f.replace("_sec", "")


def _time_weight(race_date, halflife_days: int, today: date_type) -> float:
    """レース日から経過年数に基づく時間減衰ウェイト。"""
    if race_date is None:
        return 1.0
    days_ago = max(0, (today - race_date).days)
    return math.exp(-math.log(2) * days_ago / halflife_days)


def _program_seg_weight(program_name: str, field: str) -> float:
    """プログラム×セグメント別の難易度プーリングウェイト。
    PTWC はバイク（ハンドサイクル）・ランとトランジション区間が他カテゴリと
    異なるため 0.3 に低減。スイムは同条件なので 1.0。
    """
    if "PTWC" in program_name and field in ("bike_sec", "run_sec", "t1_sec", "t2_sec"):
        return 0.3
    return 1.0


def compute_optimized_unified(
    session: Session,
    outlier_k: float = 2.5,
    min_weight: float = 0.1,
    max_iter: int = 30,
    tol: float = 0.5,
    exclude_race_ids: set[int] | None = None,
    since_date: date_type | None = None,
    min_athlete_races: int = 1,
    halflife_days: int = _HALFLIFE_DAYS,
) -> dict:
    """
    全プログラム横断・時間減衰付き ALS + IRLS。

    引数:
        since_date: この日付以降のレースのみを使用する（None = 全期間）。
        min_athlete_races: この回数未満のレース参加選手を除外する。
            疎な選手は難易度推定に寄与しないため除外すると高速化できる。
        tol: 連続する反復間の strength 最大変化量がこの値（秒）未満になったら
            早期終了する。0 を指定すると常に max_iter 回実行する。
        halflife_days: 時間減衰の半減期（日数）。デフォルト 365 日。
        exclude_race_ids: 学習から除外するレース ID のセット（LOOCV 用）。

    モデル:
        actual[a, r, p, s] ≈ strength[a, p, s] + difficulty[r, s]
        strength: プログラム別（ランキングに使用）
        difficulty: 全プログラム共通（コース難易度）

    識別制約: mean(difficulty[r, s]) = 0

    Returns:
        {
            "race_difficulties": {race_id: {field: float, ...}},
            "program_results": {
                program_name: {
                    "race_difficulties": ...,   # 共通難易度（同一内容）
                    "athlete_strengths": ...,
                    "outlier_weights": ...,
                    "athlete_race_counts": ...,
                }
            }
        }
    """
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

    # レース日取得（時間減衰用・since_date フィルタ用）
    race_ids_set = {r.race_id for r in all_results}
    race_objs = session.exec(select(Race).where(Race.id.in_(list(race_ids_set)))).all()
    race_dates = {r.id: r.date for r in race_objs}
    today = date_type.today()

    # since_date フィルタ: 対象期間外のレースを除外
    if since_date is not None:
        valid_race_ids = {
            rid for rid, rd in race_dates.items()
            if rd is None or rd >= since_date
        }
        all_results = [r for r in all_results if r.race_id in valid_race_ids]
        if not all_results:
            return {"race_difficulties": {}, "program_results": {}}
        race_ids_set = {r.race_id for r in all_results}

    time_wt: dict[int, float] = {
        rid: _time_weight(race_dates.get(rid), halflife_days, today)
        for rid in race_ids_set
    }

    # prog_data[program][athlete_id][race_id][field] = value
    prog_data: dict[str, dict[str, dict[int, dict[str, float]]]] = {}
    for r in all_results:
        p, a, rr = r.program_name, r.athlete_id, r.race_id
        prog_data.setdefault(p, {}).setdefault(a, {}).setdefault(rr, {})
        for f in _OPT_FIELDS:
            v = getattr(r, f)
            if v is not None:
                prog_data[p][a][rr][f] = float(v)

    # min_athlete_races フィルタ: 出場レース数が少ない選手を除外
    if min_athlete_races > 1:
        for p in list(prog_data.keys()):
            prog_data[p] = {
                a: races for a, races in prog_data[p].items()
                if len(races) >= min_athlete_races
            }
            if not prog_data[p]:
                del prog_data[p]

    if not prog_data:
        return {"race_difficulties": {}, "program_results": {}}

    programs = list(prog_data.keys())
    all_race_ids = list(race_ids_set)

    # 初期値 ─ difficulty = 0, strength = 選手ごとの単純平均
    diff: dict[int, dict[str, float]] = {r: {f: 0.0 for f in _OPT_FIELDS} for r in all_race_ids}
    strength: dict[str, dict[str, dict[str, float]]] = {}
    for p in programs:
        strength[p] = {}
        for a in prog_data[p]:
            strength[p][a] = {}
            for f in _OPT_FIELDS:
                vals = [prog_data[p][a][r][f] for r in prog_data[p][a] if f in prog_data[p][a][r]]
                strength[p][a][f] = sum(vals) / len(vals) if vals else 0.0

    # 外れ値ウェイト[program][athlete][race] = 1.0
    ow: dict[str, dict[str, dict[int, float]]] = {
        p: {a: {r: 1.0 for r in prog_data[p][a]} for a in prog_data[p]}
        for p in programs
    }

    for _iter in range(max_iter):
        prev_strength_total = {
            p: {a: strength[p][a]["total_sec"] for a in prog_data[p]}
            for p in programs
        }

        # a. strength 更新（プログラム別）
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

        # b. difficulty 更新（全プログラム横断、セグメント×プログラムウェイト付き）
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

        # c. 平均センタリング: mean(diff[r, f]) → 0
        if all_race_ids:
            for f in _OPT_FIELDS:
                mean_d = sum(diff[r][f] for r in all_race_ids) / len(all_race_ids)
                for r in all_race_ids:
                    diff[r][f] -= mean_d
                for p in programs:
                    for a in prog_data[p]:
                        strength[p][a][f] += mean_d

        # d. IRLS 外れ値検出（プログラム別、ペアワイズ残差）
        # ペアワイズ残差 res_i - res_j は difficulty がキャンセルされるため
        # difficulty 推定誤差の影響を受けない外れ値検出が可能。
        for p in programs:
            # まず各(選手, レース)の個別残差を収集
            race_residuals: dict[int, dict[str, float]] = {}
            for a in prog_data[p]:
                for r in prog_data[p][a]:
                    if "total_sec" in prog_data[p][a][r]:
                        res = prog_data[p][a][r]["total_sec"] - (
                            strength[p][a]["total_sec"] + diff[r]["total_sec"]
                        )
                        race_residuals.setdefault(r, {})[a] = res

            # 各(選手, レース)のペアワイズ外れ値スコア = 同レース他選手との残差差の平均絶対値
            pairwise_scores: list[float] = []
            score_pairs: list[tuple[str, int]] = []
            for r, ath_res in race_residuals.items():
                ath_list = list(ath_res.keys())
                for a in ath_list:
                    others = [ath_res[b] for b in ath_list if b != a]
                    if others:
                        score = sum(abs(ath_res[a] - rb) for rb in others) / len(others)
                        pairwise_scores.append(score)
                        score_pairs.append((a, r))
                    else:
                        # 同レースに他選手がいない場合は個別残差にフォールバック
                        pairwise_scores.append(abs(ath_res[a]))
                        score_pairs.append((a, r))

            if pairwise_scores:
                n = len(pairwise_scores)
                s = sorted(pairwise_scores)
                mad = s[n // 2] if n % 2 == 1 else (s[n // 2 - 1] + s[n // 2]) / 2
                thr = outlier_k * mad * 1.4826
                for (a, r), score in zip(score_pairs, pairwise_scores):
                    ow[p][a][r] = max(min_weight, thr / score) if thr > 0 and score > thr else 1.0

        # e. 早期終了チェック（tol > 0 のときのみ）
        if tol > 0:
            max_change = max(
                abs(strength[p][a]["total_sec"] - prev_strength_total[p][a])
                for p in programs
                for a in prog_data[p]
            )
            if max_change < tol:
                break

    # 結果整形
    race_difficulties = {r: {f: diff[r][f] for f in _OPT_FIELDS} for r in all_race_ids}

    program_results: dict[str, dict] = {}
    for p in programs:
        outlier_weights: dict[int, dict[str, float]] = {}
        for a in prog_data[p]:
            for r, w in ow[p][a].items():
                outlier_weights.setdefault(r, {})[a] = w

        program_results[p] = {
            "race_difficulties": race_difficulties,   # 全プログラム共通
            "athlete_strengths": {
                a: {_field_to_strength_key(f): strength[p][a][f] for f in _OPT_FIELDS}
                for a in prog_data[p]
            },
            "outlier_weights": outlier_weights,
            "athlete_race_counts": {a: len(prog_data[p][a]) for a in prog_data[p]},
        }

    return {
        "race_difficulties": race_difficulties,
        "program_results": program_results,
    }


def get_optimized_program(
    session: Session,
    program_name: str,
    force_recompute: bool = False,
    **kwargs,
) -> dict:
    """統合キャッシュから指定プログラムの結果を返す。"""
    if not force_recompute and "__unified__" in _CACHE:
        unified = _CACHE["__unified__"]
    else:
        unified = compute_optimized_unified(session, **kwargs)
        _CACHE["__unified__"] = unified

    empty: dict = {
        "race_difficulties": {},
        "athlete_strengths": {},
        "outlier_weights": {},
        "athlete_race_counts": {},
    }
    return unified["program_results"].get(program_name, empty)


def invalidate_cache(program_name: str | None = None) -> None:
    """キャッシュをクリアする。program_name は無視して常に全クリア。"""
    _CACHE.clear()
