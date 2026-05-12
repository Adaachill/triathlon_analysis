import { useState, useEffect, useRef, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { api, getUpcomingEvents } from '../api'
import type { WorldRankingEntry, WorldRankingRace, WorldRankingPredictedRace, AlgoliaEvent, PredictionMode } from '../api'
import './pages.css'
import './WorldRanking.css'

type DateMode = 'direct' | 'from_race'

// 大会変化フラグ
type RaceChangeFlag =
  | 'predicted'            // 前年参加者予測（黄）
  | 'predicted_startlist'  // スタートリスト予測（緑）
  | 'moved_to_previous'    // Current→Previous に移動（青）
  | 'newly_entered'        // 期間に新規追加（水色）
  | 'newly_counted'        // 上位3に新しく入った（ライム）
  | 'newly_uncounted'      // 上位3から外れた（オレンジ）

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

function fmtDiff(n: number): string {
  if (n === 0) return '±0'
  return (n > 0 ? '+' : '') + n.toFixed(Math.abs(n) < 10 && n % 1 !== 0 ? 1 : 0)
}

/** 各 race_id に対するハイライトフラグを計算 */
function computeRaceFlags(
  entry: WorldRankingEntry,
  baselineEntry: WorldRankingEntry | undefined,
  predictedMap: Map<number, WorldRankingPredictedRace>,
): Map<number, RaceChangeFlag> {
  const flags = new Map<number, RaceChangeFlag>()

  // 予測フラグ（最優先）
  for (const pr of predictedMap.values()) {
    flags.set(pr.race_id, pr.is_startlist ? 'predicted_startlist' : 'predicted')
  }

  if (!baselineEntry) return flags

  const baseP1 = new Map(baselineEntry.period1_races.map((r, i) => [r.race_id, i < 3]))
  const baseP2 = new Map(baselineEntry.period2_races.map((r, i) => [r.race_id, i < 3]))

  for (const [idx, r] of entry.period1_races.entries()) {
    if (flags.has(r.race_id)) continue
    const nowCounted = idx < 3
    if (baseP1.has(r.race_id)) {
      const wasCounted = baseP1.get(r.race_id)!
      if (nowCounted && !wasCounted) flags.set(r.race_id, 'newly_counted')
      else if (!nowCounted && wasCounted) flags.set(r.race_id, 'newly_uncounted')
    } else if (baseP2.has(r.race_id)) {
      flags.set(r.race_id, 'newly_entered')
    } else {
      flags.set(r.race_id, 'newly_entered')
    }
  }

  for (const [idx, r] of entry.period2_races.entries()) {
    if (flags.has(r.race_id)) continue
    const nowCounted = idx < 3
    if (baseP1.has(r.race_id)) {
      flags.set(r.race_id, 'moved_to_previous')
    } else if (baseP2.has(r.race_id)) {
      const wasCounted = baseP2.get(r.race_id)!
      if (nowCounted && !wasCounted) flags.set(r.race_id, 'newly_counted')
      else if (!nowCounted && wasCounted) flags.set(r.race_id, 'newly_uncounted')
    } else {
      flags.set(r.race_id, 'newly_entered')
    }
  }

  return flags
}

const FLAG_CLASS: Record<RaceChangeFlag, string> = {
  predicted: 'wr-hl-predicted',
  predicted_startlist: 'wr-hl-startlist',
  moved_to_previous: 'wr-hl-moved',
  newly_entered: 'wr-hl-new',
  newly_counted: 'wr-hl-counted',
  newly_uncounted: 'wr-hl-uncounted',
}

const FLAG_LABEL: Record<RaceChangeFlag, string> = {
  predicted: '前年予測',
  predicted_startlist: 'SL予測',
  moved_to_previous: '→前年',
  newly_entered: '新規',
  newly_counted: '↑加算',
  newly_uncounted: '↓加算外',
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
  const [predictionMode, setPredictionMode] = useState<PredictionMode>('none')
  const [showPredictedRaces, setShowPredictedRaces] = useState(false)
  const [data, setData] = useState<Awaited<ReturnType<typeof api.getWorldRanking>> | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedAthletes, setExpandedAthletes] = useState<Set<string>>(new Set())

  // スタートリストアップロード用
  const [uploadingEventId, setUploadingEventId] = useState<number | null>(null)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [uploadSuccess, setUploadSuccess] = useState<number | null>(null)
  const [raceNameInputs, setRaceNameInputs] = useState<Record<number, string>>({})
  const fileInputRef = useRef<HTMLInputElement>(null)
  const uploadTargetEventId = useRef<string | null>(null)

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
    if (dateMode === 'from_race' && selectedEvent) return subtractDays(selectedEvent.start_date, 30)
    return directDate
  }, [dateMode, selectedEvent, directDate])

  useEffect(() => {
    if (!program || !asOfDate) return
    setLoading(true)
    setError(null)
    api.getWorldRanking(program, asOfDate, predictionMode)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [program, asOfDate, predictionMode])

  const toggleExpand = (athleteId: string) => {
    setExpandedAthletes((prev) => {
      const next = new Set(prev)
      if (next.has(athleteId)) next.delete(athleteId)
      else next.add(athleteId)
      return next
    })
  }

  const handleUploadClick = (ev: AlgoliaEvent) => {
    const raceName = raceNameInputs[ev.id] ?? ev.name ?? ''
    uploadTargetEventId.current = JSON.stringify({ id: ev.id, date: ev.start_date, name: raceName })
    setUploadingEventId(ev.id)
    setUploadError(null)
    setUploadSuccess(null)
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !uploadTargetEventId.current) {
      setUploadingEventId(null)
      return
    }
    const targetInfo = JSON.parse(uploadTargetEventId.current)
    const targetId = String(targetInfo.id)
    const targetDate = targetInfo.date
    const targetName = targetInfo.name || undefined
    try {
      await api.uploadStartlist(file, targetId, targetDate, targetName)
      setUploadSuccess(Number(targetId))
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'アップロードに失敗しました')
      setUploadingEventId(null)
    } finally {
      setUploadingEventId(null)
      if (fileInputRef.current) fileInputRef.current.value = ''
      uploadTargetEventId.current = null
    }
  }

  const today = todayStr()
  const isFutureDate = asOfDate > today

  // baseline athlete_id → {rank, total_points, entry}
  const baselineMap = useMemo(() => {
    if (!data?.baseline_rankings) return {} as Record<string, { rank: number; total_points: number; entry: WorldRankingEntry }>
    const map: Record<string, { rank: number; total_points: number; entry: WorldRankingEntry }> = {}
    data.baseline_rankings.forEach((entry, idx) => {
      map[entry.athlete_id] = { rank: idx + 1, total_points: entry.total_points, entry }
    })
    return map
  }, [data])

  const hasDiff = Object.keys(baselineMap).length > 0

  // predicted_races を race_id → PredictedRace のマップに
  const predictedMap = useMemo(
    () => new Map((data?.predicted_races ?? []).map((r) => [r.race_id, r])),
    [data],
  )

  const eventsBySport = useMemo(() => {
    const groups: Record<string, AlgoliaEvent[]> = {}
    for (const ev of upcomingEvents) {
      const key = ev.sport_categories.join(', ') || 'Other'
      ;(groups[key] ??= []).push(ev)
    }
    return groups
  }, [upcomingEvents])

  // 未来日付が選択された場合、その日までの期間内に開催される大会を表示
  const eventsInRange = useMemo(() => {
    if (asOfDate <= todayStr() || !selectedEvent) return []
    const future = new Date(asOfDate)
    return upcomingEvents.filter((ev) => {
      const eventDate = new Date(ev.start_date)
      return eventDate <= future
    })
  }, [asOfDate, selectedEvent, upcomingEvents])

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
              <button className={`wr-mode-btn ${dateMode === 'direct' ? 'active' : ''}`} onClick={() => setDateMode('direct')} type="button">直接入力</button>
              <button className={`wr-mode-btn ${dateMode === 'from_race' ? 'active' : ''}`} onClick={() => setDateMode('from_race')} type="button">大会から選択</button>
            </div>
          </div>

          {dateMode === 'direct' ? (
            <div className="wr-control-group">
              <label className="wr-label">基準日</label>
              <input type="date" value={directDate} onChange={(e) => setDirectDate(e.target.value)} className="wr-date-input" />
            </div>
          ) : (
            <div className="wr-control-group">
              <label className="wr-label">
                大会を選択<span className="wr-events-source"> (World Triathlon)</span>
              </label>
              {eventsLoading && <span className="wr-events-loading">読み込み中...</span>}
              {eventsError && <span className="wr-events-error">取得失敗: {eventsError}</span>}
              {!eventsLoading && !eventsError && (
                <select value={selectedEventId ?? ''} onChange={(e) => setSelectedEventId(e.target.value ? Number(e.target.value) : null)} className="wr-race-select">
                  <option value="">-- 大会を選んでください --</option>
                  {Object.entries(eventsBySport).map(([sport, events]) => (
                    <optgroup key={sport} label={sport}>
                      {events.map((ev) => (
                        <option key={ev.id} value={ev.id}>
                          {ev.name}（{ev.start_date}{ev.city ? ` / ${ev.city}` : ''}）{ev.startlist_available ? ' ★' : ''}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              )}
              {selectedEvent && (
                <div className="wr-event-detail">
                  <span className="wr-race-date-hint">基準日: <strong>{asOfDate}</strong>（{selectedEvent.start_date} の30日前）</span>
                  <div className="wr-event-badges">
                    {selectedEvent.startlist_available && <span className="wr-badge wr-badge-startlist">スタートリスト公開済み</span>}
                    {selectedEvent.results_available && <span className="wr-badge wr-badge-results">結果あり</span>}
                    <span className="wr-badge wr-badge-sport">{sportLabel(selectedEvent)}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 期間内の大会リスト（未来日付選択時） */}
        {dateMode === 'from_race' && selectedEvent && eventsInRange.length > 0 && (
          <div className="wr-events-in-range-section">
            <div className="wr-events-in-range-label">
              期間内の大会: {asOfDate}まで（{eventsInRange.length}件）
            </div>
            {uploadError && <p className="wr-upload-error">{uploadError}</p>}
            {/* 非表示のファイル選択input */}
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <div className="wr-events-in-range-list">
              {eventsInRange.map((ev) => (
                <div key={ev.id} className={`wr-event-row ${ev.startlist_available ? 'wr-event-startlist' : 'wr-event-no-startlist'}`}>
                  <span className={`wr-event-sl-badge ${ev.startlist_available ? 'wr-badge-available' : 'wr-badge-unavailable'}`}>
                    {ev.startlist_available ? 'SL公開済' : 'SL未公開'}
                  </span>
                  <span className="wr-event-row-name">{ev.name}</span>
                  <span className="wr-event-row-date">{ev.start_date}</span>
                  {ev.startlist_available && (
                    uploadSuccess === ev.id ? (
                      <span className="wr-upload-success-badge">✓ 登録済</span>
                    ) : (
                      <>
                        <input
                          type="text"
                          className="wr-race-name-input"
                          value={raceNameInputs[ev.id] ?? ev.name ?? ''}
                          onChange={(e) => setRaceNameInputs((prev) => ({ ...prev, [ev.id]: e.target.value }))}
                          placeholder="大会名（例: 2026 Para Series Yokohama）"
                          disabled={uploadingEventId !== null}
                        />
                        <button
                          type="button"
                          className="wr-sl-upload-btn"
                          onClick={() => handleUploadClick(ev)}
                          disabled={uploadingEventId !== null}
                        >
                          {uploadingEventId === ev.id ? '処理中...' : '📂 SLアップロード'}
                        </button>
                      </>
                    )
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {isFutureDate && (
          <div className="wr-future-notice">
            📅 基準日が未来（{asOfDate}）のため、その日までに開催済みのレース結果を使って試算しています。
          </div>
        )}

        <div className="wr-predictions-row">
          <label className="wr-label">未来レースの予測</label>
          <div className="wr-prediction-mode-group">
            <label className="wr-prediction-option">
              <input type="radio" name="predictionMode" value="none" checked={predictionMode === 'none'} onChange={() => setPredictionMode('none')} />
              <span>予測なし（実績のみ）</span>
            </label>
            <label className="wr-prediction-option">
              <input type="radio" name="predictionMode" value="previous_year" checked={predictionMode === 'previous_year'} onChange={() => setPredictionMode('previous_year')} />
              <span>前年同一大会の参加者で予測</span>
            </label>
            <label className="wr-prediction-option">
              <input type="radio" name="predictionMode" value="startlist" checked={predictionMode === 'startlist'} onChange={() => setPredictionMode('startlist')} />
              <span>スタートリスト（アップロード済み）で予測</span>
            </label>
          </div>
          {predictionMode === 'previous_year' && (
            <p className="wr-predictions-note">
              ※ 前年の同一大会（年号以外のレース名が一致）の参加者リストを使用し、<strong>強さランク順</strong>で予測順位を決定します。前年大会がない場合はスキップ。
            </p>
          )}
          {predictionMode === 'startlist' && (
            <p className="wr-predictions-note">
              ※ 上記の大会リストからSLをアップロードした大会に登録済みの参加者を使用し、<strong>強さランク順</strong>で予測順位を決定します。
            </p>
          )}
        </div>

        {/* 予測対象大会の一覧 */}
        {data && predictionMode !== 'none' && data.predicted_races.length > 0 && (
          <div className="wr-predicted-races-section">
            <button type="button" className="wr-predicted-races-toggle" onClick={() => setShowPredictedRaces((v) => !v)}>
              {showPredictedRaces ? '▼' : '▶'} 予測対象大会（{data.predicted_races.length}件）
            </button>
            {showPredictedRaces && (
              <div className="wr-predicted-races-list">
                {data.predicted_races.map((pr: WorldRankingPredictedRace) => (
                  <div key={pr.race_id} className={`wr-predicted-race-row ${pr.is_startlist ? 'wr-predicted-race-sl' : ''}`}>
                    <span className={`wr-predicted-race-badge ${pr.is_startlist ? 'wr-badge-sl' : 'wr-badge-prev'}`}>
                      {pr.is_startlist ? 'SL登録' : '前年参加者'}
                    </span>
                    <span className="wr-predicted-race-name">{pr.race_name ?? `Race ${pr.race_id}`}</span>
                    <span className="wr-predicted-race-date">{pr.date}</span>
                    <span className="wr-predicted-race-pts">{pr.points}pt</span>
                    {!pr.is_startlist && (
                      <span className="wr-predicted-race-based">
                        前年: {pr.based_on_race_name ?? `Race ${pr.based_on_race_id}`}
                        <span className="wr-predicted-race-n">（{pr.participants_count}名）</span>
                      </span>
                    )}
                    {pr.is_startlist && (
                      <span className="wr-predicted-race-n">（{pr.participants_count}名）</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {data && predictionMode !== 'none' && data.predicted_races.length === 0 && (
          <div className="wr-predicted-races-empty">
            {predictionMode === 'startlist'
              ? '⚠️ スタートリストが登録された大会がありません。上記リストから「SLアップロード」してください。'
              : '⚠️ 予測対象大会が見つかりませんでした（前年同一大会がDBに存在しない可能性があります）'}
          </div>
        )}

        {/* ハイライト凡例 */}
        {hasDiff && predictionMode !== 'none' && (
          <div className="wr-legend">
            <span className="wr-legend-title">大会ハイライト凡例:</span>
            {([
              ['predicted', '前年参加者予測'],
              ['predicted_startlist', 'SL予測'],
              ['moved_to_previous', 'Current→Previous移動'],
              ['newly_entered', '新規追加'],
              ['newly_counted', '上位3に新規入り'],
              ['newly_uncounted', '上位3から外れた'],
            ] as [RaceChangeFlag, string][]).map(([flag, label]) => (
              <span key={flag} className={`wr-legend-item ${FLAG_CLASS[flag]}`}>{label}</span>
            ))}
          </div>
        )}

        {data && (
          <div className="wr-period-info">
            <span className="wr-period-chip wr-period1">Current（全ポイント）: {data.current_start} 〜 {data.current_end}</span>
            <span className="wr-period-chip wr-period2">Previous（×1/3）: {data.previous_start} 〜 {data.previous_end}</span>
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
                  {hasDiff && <th className="wr-diff-col">現在</th>}
                  <th>選手名</th>
                  <th>国</th>
                  <th className="col-total-highlight">合計pt</th>
                  {hasDiff && <th className="wr-diff-col">Δpt</th>}
                  <th>Current</th>
                  <th>Previous</th>
                </tr>
              </thead>
              <tbody>
                {data.rankings.length === 0 && (
                  <tr>
                    <td colSpan={hasDiff ? 8 : 6} style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                      該当期間にポイント設定済みのレース結果がありません
                    </td>
                  </tr>
                )}
                {data.rankings.map((entry: WorldRankingEntry, i: number) => {
                  const isExpanded = expandedAthletes.has(entry.athlete_id)
                  const baseline = baselineMap[entry.athlete_id]
                  const projRank = i + 1
                  const baseRank = baseline?.rank
                  const rankDiff = baseRank !== undefined ? baseRank - projRank : null
                  const ptsDiff = baseline !== undefined ? entry.total_points - baseline.total_points : null

                  const raceFlags = computeRaceFlags(entry, baseline?.entry, predictedMap)

                  return (
                    <>
                      <tr key={entry.athlete_id} className="race-row-expandable" onClick={() => toggleExpand(entry.athlete_id)}>
                        <td className="rank">{projRank}</td>
                        {hasDiff && (
                          <td className="wr-diff-col">
                            {baseRank !== undefined ? (
                              <span className={`wr-rank-diff ${rankDiff === null ? '' : rankDiff > 0 ? 'wr-up' : rankDiff < 0 ? 'wr-down' : 'wr-same'}`}>
                                {baseRank}
                                {rankDiff !== null && rankDiff !== 0 && (
                                  <span className="wr-rank-diff-arrow">{rankDiff > 0 ? ` ↑${rankDiff}` : ` ↓${Math.abs(rankDiff)}`}</span>
                                )}
                                {rankDiff === 0 && <span className="wr-rank-diff-arrow"> →</span>}
                              </span>
                            ) : <span className="wr-new-badge">NEW</span>}
                          </td>
                        )}
                        <td>
                          <span className="expand-toggle">{isExpanded ? '▼' : '▶'} </span>
                          <Link to={`/athletes/${entry.athlete_id}?program=${encodeURIComponent(program)}`} onClick={(e) => e.stopPropagation()}>
                            {`${entry.first_name} ${entry.last_name}`.trim()}
                          </Link>
                        </td>
                        <td>{entry.country}</td>
                        <td className="mono time-actual-total">{entry.total_points.toFixed(1)}</td>
                        {hasDiff && (
                          <td className={`mono wr-diff-col ${ptsDiff === null ? '' : ptsDiff > 0 ? 'wr-up' : ptsDiff < 0 ? 'wr-down' : 'wr-same'}`}>
                            {ptsDiff !== null ? fmtDiff(ptsDiff) : '—'}
                          </td>
                        )}
                        <td className="mono">{entry.period1_points.toFixed(1)}</td>
                        <td className="mono wr-period2-val">
                          {entry.period2_points.toFixed(1)}
                          {entry.period2_points_raw > 0 && <span className="wr-raw-hint">（元: {entry.period2_points_raw.toFixed(1)}）</span>}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr key={`${entry.athlete_id}-detail`} className="segment-detail-row">
                          <td colSpan={hasDiff ? 8 : 6}>
                            <div className="wr-detail">
                              <RaceDetailCol label="直近1年の大会（上位3大会が加算）" races={entry.period1_races} raceFlags={raceFlags} />
                              <RaceDetailCol label="前年の大会（上位3大会の合計 × 1/3）" races={entry.period2_races} raceFlags={raceFlags} />
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

function RaceDetailCol({
  label,
  races,
  raceFlags,
}: {
  label: string
  races: WorldRankingRace[]
  raceFlags: Map<number, RaceChangeFlag>
}) {
  return (
    <div className="wr-detail-col">
      <div className="wr-detail-label">{label}</div>
      {races.length === 0 ? (
        <p className="wr-no-race">該当なし</p>
      ) : (
        races.map((r, idx) => {
          const flag = raceFlags.get(r.race_id)
          const isCounted = idx < 3
          return (
            <div
              key={r.race_id}
              className={[
                'wr-race-row',
                isCounted ? 'wr-counted' : 'wr-not-counted',
                flag ? FLAG_CLASS[flag] : '',
              ].join(' ')}
            >
              <span className="wr-race-date">{r.date}</span>
              <span className="wr-race-name">
                {r.race_name ?? `Race ${r.race_id}`}
                {r.is_future && <span className="wr-future-badge">予測</span>}
              </span>
              <span className="wr-race-pts">{r.points.toFixed(1)}pt</span>
              {flag && <span className={`wr-change-badge ${FLAG_CLASS[flag]}`}>{FLAG_LABEL[flag]}</span>}
              {!isCounted && !flag && <span className="wr-not-counted-badge">加算外</span>}
            </div>
          )
        })
      )}
    </div>
  )
}
