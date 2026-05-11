import { useState, useEffect, Fragment } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { api, formatTime, formatDiff } from '../api'
import type { RaceResult } from '../api'
import './pages.css'

type ViewMode = 'actual' | 'standard' | 'gap'

const SEGS: { key: keyof RaceResult; predKey: keyof RaceResult; label: string }[] = [
  { key: 'swim_sec', predKey: 'pred_swim_sec', label: 'Swim' },
  { key: 't1_sec',   predKey: 'pred_t1_sec',   label: 'T1'   },
  { key: 'bike_sec', predKey: 'pred_bike_sec', label: 'Bike' },
  { key: 't2_sec',   predKey: 'pred_t2_sec',   label: 'T2'   },
  { key: 'run_sec',  predKey: 'pred_run_sec',  label: 'Run'  },
]

export default function RaceDetail() {
  const { raceId } = useParams<{ raceId: string }>()
  const [searchParams] = useSearchParams()
  const program = searchParams.get('program') ?? ''
  const [programs, setPrograms] = useState<string[]>([])
  const [selProgram, setSelProgram] = useState(program)
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getRace>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', date: '', location: '', points: '', note: '' })
  const [saving, setSaving] = useState(false)
  const [expandedAthletes, setExpandedAthletes] = useState<Set<string>>(new Set())
  const [viewMode, setViewMode] = useState<ViewMode>('actual')

  useEffect(() => {
    api.getPrograms().then((r) => {
      setPrograms(r.programs)
      if (!selProgram) {
        setSelProgram(r.programs.includes('PTS4 Men') ? 'PTS4 Men' : (r.programs[0] ?? ''))
      }
    })
  }, [])

  useEffect(() => {
    if (!raceId) return
    const prog = selProgram || (programs.includes('PTS4 Men') ? 'PTS4 Men' : (programs[0] ?? ''))
    if (!prog) {
      setLoading(false)
      return
    }
    setLoading(true)
    api.getRace(Number(raceId), prog)
      .then((d) => {
        setData(d)
        if ('results' in d) {
          setExpandedAthletes(new Set(d.results.map((r) => r.athlete_id)))
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [raceId, selProgram, programs.length])

  useEffect(() => {
    if (program && !selProgram) setSelProgram(program)
  }, [program])

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

  const withStandard = results.filter((r) => r.standard_total_sec != null)
  const chartData = withStandard.slice(0, 20).map((r) => ({
    name: `${r.first_name} ${r.last_name}`.trim() || r.athlete_id,
    total: r.total_sec,
    standard: r.standard_total_sec,
  }))

  const hasPred = results.some((r) => r.pred_swim_sec != null || r.pred_t1_sec != null)
  const hasStandard = difficulty_als != null
  const colSpanBase = 3 + (hasStandard ? 2 : 0)

  const viewModeOptions: { value: ViewMode; label: string }[] = [
    { value: 'actual', label: '実タイム' },
    { value: 'standard', label: '標準化タイム' },
    { value: 'gap', label: '予想とのギャップ' },
  ]

  const getSegGap = (r: RaceResult, key: keyof RaceResult, predKey: keyof RaceResult) => {
    const actual = r[key] as number | null | undefined
    const pred = r[predKey] as number | null | undefined
    return actual != null && pred != null ? actual - pred : null
  }

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

        {chartData.length > 0 && (
          <div className="chart-container">
            <h3>上位選手のタイム比較</h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} margin={{ top: 10, right: 20, left: 20, bottom: 60 }}>
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis
                  tickFormatter={(v) => formatTime(v)}
                  domain={[3300, 'dataMax']}
                />
                <Tooltip
                  formatter={(v: number) => formatTime(v)}
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
                />
                <Bar dataKey="total" name="実タイム" fill="var(--text-muted)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="standard" name="標準化" fill="var(--accent)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="results-toolbar">
          <div className="view-mode-selector">
            <label className="view-mode-label">表示:</label>
            <select
              value={viewMode}
              onChange={(e) => setViewMode(e.target.value as ViewMode)}
              className="view-mode-select"
            >
              {viewModeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>
          {hasPred && viewMode === 'actual' && (
            <p className="desc" style={{ margin: 0 }}>
              行をクリックするとセグメント詳細を展開/折りたたみできます。
            </p>
          )}
          {viewMode === 'gap' && (
            <p className="desc" style={{ margin: 0 }}>
              予想タイムとの差分。マイナス（緑）＝予想より速い、プラス（赤）＝予想より遅い。
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
                    <th>スイム</th>
                    <th>T1</th>
                    <th>バイク</th>
                    <th>T2</th>
                    <th>ラン</th>
                    <th className="col-total-highlight">合計</th>
                  </>
                )}
                {viewMode === 'standard' && (
                  <>
                    <th>スイム</th>
                    <th>T1</th>
                    <th>バイク</th>
                    <th>T2</th>
                    <th>ラン</th>
                    <th>実タイム合計</th>
                    <th className="col-total-highlight">標準化合計</th>
                  </>
                )}
                {viewMode === 'gap' && (
                  <>
                    <th>Swim差</th>
                    <th>T1差</th>
                    <th>Bike差</th>
                    <th>T2差</th>
                    <th>Run差</th>
                    <th className="col-total-highlight">合計差</th>
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
                const canExpand = hasPred && r.status === 'Finished' && viewMode === 'actual'
                const isOutlier = r.outlier_weight != null && r.outlier_weight < 0.8

                const totalGap = (() => {
                  const actuals = SEGS.map(({ key }) => r[key] as number | null | undefined)
                  const preds = SEGS.map(({ predKey }) => r[predKey] as number | null | undefined)
                  const totalActual = actuals.every((v) => v != null) ? actuals.reduce<number>((s, v) => s + (v as number), 0) : null
                  const totalPred = preds.every((v) => v != null) ? preds.reduce<number>((s, v) => s + (v as number), 0) : null
                  return totalActual != null && totalPred != null ? totalActual - totalPred : null
                })()

                const colSpanTotal = colSpanBase + (viewMode === 'actual' ? 6 : viewMode === 'standard' ? 7 : 6)

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
                      <td>{r.country}</td>

                      {viewMode === 'actual' && (
                        <>
                          <td className="mono">{formatTime(r.swim_sec)}</td>
                          <td className="mono">{formatTime(r.t1_sec)}</td>
                          <td className="mono">{formatTime(r.bike_sec)}</td>
                          <td className="mono">{formatTime(r.t2_sec)}</td>
                          <td className="mono">{formatTime(r.run_sec)}</td>
                          <td className="mono time-actual-total">{formatTime(r.total_sec)}</td>
                        </>
                      )}

                      {viewMode === 'standard' && (
                        <>
                          <td className="mono">{formatTime(r.swim_sec)}</td>
                          <td className="mono">{formatTime(r.t1_sec)}</td>
                          <td className="mono">{formatTime(r.bike_sec)}</td>
                          <td className="mono">{formatTime(r.t2_sec)}</td>
                          <td className="mono">{formatTime(r.run_sec)}</td>
                          <td className="mono time-actual-muted">{formatTime(r.total_sec)}</td>
                          <td className="mono time-standard-total">{formatTime(r.standard_total_sec)}</td>
                        </>
                      )}

                      {viewMode === 'gap' && (
                        <>
                          {SEGS.map(({ key, predKey, label }) => {
                            const gap = getSegGap(r, key, predKey)
                            return (
                              <td key={label} className={gap == null ? 'mono' : gap < 0 ? 'mono diff-fast' : gap > 0 ? 'mono diff-slow' : 'mono'}>
                                {formatDiff(gap)}
                              </td>
                            )
                          })}
                          <td className={totalGap == null ? 'mono time-actual-total' : totalGap < 0 ? 'mono diff-fast time-actual-total' : totalGap > 0 ? 'mono diff-slow time-actual-total' : 'mono time-actual-total'}>
                            {formatDiff(totalGap)}
                          </td>
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
                                return (
                                  <tr key={label}>
                                    <td className="seg-label">{label}</td>
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
                                    <td className="seg-label">合計</td>
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

        {difficulty_segments_als && (
          <details className="difficulty-details-toggle">
            <summary className="difficulty-details-summary">難易度詳細（セグメント別ALS）を表示</summary>
            <div className="difficulty-details-body">
              <div className="difficulty-segments">
                {([
                  { label: 'スイム', value: difficulty_segments_als.swim_sec },
                  { label: 'T1',     value: difficulty_segments_als.t1_sec   },
                  { label: 'バイク', value: difficulty_segments_als.bike_sec },
                  { label: 'T2',     value: difficulty_segments_als.t2_sec   },
                  { label: 'ラン',   value: difficulty_segments_als.run_sec  },
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
