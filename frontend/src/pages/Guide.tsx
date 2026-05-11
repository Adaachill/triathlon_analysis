import { Link } from 'react-router-dom'
import './Guide.css'

export default function Guide() {
  return (
    <div className="guide-page">

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
              <div className="guide-step-label"><Link to="/">ランキング</Link> で選手の実力を比較</div>
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
                計算方法は3種類あり、それぞれ別の角度でコース難易度を推定します：
              </p>
              <ul className="guide-list">
                <li><strong>同カテゴリ方式</strong>：同じ障がいクラスで複数レースに出場した選手の成績差から推定</li>
                <li><strong>クロスカテゴリ方式</strong>：異なる障がいクラスをまたいで共通選手の成績差から推定</li>
                <li><strong>ALS最適化方式</strong>：交互最小二乗法（ALS）で選手の強さとレース難易度を同時に最適化</li>
              </ul>
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

      {/* 機能一覧カード */}
      <div className="card">
        <h3 className="guide-section-title">主な機能</h3>
        <div className="guide-feature-grid">
          <Link to="/" className="guide-feature-card">
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
