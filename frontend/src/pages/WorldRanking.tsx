import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { api, getUpcomingEvents } from '../api'
import type { WorldRankingEntry, AlgoliaEvent } from '../api'
import './pages.css'
import './WorldRanking.css'

type DateMode = 'direct' | 'from_race'

function todayStr() {
  return new Date().toISOString().slice(0, 10)
}

function subtractDays(dateStr: string, days: number): string {
  const d = new Date(dateStr)
  d.setDate(d.getDate() - days)
  return d.toISOString().slice(0, 10)
}

function sportLabel(ev: AlgoliaEvent): string {
  return ev.sport_categories.join(' / ')
}

export default function WorldRanking() {
  const [programs, setPrograms] = useState<string[]>([])
  const [program, setProgram] = useState('')
  const [dateMode, setDateMode] = useState<DateMode>('direct')
  const [directDate, setDirectDate] = useState(todayStr())
  const [upcomingEvents, setUpcomingEvents] = useState<AlgoliaEvent[]>([])
  const [eventsLoading, setEventsLoading] = useState(false)
  const [eventsError, setEventsError] = useState<string | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<number | null>(null)
  const [includePredictions, setIncludePredictions] = useState(false)
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
    if (dateMode !== 'from_race') return
    if (upcomingEvents.length > 0) return
    setEventsLoading(true)
    setEventsError(null)
    getUpcomingEvents()
      .then(setUpcomingEvents)
      .catch((e) => setEventsError(e.message))
      .finally(() => setEventsLoading(false))
  }, [dateMode])

  const selectedEvent = useMemo(
    () => upcomingEvents.find((e) => e.id === selectedEventId) ?? null,
    [upcomingEvents, selectedEventId],
  )

  const asOfDate = useMemo(() => {
    if (dateMode === 'from_race' && selectedEvent) {
      return subtractDays(selectedEvent.start_date, 30)
    }
    return directDate
  }, [dateMode, selectedEvent, directDate])

  useEffect(() => {
    if (!program || !asOfDate) return
    setLoading(true)
    setError(null)
    api.getWorldRanking(program, asOfDate, includePredictions)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [program, asOfDate, includePredictions])

  const toggleExpand = (athleteId: string) => {
    setExpandedAthletes((prev) => {
      const next = new Set(prev)
      if (next.has(athleteId)) next.delete(athleteId)
      else next.add(athleteId)
      return next
    })
  }

  const today = todayStr()
  const isFutureDate = asOfDate > today

  const eventsBySport = useMemo(() => {
    const groups: Record<string, AlgoliaEvent[]> = {}
    for (const ev of upcomingEvents) {
      const key = ev.sport_categories.join(', ') || 'Other'
      ;(groups[key] ??= []).push(ev)
    }
    return groups
  }, [upcomingEvents])

  return (
    <div className="wr-page">
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
            <label className="wr-label">基準日の指定方法</label>
            <div className="wr-date-mode-toggle">
              <button
                className={`wr-mode-btn ${dateMode === 'direct' ? 'active' : ''}`}
                onClick={() => setDateMode('direct')}
                type="button"
              >
                直接入力
              </button>
              <button
                className={`wr-mode-btn ${dateMode === 'from_race' ? 'active' : ''}`}
                onClick={() => setDateMode('from_race')}
                type="button"
              >
                大会から選択
              </button>
            </div>
          </div>

          {dateMode === 'direct' ? (
            <div className="wr-control-group">
              <label className="wr-label">基準日</label>
              <input
                type="date"
                value={directDate}
                onChange={(e) => setDirectDate(e.target.value)}
                className="wr-date-input"
              />
            </div>
          ) : (
            <div className="wr-control-group">
              <label className="wr-label">
                大会を選択
                <span className="wr-events-source"> (World Triathlon)</span>
              </label>
              {eventsLoading && <span className="wr-events-loading">読み込み中...</span>}
              {eventsError && <span className="wr-events-error">取得失敗: {eventsError}</span>}
              {!eventsLoading && !eventsError && (
                <select
                  value={selectedEventId ?? ''}
                  onChange={(e) => setSelectedEventId(e.target.value ? Number(e.target.value) : null)}
                  className="wr-race-select"
                >
                  <option value="">-- 大会を選んでください --</option>
                  {Object.entries(eventsBySport).map(([sport, events]) => (
                    <optgroup key={sport} label={sport}>
                      {events.map((ev) => (
                        <option key={ev.id} value={ev.id}>
                          {ev.name}（{ev.start_date}{ev.city ? ` / ${ev.city}` : ''}）
                          {ev.startlist_available ? ' ★' : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              )}
              {selectedEvent && (
                <div className="wr-event-detail">
                  <span className="wr-race-date-hint">
                    基準日: <strong>{asOfDate}</strong>（{selectedEvent.start_date} の30日前）
                  </span>
                  <div className="wr-event-badges">
                    {selectedEvent.startlist_available && (
                      <span className="wr-badge wr-badge-startlist">スタートリスト公開済み</span>
                    )}
                    {selectedEvent.results_available && (
                      <span className="wr-badge wr-badge-results">結果あり</span>
                    )}
                    <span className="wr-badge wr-badge-sport">
                      {sportLabel(selectedEvent)}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {isFutureDate && (
          <div className="wr-future-notice">
            📅 基準日が未来（{asOfDate}）のため、その日までに開催済みのレース結果を使って試算しています。
          </div>
        )}

        <div className="wr-predictions-row">
          <label className="wr-predictions-label">
            <span className="wr-predictions-toggle-wrap">
              <input
                type="checkbox"
                checked={includePredictions}
                onChange={(e) => setIncludePredictions(e.target.checked)}
                className="wr-predictions-checkbox"
              />
              <span className="wr-predictions-text">未開催レースの予測結果を含める</span>
            </span>
            <span className="wr-coming-soon-badge">準備中</span>
          </label>
          {includePredictions && (
            <p className="wr-predictions-note">
              ※ スタートリストが発表済みの未来のレースについて、予測順位に基づくポイントを試算に含めます。この機能は現在開発中です。
            </p>
          )}
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
                                      <span className="wr-race-name">
                                        {r.race_name ?? `Race ${r.race_id}`}
                                        {r.is_future && <span className="wr-future-badge">予測</span>}
                                      </span>
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
                                      <span className="wr-race-name">
                                        {r.race_name ?? `Race ${r.race_id}`}
                                        {r.is_future && <span className="wr-future-badge">予測</span>}
                                      </span>
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
