import { useState, useRef, Fragment } from 'react'
import { Link } from 'react-router-dom'
import { api, formatTime, formatDiff } from '../api'
import type { PredictResponse } from '../api'
import './pages.css'

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

export default function Predict() {
  const [data, setData]             = useState<PredictResponse | null>(null)
  const [activeCategory, setActiveCategory] = useState<string>('')
  const [expanded, setExpanded]     = useState<Set<string>>(new Set())
  const [uploading, setUploading]   = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setUploadError(null)
    try {
      const res = await api.uploadStartlist(file)
      setData(res)
      setExpanded(new Set())
      const first = PROGRAM_ORDER.find((p) => p in res.categories)
      if (first) setActiveCategory(first)
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'アップロードに失敗しました')
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  // ── アップロード前の初期画面 ──
  if (!data) {
    return (
      <div className="predict-page">
        <div className="card">
          <div className="page-header">
            <h2>🔮 予想リザルト</h2>
          </div>
          <p className="desc">
            スタートリスト（.xlsx）をアップロードすると、ALS強度から各選手の予想タイム・予想順位を算出します。
          </p>
          <div className="upload-note">
            <strong>⚠️ ファイルの取得方法：</strong>
            <a href="https://www.triathlon.org/events" target="_blank" rel="noreferrer">WorldTriathlon 大会ページ</a>
            の対象レースを開き、「Start List」タブ →「Download」から <strong>全カテゴリを含む Excel（.xlsx）</strong> をダウンロードしてください。カテゴリ別に分かれた個別ファイルではなく、全カテゴリ一括のファイルが必要です。
          </div>
          <div className="predict-upload-area">
            <button
              className="btn-upload"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? '読み込み中...' : '📂 スタートリスト（.xlsx）をアップロード'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            {uploadError && <p className="upload-error">{uploadError}</p>}
          </div>
        </div>
      </div>
    )
  }

  // ── アップロード後の結果画面 ──
  const availablePrograms = PROGRAM_ORDER.filter((p) => p in data.categories)
  const athletes = activeCategory ? (data.categories[activeCategory] ?? []) : []
  const sorted = [
    ...athletes
      .filter((a) => a.rank_avg != null)
      .sort((a, b) => (a.rank_avg ?? 999) - (b.rank_avg ?? 999)),
    ...athletes.filter((a) => a.rank_avg == null),
  ]

  return (
    <div className="predict-page">
      <div className="card">
        <div className="page-header">
          <h2>予想リザルト</h2>
          {/* 再アップロードボタン */}
          <div className="predict-upload-area" style={{ margin: 0 }}>
            <button
              className="btn-upload"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? '読み込み中...' : '📂 別ファイルをアップロード'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>
        </div>

        <p className="predict-source-label">
          表示中: <strong>{data.source_label}</strong>
        </p>
        {uploadError && <p className="upload-error">{uploadError}</p>}

        {/* カテゴリタブ */}
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

        {/* 結果テーブル */}
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
                const pred   = a.pred_avg
                const rank   = a.rank_avg
                const isExp  = expanded.has(a.athlete_id)
                const canExp = a.has_history

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
