/**
 * Render Free プランはアイドル時にサーバーがスリープし、復帰に 30〜60秒かかる。
 * アプリ起動直後に低コストな GET / を投げて裏で温める。
 * 多重実行・タブ間競合に強くするため module-scope の Promise を共有する。
 */
const API_BASE = import.meta.env.VITE_API_URL ?? '/api'

let warmupPromise: Promise<boolean> | null = null
let warmedAt: number | null = null

const WARM_TTL_MS = 5 * 60 * 1000 // 5分以内なら追加warm-upしない

function warmUrl(): string {
  const pathStr = ''
  const base = API_BASE.startsWith('http') ? API_BASE : window.location.origin + API_BASE
  const url = new URL(pathStr, base.endsWith('/') ? base : base + '/')
  return url.toString()
}

/** バックエンドに warm-up ping を打つ。完了/失敗を boolean で返す（catch しない） */
export function warmupBackend(): Promise<boolean> {
  if (warmedAt && Date.now() - warmedAt < WARM_TTL_MS) {
    return Promise.resolve(true)
  }
  if (warmupPromise) return warmupPromise
  warmupPromise = (async () => {
    try {
      const ctrl = new AbortController()
      const t = setTimeout(() => ctrl.abort(), 90_000)
      const res = await fetch(warmUrl(), { signal: ctrl.signal, cache: 'no-store' })
      clearTimeout(t)
      const ok = res.ok
      if (ok) warmedAt = Date.now()
      return ok
    } catch {
      return false
    } finally {
      // 1回失敗しても他の fetch が走ったら再評価可能にする
      setTimeout(() => { warmupPromise = null }, 10_000)
    }
  })()
  return warmupPromise
}

export function isWarm(): boolean {
  return warmedAt != null && Date.now() - warmedAt < WARM_TTL_MS
}
