import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { api, formatTime, getCountryFlag, type RankingSortBy } from '../api'
import './pages.css'

type SortConfig = { key: RankingSortBy; label: string; strengthKey: string; rankKey: string }

const SORT_CONFIGS: SortConfig[] = [
  { key: 'total', label: 'Total',  strengthKey: 'strength',      rankKey: 'rank'      },
  { key: 'swim',  label: 'Swim',   strengthKey: 'strength_swim', rankKey: 'rank_swim' },
  { key: 't1',    label: 'T1',     strengthKey: 'strength_t1',   rankKey: 'rank_t1'   },
  { key: 'bike',  label: 'Bike',   strengthKey: 'strength_bike', rankKey: 'rank_bike' },
  { key: 't2',    label: 'T2',     strengthKey: 'strength_t2',   rankKey: 'rank_t2'   },
  { key: 'run',   label: 'Run',    strengthKey: 'strength_run',  rankKey: 'rank_run'  },
]

export default function Rankings() {
  const [programs, setPrograms] = useState<string[]>([])
  const [program, setProgram] = useState('PTS4 Men')
  const [sortBy, setSortBy] = useState<RankingSortBy>('total')
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getRankings>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.getPrograms()
      .then((r) => {
        setPrograms(r.programs)
        setProgram((prev) =>
          r.programs.includes(prev) ? prev : (r.programs.includes('PTS4 Men') ? 'PTS4 Men' : (r.programs[0] ?? ''))
        )
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!program) return
    setLoading(true)
    api.getRankings(program, 50, sortBy)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [program, sortBy])

  if (error) return <div className="error">{error}</div>
  if (loading && !data) return <div className="loading">読み込み中...</div>

  const activeConfig = SORT_CONFIGS.find((c) => c.key === sortBy) ?? SORT_CONFIGS[0]

  function getSegTime(r: import('../api').RankingEntry, key: RankingSortBy): number | null | undefined {
    switch (key) {
      case 'total': return r.strength
      case 'swim':  return r.strength_swim
      case 't1':    return r.strength_t1
      case 'bike':  return r.strength_bike
      case 't2':    return r.strength_t2
      case 'run':   return r.strength_run
    }
  }

  function getSegRank(r: import('../api').RankingEntry, key: RankingSortBy): number | null | undefined {
    switch (key) {
      case 'total': return r.rank
      case 'swim':  return r.rank_swim
      case 't1':    return r.rank_t1
      case 'bike':  return r.rank_bike
      case 't2':    return r.rank_t2
      case 'run':   return r.rank_run
    }
  }

  const chartData = data?.rankings.slice(0, 15).map((r, i) => ({
    name: `${r.first_name} ${r.last_name}`.trim() || r.athlete_id,
    time: getSegTime(r, activeConfig.key) ?? null,
    fullName: `${r.first_name} ${r.last_name}`.trim(),
    rank: i + 1,
  })).filter((d) => d.time != null) ?? []

  function handleSortChange(key: RankingSortBy) {
    if (key !== sortBy) setSortBy(key)
  }

  return (
    <div className="rankings-page">
      <div className="card">
        <div className="page-header">
          <h2>強さランキング（標準化タイム平均）</h2>
          <select value={program} onChange={(e) => setProgram(e.target.value)}>
            {programs.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>

        <p className="desc">
          基準レースとの比較で補正した標準化タイムの平均が短い順。レース難易度を考慮した実力指標。
          列ヘッダーをクリックするとそのセグメントでソートできます。
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
                {SORT_CONFIGS.map((c) => (
                  <th
                    key={c.key}
                    className={`sortable-th${sortBy === c.key ? ' sort-active' : ''}`}
                    onClick={() => handleSortChange(c.key)}
                  >
                    {c.label}
                    <span className="sort-arrow">{sortBy === c.key ? ' ▲' : ' ↕'}</span>
                  </th>
                ))}
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
                  {SORT_CONFIGS.map((c) => {
                    const time = getSegTime(r, c.key)
                    const segRank = getSegRank(r, c.key)
                    return (
                      <td key={c.key} className={`mono seg-cell${sortBy === c.key ? ' sort-active-cell' : ''}`}>
                        <span className="seg-time">{formatTime(time)}</span>
                        {segRank != null && (
                          <span className="seg-rank">#{segRank}</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
