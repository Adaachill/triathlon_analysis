import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { api, formatTime, getCountryFlag } from '../api'
import './pages.css'

export default function Rankings() {
  const [programs, setPrograms] = useState<string[]>([])
  const [program, setProgram] = useState('')
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getRankings>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getPrograms()
      .then((r) => {
        setPrograms(r.programs)
        setProgram(r.programs.includes('PTS4 Men') ? 'PTS4 Men' : (r.programs[0] ?? ''))
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!program) return
    setLoading(true)
    api.getRankings(program)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [program])

  if (error) return <div className="error">{error}</div>
  if (loading && !data) return <div className="loading">読み込み中...</div>

  const chartData = data?.rankings.slice(0, 15).map((r, i) => ({
    name: `${r.first_name} ${r.last_name}`.trim() || r.athlete_id,
    time: r.strength,
    fullName: `${r.first_name} ${r.last_name}`.trim(),
    rank: i + 1,
  })) ?? []

  return (
    <div className="rankings-page">
      <div className="card">
        <div className="page-header">
          <h2>強さランキング（標準化Total平均）</h2>
          <select value={program} onChange={(e) => setProgram(e.target.value)}>
            {programs.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        <p className="desc">
          基準レースとの比較で補正した標準化タイムの平均が短い順。レース難易度を考慮した実力指標。
        </p>

        {chartData.length > 0 && (
          <div className="chart-container">
            <ResponsiveContainer width="100%" height={320}>
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
                  domain={['dataMin - 60', 'dataMax + 60']}
                />
                <Tooltip
                  formatter={(v: number) => formatTime(v)}
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
                />
                <Bar dataKey="time" fill="var(--accent)" radius={[4, 4, 0, 0]} />
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
                <th>Total</th>
                <th>Swim</th>
                <th>T1</th>
                <th>Bike</th>
                <th>T2</th>
                <th>Run</th>
              </tr>
            </thead>
            <tbody>
              {data?.rankings.map((r, i) => (
                <tr key={r.athlete_id}>
                  <td className="rank">{i + 1}</td>
                  <td>
                    <Link to={`/athletes/${r.athlete_id}?program=${encodeURIComponent(program)}`}>
                      {`${r.first_name} ${r.last_name}`.trim() || r.athlete_id}
                    </Link>
                  </td>
                  <td><span className="country-flag">{getCountryFlag(r.country)}</span>{r.country}</td>
                  <td className="mono">{formatTime(r.strength)}</td>
                  <td className="mono">{formatTime(r.strength_swim)}</td>
                  <td className="mono">{formatTime(r.strength_t1)}</td>
                  <td className="mono">{formatTime(r.strength_bike)}</td>
                  <td className="mono">{formatTime(r.strength_t2)}</td>
                  <td className="mono">{formatTime(r.strength_run)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
