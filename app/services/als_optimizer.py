"""ALS + IRLS による難易度・強さ指標の最適化"""
from sqlmodel import Session, select
from app.models import Result

_OPT_FIELDS = ["total_sec", "swim_sec", "t1_sec", "bike_sec", "t2_sec", "run_sec"]
_CACHE: dict[str, dict] = {}


def _field_to_strength_key(f: str) -> str:
    if f == "total_sec":
        return "strength"
    return "strength_" + f.replace("_sec", "")


def compute_optimized_program(
    session: Session,
    program_name: str,
    outlier_k: float = 2.5,
    min_weight: float = 0.1,
    max_iter: int = 30,
    exclude_race_ids: set[int] | None = None,
) -> dict:
    """
    ALS + IRLS で難易度・強さ指標を計算する。

    モデル: actual[athlete, race, seg] ≈ strength[athlete, seg] + difficulty[race, seg]
    識別制約: 各フィールドで mean(difficulty[r]) = 0（平均センタリング）
    外れ値: total_sec 残差の MAD × 1.4826 × outlier_k を超えるペアを downweight
    exclude_race_ids: 指定したrace_idを計算から除外する（差分比較用）

    Returns:
        {
            "race_difficulties":   {race_id: {"total_sec": float, "swim_sec": float, ...}},
            "athlete_strengths":   {athlete_id: {"strength": float, "strength_swim": float, ...}},
            "outlier_weights":     {race_id: {athlete_id: float}},
            "athlete_race_counts": {athlete_id: int},
        }
    """
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
        return {
            "race_difficulties": {},
            "athlete_strengths": {},
            "outlier_weights": {},
            "athlete_race_counts": {},
        }

    # data[athlete_id][race_id][field] = value
    data: dict[str, dict[int, dict[str, float]]] = {}
    for r in results:
        a = r.athlete_id
        rr = r.race_id
        if a not in data:
            data[a] = {}
        if rr not in data[a]:
            data[a][rr] = {}
        for f in _OPT_FIELDS:
            v = getattr(r, f)
            if v is not None:
                data[a][rr][f] = float(v)

    athlete_ids = list(data.keys())
    race_ids = list(dict.fromkeys(r.race_id for r in results))

    # 初期値: diff = 0, strength = 選手ごとの単純平均
    diff: dict[int, dict[str, float]] = {r: {f: 0.0 for f in _OPT_FIELDS} for r in race_ids}
    strength: dict[str, dict[str, float]] = {}
    for a in athlete_ids:
        strength[a] = {}
        for f in _OPT_FIELDS:
            vals = [data[a][r][f] for r in data[a] if f in data[a][r]]
            strength[a][f] = sum(vals) / len(vals) if vals else 0.0

    # weights[athlete_id][race_id] = 1.0
    weights: dict[str, dict[int, float]] = {
        a: {r: 1.0 for r in data[a]} for a in athlete_ids
    }

    for _ in range(max_iter):
        # a. strength 更新: strength[a,f] = weighted_mean(actual[a,r,f] - diff[r,f])
        for a in athlete_ids:
            for f in _OPT_FIELDS:
                num = 0.0
                den = 0.0
                for r in data[a]:
                    if f in data[a][r]:
                        w = weights[a].get(r, 1.0)
                        num += w * (data[a][r][f] - diff[r][f])
                        den += w
                strength[a][f] = num / den if den > 0 else 0.0

        # b. difficulty 更新: diff[r,f] = weighted_mean(actual[a,r,f] - strength[a,f])
        for r in race_ids:
            for f in _OPT_FIELDS:
                num = 0.0
                den = 0.0
                for a in athlete_ids:
                    if r in data.get(a, {}) and f in data[a][r]:
                        w = weights[a].get(r, 1.0)
                        num += w * (data[a][r][f] - strength[a][f])
                        den += w
                diff[r][f] = num / den if den > 0 else 0.0

        # c. 平均センタリング: mean(diff[r,f]) → 0; strength += mean_diff
        if race_ids:
            for f in _OPT_FIELDS:
                mean_d = sum(diff[r][f] for r in race_ids) / len(race_ids)
                for r in race_ids:
                    diff[r][f] -= mean_d
                for a in athlete_ids:
                    strength[a][f] += mean_d

        # d. 外れ値検出: total_sec 残差 → MAD → 閾値超えペアを downweight
        abs_residuals: list[float] = []
        pairs: list[tuple[str, int]] = []
        for a in athlete_ids:
            for r in data[a]:
                if "total_sec" in data[a][r]:
                    res = data[a][r]["total_sec"] - (
                        strength[a]["total_sec"] + diff[r]["total_sec"]
                    )
                    abs_residuals.append(abs(res))
                    pairs.append((a, r))

        if abs_residuals:
            sorted_abs = sorted(abs_residuals)
            n = len(sorted_abs)
            mad = (
                sorted_abs[n // 2]
                if n % 2 == 1
                else (sorted_abs[n // 2 - 1] + sorted_abs[n // 2]) / 2
            )
            threshold = outlier_k * mad * 1.4826
            for (a, r), abs_r in zip(pairs, abs_residuals):
                if threshold > 0 and abs_r > threshold:
                    weights[a][r] = max(min_weight, threshold / abs_r)
                else:
                    weights[a][r] = 1.0

    # 結果整形
    race_difficulties: dict[int, dict[str, float]] = {
        r: {f: diff[r][f] for f in _OPT_FIELDS} for r in race_ids
    }
    athlete_strengths: dict[str, dict[str, float]] = {
        a: {_field_to_strength_key(f): strength[a][f] for f in _OPT_FIELDS}
        for a in athlete_ids
    }
    outlier_weights: dict[int, dict[str, float]] = {}
    for a in athlete_ids:
        for r, w in weights[a].items():
            if r not in outlier_weights:
                outlier_weights[r] = {}
            outlier_weights[r][a] = w

    athlete_race_counts: dict[str, int] = {a: len(data[a]) for a in athlete_ids}

    return {
        "race_difficulties": race_difficulties,
        "athlete_strengths": athlete_strengths,
        "outlier_weights": outlier_weights,
        "athlete_race_counts": athlete_race_counts,
    }


def get_optimized_program(
    session: Session,
    program_name: str,
    force_recompute: bool = False,
    **kwargs,
) -> dict:
    """モジュールレベルキャッシュ付きで最適化結果を取得する。"""
    if not force_recompute and program_name in _CACHE:
        return _CACHE[program_name]
    result = compute_optimized_program(session, program_name, **kwargs)
    _CACHE[program_name] = result
    return result


def invalidate_cache(program_name: str | None = None) -> None:
    """_CACHE をクリアする。"""
    if program_name is None:
        _CACHE.clear()
    else:
        _CACHE.pop(program_name, None)
