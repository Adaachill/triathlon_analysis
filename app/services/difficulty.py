"""レース難易度と標準化タイムの計算ロジック"""
from typing import Optional
from sqlmodel import Session, select
from app.models import Race, Result

REFERENCE_EVENT_ID = "188993"

SEGMENT_FIELDS = ["swim_sec", "t1_sec", "bike_sec", "t2_sec", "run_sec"]


def get_reference_race(session: Session) -> Optional[Race]:
    """基準レース（2025世界選手権）を取得"""
    ref = session.exec(
        select(Race).where(Race.is_reference == True)  # noqa: E712
    ).first()
    return ref


def compute_race_difficulty(
    session: Session,
    race_id: int,
    program_name: str,
) -> float:
    """
    レース難易度オフセットを計算（秒単位）
    基準レースとの差分の平均を返す
    """
    ref_race = get_reference_race(session)
    if ref_race is None:
        return 0.0

    if ref_race.id == race_id:
        return 0.0

    # 対象レースR & 基準レースRefの結果（同一program_name）を取得
    q_ref = select(Result).where(
        Result.race_id == ref_race.id,
        Result.program_name == program_name,
        Result.status == "Finished",
        Result.total_sec.isnot(None),
    )
    q_race = select(Result).where(
        Result.race_id == race_id,
        Result.program_name == program_name,
        Result.status == "Finished",
        Result.total_sec.isnot(None),
    )

    ref_results = session.exec(q_ref).all()
    race_results = session.exec(q_race).all()

    # athlete_idごとにマップ
    ref_by_ath = {r.athlete_id: r for r in ref_results}
    deltas: list[float] = []

    for r in race_results:
        ref = ref_by_ath.get(r.athlete_id)
        if not ref:
            continue
        if ref.total_sec is None or r.total_sec is None:
            continue
        delta = r.total_sec - ref.total_sec
        deltas.append(delta)

    if not deltas:
        return 0.0  # 共通選手がいなければ、難易度0扱い（MVP）

    return float(sum(deltas) / len(deltas))


def get_standard_total_sec(
    total_sec: Optional[int],
    race_difficulty: float,
) -> Optional[float]:
    """標準化Totalタイムを計算"""
    if total_sec is None:
        return None
    return float(total_sec - race_difficulty)


def compute_athlete_strength(
    session: Session,
    athlete_id: str,
    program_name: str,
) -> Optional[float]:
    """
    選手の強さ指標を計算（DB内全レースの標準化Totalタイム平均）
    MVPでは直近1年のデータのみをDBに入れる前提なので、DB内全レース = 直近1年
    """
    q = select(Result).where(
        Result.athlete_id == athlete_id,
        Result.program_name == program_name,
        Result.status == "Finished",
        Result.total_sec.isnot(None),
    )
    results = session.exec(q).all()
    if not results:
        return None

    # race_idごとの難易度をキャッシュ
    difficulty_cache: dict[int, float] = {}

    standard_times: list[float] = []
    for r in results:
        if r.race_id not in difficulty_cache:
            difficulty_cache[r.race_id] = compute_race_difficulty(
                session, r.race_id, program_name
            )
        d = difficulty_cache[r.race_id]
        st = get_standard_total_sec(r.total_sec, d)
        if st is not None:
            standard_times.append(st)

    if not standard_times:
        return None

    return float(sum(standard_times) / len(standard_times))


def compute_race_difficulty_segments(
    session: Session,
    race_id: int,
    program_name: str,
) -> dict[str, float]:
    """
    セグメント別のレース難易度オフセット（秒）
    swim, t1, bike, t2, run それぞれについて基準レースとの差分の平均を返す
    """
    ref_race = get_reference_race(session)
    if ref_race is None:
        return {f: 0.0 for f in SEGMENT_FIELDS}

    if ref_race.id == race_id:
        return {f: 0.0 for f in SEGMENT_FIELDS}

    q_ref = select(Result).where(
        Result.race_id == ref_race.id,
        Result.program_name == program_name,
        Result.status == "Finished",
    )
    q_race = select(Result).where(
        Result.race_id == race_id,
        Result.program_name == program_name,
        Result.status == "Finished",
    )
    ref_results = {r.athlete_id: r for r in session.exec(q_ref).all()}
    race_results = session.exec(q_race).all()

    out: dict[str, list[float]] = {f: [] for f in SEGMENT_FIELDS}
    for r in race_results:
        ref = ref_results.get(r.athlete_id)
        if not ref:
            continue
        for f in SEGMENT_FIELDS:
            r_val = getattr(r, f)
            ref_val = getattr(ref, f)
            if r_val is not None and ref_val is not None:
                out[f].append(float(r_val - ref_val))

    return {f: float(sum(d) / len(d)) if out[f] else 0.0 for f, d in out.items()}


def get_standard_segment(
    value: Optional[int],
    difficulty: float,
) -> Optional[float]:
    """セグメントの標準化タイム"""
    if value is None:
        return None
    return float(value - difficulty)


def compute_athlete_strength_full(
    session: Session,
    athlete_id: str,
    program_name: str,
) -> Optional[dict[str, Optional[float]]]:
    """
    選手の強さ指標をセグメント別に計算
    strength (Total), strength_swim, strength_t1, strength_bike, strength_t2, strength_run
    """
    q = select(Result).where(
        Result.athlete_id == athlete_id,
        Result.program_name == program_name,
        Result.status == "Finished",
    )
    results = session.exec(q).all()
    if not results:
        return None

    difficulty_cache: dict[int, dict[str, float]] = {}
    standard_by_field: dict[str, list[float]] = {
        "total": [],
        "swim_sec": [],
        "t1_sec": [],
        "bike_sec": [],
        "t2_sec": [],
        "run_sec": [],
    }

    for r in results:
        if r.race_id not in difficulty_cache:
            difficulty_cache[r.race_id] = compute_race_difficulty_segments(
                session, r.race_id, program_name
            )
        diffs = difficulty_cache[r.race_id]

        # Total
        tot_diff = compute_race_difficulty(session, r.race_id, program_name)
        st_tot = get_standard_total_sec(r.total_sec, tot_diff)
        if st_tot is not None:
            standard_by_field["total"].append(st_tot)

        # Segments
        for f in SEGMENT_FIELDS:
            st = get_standard_segment(getattr(r, f), diffs[f])
            if st is not None:
                standard_by_field[f].append(st)

    out: dict[str, Optional[float]] = {}
    for k, vals in standard_by_field.items():
        if vals:
            out["strength" if k == "total" else f"strength_{k.replace('_sec', '')}"] = float(
                sum(vals) / len(vals)
            )
        else:
            out["strength" if k == "total" else f"strength_{k.replace('_sec', '')}"] = None

    return out if standard_by_field["total"] else None
