import { useState, useEffect } from 'react'
import { api } from '../api'
import type { WtParaEvent } from '../api'
import './pages.css'
import './WtImport.css'

const POINTS_OPTIONS = [700, 550, 500, 450, 350]

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default function WtImport() {
  const [yearsBack, setYearsBack] = useState(3)
  const [events, setEvents] = useState<WtParaEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [bulkRunning, setBulkRunning] = useState(false)

  // インポート中イベントの状態 id -> 'loading' | 'done:{n}' | 'skipped' | 'error:{msg}'
  const [importState, setImportState] = useState<Record<number, string>>({})

  // 編集可能な優勝ポイント id -> number
  const [editedPoints, setEditedPoints] = useState<Record<number, number>>({})

  function getPoints(ev: WtParaEvent): number {
    return editedPoints[ev.id] ?? ev.win_points ?? 0
  }

  async function fetchEvents() {
    setLoading(true)
    setFetchError(null)
    setEvents([])
    setImportState({})
    try {
      const res = await api.getWtParaEvents(yearsBack)
      setEvents(res.events)
      const pts: Record<number, number> = {}
      for (const ev of res.events) {
        if (ev.win_points != null) pts[ev.id] = ev.win_points
      }
      setEditedPoints(pts)
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : '取得失敗')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchEvents() }, [])

  async function doImport(ev: WtParaEvent, force = false) {
    const pts = getPoints(ev)
    if (!pts) return
    setImportState((s) => ({ ...s, [ev.id]: 'loading' }))
    try {
      const res = await api.importWtEvent({
        id: ev.id,
        win_points: pts,
        race_name: ev.name,
        race_date: ev.start_date,
        note: ev.event_categories.join(', '),
        force,
      })
      if (res.skipped) {
        setImportState((s) => ({ ...s, [ev.id]: 'skipped' }))
      } else {
        setImportState((s) => ({ ...s, [ev.id]: `done:${res.added_results}` }))
        setEvents((prev) => prev.map((e) => e.id === ev.id ? { ...e, imported: true } : e))
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '失敗'
      setImportState((s) => ({ ...s, [ev.id]: `error:${msg}` }))
    }
  }

  async function handleBulkImport() {
    const targets = events.filter(
      (ev) => ev.win_points != null && !ev.imported && importState[ev.id] == null
    )
    if (targets.length === 0) return
    setBulkRunning(true)
    for (const ev of targets) {
      await doImport(ev)
      await sleep(500)
    }
    setBulkRunning(false)
  }

  const withPoints = events.filter((e) => e.win_points != null)
  const noPoints = events.filter((e) => e.win_points == null)
  const pendingCount = withPoints.filter(
    (e) => !e.imported && importState[e.id] == null
  ).length

  return (
    <div className="page">
      <div className="page-header">
        <h2>World Triathlon 過去大会インポート</h2>
      </div>
      <p className="desc">
        World Triathlon の Paratriathlon 大会を Algolia から取得し、
        結果 Excel を自動ダウンロードして DB にインポートします。
        既存レースはスキップします（再インポートは各行の「再取込」ボタンで実行）。
      </p>

      <div className="wti-toolbar">
        <div className="wti-toolbar-left">
          <label className="form-label" style={{ marginBottom: 0 }}>過去</label>
          <select
            value={yearsBack}
            onChange={(e) => setYearsBack(Number(e.target.value))}
            className="wti-years-select"
          >
            {[1, 2, 3, 5].map((y) => (
              <option key={y} value={y}>{y}年分</option>
            ))}
          </select>
        </div>
        <button className="submit-btn" onClick={fetchEvents} disabled={loading || bulkRunning}>
          {loading ? '取得中...' : 'データを取得'}
        </button>
        {!loading && pendingCount > 0 && (
          <button
            className="submit-btn wti-bulk-btn"
            onClick={handleBulkImport}
            disabled={bulkRunning}
          >
            {bulkRunning ? '一括取込中...' : `未取込 ${pendingCount}件を一括インポート`}
          </button>
        )}
      </div>

      {fetchError && <div className="upload-error">{fetchError}</div>}

      {!loading && events.length > 0 && (
        <>
          <div className="wti-summary">
            {withPoints.length}件（ポイント対象）／{noPoints.length}件（ポイントなし）取得
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>大会名</th>
                  <th>開催日</th>
                  <th>開催地</th>
                  <th>カテゴリ</th>
                  <th>優勝pt</th>
                  <th>状態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {events.map((ev) => {
                  const state = importState[ev.id]
                  const pts = getPoints(ev)
                  const isLoading = state === 'loading'
                  const isSkipped = state === 'skipped' || (ev.imported && state == null)
                  const isDone = state?.startsWith('done')
                  const isError = state?.startsWith('error')
                  const addedCount = state?.startsWith('done:') ? state.slice(5) : null
                  return (
                    <tr key={ev.id} className={ev.win_points == null ? 'wti-row-nopoints' : ''}>
                      <td>
                        <span className="wti-event-name">{ev.name}</span>
                      </td>
                      <td className="mono">{ev.start_date}</td>
                      <td>
                        {[ev.city, ev.country_name].filter(Boolean).join(', ')}
                      </td>
                      <td>
                        <div className="wti-cats">
                          {ev.event_categories.map((c) => (
                            <span key={c} className="wti-cat-badge">{c}</span>
                          ))}
                        </div>
                      </td>
                      <td>
                        {ev.win_points != null ? (
                          <select
                            value={pts}
                            onChange={(e) =>
                              setEditedPoints((prev) => ({ ...prev, [ev.id]: Number(e.target.value) }))
                            }
                            className="wti-pts-select"
                          >
                            {POINTS_OPTIONS.map((p) => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </select>
                        ) : (
                          <span className="wti-nopoints">—</span>
                        )}
                      </td>
                      <td>
                        {isDone ? (
                          <span className="wti-status wti-status-done">
                            ✓ {addedCount}件追加
                          </span>
                        ) : isSkipped ? (
                          <span className="wti-status wti-status-skipped">済（スキップ）</span>
                        ) : isError ? (
                          <span className="wti-status wti-status-error" title={state?.slice(6)}>
                            ✗ エラー
                          </span>
                        ) : isLoading ? (
                          <span className="wti-status wti-status-loading">取込中...</span>
                        ) : (
                          <span className="wti-status wti-status-pending">未インポート</span>
                        )}
                      </td>
                      <td className="wti-actions">
                        {ev.win_points != null && !isLoading && !isDone && !isSkipped && (
                          <button
                            className="wti-import-btn"
                            onClick={() => doImport(ev)}
                            disabled={bulkRunning}
                          >
                            インポート
                          </button>
                        )}
                        {ev.win_points != null && (isDone || isSkipped) && (
                          <button
                            className="wti-import-btn wti-reimport-btn"
                            onClick={() => doImport(ev, true)}
                            disabled={isLoading || bulkRunning}
                            title="既存データを削除して再インポート"
                          >
                            再取込
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {noPoints.length > 0 && (
            <p className="wti-nopoints-note">
              ※ ポイントなしの {noPoints.length} 件（ポイント対象外カテゴリ）はグレー表示です。必要に応じてインポートしてください。
            </p>
          )}
        </>
      )}

      {!loading && events.length === 0 && !fetchError && (
        <p className="wti-empty">大会が見つかりませんでした。</p>
      )}
    </div>
  )
}
