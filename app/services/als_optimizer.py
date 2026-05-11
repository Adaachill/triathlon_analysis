"""統合ALS + IRLS による難易度・強さ指標の最適化

改良点（v2）:
  1. 時間減衰ウェイト: 経過年数に応じて指数減衰（半減期 1 年）。直近の対戦
     ペアほど難易度推定に強く寄与する。
  2. 全プログラム横断難易度: 難易度パラメータを全プログラム共通とすることで
     サンプル数の少ないカテゴリの推定精度を向上。
     PTWC のバイク・ランはハンドサイクル・車いすのため貢献ウェイトを低減。
  3. 強さパラメータは従来通りプログラム別（各カテゴリのランキングに使用）。
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


def _time_weight(race_date, today: date_type | None = None) -> float:
    """レース日から経過年数に基づく時間減衰ウェイト。半減期 = 1 年。"""
    if today is None:
        today = date_type.today()
    if race_date is None:
        return 1.0
    days_ago = max(0, (today - race_date).days)
    return math.exp(-math.log(2) * days_ago / _HALFLIFE_DAYS)


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
    exclude_race_ids: set[int] | None = None,
) -> dict:
    """
    全プログラム横断・時間減衰付き ALS + IRLS。

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

    # レース日取得（時間減衰用）
    race_ids_set = {r.race_id for r in all_results}
    race_objs = session.exec(select(Race).where(Race.id.in_(list(race_ids_set)))).all()
    race_dates = {r.id: r.date for r in race_objs}
    today = date_type.today()
    time_wt: dict[int, float] = {
        rid: _time_weight(race_dates.get(rid), today) for rid in race_ids_set
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

    for _ in range(max_iter):
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

        # d. IRLS 外れ値検出（プログラム別、total_sec 残差）
        for p in programs:
            abs_res: list[float] = []
            pairs: list[tuple[str, int]] = []
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
