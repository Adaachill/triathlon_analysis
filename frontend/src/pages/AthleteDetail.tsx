import { useState, useEffect, Fragment, useMemo, useRef } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  BarChart, Bar, LabelList,
} from 'recharts'
import { api, formatTime, formatDiff, getCountryFlag } from '../api'
import type { AthleteRace, RankingEntry } from '../api'
import WhatIfSimulator from '../components/WhatIfSimulator'
import { GrowthCards, SegmentRadar } from '../components/GrowthRadar'
import { LoadingState } from '../components/Loading'
import './pages.css'

const DAYS = 86400000

const SEG_CONFIG = [
  { key: 'swim_sec' as keyof AthleteRace, label: 'Swim', icon: '🏊', color: '#38bdf8' },
  { key: 't1_sec'   as keyof AthleteRace, label: 'T1',   icon: '⚡', color: '#c4b5fd' },
  { key: 'bike_sec' as keyof AthleteRace, label: 'Bike', icon: '🚴', color: '#fb923c' },
  { key: 't2_sec'   as keyof AthleteRace, label: 'T2',   icon: '🔄', color: '#f9a8d4' },
  { key: 'run_sec'  as keyof AthleteRace, label: 'Run',  icon: '🏃', color: '#4ade80' },
]

const CHECKPOINT_LABELS_A = [
  { headline: 'スイム',      sub: 'Swim のみ',             icon: '🏊' },
  { headline: 'T1 通過',    sub: 'Swim + T1',              icon: '⚡' },
  { headline: 'バイク',     sub: 'バイク終了後',             icon: '🚴' },
  { headline: 'T2 通過',   sub: 'バイク + T2',              icon: '🔄' },
  { headline: 'フィニッシュ', sub: '最終タイム',             icon: '🏁' },
]

function shortenRaceName(name: string | null, raceId: number): string {
  if (!name) return `Race ${raceId}`
  const short = name
    .replace(/World Triathlon\s*/gi, '')
    .replace(/\bParatriathlon\b\s*/gi, '')
    .replace(/\bPara\b\s*/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
  return short.length > 24 ? short.slice(0, 23) + '…' : short
}

function AthleteCumulativeChart({ races }: { races: AthleteRace[] }) {
  const [step, setStep] = useState(4)
  const [animKey, setAnimKey] = useState(0)
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)

  const sorted = useMemo(() => {
    const allSorted = [...races]
      .filter((r) => r.total_sec != null)
      .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
    // 直近2年以内の件数と10件の多い方を表示上限にする
    const twoYearsAgo = new Date(Date.now() - 730 * DAYS)
    const twoYearCount = allSorted.filter(
      (r) => r.date && new Date(r.date) > twoYearsAgo
    ).length
    const limit = Math.max(10, twoYearCount)
    return allSorted.slice(-limit)
  }, [races])

  const chartData = useMemo(() =>
    sorted.map((r) => {
      const entry: Record<string, number | string> = {
        name: shortenRaceName(r.race_name, r.race_id),
      }
      SEG_CONFIG.forEach((seg, i) => {
        entry[seg.key as string] = i <= step ? ((r[seg.key] as number | null) ?? 0) : 0
      })
      return entry
    }),
    [sorted, step]
  )

  const goTo = (newStep: number) => {
    setStep(newStep)
    setAnimKey((k) => k + 1)
  }

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 50) {
      if (dx < 0 && step < 4) goTo(step + 1)
      if (dx > 0 && step > 0) goTo(step - 1)
    }
    touchStartX.current = null
    touchStartY.current = null
  }

  const cp = CHECKPOINT_LABELS_A[step]
  if (sorted.length === 0) return null

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
          {CHECKPOINT_LABELS_A.map((cl, i) => (
            <button key={i} role="tab" aria-selected={i === step}
              className={`cum-step-dot${i === step ? ' active' : ''}`}
              onClick={() => goTo(i)} title={cl.headline} />
          ))}
        </div>
      </div>

      <div className="cum-chart-wrap" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <button className="cum-nav-btn cum-nav-left" onClick={() => step > 0 && goTo(step - 1)}
          disabled={step === 0} aria-label="前のチェックポイント">‹</button>

        <div className="cum-chart-inner" key={animKey}>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} margin={{ top: 24, right: 8, left: 0, bottom: 64 }}>
              <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={72} interval={0} />
              <YAxis tickFormatter={(v) => formatTime(v)} tick={{ fontSize: 10 }} width={52} />
              <Tooltip
                formatter={(v: number, name: string) => {
                  const seg = SEG_CONFIG.find((s) => (s.key as string) === name)
                  return [formatTime(v), seg ? `${seg.icon} ${seg.label}` : name]
                }}
                contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', fontSize: '0.82rem', borderRadius: '8px' }}
                curso={{ fill: 'rgba(30,107,186,0.06)' }}
              />
              {SEG_CONFIG.map((seg, i) => (
                <Bar key={seg.key as string} dataKey={seg.key as string} stackId="a" fill={seg.color}
                  isAnimationActive animationDuration={500} animationEasing="ease-out"
                  radius={i === step ? [4, 4, 0, 0] : i === 0 ? [0, 0, 4, 4] : undefined}>
                  {i === step && (
                    <LabelList position="top" content={(props) => {
                      const p = props as unknown as Record<string, unknown>
                      const x = p.x as number, y = p.y as number, width = p.width as number
                      const index = p.index as number
                      if (index == null || !sorted[index]) return null
                      const r = sorted[index]
                      let total = 0
                      for (let si = 0; si <= step; si++) total += (r[SEG_CONFIG[si].key] as number | null) ?? 0
                      return (
                        <text x={x + width / 2} y={y - 4} textAnchor="middle" fontSize={8} fill="var(--text-muted)">
                          {formatTime(total)}
                        </text>
                      )
                    }} />
                  )}
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        <button className="cum-nav-btn cum-nav-right" onClick={() => step < 4 && goTo(step + 1)}
          disabled={step === 4} aria-label="次のチェックポイント">›</button>
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
      <p className="cum-swipe-hint">← スワイプでチェックポイントを切り替え →</p>
    </div>
  )
}

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


function medalIcon(rank: number): string {
  if (rank === 1) return '🥇'
  if (rank === 2) return '🥈'
  if (rank === 3) return '🥉'
  return ''
}

function fmtTimeDiff(sec: number | null): string {
  if (sec == null || sec <= 0) return ''
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `+${m}:${String(s).padStart(2, '0')}`
}


export default function AthleteDetail() {
  const { athleteId } = useParams<{ athleteId: string }>()
  const [searchParams] = useSearchParams()
  const program = searchParams.get('program') ?? ''
  const [programs, setPrograms] = useState<string[]>([])
  const [selProgram, setSelProgram] = useState(program || 'PTS4 Men')
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getAthlete>> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedRaces, setExpandedRaces] = useState<Set<number>>(new Set())
  const [categoryRankings, setCategoryRankings] = useState<RankingEntry[] | null>(null)

  useEffect(() => {
    api.getPrograms().then((r) => {
      setPrograms(r.programs)
      if (!selProgram) {
        setSelProgram(r.programs.includes('PTS4 Men') ? 'PTS4 Men' : (r.programs[0] ?? ''))
      }
    })
  }, [])

  useEffect(() => {
    if (!athleteId || !selProgram) return
    setLoading(true)
    setCategoryRankings(null)
    api.getAthlete(athleteId, selProgram)
      .then((d) => {
        setData(d)
        if ('races' in d) {
          setExpandedRaces(new Set(d.races.map((r) => r.race_id)))
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
    // What-if 順位再計算用にカテゴリランキングを並列取得
    // 伸び代分析・レーダー用にカテゴリ内ランキングを並列取得（失敗してもメインの表示は影響しない）
    api.getRankings(selProgram, 200, 'total')
      .then((r) => setCategoryRankings(r.rankings))
      .catch(() => setCategoryRankings([]))
  }, [athleteId, selProgram])

  const toggleExpand = (raceId: number) => {
    setExpandedRaces((prev) => {
      const next = new Set(prev)
      if (next.has(raceId)) next.delete(raceId)
      else next.add(raceId)
      return next
    })
  }

  if (error) return <div className="error">{error}</div>
  if (loading && !data) return <LoadingState variant="page" />
  if (data && 'error' in data) return <div className="error">{(data as { error: string }).error}</div>
  if (!data) return null

  const lineChartData = [...data.races]
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
          <span className="country">
            <span className="country-flag">{getCountryFlag(data.country)}</span>
            {data.country}
          </span>
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

        {data.segment_ranks && (() => {
          const ranks = [
            { label: '総合',  key: 'strength'      },
            { label: 'Swim',  key: 'strength_swim' },
            { label: 'T1',    key: 'strength_t1'   },
            { label: 'Bike',  key: 'strength_bike' },
            { label: 'T2',    key: 'strength_t2'   },
            { label: 'Run',   key: 'strength_run'  },
          ].map(({ label, key }) => ({ label, result: data.segment_ranks![key as keyof typeof data.segment_ranks] ?? null }))
            .filter(({ result }) => result != null)
          if (ranks.length === 0) return null
          return (
            <div className="athlete-seg-ranks">
              {ranks.map(({ label, result }) => {
                const medal = medalIcon(result!.rank)
                const diff = fmtTimeDiff(result!.diff_from_first)
                return (
                  <span key={label} className={`seg-rank-chip${result!.rank <= 3 ? ' seg-rank-medal' : ''}`}>
                    {medal && <span className="seg-medal-icon">{medal}</span>}
                    {label}: <strong>{result!.rank}位</strong>
                    <span className="seg-rank-total">/{result!.total}人</span>
                    {diff && <span className="seg-rank-diff">{diff}</span>}
                  </span>
                )
              })}
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

        {/* What-if シミュレータ: スライダーで各セグメントを動かして予想順位を再計算 */}
        <WhatIfSimulator athlete={data} rankings={categoryRankings} />
        {/* 伸び代分析カード（同カテゴリTOPとの比較） */}
        <GrowthCards athlete={data} rankings={categoryRankings} />

        {/* セグメント別ポジショニング（レーダー） */}
        <SegmentRadar athlete={data} rankings={categoryRankings} />

        {data.races.length > 0 && (
          <div className="chart-container">
            <h3>レース別タイム推移（セグメント累積）</h3>
            <AthleteCumulativeChart races={data.races} />
          </div>
        )}

        {lineChartData.length > 0 && (
          <div className="chart-container">
            <h3>実タイム vs 標準化タイム推移</h3>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={lineChartData} margin={{ top: 20, right: 20, left: 20, bottom: 30 }}>
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => formatTime(v)} />
                <Tooltip
                  formatter={(v: number) => formatTime(v)}
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
                  labelFormatter={(_, payload) => payload?.[0]?.payload?.name}
                />
                <Line type="monotone" dataKey="total" name="実タイム" stroke="var(--text-muted)" strokeWidth={2} dot={{ r: 4 }}>
                  <LabelList dataKey="total" position="top" formatter={(v: number) => formatTime(v)} style={{ fontSize: 9, fill: 'var(--text-muted)' }} />
                </Line>
                <Line type="monotone" dataKey="standard" name="ALS標準化" stroke="var(--accent)" strokeWidth={2} dot={{ r: 4 }}>
                  <LabelList dataKey="standard" position="bottom" formatter={(v: number) => formatTime(v)} style={{ fontSize: 9, fill: 'var(--accent)' }} />
                </Line>
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
                <th>強さ順位</th>
                <th>逆転</th>
                <th>🏊 Swim</th>
                <th>⚡ T1</th>
                <th>🚴 Bike</th>
                <th>🔄 T2</th>
                <th>🏃 Run</th>
                <th className="col-total-highlight">🏁 合計</th>
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
                      title="クリックして標準化タイムを表示"
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
                          <span className="reversal-up" title={`強さ順位${r.strength_rank}位に対し実際${r.position}位（${diff}位分上回り）`}>
                            ↑{diff}
                          </span>
                        ) : (
                          <span className="reversal-down" title={`強さ順位${r.strength_rank}位に対し実際${r.position}位（${Math.abs(diff)}位分下回り）`}>
                            ↓{Math.abs(diff)}
                          </span>
                        )}
                      </td>
                      <td className="mono">{formatTime(r.swim_sec)}</td>
                      <td className="mono">{formatTime(r.t1_sec)}</td>
                      <td className="mono">{formatTime(r.bike_sec)}</td>
                      <td className="mono">{formatTime(r.t2_sec)}</td>
                      <td className="mono">{formatTime(r.run_sec)}</td>
                      <td className="mono time-actual-total">{formatTime(r.total_sec)}</td>
                    </tr>
                    {isExpanded && (
                      <tr className="segment-detail-row">
                        <td colSpan={11}>
                          <table className="seg-compare-table">
                            <thead>
                              <tr>
                                <th>セグメント</th>
                                <th>実タイム</th>
                                <th>標準化</th>
                                <th>予想タイム</th>
                                <th>差分（予想比）</th>
                              </tr>
                            </thead>
                            <tbody>
                              {([
                                { label: '🏊 Swim', actual: r.swim_sec, std: r.standard_swim_sec, pred: r.pred_swim_sec },
                                { label: '⚡ T1',   actual: r.t1_sec,   std: r.standard_t1_sec,   pred: r.pred_t1_sec   },
                                { label: '🚴 Bike', actual: r.bike_sec, std: r.standard_bike_sec, pred: r.pred_bike_sec },
                                { label: '🔄 T2',   actual: r.t2_sec,   std: r.standard_t2_sec,   pred: r.pred_t2_sec   },
                                { label: '🏃 Run',  actual: r.run_sec,  std: r.standard_run_sec,  pred: r.pred_run_sec  },
                              ] as const).map(({ label, actual, std, pred }) => {
                                const d = actual != null && pred != null ? actual - pred : null
                                return (
                                  <tr key={label}>
                                    <td className="seg-label">{label}</td>
                                    <td className="mono">{formatTime(actual)}</td>
                                    <td className="mono time-actual-muted">{formatTime(std)}</td>
                                    <td className="mono">{formatTime(pred)}</td>
                                    <td className={d == null ? 'mono' : d < 0 ? 'mono diff-fast' : d > 0 ? 'mono diff-slow' : 'mono'}>
                                      {formatDiff(d)}
                                    </td>
                                  </tr>
                                )
                              })}
                              <tr className="seg-total-row">
                                <td className="seg-label">🏁 合計</td>
                                <td className="mono">{formatTime(r.total_sec)}</td>
                                <td className="mono time-actual-muted">{formatTime(r.standard_total_sec)}</td>
                                <td className="mono">{formatTime(r.pred_total_sec)}</td>
                                <td className={
                                  r.total_sec == null || r.pred_total_sec == null ? 'mono' :
                                  r.total_sec - r.pred_total_sec < 0 ? 'mono diff-fast' :
                                  r.total_sec - r.pred_total_sec > 0 ? 'mono diff-slow' : 'mono'
                                }>
                                  {r.total_sec != null && r.pred_total_sec != null ? formatDiff(r.total_sec - r.pred_total_sec) : '--'}
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
