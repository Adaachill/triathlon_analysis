import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { api, getUpcomingEvents } from '../api'
import type { EvalResult, Race, StatsResponse, AlgoliaEvent } from '../api'
import { TriathlonSpinner } from '../components/Loading'
import './Guide.css'

const MODEL_LABELS: Record<string, string> = {
  old_als: '旧ALS',
  unified: '新統合ALS',
  same_cat: '同一カテゴリ',
  cross_cat: 'クロスカテゴリ',
}

const MODEL_COLORS: Record<string, string> = {
  old_als: 'var(--text-muted)',
  unified: 'var(--accent)',
  same_cat: '#f59e0b',
  cross_cat: '#8b5cf6',
}

const SEG_LABELS: Record<string, string> = {
  total_sec: '合計',
  swim_sec: 'Swim',
  t1_sec: 'T1',
  bike_sec: 'Bike',
  t2_sec: 'T2',
  run_sec: 'Run',
}

function EvalSection() {
  const [evalData, setEvalData] = useState<EvalResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sinceYears, setSinceYears] = useState<number | undefined>(2)
  const [minRaces, setMinRaces] = useState<number>(2)

  const run = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.getEvaluation(sinceYears, minRaces)
      setEvalData(result)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const summaryChartData = evalData
    ? Object.entries(evalData.summary).map(([key, stat]) => ({
        model: MODEL_LABELS[key] ?? key,
        key,
        mae: stat.mae_sec,
        n: stat.n,
      }))
    : []

  const segChartData = evalData
    ? Object.entries(SEG_LABELS).map(([field, label]) => ({
        seg: label,
        旧ALS: evalData.by_segment['old_als']?.[field]?.mae_sec ?? null,
        新統合ALS: evalData.by_segment['unified']?.[field]?.mae_sec ?? null,
      }))
    : []

  const programRows = evalData
    ? Object.entries(evalData.by_program)
        .filter(([, stats]) => stats['unified']?.n > 0)
        .sort((a, b) => a[0].localeCompare(b[0]))
    : []

  return (
    <div className="card">
      <h3 className="guide-section-title">予測精度チェック</h3>
      <p className="guide-eval-desc">
        過去レースのレースアウト交差検証（LOOCV）による予測タイムの平均誤差（MAE）を確認できます。
        計算に数十秒かかる場合があります。
      </p>
      <div className="guide-eval-note">
        <strong>【モデルの前提条件の違いに注意】</strong>
        <ul>
          <li>
            <strong>旧ALS・新統合ALS</strong>：選手の強さをテストレース除外で推定、コース難易度は過去の同会場レースから事前推定。
            <strong>レース前に予測可能な情報のみを使用</strong>しており、実際の予想タイム計算と同じ条件。
          </li>
          <li>
            <strong>同一カテゴリ・クロスカテゴリ</strong>：コース難易度を<strong>当日の実走タイムから計算</strong>するため、
            レース開始前には使用できない情報が含まれる（データリーク）。
            「速報が出始めた後に難易度補正する」用途向けであり、事前予測との直接比較は公平でない。
          </li>
        </ul>
      </div>

      {/* フィルタ設定 */}
      <div className="guide-eval-filters">
        <label className="guide-eval-filter-item">
          <span>評価期間</span>
          <select
            value={sinceYears ?? ''}
            onChange={e => setSinceYears(e.target.value === '' ? undefined : Number(e.target.value))}
            disabled={loading}
          >
            <option value="">全期間</option>
            <option value="1">直近1年</option>
            <option value="2">直近2年（推奨）</option>
            <option value="3">直近3年</option>
            <option value="5">直近5年</option>
          </select>
        </label>
        <label className="guide-eval-filter-item">
          <span>選手フィルタ</span>
          <select
            value={minRaces}
            onChange={e => setMinRaces(Number(e.target.value))}
            disabled={loading}
          >
            <option value="1">除外なし</option>
            <option value="2">2戦以上のみ（推奨）</option>
            <option value="3">3戦以上のみ</option>
          </select>
        </label>
      </div>

      <button
        className="guide-eval-btn"
        onClick={run}
        disabled={loading}
      >
        {loading ? '計算中...' : '精度を確認する'}
      </button>

      {error && <p className="guide-eval-error">{error}</p>}

      {evalData && (
        <div className="guide-eval-results">
          <p className="guide-eval-meta">
            評価レース数: {evalData.n_races_evaluated}レース
            {evalData.filters?.since_years != null && ` (直近${evalData.filters.since_years}年)`}
            {evalData.filters?.min_athlete_races != null && evalData.filters.min_athlete_races > 1 && ` / ${evalData.filters.min_athlete_races}戦以上の選手のみ`}
          </p>

          {/* モデル別MAE棒グラフ */}
          <div className="guide-eval-chart-section">
            <div className="guide-eval-chart-title">モデル別 MAE（秒） — 値が小さいほど精度が高い</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={summaryChartData} margin={{ top: 8, right: 20, left: 0, bottom: 4 }}>
                <XAxis dataKey="model" tick={{ fontSize: 12 }} />
                <YAxis unit="秒" tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(v: number) => [`${v.toFixed(1)}秒`, 'MAE']}
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
                />
                <Bar dataKey="mae" radius={[4, 4, 0, 0]}>
                  {summaryChartData.map((entry) => (
                    <Cell key={entry.key} fill={MODEL_COLORS[entry.key] ?? 'var(--accent)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* セグメント別比較（旧ALS vs 新統合ALS） */}
          <div className="guide-eval-chart-section">
            <div className="guide-eval-chart-title">セグメント別 MAE（旧ALS vs 新統合ALS）</div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={segChartData} margin={{ top: 8, right: 20, left: 0, bottom: 4 }}>
                <XAxis dataKey="seg" tick={{ fontSize: 12 }} />
                <YAxis unit="秒" tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(v: number, name: string) => [`${v.toFixed(1)}秒`, name]}
                  contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
                />
                <Bar dataKey="旧ALS" fill={MODEL_COLORS['old_als']} radius={[4, 4, 0, 0]} />
                <Bar dataKey="新統合ALS" fill={MODEL_COLORS['unified']} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* カテゴリ別テーブル */}
          {programRows.length > 0 && (
            <div className="guide-eval-chart-section">
              <div className="guide-eval-chart-title">カテゴリ別 MAE（秒）</div>
              <div className="guide-eval-table-wrap">
                <table className="guide-eval-table">
                  <thead>
                    <tr>
                      <th>カテゴリ</th>
                      <th>旧ALS</th>
                      <th>新統合ALS</th>
                      <th>改善</th>
                      <th>N</th>
                    </tr>
                  </thead>
                  <tbody>
                    {programRows.map(([prog, stats]) => {
                      const oldMae = stats['old_als']?.mae_sec
                      const newMae = stats['unified']?.mae_sec
                      const improved = oldMae != null && newMae != null ? oldMae - newMae : null
                      return (
                        <tr key={prog}>
                          <td>{prog}</td>
                          <td className="mono">{oldMae != null ? `${oldMae.toFixed(1)}` : '--'}</td>
                          <td className="mono">{newMae != null ? `${newMae.toFixed(1)}` : '--'}</td>
                          <td className={improved == null ? 'mono' : improved > 0 ? 'mono eval-improved' : improved < 0 ? 'mono eval-worsened' : 'mono'}>
                            {improved != null ? `${improved > 0 ? '-' : '+'}${Math.abs(improved).toFixed(1)}秒` : '--'}
                          </td>
                          <td className="mono">{stats['unified']?.n ?? '--'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 数値カウントアップ表示 */
function CountUp({ value, duration = 800 }: { value: number | null; duration?: number }) {
  const [display, setDisplay] = useState(0)
  useEffect(() => {
    if (value == null) return
    const start = performance.now()
    const from = 0
    const to = value
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(Math.round(from + (to - from) * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value, duration])
  if (value == null) return <span className="stat-num-placeholder">—</span>
  return <span>{display.toLocaleString()}</span>
}

function StatsHero() {
  const [stats, setStats] = useState<StatsResponse | null>(null)
  const [warming, setWarming] = useState(true)

  useEffect(() => {
    setWarming(true)
    api.getStats()
      .then(setStats)
      .catch(() => {})
      .finally(() => setWarming(false))
  }, [])

  const lastDate = stats?.last_race_date
    ? new Date(stats.last_race_date).toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' })
    : '—'

  return (
    <div className="guide-hero guide-hero-rich">
      <div className="guide-hero-spinner-wrap">
        <TriathlonSpinner size={72} />
      </div>
      <div className="guide-hero-text">
        <h2 className="guide-hero-title">パラトライアスロン 分析ツール</h2>
        <p className="guide-hero-sub">
          World Triathlon 公式記録から、選手の実力・コース難易度・予想タイムをデータで可視化。
        </p>
        <div className="guide-hero-stats">
          <div className="guide-hero-stat">
            <div className="stat-num"><CountUp value={stats?.race_count ?? null} /></div>
            <div className="stat-label">登録レース</div>
          </div>
          <div className="guide-hero-stat">
            <div className="stat-num"><CountUp value={stats?.athlete_count ?? null} /></div>
            <div className="stat-label">分析対象選手</div>
          </div>
          <div className="guide-hero-stat">
            <div className="stat-num"><CountUp value={stats?.result_count ?? null} /></div>
            <div className="stat-label">レース結果</div>
          </div>
          <div className="guide-hero-stat">
            <div className="stat-num-text">{lastDate}</div>
            <div className="stat-label">最新レース</div>
          </div>
        </div>
        {warming && (
          <p className="guide-hero-warming">
            サーバーを起動中… 30〜60秒ほどお待ちください（その間にも下のセクションは閲覧できます）
          </p>
        )}
      </div>
    </div>
  )
}

function RecentAndUpcoming() {
  const [recent, setRecent] = useState<Race[] | null>(null)
  const [upcoming, setUpcoming] = useState<AlgoliaEvent[] | null>(null)

  useEffect(() => {
    api.getRaces()
      .then((races) => {
        const sorted = [...races]
          .filter(r => r.date)
          .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
          .slice(0, 4)
        setRecent(sorted)
      })
      .catch(() => setRecent([]))
    getUpcomingEvents(120)
      .then(evs => setUpcoming(evs.slice(0, 4)))
      .catch(() => setUpcoming([]))
  }, [])

  const fmtDate = (d: string | null) => {
    if (!d) return '—'
    const dt = new Date(d)
    return `${dt.getMonth() + 1}月${dt.getDate()}日`
  }

  return (
    <div className="card guide-cards-row">
      <div className="guide-cards-col">
        <h3 className="guide-section-title">🏁 直近のレース</h3>
        {recent == null ? (
          <div className="guide-recent-loading">読み込み中…</div>
        ) : recent.length === 0 ? (
          <p className="guide-empty">まだデータがありません</p>
        ) : (
          <div className="guide-mini-list">
            {recent.map(r => (
              <Link key={r.id} to={`/races/${r.id}`} className="guide-mini-row">
                <span className="guide-mini-date">{fmtDate(r.date)}</span>
                <span className="guide-mini-name">{r.name || `Race ${r.event_id}`}</span>
              </Link>
            ))}
          </div>
        )}
        <Link to="/races" className="guide-cards-more">すべて見る →</Link>
      </div>

      <div className="guide-cards-col">
        <h3 className="guide-section-title">📅 近日開催 (公式WT)</h3>
        {upcoming == null ? (
          <div className="guide-recent-loading">読み込み中…</div>
        ) : upcoming.length === 0 ? (
          <p className="guide-empty">予定されたレースが見つかりませんでした</p>
        ) : (
          <div className="guide-mini-list">
            {upcoming.map(ev => (
              <a
                key={ev.id}
                href={`https://www.triathlon.org/events/event/${ev.id}`}
                target="_blank" rel="noreferrer"
                className="guide-mini-row"
              >
                <span className="guide-mini-date">{fmtDate(ev.start_date)}</span>
                <span className="guide-mini-name">{ev.name}</span>
                <span className="guide-mini-loc">{ev.city ?? ev.country_name}</span>
              </a>
            ))}
          </div>
        )}
        <Link to="/admin/wt-import" className="guide-cards-more">過去大会の自動取込 →</Link>
      </div>
    </div>
  )
}

const PERSONAS = [
  {
    icon: '🏃',
    title: '選手として使う',
    color: '#16a34a',
    bullets: [
      <>
        自分の<Link to="/rankings">強さランキング</Link> でカテゴリ内の現在地を確認
      </>,
      <>
        個人ページでセグメント別の強み・弱みと、過去365日 vs 366〜730日前の<strong>成長トレンド</strong>を比較
      </>,
      <>
        <Link to="/predict">予想リザルト</Link> に次戦のスタートリストを入れて、目標タイム・想定順位を逆算
      </>,
    ],
  },
  {
    icon: '🧠',
    title: 'コーチ・スカウト視点で使う',
    color: '#1e6bba',
    bullets: [
      <>
        <Link to="/rankings">セグメント別ランキング</Link>で「Bike が強いがRunで失速する選手」を発見
      </>,
      <>
        各レース詳細の<strong>逆転（↑↓）</strong>列で、コース・気象適性と「番狂わせ傾向」を確認
      </>,
      <>
        <Link to="/world-ranking">世界ランク試算</Link>で代表選考・派遣戦略の根拠データを取得
      </>,
    ],
  },
  {
    icon: '📺',
    title: 'ファン・観戦者として楽しむ',
    color: '#f59e0b',
    bullets: [
      <>
        <Link to="/races">レース一覧</Link>から気になる大会の累積セグメントチャートで展開を追体験
      </>,
      <>
        順位変動<strong>バンプチャート</strong>で「誰がどこで抜いたか」を視覚的に把握
      </>,
      <>
        予想タイムと実タイムの差分から「番狂わせの神回」レースを探す
      </>,
    ],
  },
]

function PersonaSection() {
  return (
    <div className="card">
      <h3 className="guide-section-title">🎯 使い方（3つの視点で）</h3>
      <p className="guide-persona-intro">
        立場によって価値が違うツールです。自分の目的に近いタブを選んでください。
      </p>
      <div className="guide-persona-grid">
        {PERSONAS.map((p, i) => (
          <div key={i} className="guide-persona-card" style={{ borderTopColor: p.color }}>
            <div className="guide-persona-header">
              <span className="guide-persona-icon">{p.icon}</span>
              <span className="guide-persona-title">{p.title}</span>
            </div>
            <ul className="guide-persona-bullets">
              {p.bullets.map((b, j) => <li key={j}>{b}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}

const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: '最初のアクセスがとても遅いのはなぜ？',
    a: (
      <>
        無料のホスティング (Render) を使っており、しばらくアクセスが無いとサーバーが自動でスリープします。
        スリープ復帰には 30〜60秒かかります。ページを開いた瞬間に裏で起動を始めるので、待っていれば自動で表示されます。
      </>
    ),
  },
  {
    q: 'データはどこから取得していますか？',
    a: (
      <>
        World Triathlon の公式リザルト（Excel）を <Link to="/admin/wt-import">データ取得</Link>{' '}
        ページから自動でインポートしています。Algolia の公開検索 API も併用しています。
      </>
    ),
  },
  {
    q: '「強さスコア」が同じカテゴリでも数値の桁が違うのはなぜ？',
    a: (
      <>
        基準レースに対する標準化タイム（秒）です。レース距離（スプリント / オリンピック等）が違うと自然と桁も変わります。
        ランキングはカテゴリ内（≒同距離）でのみ比較してください。
      </>
    ),
  },
  {
    q: '予想と実タイムがズレるのは？',
    a: (
      <>
        天候、当日のコンディション、レースペース戦略、機材トラブル、また新コース・新規選手は予測誤差が大きくなります。
        「予測精度チェック」セクションでカテゴリ別のMAE（平均誤差）を確認できます。
      </>
    ),
  },
  {
    q: '逆転 (↑3 / ↓2) の意味は？',
    a: (
      <>
        「強さスコアから予想される順位」と「実際の順位」の差です。↑3 は予想より3つ上、↓2 は2つ下。
        プラスは当日好調・戦略成功、マイナスはアクシデント・コース不適応を示唆します。
      </>
    ),
  },
  {
    q: '自分の選手データを追加してほしい',
    a: (
      <>
        World Triathlon に公式レース結果が掲載されていれば、<Link to="/admin/wt-import">データ取得</Link>{' '}
        ページから誰でも取り込めます。掲載されていない非公式レースは現状サポート外です。
      </>
    ),
  },
]

function FaqSection() {
  return (
    <div className="card">
      <h3 className="guide-section-title">❓ よくある質問</h3>
      <div className="guide-faq-list">
        {FAQS.map((item, i) => (
          <details key={i} className="guide-term">
            <summary className="guide-term-title">{item.q}</summary>
            <div className="guide-term-body"><p>{item.a}</p></div>
          </details>
        ))}
      </div>
    </div>
  )
}

export default function Guide() {
  return (
    <div className="guide-page">
      {/* ヒーロー（統計ダッシュボード） */}
      <StatsHero />

      {/* 直近レース & 近日開催 */}
      <RecentAndUpcoming />

      {/* ペルソナ別ユースケース */}
      <PersonaSection />

      {/* 用語解説 */}
      <div className="card">
        <h3 className="guide-section-title">用語・計算方法の解説</h3>
        <div className="guide-terms">

          <details className="guide-term">
            <summary className="guide-term-title">標準化タイム（Standardized Time）</summary>
            <div className="guide-term-body">
              <p>
                レースごとにコースの難しさは異なります（アップダウン・海の荒れ方・気温など）。
                <strong>標準化タイム</strong>は、そのレース固有の「難易度差」を補正して、
                異なるレース同士でタイムを比較できるようにしたものです。
              </p>
              <div className="guide-formula">
                標準化タイム ＝ 実タイム − 難易度オフセット
              </div>
              <p>
                たとえば「このレースは基準より30秒厳しい」と判定された場合、
                全選手の実タイムから30秒引いたものが標準化タイムになります。
              </p>
            </div>
          </details>

          <details className="guide-term">
            <summary className="guide-term-title">難易度オフセット（Difficulty Offset）</summary>
            <div className="guide-term-body">
              <p>
                「このレースは基準レースと比べて何秒分難しかったか」を表す値です。
                プラスなら基準より厳しいコース、マイナスなら易しいコースです。
              </p>
              <p>
                交互最小二乗法（ALS）で全カテゴリのデータを横断的に使い、
                選手の強さとレース難易度を同時に最適化して算出します。
              </p>
            </div>
          </details>

          <details className="guide-term">
            <summary className="guide-term-title">強さスコア（Strength Rating）</summary>
            <div className="guide-term-body">
              <p>
                選手が複数レースで記録した<strong>標準化タイムの平均</strong>が強さスコアです。
                スコアが小さいほど（タイムが速いほど）強い選手と判定されます。
              </p>
              <p>
                体調不良やアクシデントなど「外れ値」と判定されたレース結果は、
                平均計算の重みが自動的に下げられます（外れ値行は薄く表示されます）。
              </p>
            </div>
          </details>

          <details className="guide-term">
            <summary className="guide-term-title">強さ順位・逆転（Strength Rank / Reversal）</summary>
            <div className="guide-term-body">
              <p>
                強さスコアで並べたときの順位が<strong>強さ順位</strong>です。
                実際のフィニッシュ順位と強さ順位のズレを<strong>逆転</strong>と呼びます。
              </p>
              <ul className="guide-list">
                <li>↑3 → 強さ順位より3つ上の順位でフィニッシュ（当日調子が良い・戦略成功）</li>
                <li>↓2 → 強さ順位より2つ下の順位でフィニッシュ（当日不調・アクシデントなど）</li>
              </ul>
            </div>
          </details>

          <details className="guide-term">
            <summary className="guide-term-title">予想タイムの計算方法</summary>
            <div className="guide-term-body">
              <p>
                予想タイムは以下の式で計算されます：
              </p>
              <div className="guide-formula">
                予想タイム ＝ 選手の強さスコア（標準化平均）＋ そのレースの難易度オフセット
              </div>
              <p>
                難易度オフセットが未知のレース（新コース等）には過去の類似レースから推定値を使います。
                過去データが少ない選手は予測精度が下がる場合があります。
              </p>
            </div>
          </details>

        </div>
      </div>

      {/* 予測精度チェック */}
      <EvalSection />

      {/* 機能一覧カード */}
      <div className="card">
        <h3 className="guide-section-title">主な機能</h3>
        <div className="guide-feature-grid">
          <Link to="/rankings" className="guide-feature-card">
            <div className="guide-feature-icon">🏆</div>
            <div className="guide-feature-name">ランキング</div>
            <p className="guide-feature-desc">強さスコア順の選手ランキング。カテゴリ別に絞り込み可能。</p>
          </Link>
          <Link to="/races" className="guide-feature-card">
            <div className="guide-feature-icon">🏁</div>
            <div className="guide-feature-name">レース一覧</div>
            <p className="guide-feature-desc">日付順のレース一覧。各レースの結果・難易度・標準化タイムを確認。</p>
          </Link>
          <Link to="/predict" className="guide-feature-card">
            <div className="guide-feature-icon">📊</div>
            <div className="guide-feature-name">予想リザルト</div>
            <p className="guide-feature-desc">エントリーリストから予想順位・予想タイムを自動生成。</p>
          </Link>
          <Link to="/admin/wt-import" className="guide-feature-card">
            <div className="guide-feature-icon">📥</div>
            <div className="guide-feature-name">データ取得</div>
            <p className="guide-feature-desc">World Triathlon 公式の過去大会を自動取込。</p>
          </Link>
        </div>
      </div>

      {/* FAQ */}
      <FaqSection />

    </div>
  )
}
