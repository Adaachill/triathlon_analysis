import { useEffect, useState } from 'react'
import './Loading.css'

const PHASES: { at: number; msg: string }[] = [
  { at: 0,  msg: 'データを読み込み中…' },
  { at: 6,  msg: 'サーバーを起動しています（無料プラン）…' },
  { at: 14, msg: 'ALS最適化を計算中… もう少しお待ちください' },
  { at: 24, msg: '最後の仕上げをしています…' },
  { at: 38, msg: 'まだ準備中です。回線状況によりさらに10秒程かかる場合があります' },
]

/** 3D回転トライアスロンアイコン */
export function TriathlonSpinner({ size = 56 }: { size?: number }) {
  const style = {
    width: size,
    height: size,
    ['--spinner-size' as string]: `${size}px`,
    ['--spinner-radius' as string]: `${Math.round(size * 0.5)}px`,
  } as React.CSSProperties
  return (
    <div className="tri-spinner" style={style} aria-hidden>
      <div className="tri-spinner-stage">
        <span className="tri-spinner-face tri-spinner-face-1" role="img" aria-label="swim">🏊</span>
        <span className="tri-spinner-face tri-spinner-face-2" role="img" aria-label="bike">🚴</span>
        <span className="tri-spinner-face tri-spinner-face-3" role="img" aria-label="run">🏃</span>
      </div>
    </div>
  )
}

/** 進捗メッセージ（経過秒数に応じて段階的に切り替え） */
export function ProgressMessage({ startedAt }: { startedAt: number }) {
  const [elapsed, setElapsed] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 500)
    return () => clearInterval(id)
  }, [startedAt])
  let phase = PHASES[0]
  for (const p of PHASES) if (elapsed >= p.at) phase = p
  return (
    <div className="loading-progress">
      <div className="loading-progress-msg">{phase.msg}</div>
      <div className="loading-progress-elapsed">経過 {elapsed}秒</div>
    </div>
  )
}

interface LoadingStateProps {
  variant?: 'inline' | 'page' | 'card'
  message?: string
  showElapsed?: boolean
  children?: React.ReactNode
}

/** ローディング状態の共通コンポーネント。スピナー＋進捗メッセージ＋（任意）スケルトン */
export function LoadingState({ variant = 'page', message, showElapsed = true, children }: LoadingStateProps) {
  const [startedAt] = useState(() => Date.now())
  return (
    <div className={`loading-state loading-state-${variant}`} role="status" aria-live="polite">
      <TriathlonSpinner size={variant === 'inline' ? 36 : 64} />
      {message ? (
        <div className="loading-progress-msg">{message}</div>
      ) : showElapsed ? (
        <ProgressMessage startedAt={startedAt} />
      ) : null}
      {children}
    </div>
  )
}

/** テーブル行のスケルトン */
export function TableSkeleton({ rows = 8, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <table className="skeleton-table" aria-hidden>
      <thead>
        <tr>
          {Array.from({ length: cols }).map((_, i) => (
            <th key={i}><span className="skeleton-bar skeleton-bar-sm" /></th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }).map((_, r) => (
          <tr key={r}>
            {Array.from({ length: cols }).map((_, c) => (
              <td key={c}><span className={`skeleton-bar${c === 0 ? ' skeleton-bar-sm' : ''}`} /></td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** カード一覧のスケルトン */
export function CardListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="skeleton-card-grid" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="skeleton-card">
          <span className="skeleton-bar skeleton-bar-lg" />
          <span className="skeleton-bar skeleton-bar-sm" />
          <span className="skeleton-bar" style={{ width: '60%' }} />
        </div>
      ))}
    </div>
  )
}
