"""レース難易度と標準化タイムの計算ロジック"""
from typing import Optional
from sqlmodel import Session, select
from app.models import Race, Result

REFERENCE_EVENT_ID = "188993"

SEGMENT_FIELDS = ["swim_sec", "t1_sec", "bike_sec", "t2_sec", "run_sec"]

# クロスプログラム計算から除外するプログラム（PTWCは車いすで条件が異なる）
CROSS_EXCLUDED_KEYWORDS = ["PTWC"]


def _is_excluded(program_name: str) -> bool:
    return any(kw in program_name for kw in CROSS_EXCLUDED_KEYWORDS)


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


# ---------------------------------------------------------------------------
# クロスプログラム難易度（PTWC以外の全プログラムを利用）
# ---------------------------------------------------------------------------

def compute_race_difficulty_with_n(
    session: Session,
    race_id: int,
    program_name: str,
) -> tuple[float, int]:
    """
    同一プログラム内の難易度オフセット（秒）と共通選手数N を返す。
    既存の compute_race_difficulty と同じアルゴリズムだが N も返す。
    """
    ref_race = get_reference_race(session)
    if ref_race is None or ref_race.id == race_id:
        return (0.0, 0)

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
    ref_by_ath = {r.athlete_id: r for r in session.exec(q_ref).all()}
    deltas: list[float] = []
    for r in session.exec(q_race).all():
        ref = ref_by_ath.get(r.athlete_id)
        if ref and ref.total_sec is not None and r.total_sec is not None:
            deltas.append(float(r.total_sec - ref.total_sec))

    if not deltas:
        return (0.0, 0)
    return (float(sum(deltas) / len(deltas)), len(deltas))


def compute_race_difficulty_segments_with_n(
    session: Session,
    race_id: int,
    program_name: str,
) -> tuple[dict[str, float], dict[str, int]]:
    """
    同一プログラム内のセグメント別難易度オフセット（秒）とセグメント別N数を返す。
    """
    ref_race = get_reference_race(session)
    zero_segs = {f: 0.0 for f in SEGMENT_FIELDS}
    zero_ns = {f: 0 for f in SEGMENT_FIELDS}
    if ref_race is None or ref_race.id == race_id:
        return (zero_segs, zero_ns)

    ref_results = {
        r.athlete_id: r
        for r in session.exec(
            select(Result).where(
                Result.race_id == ref_race.id,
                Result.program_name == program_name,
                Result.status == "Finished",
            )
        ).all()
    }
    out: dict[str, list[float]] = {f: [] for f in SEGMENT_FIELDS}
    for r in session.exec(
        select(Result).where(
            Result.race_id == race_id,
            Result.program_name == program_name,
            Result.status == "Finished",
        )
    ).all():
        ref = ref_results.get(r.athlete_id)
        if not ref:
            continue
        for f in SEGMENT_FIELDS:
            rv, rref = getattr(r, f), getattr(ref, f)
            if rv is not None and rref is not None:
                out[f].append(float(rv - rref))

    segs = {f: float(sum(d) / len(d)) if d else 0.0 for f, d in out.items()}
    ns = {f: len(d) for f, d in out.items()}
    return (segs, ns)


def compute_race_difficulty_cross_with_n(
    session: Session,
    race_id: int,
    program_name: str,
) -> tuple[float | None, int]:
    """
    クロスプログラム難易度オフセット（秒）と共通選手総数N を返す。

    PTWC以外の全プログラムの共通選手について
      pct_delta = (target_total - ref_total) / ref_total
    を収集し、その平均値に対象プログラムの基準レース平均タイムを掛けて秒換算する。
    """
    ref_race = get_reference_race(session)
    if ref_race is None or ref_race.id == race_id:
        return (None, 0)

    # 対象プログラムの基準レース平均タイム（変換係数）
    ref_target = session.exec(
        select(Result).where(
            Result.race_id == ref_race.id,
            Result.program_name == program_name,
            Result.status == "Finished",
            Result.total_sec.isnot(None),
        )
    ).all()
    if not ref_target:
        return (None, 0)
    ref_avg_target = sum(r.total_sec for r in ref_target) / len(ref_target)

    # 対象レース・基準レースの全結果（PTWC除く）
    race_all = session.exec(
        select(Result).where(
            Result.race_id == race_id,
            Result.status == "Finished",
            Result.total_sec.isnot(None),
        )
    ).all()
    ref_all = session.exec(
        select(Result).where(
            Result.race_id == ref_race.id,
            Result.status == "Finished",
            Result.total_sec.isnot(None),
        )
    ).all()

    # program × athlete_id → Result（基準レース）
    ref_index: dict[tuple[str, str], Result] = {}
    for r in ref_all:
        if not _is_excluded(r.program_name):
            ref_index[(r.program_name, r.athlete_id)] = r

    pct_deltas: list[float] = []
    for r in race_all:
        if _is_excluded(r.program_name):
            continue
        ref = ref_index.get((r.program_name, r.athlete_id))
        if ref and ref.total_sec and ref.total_sec > 0:
            pct_deltas.append((r.total_sec - ref.total_sec) / ref.total_sec)

    if not pct_deltas:
        return (None, 0)

    mean_pct = sum(pct_deltas) / len(pct_deltas)
    return (float(mean_pct * ref_avg_target), len(pct_deltas))


def compute_race_difficulty_segments_cross_with_n(
    session: Session,
    race_id: int,
    program_name: str,
) -> tuple[dict[str, float | None], dict[str, int]]:
    """
    クロスプログラムのセグメント別難易度オフセット（秒）とセグメント別N数を返す。
    """
    ref_race = get_reference_race(session)
    none_segs: dict[str, float | None] = {f: None for f in SEGMENT_FIELDS}
    zero_ns = {f: 0 for f in SEGMENT_FIELDS}
    if ref_race is None or ref_race.id == race_id:
        return (none_segs, zero_ns)

    # 対象プログラムの基準レースのセグメント平均タイム（変換係数）
    ref_target_all = session.exec(
        select(Result).where(
            Result.race_id == ref_race.id,
            Result.program_name == program_name,
            Result.status == "Finished",
        )
    ).all()
    ref_avg_segs: dict[str, float | None] = {}
    for f in SEGMENT_FIELDS:
        vals = [getattr(r, f) for r in ref_target_all if getattr(r, f) is not None]
        ref_avg_segs[f] = float(sum(vals) / len(vals)) if vals else None

    # 対象レース・基準レースの全結果（PTWC除く）
    race_all = session.exec(
        select(Result).where(
            Result.race_id == race_id,
            Result.status == "Finished",
        )
    ).all()
    ref_all = session.exec(
        select(Result).where(
            Result.race_id == ref_race.id,
            Result.status == "Finished",
        )
    ).all()

    ref_index: dict[tuple[str, str], Result] = {}
    for r in ref_all:
        if not _is_excluded(r.program_name):
            ref_index[(r.program_name, r.athlete_id)] = r

    pct_by_seg: dict[str, list[float]] = {f: [] for f in SEGMENT_FIELDS}
    for r in race_all:
        if _is_excluded(r.program_name):
            continue
        ref = ref_index.get((r.program_name, r.athlete_id))
        if not ref:
            continue
        for f in SEGMENT_FIELDS:
            rv, rref = getattr(r, f), getattr(ref, f)
            if rv is not None and rref is not None and rref > 0:
                pct_by_seg[f].append((rv - rref) / rref)

    segs: dict[str, float | None] = {}
    ns: dict[str, int] = {}
    for f in SEGMENT_FIELDS:
        d = pct_by_seg[f]
        avg_ref = ref_avg_segs[f]
        if d and avg_ref is not None:
            segs[f] = float(sum(d) / len(d)) * avg_ref
        else:
            segs[f] = None
        ns[f] = len(d)

    return (segs, ns)
