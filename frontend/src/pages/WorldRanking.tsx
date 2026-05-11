import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import type { WorldRankingEntry } from '../api'
import './pages.css'
import './WorldRanking.css'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

export default function WorldRanking() {
  const [programs, setPrograms] = useState<string[]>([])
  const [program, setProgram] = useState('')
  const [asOfDate, setAsOfDate] = useState(todayStr())
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getWorldRanking>> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedAthletes, setExpandedAthletes] = useState<Set<string>>(new Set())

  useEffect(() => {
    api.getPrograms().then((r) => {
      setPrograms(r.programs)
      setProgram(r.programs[0] ?? '')
    })
  }, [])

  useEffect(() => {
    if (!program || !asOfDate) return
    setLoading(true)
    setError(null)
    api.getWorldRanking(program, asOfDate)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [program, asOfDate])

  const toggleExpand = (athleteId: string) => {
    setExpandedAthletes((prev) => {
      const next = new Set(prev)
      if (next.has(athleteId)) next.delete(athleteId)
      else next.add(athleteId)
      return next
    })
  }

  return (
    <div className="wr-page">
      {/* 開発中バナー */}
      <div className="wr-dev-banner">
        ⚠️ 世界ランキング（開発中）：このページは開発中です。計算結果は参考値であり、公式のWorld Triathlon世界ランキングとは異なる場合があります。
      </div>

      <div className="card">
        <div className="page-header">
          <h2 className="wr-title">
            世界ランキング試算
            <span className="wr-dev-badge">開発中</span>
          </h2>
        </div>

        <div className="wr-controls">
          <div className="wr-control-group">
            <label className="wr-label">カテゴリ</label>
            <select value={program} onChange={(e) => setProgram(e.target.value)}>
              {programs.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div className="wr-control-group">
            <label className="wr-label">基準日</label>
            <input
              type="date"
              value={asOfDate}
              max={todayStr()}
              onChange={(e) => setAsOfDate(e.target.value)}
              className="wr-date-input"
            />
          </div>
        </div>

        {data && (
          <div className="wr-period-info">
            <span className="wr-period-chip wr-period1">
              Current（全ポイント）: {data.current_start} 〜 {data.current_end}
            </span>
            <span className="wr-period-chip wr-period2">
              Previous（×1/3）: {data.previous_start} 〜 {data.previous_end}
            </span>
          </div>
        )}

        <p className="desc">
          各期間の上位3大会のポイント合計。優勝ポイントを1位が獲得し、以降は0.925倍ずつ減少。行をクリックで詳細を展開。
        </p>

        {error && <div className="error">{error}</div>}
        {loading && <div className="loading">計算中...</div>}

        {data && !loading && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>順位</th>
                  <th>選手名</th>
                  <th>国</th>
                  <th className="col-total-highlight">合計ポイント</th>
                  <th>Current</th>
                  <th>Previous</th>
                </tr>
              </thead>
              <tbody>
                {data.rankings.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      該当期間にポイント設定済みのレース結果がありません
                    </td>
                  </tr>
                )}
                {data.rankings.map((entry: WorldRankingEntry, i: number) => {
                  const isExpanded = expandedAthletes.has(entry.athlete_id)
                  return (
                    <>
                      <tr
                        key={entry.athlete_id}
                        className="race-row-expandable"
                        onClick={() => toggleExpand(entry.athlete_id)}
                      >
                        <td className="rank">{i + 1}</td>
                        <td>
                          <span className="expand-toggle">{isExpanded ? '▼' : '▶'} </span>
                          <Link
                            to={`/athletes/${entry.athlete_id}?program=${encodeURIComponent(program)}`}
                            onClick={(e) => e.stopPropagation()}
                          >
                            {`${entry.first_name} ${entry.last_name}`.trim()}
                          </Link>
                        </td>
                        <td>{entry.country}</td>
                        <td className="mono time-actual-total">{entry.total_points.toFixed(1)}</td>
                        <td className="mono">{entry.period1_points.toFixed(1)}</td>
                        <td className="mono wr-period2-val">
                          {entry.period2_points.toFixed(1)}
                          {entry.period2_points_raw > 0 && (
                            <span className="wr-raw-hint">（元: {entry.period2_points_raw.toFixed(1)}）</span>
                          )}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${entry.athlete_id}-detail`} className="segment-detail-row">
                          <td colSpan={6}>
                            <div className="wr-detail">
                              <div className="wr-detail-col">
                                <div className="wr-detail-label">直近1年の大会（上位3大会が加算）</div>
                                {entry.period1_races.length === 0
                                  ? <p className="wr-no-race">該当なし</p>
                                  : entry.period1_races.map((r, idx) => (
                                    <div key={r.race_id} className={`wr-race-row ${idx < 3 ? 'wr-counted' : 'wr-not-counted'}`}>
                                      <span className="wr-race-date">{r.date}</span>
                                      <span className="wr-race-name">{r.race_name ?? `Race ${r.race_id}`}</span>
                                      <span className="wr-race-pts">{r.points.toFixed(1)}pt</span>
                                      {idx >= 3 && <span className="wr-not-counted-badge">加算外</span>}
                                    </div>
                                  ))
                                }
                              </div>
                              <div className="wr-detail-col">
                                <div className="wr-detail-label">前年の大会（上位3大会の合計 × 1/3）</div>
                                {entry.period2_races.length === 0
                                  ? <p className="wr-no-race">該当なし</p>
                                  : entry.period2_races.map((r, idx) => (
                                    <div key={r.race_id} className={`wr-race-row ${idx < 3 ? 'wr-counted' : 'wr-not-counted'}`}>
                                      <span className="wr-race-date">{r.date}</span>
                                      <span className="wr-race-name">{r.race_name ?? `Race ${r.race_id}`}</span>
                                      <span className="wr-race-pts">{r.points.toFixed(1)}pt</span>
                                      {idx >= 3 && <span className="wr-not-counted-badge">加算外</span>}
                                    </div>
                                  ))
                                }
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
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
