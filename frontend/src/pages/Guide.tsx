import { useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { api } from '../api'
import type { EvalResult } from '../api'
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

  const run = async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await api.getEvaluation()
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
          <p className="guide-eval-meta">評価レース数: {evalData.n_races_evaluated}レース</p>

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

export default function Guide() {
  return (
    <div className="guide-page">

      {/* サーバー起動通知 */}
      <div className="guide-server-notice">
        <strong>⏱ 初回アクセス・久しぶりのアクセスについて</strong>
        <p>
          サーバーは一定時間アクセスがないとスリープ状態になります。
          再起動に <strong>30秒ほど</strong> かかるため、最初にページを開いた際に
          データが表示されない・エラーが出る場合があります。
          しばらく待ってからページを再読み込みしてください。
        </p>
      </div>

      {/* ヒーロー */}
      <div className="guide-hero">
        <h2 className="guide-hero-title">パラトライアスロン 分析ツール</h2>
        <p className="guide-hero-sub">
          World Triathlon 公式記録をもとに、選手の実力・レース難易度・予想タイムをデータで可視化します。
        </p>
      </div>

      {/* クイックスタート */}
      <div className="card">
        <h3 className="guide-section-title">はじめかた</h3>
        <div className="guide-steps">
          <div className="guide-step">
            <div className="guide-step-num">1</div>
            <div>
              <div className="guide-step-label"><Link to="/races">レース一覧</Link> を開く</div>
              <p className="guide-step-desc">過去・直近のパラトライアスロンレースが日付順に並んでいます。気になる大会をクリックしてください。</p>
            </div>
          </div>
          <div className="guide-step">
            <div className="guide-step-num">2</div>
            <div>
              <div className="guide-step-label">カテゴリを選んで結果を確認</div>
              <p className="guide-step-desc">結果ページ右上のプルダウンでカテゴリ（例: PTS4 Men）を切り替えられます。「表示」プルダウンで実タイム・標準化タイム・予想とのギャップを切り替えできます。</p>
            </div>
          </div>
          <div className="guide-step">
            <div className="guide-step-num">3</div>
            <div>
              <div className="guide-step-label"><Link to="/rankings">ランキング</Link> で選手の実力を比較</div>
              <p className="guide-step-desc">複数レースを横断した「強さスコア」で選手をランキング。選手名をクリックすると個人の成績推移を確認できます。</p>
            </div>
          </div>
          <div className="guide-step">
            <div className="guide-step-num">4</div>
            <div>
              <div className="guide-step-label"><Link to="/predict">予想リザルト</Link> で未来のレースをシミュレート</div>
              <p className="guide-step-desc">エントリーリスト（Excel）をアップロードすると、選手の強さスコアとレース難易度から予想タイム・予想順位を自動計算します。</p>
            </div>
          </div>
        </div>
      </div>

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
        </div>
      </div>

    </div>
  )
}
