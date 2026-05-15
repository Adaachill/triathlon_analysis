import { useState, useEffect, useMemo, Fragment } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, LabelList } from 'recharts'
import { api, formatTime, formatDiff, getCountryFlag } from '../api'
import type { RaceResult } from '../api'
import BumpChart, { type BumpAthleteInput } from './BumpChart'
import './pages.css'

type ViewMode = 'actual' | 'standard'

const SEGS: { key: keyof RaceResult; predKey: keyof RaceResult; stdKey: keyof RaceResult; label: string }[] = [
  { key: 'swim_sec', predKey: 'pred_swim_sec', stdKey: 'standard_swim_sec', label: 'Swim' },
  { key: 't1_sec',   predKey: 'pred_t1_sec',   stdKey: 'standard_t1_sec',   label: 'T1'   },
  { key: 'bike_sec', predKey: 'pred_bike_sec', stdKey: 'standard_bike_sec', label: 'Bike' },
  { key: 't2_sec',   predKey: 'pred_t2_sec',   stdKey: 'standard_t2_sec',   label: 'T2'   },
  { key: 'run_sec',  predKey: 'pred_run_sec',  stdKey: 'standard_run_sec',  label: 'Run'  },
]

const SEG_CONFIG: { key: keyof RaceResult; label: string; icon: string; color: string }[] = [
  { key: 'swim_sec', label: 'Swim', icon: '🏊', color: '#38bdf8' },
  { key: 't1_sec',   label: 'T1',   icon: '⚡', color: '#c4b5fd' },
  { key: 'bike_sec', label: 'Bike', icon: '🚴', color: '#fb923c' },
  { key: 't2_sec',   label: 'T2',   icon: '🔄', color: '#f9a8d4' },
  { key: 'run_sec',  label: 'Run',  icon: '🏃', color: '#4ade80' },
]

const CHECKPOINT_LABELS = [
  { headline: 'スイム', sub: 'Swim 終了後の順位', icon: '🏊' },
  { headline: 'T1 通過', sub: 'スイム + T1', icon: '⚡' },
  { headline: 'バイク', sub: 'バイク終了後の順位', icon: '🚴' },
  { headline: 'T2 通過', sub: 'バイク + T2', icon: '🔄' },
  { headline: 'フィニッシュ', sub: '最終タイム', icon: '🏁' },
]

function CumulativeSegChart({ results }: { results: RaceResult[] }) {
  const [step, setStep] = useState(4)
  const [animKey, setAnimKey] = useState(0)

  const top15 = useMemo(() =>
    results
      .filter((r) => r.status === 'Finished' && r.total_sec != null)
      .sort((a, b) => (a.total_sec ?? 999999) - (b.total_sec ?? 999999))
      .slice(0, 15),
    [results]
  )

  const chartData = useMemo(() =>
    top15.map((r) => {
      const entry: Record<string, number | string> = {
        name: r.last_name || r.athlete_id,
        athleteId: r.athlete_id,
      }
      SEG_CONFIG.forEach((seg, i) => {
        entry[seg.key as string] = i <= step ? ((r[seg.key] as number | null) ?? 0) : 0
      })
      return entry
    }),
    [top15, step]
  )

  const checkpointRanks = useMemo(() => {
    const totals = top15.map((r) => {
      let cum = 0
      for (let i = 0; i <= step; i++) cum += (r[SEG_CONFIG[i].key] as number | null) ?? 0
      return { id: r.athlete_id, cum }
    })
    totals.sort((a, b) => a.cum - b.cum)
    return Object.fromEntries(totals.map((t, i) => [t.id, i + 1]))
  }, [top15, step])

  const prevCheckpointRanks = useMemo(() => {
    if (step === 0) return null
    const totals = top15.map((r) => {
      let cum = 0
      for (let i = 0; i <= step - 1; i++) cum += (r[SEG_CONFIG[i].key] as number | null) ?? 0
      return { id: r.athlete_id, cum }
    })
    totals.sort((a, b) => a.cum - b.cum)
    return Object.fromEntries(totals.map((t, i) => [t.id, i + 1]))
  }, [top15, step])

  const goTo = (newStep: number) => {
    setStep(newStep)
    setAnimKey((k) => k + 1)
  }

  const cp = CHECKPOINT_LABELS[step]

  if (top15.length === 0) return null

  return (
    <div className="cum-chart-card">
      <div className="cum-chart-header">
        <div className="cum-chart-title">
          <span className="cum-chart-icon">{cp.icon}</span>
          <div>
            <div className="cum-chart-headline">{cp.headline}</div>
            <div className="cum-chart-sub">{cp.sub}</div>
          </div>
        </div>
        <div className="cum-step-dots" role="tablist">
          {CHECKPOINT_LABELS.map((cl, i) => (
            <button
              key={i}
              role="tab"
              aria-selected={i === step}
              className={`cum-step-dot${i === step ? ' active' : ''}`}
              onClick={() => goTo(i)}
              title={cl.headline}
            />
          ))}
        </div>
      </div>

      <div className="cum-chart-wrap">
        <button
          className="cum-nav-btn cum-nav-left"
          onClick={() => step > 0 && goTo(step - 1)}
          disabled={step === 0}
          aria-label="前のチェックポイント"
        >‹</button>

        <div className="cum-chart-scroll-outer">
          <div className="cum-chart-inner" key={animKey} style={{ minWidth: Math.max(600, top15.length * 72) }}>
            <BarChart
              width={Math.max(600, top15.length * 72)}
              height={320}
              data={chartData}
              margin={{ top: 40, right: 8, left: 0, bottom: 64 }}
            >
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10 }}
                angle={-45}
                textAnchor="end"
                height={72}
                interval={0}
              />
              <YAxis
                tickFormatter={(v) => formatTime(v)}
                tick={{ fontSize: 10 }}
                width={52}
              />
              <Tooltip
                formatter={(v: number, name: string) => {
                  const seg = SEG_CONFIG.find((s) => (s.key as string) === name)
                  return [formatTime(v), seg ? `${seg.icon} ${seg.label}` : name]
                }}
                contentStyle={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border)',
                  fontSize: '0.82rem',
                  borderRadius: '8px',
                }}
                cursor={{ fill: 'rgba(30,107,186,0.06)' }}
              />
              {SEG_CONFIG.map((seg, i) => (
                <Bar
                  key={seg.key as string}
                  dataKey={seg.key as string}
                  stackId="a"
                  fill={seg.color}
                  isAnimationActive
                  animationDuration={500}
                  animationEasing="ease-out"
                  radius={i === step ? [4, 4, 0, 0] : i === 0 ? [0, 0, 4, 4] : undefined}
                >
                  {i === step && (
                    <LabelList
                      position="top"
                      content={(props) => {
                        const p = props as unknown as Record<string, unknown>
                        const x = p.x as number
                        const y = p.y as number
                        const width = p.width as number
                        const index = p.index as number
                        if (index == null || !top15[index]) return null
                        const r = top15[index]
                        let total = 0
                        for (let si = 0; si <= step; si++) {
                          total += (r[SEG_CONFIG[si].key] as number | null) ?? 0
                        }
                        const rank = checkpointRanks[r.athlete_id]
                        const prevRank = prevCheckpointRanks?.[r.athlete_id]
                        const rankChanged = prevRank != null && prevRank !== rank
                        const rankUp = prevRank != null && rank < prevRank
                        const rankDown = prevRank != null && rank > prevRank
                        const rankColor = rankUp ? '#16a34a' : rankDown ? '#dc2626' : 'var(--text-muted)'
                        const cx = x + width / 2
                        return (
                          <g>
                            <text x={cx} y={y - 14} textAnchor="middle" fontSize={9} fontWeight={rankChanged ? 700 : 400} fill={rankColor}>
                              {rankChanged && (rankUp ? '↑' : '↓')}{rank}位
                            </text>
                            <text x={cx} y={y - 3} textAnchor="middle" fontSize={8} fill="var(--text-muted)">
                              {formatTime(total)}
                            </text>
                          </g>
                        )
                      }}
                    />
                  )}
                </Bar>
              ))}
            </BarChart>
          </div>
        </div>

        <button
          className="cum-nav-btn cum-nav-right"
          onClick={() => step < 4 && goTo(step + 1)}
          disabled={step === 4}
          aria-label="次のチェックポイント"
        >›</button>
      </div>

      <div className="cum-legend">
        {SEG_CONFIG.slice(0, step + 1).map((seg) => (
          <span key={seg.key as string} className="cum-legend-item">
            <span className="cum-legend-dot" style={{ background: seg.color }} />
            <span className="cum-legend-icon">{seg.icon}</span>
            {seg.label}
          </span>
        ))}
      </div>

      <p className="cum-swipe-hint">‹ › ボタンでチェックポイントを切り替え（グラフは横スクロール可）</p>
    </div>
  )
}

export default function RaceDetail() {
  const { raceId } = useParams<{ raceId: string }>()
  const [searchParams] = useSearchParams()
  const program = searchParams.get('program') ?? ''
  const [programs, setPrograms] = useState<string[]>([])
  const [selProgram, setSelProgram] = useState(program || 'PTS4 Men')
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getRace>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', date: '', location: '', points: '', note: '' })
  const [saving, setSaving] = useState(false)
  const [expandedAthletes, setExpandedAthletes] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<ViewMode>('actual')
  const [showGap, setShowGap] = useState(false)

  useEffect(() => {
    api.getPrograms().then((r) => {
      setPrograms(r.programs)
      if (!selProgram) {
        setSelProgram(r.programs.includes('PTS4 Men') ? 'PTS4 Men' : (r.programs[0] ?? ''))
      }
    })
  }, [])

  useEffect(() => {
    if (!raceId || !selProgram) return
    setLoading(true)
    api.getRace(Number(raceId), selProgram)
      .then((d) => {
        setData(d)
        if ('results' in d) {
          setExpandedAthletes(new Set(d.results.map((r) => r.athlete_id)))
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [raceId, selProgram])

  useEffect(() => {
    if (program && !selProgram) setSelProgram(program)
  }, [program])

  // 早期 return より前に宣言しないと Rules of Hooks 違反（React error #310）になる
  const gapMap = useMemo(() => {
    if (!data || !('results' in data)) return {} as Record<string, number | null>
    const finished = data.results
      .filter((r) => r.status === 'Finished' && r.total_sec != null && r.position != null)
      .sort((a, b) => (a.position ?? 999) - (b.position ?? 999))
    const map: Record<string, number | null> = {}
    for (let i = 0; i < finished.length; i++) {
      if (i === 0) {
        map[finished[i].athlete_id] = null
      } else {
        const prev = finished[i - 1].total_sec ?? 0
        const cur  = finished[i].total_sec ?? 0
        map[finished[i].athlete_id] = cur - prev
      }
    }
    return map
  }, [data])

  const toggleExpand = (athleteId: string) => {
    setExpandedAthletes((prev) => {
      const next = new Set(prev)
      if (next.has(athleteId)) next.delete(athleteId)
      else next.add(athleteId)
      return next
    })
  }

  if (error) return <div className="error">{error}</div>
  if (loading && !data) return <div className="loading">読み込み中...</div>
  if (data && 'error' in data) return <div className="error">{(data as { error: string }).error}</div>
  if (!data) return null

  const { race, results, difficulty_als, difficulty_n_als, difficulty_segments_als } = data

  const startEdit = () => {
    setEditForm({
      name: race.name ?? '',
      date: race.date ?? '',
      location: race.location ?? '',
      points: race.points != null ? String(race.points) : '',
      note: race.note ?? '',
    })
    setEditing(true)
  }

  const saveEdit = async () => {
    if (!raceId) return
    setSaving(true)
    try {
      const body: { name?: string; date?: string; location?: string; points?: number; note?: string } = {}
      if (editForm.name !== (race.name ?? '')) body.name = editForm.name || ''
      if (editForm.date !== (race.date ?? '')) body.date = editForm.date || ''
      if (editForm.location !== (race.location ?? '')) body.location = editForm.location || ''
      const newPoints = editForm.points !== '' ? Number(editForm.points) : null
      if (newPoints !== (race.points ?? null) && newPoints != null) body.points = newPoints
      if (editForm.note !== (race.note ?? '')) body.note = editForm.note || ''
      if (Object.keys(body).length === 0) {
        setEditing(false)
        return
      }
      const res = await api.updateRace(Number(raceId), body)
      setData((prev) => prev && { ...prev, race: res.race })
      setEditing(false)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const cancelEdit = () => setEditing(false)

  const hasPred = results.some((r) => r.pred_swim_sec != null || r.pred_t1_sec != null)
  const hasStandard = difficulty_als != null
  const colSpanBase = 3 + (hasStandard ? 2 : 0)

  const viewModeOptions: { value: ViewMode; label: string }[] = [
    { value: 'actual', label: '実タイム' },
    { value: 'standard', label: '標準化タイム' },
  ]

  return (
    <div className="race-detail-page">
      <div className="card">
        <div className="page-header">
          <Link to="/races" className="back-link">← レース一覧</Link>
          <select value={selProgram} onChange={(e) => setSelProgram(e.target.value)}>
            {programs.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        <div className="race-header-row">
          <h2 className="race-title">
            {race.name || `Race ${race.id}`} (event_id: {race.event_id})
            {race.is_reference && <span className="badge">基準レース</span>}
          </h2>
          {!editing ? (
            <button type="button" className="btn-edit" onClick={startEdit}>
              レース情報を編集
            </button>
          ) : null}
        </div>

        {editing ? (
          <div className="race-edit-form">
            <label>
              レース名 <input value={editForm.name} onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} placeholder="例: 2025 World Triathlon Para Championships" />
            </label>
            <label>
              日付 <input type="date" value={editForm.date} onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))} />
            </label>
            <label>
              開催国 <input value={editForm.location} onChange={(e) => setEditForm((f) => ({ ...f, location: e.target.value }))} placeholder="例: Australia" />
            </label>
            <label>
              優勝ポイント（150〜750）
              <input
                type="number"
                value={editForm.points}
                onChange={(e) => setEditForm((f) => ({ ...f, points: e.target.value }))}
                min={150}
                max={750}
                step={1}
                placeholder="例: 750"
              />
            </label>
            <label>
              メモ <input value={editForm.note} onChange={(e) => setEditForm((f) => ({ ...f, note: e.target.value }))} placeholder="任意" />
            </label>
            <div className="form-actions">
              <button type="button" className="btn-save" onClick={saveEdit} disabled={saving}>
                {saving ? '保存中...' : '保存'}
              </button>
              <button type="button" className="btn-cancel" onClick={cancelEdit} disabled={saving}>
                キャンセル
              </button>
            </div>
          </div>
        ) : null}

        {!editing && race.date && <p className="race-meta">日付: {race.date}</p>}
        {!editing && race.location && <p className="race-meta">開催国: {race.location}</p>}
        {!editing && race.points != null && <p className="race-meta">優勝ポイント: {race.points}pt</p>}
        {!editing && race.note && <p className="race-meta">メモ: {race.note}</p>}
        {!editing && difficulty_als != null && (
          <p className="race-meta race-difficulty-subtle">
            難易度（ALS）: <span className={difficulty_als >= 0 ? 'diff-harder' : 'diff-easier'}>
              {difficulty_als >= 0 ? '+' : ''}{Math.round(difficulty_als)}秒
            </span>
            <span className="difficulty-note">（平均より{difficulty_als >= 0 ? '厳しい' : '易しい'}コース, N={difficulty_n_als}）</span>
          </p>
        )}

        {/* 順位変動バンプチャート（実績タイム） */}
        <BumpChart athletes={results.flatMap((r): BumpAthleteInput[] => {
          if (
            r.status !== 'Finished' ||
            r.swim_sec == null || r.t1_sec == null ||
            r.bike_sec == null || r.t2_sec == null || r.run_sec == null
          ) return []
          return [{
            athlete_id: r.athlete_id,
            first_name: r.first_name,
            last_name:  r.last_name,
            country:    r.country,
            swim_sec:   r.swim_sec,
            t1_sec:     r.t1_sec,
            bike_sec:   r.bike_sec,
            t2_sec:     r.t2_sec,
            run_sec:    r.run_sec,
          }]
        })} />

        <div className="results-toolbar">
          <div className="view-mode-selector">
            <label className="view-mode-label">表示:</label>
            <select
              value={viewMode}
              onChange={(e) => { setViewMode(e.target.value as ViewMode); setShowGap(false) }}
              className="view-mode-select"
            >
              {viewModeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {hasPred && viewMode === 'actual' && (
            <label className="gap-toggle-label">
              <input
                type="checkbox"
                checked={showGap}
                onChange={(e) => setShowGap(e.target.checked)}
              />
              予想との差を表示
            </label>
          )}
          {hasPred && viewMode === 'actual' && showGap && (
            <p className="desc" style={{ margin: 0 }}>
              予想タイムとの差分。行をクリックしてセグメント詳細を展開できます。マイナス（緑）＝予想より速い、プラス（赤）＝予想より遅い。
            </p>
          )}
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>順位</th>
                {hasStandard && <th>強さ順位</th>}
                {hasStandard && <th>逆転</th>}
                <th>選手名</th>
                <th>国</th>
                {viewMode === 'actual' && (
                  <>
                    <th>🏊 Swim</th>
                    <th>⚡ T1</th>
                    <th>🚴 Bike</th>
                    <th>🔄 T2</th>
                    <th>🏃 Run</th>
                    <th className="col-total-highlight">🏁 合計</th>
                    <th className="col-gap">Gap</th>
                  </>
                )}
                {viewMode === 'standard' && (
                  <>
                    <th>🏊 Swim*</th>
                    <th>⚡ T1*</th>
                    <th>🚴 Bike*</th>
                    <th>🔄 T2*</th>
                    <th>🏃 Run*</th>
                    <th>実タイム合計</th>
                    <th className="col-total-highlight">標準化合計</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const isExpanded = expandedAthletes.has(r.athlete_id)
                const reversalDiff =
                  r.strength_rank != null && r.position != null
                    ? r.strength_rank - r.position
                    : null
                const canExpand = hasPred && r.status === 'Finished' && viewMode === 'actual' && showGap
                const isOutlier = r.outlier_weight != null && r.outlier_weight < 0.8


                const colSpanTotal = colSpanBase + 7

                return (
                  <Fragment key={r.athlete_id}>
                    <tr
                      className={[
                        canExpand ? 'race-row-expandable' : '',
                        isOutlier ? 'outlier-row' : '',
                      ].filter(Boolean).join(' ') || undefined}
                      onClick={canExpand ? () => toggleExpand(r.athlete_id) : undefined}
                      title={canExpand ? 'クリックしてセグメント詳細を表示' : undefined}
                    >
                      <td className="rank">{r.position ?? '--'}</td>
                      {hasStandard && (
                        <td className="rank">{r.strength_rank ?? '--'}</td>
                      )}
                      {hasStandard && (
                        <td>
                          {reversalDiff === null ? (
                            <span className="mono">--</span>
                          ) : reversalDiff === 0 ? (
                            <span className="reversal-none">±0</span>
                          ) : reversalDiff > 0 ? (
                            <span className="reversal-up" title={`強さ順位${r.strength_rank}位に対し実際${r.position}位（${reversalDiff}位分上回り）`}>
                              ↑{reversalDiff}
                            </span>
                          ) : (
                            <span className="reversal-down" title={`強さ順位${r.strength_rank}位に対し実際${r.position}位（${Math.abs(reversalDiff)}位分下回り）`}>
                              ↓{Math.abs(reversalDiff)}
                            </span>
                          )}
                        </td>
                      )}
                      <td>
                        {canExpand && (
                          <span className="expand-toggle">{isExpanded ? '▼' : '▶'} </span>
                        )}
                        <Link
                          to={`/athletes/${r.athlete_id}?program=${encodeURIComponent(selProgram || '')}`}
                          onClick={(e) => e.stopPropagation()}
                          title={isOutlier ? `外れ値の可能性（体調不良・アクシデント等）。重み: ${r.outlier_weight?.toFixed(2)}` : undefined}
                        >
                          {`${r.first_name} ${r.last_name}`.trim() || r.athlete_id}
                        </Link>
                      </td>
                      <td>
                        <span className="country-flag">{getCountryFlag(r.country)}</span>
                        {r.country}
                      </td>

                      {viewMode === 'actual' && (
                        <>
                          <td className="mono">{formatTime(r.swim_sec)}</td>
                          <td className="mono">{formatTime(r.t1_sec)}</td>
                          <td className="mono">{formatTime(r.bike_sec)}</td>
                          <td className="mono">{formatTime(r.t2_sec)}</td>
                          <td className="mono">{formatTime(r.run_sec)}</td>
                          <td className="mono time-actual-total">{formatTime(r.total_sec)}</td>
                          <td className="mono col-gap">
                            {gapMap[r.athlete_id] == null
                              ? <span className="gap-leader">—</span>
                              : <span className="gap-value">+{formatTime(gapMap[r.athlete_id])}</span>
                            }
                          </td>
                        </>
                      )}

                      {viewMode === 'standard' && (
                        <>
                          <td className="mono time-standard-total">{formatTime(r.standard_swim_sec)}</td>
                          <td className="mono time-standard-total">{formatTime(r.standard_t1_sec)}</td>
                          <td className="mono time-standard-total">{formatTime(r.standard_bike_sec)}</td>
                          <td className="mono time-standard-total">{formatTime(r.standard_t2_sec)}</td>
                          <td className="mono time-standard-total">{formatTime(r.standard_run_sec)}</td>
                          <td className="mono time-actual-muted">{formatTime(r.total_sec)}</td>
                          <td className="mono time-standard-total">{formatTime(r.standard_total_sec)}</td>
                        </>
                      )}
                    </tr>

                    {canExpand && isExpanded && (
                      <tr className="segment-detail-row">
                        <td colSpan={colSpanTotal}>
                          <table className="seg-compare-table">
                            <thead>
                              <tr>
                                <th>セグメント</th>
                                <th>実タイム</th>
                                <th>予想タイム</th>
                                <th>差分</th>
                              </tr>
                            </thead>
                            <tbody>
                              {SEGS.map(({ key, predKey, label }) => {
                                const actual = r[key] as number | null | undefined
                                const pred = r[predKey] as number | null | undefined
                                const diff = actual != null && pred != null ? actual - pred : null
                                const seg = SEG_CONFIG.find((s) => s.key === key)
                                return (
                                  <tr key={label}>
                                    <td className="seg-label">{seg?.icon} {label}</td>
                                    <td className="mono">{formatTime(actual)}</td>
                                    <td className="mono">{formatTime(pred)}</td>
                                    <td className={
                                      diff == null ? 'mono' :
                                      diff < 0 ? 'mono diff-fast' : diff > 0 ? 'mono diff-slow' : 'mono'
                                    }>
                                      {formatDiff(diff)}
                                    </td>
                                  </tr>
                                )
                              })}
                              {(() => {
                                const actuals = SEGS.map(({ key }) => r[key] as number | null | undefined)
                                const preds   = SEGS.map(({ predKey }) => r[predKey] as number | null | undefined)
                                const totalActual = actuals.every((v) => v != null)
                                  ? actuals.reduce<number>((s, v) => s + (v as number), 0)
                                  : null
                                const totalPred = preds.every((v) => v != null)
                                  ? preds.reduce<number>((s, v) => s + (v as number), 0)
                                  : null
                                const totalDiff = totalActual != null && totalPred != null ? totalActual - totalPred : null
                                return (
                                  <tr className="seg-total-row">
                                    <td className="seg-label">🏁 合計</td>
                                    <td className="mono">{formatTime(totalActual)}</td>
                                    <td className="mono">{formatTime(totalPred)}</td>
                                    <td className={
                                      totalDiff == null ? 'mono' :
                                      totalDiff < 0 ? 'mono diff-fast' : totalDiff > 0 ? 'mono diff-slow' : 'mono'
                                    }>
                                      {formatDiff(totalDiff)}
                                    </td>
                                  </tr>
                                )
                              })()}
                            </tbody>
                          </table>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>

        <CumulativeSegChart results={results} />

        {difficulty_segments_als && (
          <details className="difficulty-details-toggle">
            <summary className="difficulty-details-summary">難易度詳細（セグメント別ALS）を表示</summary>
            <div className="difficulty-details-body">
              <div className="difficulty-segments">
                {([
                  { label: '🏊 Swim', value: difficulty_segments_als.swim_sec },
                  { label: '⚡ T1',   value: difficulty_segments_als.t1_sec   },
                  { label: '🚴 Bike', value: difficulty_segments_als.bike_sec },
                  { label: '🔄 T2',   value: difficulty_segments_als.t2_sec   },
                  { label: '🏃 Run',  value: difficulty_segments_als.run_sec  },
                ] as const).map(({ label, value }) => (
                  value != null ? (
                    <span key={label} className={`difficulty-chip ${value >= 0 ? 'harder' : 'easier'}`}>
                      {label}: {value >= 0 ? '+' : ''}{Math.round(value)}秒
                    </span>
                  ) : (
                    <span key={label} className="difficulty-chip difficulty-chip-na">{label}: --</span>
                  )
                ))}
              </div>
            </div>
          </details>
        )}
      </div>
    </div>
  )
}
