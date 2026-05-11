import { useState, useEffect, Fragment } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { api, formatTime, formatDiff } from '../api'
import type { RankingEntry, AthleteRace } from '../api'
import './pages.css'

const DAYS = 86400000

function periodBounds() {
  const now = Date.now()
  return {
    cur_start: new Date(now - 365 * DAYS),
    cur_end:   new Date(now),
    prv_start: new Date(now - 730 * DAYS),
    prv_end:   new Date(now - 365 * DAYS),
  }
}

function inRange(dateStr: string | null, start: Date, end: Date) {
  if (!dateStr) return false
  const d = new Date(dateStr)
  return d > start && d <= end
}

function periodAvg(races: AthleteRace[], start: Date, end: Date) {
  const filtered = races.filter(r => inRange(r.date, start, end))
  const avg = (key: keyof AthleteRace) => {
    const vals = filtered.map(r => r[key] as number | null).filter((v): v is number => v != null)
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
  }
  return {
    count: filtered.length,
    total: avg('standard_total_sec'),
    swim:  avg('standard_swim_sec'),
    t1:    avg('standard_t1_sec'),
    bike:  avg('standard_bike_sec'),
    t2:    avg('standard_t2_sec'),
    run:   avg('standard_run_sec'),
  }
}

function segRank(rankings: RankingEntry[], athleteId: string, key: keyof RankingEntry) {
  const valid = rankings.filter(r => r[key] != null)
  valid.sort((a, b) => (a[key] as number) - (b[key] as number))
  const idx = valid.findIndex(r => r.athlete_id === athleteId)
  return idx >= 0 ? { rank: idx + 1, total: valid.length } : null
}


export default function AthleteDetail() {
  const { athleteId } = useParams<{ athleteId: string }>()
  const [searchParams] = useSearchParams()
  const program = searchParams.get('program') ?? ''
  const [programs, setPrograms] = useState<string[]>([])
  const [selProgram, setSelProgram] = useState(program)
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getAthlete>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedRaces, setExpandedRaces] = useState<Set<number>>(new Set())
  const [allRankings, setAllRankings] = useState<RankingEntry[] | null>(null)

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
      .then((d) => {
        setData(d)
        if ('races' in d) {
          setExpandedRaces(new Set(d.races.map((r) => r.race_id)))
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [athleteId, selProgram, programs])

  useEffect(() => {
    if (program && !selProgram) setSelProgram(program)
  }, [program])

  useEffect(() => {
    if (!selProgram) return
    api.getRankings(selProgram, 500).then(r => setAllRankings(r.rankings))
  }, [selProgram])

  const toggleExpand = (raceId: number) => {
    setExpandedRaces((prev) => {
      const next = new Set(prev)
      if (next.has(raceId)) next.delete(raceId)
      else next.add(raceId)
      return next
    })
  }

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

  const sortedRaces = [...data.races].sort((a, b) => (b.date || '').localeCompare(a.date || ''))

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
          ALS strength（標準難易度でのTotal予測）: <strong>{formatTime(data.strength)}</strong>
          （{data.race_count}レース）
        </p>
        <div className="athlete-segments">
          <span title="Swim">Swim <strong>{formatTime(data.strength_swim)}</strong></span>
          <span title="T1">T1 <strong>{formatTime(data.strength_t1)}</strong></span>
          <span title="Bike">Bike <strong>{formatTime(data.strength_bike)}</strong></span>
          <span title="T2">T2 <strong>{formatTime(data.strength_t2)}</strong></span>
          <span title="Run">Run <strong>{formatTime(data.strength_run)}</strong></span>
        </div>

        {allRankings && (() => {
          const ranks = [
            { label: '総合',  key: 'strength'      as keyof RankingEntry },
            { label: 'Swim',  key: 'strength_swim' as keyof RankingEntry },
            { label: 'T1',    key: 'strength_t1'   as keyof RankingEntry },
            { label: 'Bike',  key: 'strength_bike' as keyof RankingEntry },
            { label: 'T2',    key: 'strength_t2'   as keyof RankingEntry },
            { label: 'Run',   key: 'strength_run'  as keyof RankingEntry },
          ].map(({ label, key }) => ({ label, result: segRank(allRankings, data.athlete_id, key) }))
            .filter(({ result }) => result != null)
          if (ranks.length === 0) return null
          return (
            <div className="athlete-seg-ranks">
              {ranks.map(({ label, result }) => (
                <span key={label} className="seg-rank-chip">
                  {label}: <strong>{result!.rank}位</strong> / {result!.total}人
                </span>
              ))}
            </div>
          )
        })()}

        {(() => {
          const { cur_start, cur_end, prv_start, prv_end } = periodBounds()
          const cur = periodAvg(data.races, cur_start, cur_end)
          const prv = periodAvg(data.races, prv_start, prv_end)
          if (cur.count === 0 && prv.count === 0) return null
          const rows: { label: string; curVal: number | null; prvVal: number | null }[] = [
            { label: '合計（標準化平均）', curVal: cur.total, prvVal: prv.total },
            { label: 'Swim',  curVal: cur.swim,  prvVal: prv.swim  },
            { label: 'T1',    curVal: cur.t1,    prvVal: prv.t1    },
            { label: 'Bike',  curVal: cur.bike,  prvVal: prv.bike  },
            { label: 'T2',    curVal: cur.t2,    prvVal: prv.t2    },
            { label: 'Run',   curVal: cur.run,   prvVal: prv.run   },
          ]
          return (
            <div className="athlete-period-stats">
              <div className="period-stats-title">期間別成績（標準化タイム平均）</div>
              <table className="period-stats-table">
                <thead>
                  <tr>
                    <th></th>
                    <th>今期（過去365日）<br/><span className="period-count">{cur.count}レース</span></th>
                    <th>前期（366〜730日前）<br/><span className="period-count">{prv.count}レース</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ label, curVal, prvVal }) => (
                    <tr key={label}>
                      <td className="period-seg-label">{label}</td>
                      <td className="mono">{formatTime(curVal)}</td>
                      <td className="mono">{formatTime(prvVal)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        })()}

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
                <Line type="monotone" dataKey="standard" name="ALS標準化" stroke="var(--accent)" strokeWidth={2} dot={{ r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <p className="desc" style={{ marginTop: '1rem' }}>
          行をクリックするとセグメント別タイムの展開/折りたたみができます。
          「逆転」列は強さ指標に基づく期待順位と実際の順位の差（↑＝上回り、↓＝下回り）を示します。
        </p>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>レース</th>
                <th>日付</th>
                <th>実順位</th>
                <th>標準化順位</th>
                <th>逆転</th>
                <th>実タイム</th>
                <th>標準化</th>
              </tr>
            </thead>
            <tbody>
              {sortedRaces.map((r) => {
                const isExpanded = expandedRaces.has(r.race_id)
                const diff = r.strength_rank != null && r.position != null
                  ? r.strength_rank - r.position
                  : null
                return (
                  <Fragment key={r.race_id}>
                    <tr
                      className="race-row-expandable"
                      onClick={() => toggleExpand(r.race_id)}
                      title="クリックしてセグメントタイムを表示"
                    >
                      <td>
                        <span className="expand-toggle">{isExpanded ? '▼' : '▶'}</span>
                        {' '}
                        <Link
                          to={`/races/${r.race_id}?program=${encodeURIComponent(selProgram || '')}`}
                          onClick={(e) => e.stopPropagation()}
                        >
                          {r.race_name || `Race ${r.race_id}`}
                        </Link>
                      </td>
                      <td>{r.date ?? '--'}</td>
                      <td className="rank">{r.position ?? '--'}</td>
                      <td className="rank">{r.strength_rank ?? '--'}</td>
                      <td>
                        {diff === null ? (
                          <span className="mono">--</span>
                        ) : diff === 0 ? (
                          <span className="reversal-none">±0</span>
                        ) : diff > 0 ? (
                          <span
                            className="reversal-up"
                            title={`強さ順位${r.strength_rank}位に対し実際${r.position}位（${diff}位分上回り）`}
                          >
                            ↑{diff}
                          </span>
                        ) : (
                          <span
                            className="reversal-down"
                            title={`強さ順位${r.strength_rank}位に対し実際${r.position}位（${Math.abs(diff)}位分下回り）`}
                          >
                            ↓{Math.abs(diff)}
                          </span>
                        )}
                      </td>
                      <td className="mono">{formatTime(r.total_sec)}</td>
                      <td className="mono">{formatTime(r.standard_total_sec)}</td>
                    </tr>
                    {isExpanded && (
                      <tr className="segment-detail-row">
                        <td colSpan={7}>
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
                              {([
                                { label: 'Swim', actual: r.swim_sec, pred: r.pred_swim_sec },
                                { label: 'T1',   actual: r.t1_sec,   pred: r.pred_t1_sec   },
                                { label: 'Bike', actual: r.bike_sec, pred: r.pred_bike_sec },
                                { label: 'T2',   actual: r.t2_sec,   pred: r.pred_t2_sec   },
                                { label: 'Run',  actual: r.run_sec,  pred: r.pred_run_sec  },
                              ] as const).map(({ label, actual, pred }) => {
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
                              <tr className="seg-total-row">
                                <td className="seg-label">合計</td>
                                <td className="mono">{formatTime(r.total_sec)}</td>
                                <td className="mono">{formatTime(r.pred_total_sec)}</td>
                                <td className={
                                  r.total_sec == null || r.pred_total_sec == null ? 'mono' :
                                  r.total_sec - r.pred_total_sec < 0 ? 'mono diff-fast' :
                                  r.total_sec - r.pred_total_sec > 0 ? 'mono diff-slow' : 'mono'
                                }>
                                  {r.total_sec != null && r.pred_total_sec != null
                                    ? formatDiff(r.total_sec - r.pred_total_sec)
                                    : '--'}
                                </td>
                              </tr>
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
      </div>
    </div>
  )
}
