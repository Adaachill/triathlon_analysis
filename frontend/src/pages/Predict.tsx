import { useState, useEffect, useRef, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { api, formatTime, formatDiff } from '../api'
import type { PredictAthlete, PredictSegTimes, PredictResponse } from '../api'
import './pages.css'

type DiffMode = 'avg' | 'devonport'
type SourceMode = 'fixed' | 'uploaded'

const PROGRAM_ORDER = [
  'PTWC Men', 'PTWC Women',
  'PTS2 Men', 'PTS2 Women',
  'PTS3 Men', 'PTS3 Women',
  'PTS4 Men', 'PTS4 Women',
  'PTS5 Men', 'PTS5 Women',
  'PTVI Men', 'PTVI Women',
]

const SEGS = [
  { label: 'Swim', key: 'swim_sec' },
  { label: 'T1',   key: 't1_sec'   },
  { label: 'Bike', key: 'bike_sec' },
  { label: 'T2',   key: 't2_sec'   },
  { label: 'Run',  key: 'run_sec'  },
] as const

function getPred(a: PredictAthlete, mode: DiffMode): PredictSegTimes {
  return mode === 'avg' ? a.pred_avg : a.pred_devonport
}
function getRank(a: PredictAthlete, mode: DiffMode): number | null {
  return mode === 'avg' ? a.rank_avg : a.rank_devonport
}

export default function Predict() {
  const [fixedData, setFixedData]       = useState<PredictResponse | null>(null)
  const [uploadedData, setUploadedData] = useState<PredictResponse | null>(null)
  const [sourceMode, setSourceMode]     = useState<SourceMode>('fixed')
  const [diffMode, setDiffMode]         = useState<DiffMode>('devonport')
  const [activeCategory, setActiveCategory] = useState<string>('')
  const [expanded, setExpanded]         = useState<Set<string>>(new Set())

  const [loading, setLoading]     = useState(true)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [error, setError]         = useState<string | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // 起動時: 取込済スタートリスト + アップロード済みがあれば同時取得
  useEffect(() => {
    const p1 = api.getPredictDevonport()
      .then((res) => {
        setFixedData(res)
        const first = PROGRAM_ORDER.find((p) => p in res.categories)
        if (first) setActiveCategory(first)
      })
      .catch((e) => setError(e.message))

    // 既存アップロード済みがあれば取得（404 は無視）
    const p2 = api.getPredictUploaded()
      .then(setUploadedData)
      .catch(() => {/* アップロード未済の場合は無視 */})

    Promise.all([p1, p2]).finally(() => setLoading(false))
  }, [])

  // ソース切替時にカテゴリをリセット
  const switchSource = (mode: SourceMode) => {
    setSourceMode(mode)
    setExpanded(new Set())
    const data = mode === 'fixed' ? fixedData : uploadedData
    if (data) {
      const first = PROGRAM_ORDER.find((p) => p in data.categories)
      if (first) setActiveCategory(first)
    }
  }

  // ファイルアップロード
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError(null)
    try {
      const res = await api.uploadStartlist(file)
      setUploadedData(res)
      setSourceMode('uploaded')
      setExpanded(new Set())
      const first = PROGRAM_ORDER.find((p) => p in res.categories)
      if (first) setActiveCategory(first)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'アップロードに失敗しました')
    } finally {
      setUploading(false)
      // ファイル選択をリセット（同じファイルを再アップできるように）
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  if (loading) return <div className="loading">読み込み中...</div>
  if (error)   return <div className="error">{error}</div>

  const data = sourceMode === 'fixed' ? fixedData : uploadedData
  if (!data) return null

  const availablePrograms = PROGRAM_ORDER.filter((p) => p in data.categories)
  const athletes = activeCategory ? (data.categories[activeCategory] ?? []) : []

  const sorted = [
    ...athletes
      .filter((a) => getRank(a, diffMode) != null)
      .sort((a, b) => (getRank(a, diffMode) ?? 999) - (getRank(b, diffMode) ?? 999)),
    ...athletes.filter((a) => getRank(a, diffMode) == null),
  ]

  const devDiff = data.devonport_difficulties[activeCategory] ?? {}

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <div className="predict-page">
      <div className="card">
        <div className="page-header">
          <h2>予想リザルト</h2>
        </div>
        <p className="desc">
          スタートリスト登録選手のALS強度とコース難易度から予想タイム・順位を算出しています。
          履歴なしの選手は予想不可（末尾表示）。
        </p>

        {/* ── スタートリストソース選択 ── */}
        <div className="predict-source-row">
          <div className="predict-diff-tabs">
            <button
              className={`predict-diff-tab${sourceMode === 'fixed' ? ' active' : ''}`}
              onClick={() => switchSource('fixed')}
            >
              {fixedData?.source_filename ?? '取込済スタートリスト'}
            </button>
            <button
              className={`predict-diff-tab${sourceMode === 'uploaded' ? ' active' : ''}`}
              onClick={() => uploadedData ? switchSource('uploaded') : fileInputRef.current?.click()}
              title={uploadedData ? uploadedData.source_label : 'クリックしてアップロード'}
            >
              {uploadedData
                ? uploadedData.source_filename
                : 'スタートリストをアップロード'}
            </button>
          </div>

          {/* アップロードボタン */}
          <div className="predict-upload-area">
            <button
              className="btn-upload"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? '読み込み中...' : '📂 xlsx をアップロード'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            {uploadError && (
              <span className="upload-error">{uploadError}</span>
            )}
          </div>
        </div>

        {/* 現在のソース表示 */}
        <p className="predict-source-label">
          表示中: <strong>{data.source_label}</strong>
        </p>

        {/* ── カテゴリタブ ── */}
        <div className="predict-cat-tabs">
          {availablePrograms.map((p) => (
            <button
              key={p}
              className={`predict-cat-tab${activeCategory === p ? ' active' : ''}`}
              onClick={() => { setActiveCategory(p); setExpanded(new Set()) }}
            >
              {p}
            </button>
          ))}
        </div>

        {/* ── 難易度モードタブ ── */}
        <div className="predict-diff-tabs">
          <button
            className={`predict-diff-tab${diffMode === 'devonport' ? ' active' : ''}`}
            onClick={() => setDiffMode('devonport')}
          >
            Devonport 2025 コース
          </button>
          <button
            className={`predict-diff-tab${diffMode === 'avg' ? ' active' : ''}`}
            onClick={() => setDiffMode('avg')}
          >
            平均コース（ALS全体）
          </button>
        </div>

        {/* コース難易度サマリー（Devonportモード時） */}
        {diffMode === 'devonport' && (
          <div className="predict-diff-summary">
            {devDiff.total_sec != null ? (
              <>
                <span className="diff-summary-label">Devonport 2025 難易度:</span>
                <span className={`difficulty-chip ${(devDiff.total_sec ?? 0) >= 0 ? 'harder' : 'easier'}`}>
                  合計 {(devDiff.total_sec ?? 0) >= 0 ? '+' : ''}{Math.round(devDiff.total_sec ?? 0)}秒
                </span>
                {(['swim_sec', 't1_sec', 'bike_sec', 't2_sec', 'run_sec'] as const).map((f) => {
                  const v = devDiff[f]
                  const label = { swim_sec: 'Swim', t1_sec: 'T1', bike_sec: 'Bike', t2_sec: 'T2', run_sec: 'Run' }[f]
                  return v != null ? (
                    <span key={f} className={`difficulty-chip ${v >= 0 ? 'harder' : 'easier'}`}>
                      {label}: {v >= 0 ? '+' : ''}{Math.round(v)}秒
                    </span>
                  ) : null
                })}
              </>
            ) : (
              <span className="difficulty-na">このカテゴリの2025 Devonport 難易度データなし（平均コースと同値）</span>
            )}
          </div>
        )}

        {/* ── 結果テーブル ── */}
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>予想順位</th>
                <th></th>
                <th>選手名</th>
                <th>国</th>
                <th>予想 Total</th>
                <th>Swim</th>
                <th>T1</th>
                <th>Bike</th>
                <th>T2</th>
                <th>Run</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => {
                const pred    = getPred(a, diffMode)
                const rank    = getRank(a, diffMode)
                const isExp   = expanded.has(a.athlete_id)
                const canExp  = a.has_history

                return (
                  <Fragment key={a.athlete_id}>
                    <tr
                      className={[
                        canExp ? 'race-row-expandable' : '',
                        !a.has_history ? 'predict-no-history' : '',
                      ].filter(Boolean).join(' ') || undefined}
                      onClick={canExp ? () => toggleExpand(a.athlete_id) : undefined}
                      title={canExp ? 'クリックしてセグメント詳細を表示' : undefined}
                    >
                      <td className="rank">
                        {rank != null ? rank : <span className="text-muted">--</span>}
                      </td>
                      <td className="expand-toggle">{canExp ? (isExp ? '▲' : '▼') : ''}</td>
                      <td>
                        <Link
                          to={`/athletes/${a.athlete_id}?program=${encodeURIComponent(a.program_name)}`}
                          onClick={(e) => e.stopPropagation()}
                          title={!a.has_history ? '履歴なし（予想不可）' : undefined}
                        >
                          {`${a.first_name} ${a.last_name}`.trim() || a.athlete_id}
                          {!a.has_history && <span className="predict-no-hist-badge">NEW</span>}
                        </Link>
                      </td>
                      <td>{a.country}</td>
                      <td className="mono">{formatTime(pred.total_sec)}</td>
                      <td className="mono">{formatTime(pred.swim_sec)}</td>
                      <td className="mono">{formatTime(pred.t1_sec)}</td>
                      <td className="mono">{formatTime(pred.bike_sec)}</td>
                      <td className="mono">{formatTime(pred.t2_sec)}</td>
                      <td className="mono">{formatTime(pred.run_sec)}</td>
                    </tr>

                    {isExp && a.has_history && (
                      <tr className="segment-detail-row">
                        <td colSpan={10}>
                          <table className="seg-compare-table">
                            <thead>
                              <tr>
                                <th>セグメント</th>
                                <th>予想タイム</th>
                                <th>ALS strength</th>
                                <th>コース補正</th>
                              </tr>
                            </thead>
                            <tbody>
                              {SEGS.map(({ label, key }) => {
                                const predVal = pred[key]
                                const strMap: Record<typeof key, number | null> = {
                                  swim_sec: a.strength_swim,
                                  t1_sec:   a.strength_t1,
                                  bike_sec: a.strength_bike,
                                  t2_sec:   a.strength_t2,
                                  run_sec:  a.strength_run,
                                }
                                const strVal = strMap[key]
                                const diff = predVal != null && strVal != null ? predVal - strVal : null
                                return (
                                  <tr key={label}>
                                    <td className="seg-label">{label}</td>
                                    <td className="mono">{formatTime(predVal)}</td>
                                    <td className="mono">{formatTime(strVal)}</td>
                                    <td className={
                                      diff == null ? 'mono' :
                                      diff > 0 ? 'mono diff-slow' : diff < 0 ? 'mono diff-fast' : 'mono'
                                    }>
                                      {formatDiff(diff)}
                                    </td>
                                  </tr>
                                )
                              })}
                              {(() => {
                                const strTotal  = a.strength
                                const predTotal = pred.total_sec
                                const diffTotal = predTotal != null && strTotal != null ? predTotal - strTotal : null
                                return (
                                  <tr className="seg-total-row">
                                    <td className="seg-label">合計</td>
                                    <td className="mono">{formatTime(predTotal)}</td>
                                    <td className="mono">{formatTime(strTotal)}</td>
                                    <td className={
                                      diffTotal == null ? 'mono' :
                                      diffTotal > 0 ? 'mono diff-slow' : diffTotal < 0 ? 'mono diff-fast' : 'mono'
                                    }>
                                      {formatDiff(diffTotal)}
                                    </td>
                                  </tr>
                                )
                              })()}
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
