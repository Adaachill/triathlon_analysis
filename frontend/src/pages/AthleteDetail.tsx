import { useState, useEffect } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { api, formatTime } from '../api'
import './pages.css'

export default function AthleteDetail() {
  const { athleteId } = useParams<{ athleteId: string }>()
  const [searchParams] = useSearchParams()
  const program = searchParams.get('program') ?? ''
  const [programs, setPrograms] = useState<string[]>([])
  const [selProgram, setSelProgram] = useState(program)
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getAthlete>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getPrograms().then((r) => {
      setPrograms(r.programs)
      if (!selProgram) {
        setSelProgram(r.programs.includes('PTS4 Men') ? 'PTS4 Men' : (r.programs[0] ?? ''))
      }
    })
  }, [])

  useEffect(() => {
    if (!athleteId) return
    const prog = selProgram || (programs.includes('PTS4 Men') ? 'PTS4 Men' : (programs[0] ?? ''))
    if (!prog) {
      setLoading(false)
      return
    }
    setLoading(true)
    api.getAthlete(athleteId, prog)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [athleteId, selProgram, programs])

  useEffect(() => {
    if (program && !selProgram) setSelProgram(program)
  }, [program])

  if (error) return <div className="error">{error}</div>
  if (loading && !data) return <div className="loading">読み込み中...</div>
  if (data && 'error' in data) return <div className="error">{(data as { error: string }).error}</div>
  if (!data) return null

  const chartData = [...data.races]
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    .map((r) => ({
      date: r.date || r.race_id,
      name: r.race_name || `Race ${r.race_id}`,
      total: r.total_sec,
      standard: r.standard_total_sec,
      position: r.position,
    }))

  return (
    <div className="athlete-detail-page">
      <div className="card">
        <div className="page-header">
          <Link to="/" className="back-link">← ランキング</Link>
          <select value={selProgram} onChange={(e) => setSelProgram(e.target.value)}>
            {programs.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        <h2 className="athlete-name">
          {data.first_name} {data.last_name}
          <span className="country">{data.country}</span>
        </h2>
        <p className="athlete-strength">
          標準化Total平均: <strong>{formatTime(data.strength)}</strong>
          （{data.race_count}レースの平均）
        </p>
        <div className="athlete-segments">
          <span title="Swim">Swim <strong>{formatTime(data.strength_swim)}</strong></span>
          <span title="T1">T1 <strong>{formatTime(data.strength_t1)}</strong></span>
          <span title="Bike">Bike <strong>{formatTime(data.strength_bike)}</strong></span>
          <span title="T2">T2 <strong>{formatTime(data.strength_t2)}</strong></span>
          <span title="Run">Run <strong>{formatTime(data.strength_run)}</strong></span>
        </div>

        {chartData.length > 0 && (
          <div className="chart-container">
            <h3>レース別タイム推移</h3>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData} margin={{ top: 10, right: 20, left: 20, bottom: 30 }}>
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => formatTime(v)} />
                <Tooltip
                  formatter={(v: number) => formatTime(v)}
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.name}
                />
                <Line type="monotone" dataKey="total" name="実タイム" stroke="var(--text-muted)" strokeWidth={2} dot={{ r: 4 }} />
                <Line type="monotone" dataKey="standard" name="標準化" stroke="var(--accent)" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>レース</th>
                <th>日付</th>
                <th>順位</th>
                <th>実タイム</th>
                <th>標準化</th>
              </tr>
            </thead>
            <tbody>
              {[...data.races]
                .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
                .map((r) => (
                  <tr key={r.race_id}>
                    <td>
                      <Link to={`/races/${r.race_id}?program=${encodeURIComponent(selProgram || '')}`}>
                        {r.race_name || `Race ${r.race_id}`}
                      </Link>
                    </td>
                    <td>{r.date ?? '--'}</td>
                    <td className="rank">{r.position ?? '--'}</td>
                    <td className="mono">{formatTime(r.total_sec)}</td>
                    <td className="mono">{formatTime(r.standard_total_sec)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
