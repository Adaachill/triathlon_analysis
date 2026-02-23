import { useState, useEffect } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { api, formatTime } from '../api'
import './pages.css'

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
  const [editForm, setEditForm] = useState({ name: '', date: '', location: '', note: '' })
  const [saving, setSaving] = useState(false)

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
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [raceId, selProgram, programs.length])

  useEffect(() => {
    if (program && !selProgram) setSelProgram(program)
  }, [program])

  if (error) return <div className="error">{error}</div>
  if (loading && !data) return <div className="loading">読み込み中...</div>
  if (data && 'error' in data) return <div className="error">{(data as { error: string }).error}</div>
  if (!data) return null

  const { race, difficulty_offset, difficulty_segments, results } = data

  const startEdit = () => {
    setEditForm({
      name: race.name ?? '',
      date: race.date ?? '',
      location: race.location ?? '',
      note: race.note ?? '',
    })
    setEditing(true)
  }

  const saveEdit = async () => {
    if (!raceId) return
    setSaving(true)
    try {
      const body: { name?: string; date?: string; location?: string; note?: string } = {}
      if (editForm.name !== (race.name ?? '')) body.name = editForm.name || ''
      if (editForm.date !== (race.date ?? '')) body.date = editForm.date || ''
      if (editForm.location !== (race.location ?? '')) body.location = editForm.location || ''
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
    position: r.position,
  }))

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
        {!editing && race.note && <p className="race-meta">メモ: {race.note}</p>}
        {difficulty_offset != null && (
          <div className="difficulty-block">
            <p className="race-meta">
              難易度オフセット（合計）: {difficulty_offset >= 0 ? '+' : ''}{Math.round(difficulty_offset)}秒
              （基準レースより{difficulty_offset >= 0 ? '厳しい' : '易しい'}コース）
            </p>
            {difficulty_segments && (
              <div className="difficulty-segments">
                {[
                  { label: 'スイム', value: difficulty_segments.swim_sec },
                  { label: 'T1', value: difficulty_segments.t1_sec },
                  { label: 'バイク', value: difficulty_segments.bike_sec },
                  { label: 'T2', value: difficulty_segments.t2_sec },
                  { label: 'ラン', value: difficulty_segments.run_sec },
                ].map(({ label, value }) => (
                  <span key={label} className={`difficulty-chip ${value >= 0 ? 'harder' : 'easier'}`}>
                    {label}: {value >= 0 ? '+' : ''}{Math.round(value)}秒
                  </span>
                ))}
              </div>
            )}
          </div>
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
                  domain={[3300, 'dataMax']}   // 3300秒 = 55分
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

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>順位</th>
                <th>選手名</th>
                <th>国</th>
                <th>スイム</th>
                <th>バイク</th>
                <th>ラン</th>
                <th>合計</th>
                {difficulty_offset != null && <th>標準化</th>}
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.athlete_id}>
                  <td className="rank">{r.position ?? '--'}</td>
                  <td>
                    <Link to={`/athletes/${r.athlete_id}?program=${encodeURIComponent(selProgram || '')}`}>
                      {`${r.first_name} ${r.last_name}`.trim() || r.athlete_id}
                    </Link>
                  </td>
                  <td>{r.country}</td>
                  <td className="mono">{formatTime(r.swim_sec)}</td>
                  <td className="mono">{formatTime(r.bike_sec)}</td>
                  <td className="mono">{formatTime(r.run_sec)}</td>
                  <td className="mono">{formatTime(r.total_sec)}</td>
                  {difficulty_offset != null && (
                    <td className="mono">{formatTime(r.standard_total_sec)}</td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
