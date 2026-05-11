import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { api, formatTime, formatDiff } from '../api'
import type { RankingsDiffResponse } from '../api'
import './pages.css'

// 2026 Devonport の race_id（新たに追加されたレース）
const NEW_RACE_ID = 11

export default function Rankings() {
  const [programs, setPrograms] = useState<string[]>([])
  const [program, setProgram] = useState('')
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getRankings>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [showDiff, setShowDiff] = useState(false)
  const [diffData, setDiffData] = useState<RankingsDiffResponse | null>(null)
  const [diffLoading, setDiffLoading] = useState(false)
  const [diffError, setDiffError] = useState<string | null>(null)

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
    setDiffData(null)
    setShowDiff(false)
    api.getRankings(program)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [program])

  const handleToggleDiff = () => {
    if (!program) return
    if (showDiff) {
      setShowDiff(false)
      return
    }
    if (diffData && diffData.program_name === program) {
      setShowDiff(true)
      return
    }
    setDiffLoading(true)
    setDiffError(null)
    api.getRankingsDiff(program, NEW_RACE_ID)
      .then((d) => {
        setDiffData(d)
        setShowDiff(true)
      })
      .catch((e) => setDiffError(e.message))
      .finally(() => setDiffLoading(false))
  }

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
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <select value={program} onChange={(e) => setProgram(e.target.value)}>
              {programs.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <button
              className={`btn-diff-toggle${showDiff ? ' active' : ''}`}
              onClick={handleToggleDiff}
              disabled={diffLoading}
            >
              {diffLoading ? '計算中...' : showDiff ? '通常表示に戻す' : '2026 Devonport 追加の影響'}
            </button>
          </div>
        </div>

        {diffError && <p style={{ color: '#f87171', fontSize: '0.85rem' }}>{diffError}</p>}

        <p className="desc">
          {showDiff
            ? '2026 Devonport（race_id=11）のデータ追加前後でのランキング変化。rank_change が正の値 = 順位上昇。'
            : '基準レースとの比較で補正した標準化タイムの平均が短い順。レース難易度を考慮した実力指標。'}
        </p>

        {/* 通常ランキング：棒グラフ */}
        {!showDiff && chartData.length > 0 && (
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

        {/* 通常ランキングテーブル */}
        {!showDiff && (
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
                    <td>{r.country}</td>
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
        )}

        {/* 差分ランキングテーブル */}
        {showDiff && diffData && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>現順位</th>
                  <th>変化</th>
                  <th>追加前</th>
                  <th>選手名</th>
                  <th>国</th>
                  <th>strength（追加後）</th>
                  <th>strength変化</th>
                </tr>
              </thead>
              <tbody>
                {diffData.entries.map((e) => {
                  const change = e.rank_change
                  return (
                    <tr key={e.athlete_id}>
                      <td className="rank">{e.rank_after}</td>
                      <td>
                        {change === null ? (
                          <span className="rank-badge rank-new">NEW</span>
                        ) : change > 0 ? (
                          <span className="rank-badge rank-up">↑{change}</span>
                        ) : change < 0 ? (
                          <span className="rank-badge rank-down">↓{Math.abs(change)}</span>
                        ) : (
                          <span className="rank-badge rank-same">－</span>
                        )}
                      </td>
                      <td className="mono" style={{ color: 'var(--text-muted)' }}>
                        {e.rank_before ?? '—'}
                      </td>
                      <td>
                        <Link to={`/athletes/${e.athlete_id}?program=${encodeURIComponent(program)}`}>
                          {`${e.first_name} ${e.last_name}`.trim() || e.athlete_id}
                        </Link>
                      </td>
                      <td>{e.country}</td>
                      <td className="mono">{formatTime(e.strength_after)}</td>
                      <td className="mono">
                        {e.strength_change == null ? '—' : (
                          <span className={e.strength_change < 0 ? 'diff-fast' : e.strength_change > 0 ? 'diff-slow' : ''}>
                            {formatDiff(-e.strength_change)}
                          </span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
