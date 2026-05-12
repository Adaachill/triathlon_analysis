# 開発履歴

## ルール（2026-05-11 策定）

### 過去の記録
git commit logから概要のみ記載。詳細はコミットハッシュで追跡可能。

### 今後のルール
**コミットのたびに以下のフォーマットで追記する（新しい順）。**

---

## 2026-05-12: ALS精度評価のデータリーク修正・半減期比較API追加
**コミット:** `f0e42db`
**ブランチ:** claude/improve-als-accuracy-iY9qX

### 変更内容
- `app/services/eval_difficulty.py`: ALS評価ロジックを修正（difficulty=0→フルデータALS推定値）
- `app/services/eval_difficulty.py`: `evaluate_halflife_comparison()` 関数追加（365/270/180日比較）
- `app/routers/admin.py`: `GET /admin/compare_halflife` エンドポイント追加
- `frontend/src/pages/Guide.tsx`: 評価UIにモデルの前提条件の違いを説明するノート追加
- `frontend/src/pages/Guide.css`: ノート用スタイル追加
- `scripts/compare_halflife.py`: ローカル実験用スクリプト追加

### 変更意図・背景
精度チェックでsame_cat/cross_catがALSより圧倒的に誤差が少ない状況を分析した結果、
評価上の根本的な非対称（データリーク）を発見した。

- **旧ALSの評価**: テストレースを除外してdifficultyが推定できないため `difficulty=0` を使用
- **same_cat/cross_cat**: テストレース当日の実走タイムを使ってdifficultyを計算（情報リーク）

→ 不公平な比較であったため修正。ALSはフルデータのコース難易度を使い「過去の同会場実績から
  事前推定するシナリオ」として再評価するように変更。

また、時間減衰の半減期パラメータ（現在365日）が精度に与える影響を測定するため、
API経由で365/270/180日の比較ができるエンドポイントを追加した。

### 技術的決定事項
- **評価の分割設計**: 選手強さ=hold-out、コース難易度=フルデータ（事前推定シナリオ）
  これは実用に即した比較：コース難易度は過去の同会場レースから事前に推定できる
- **半減期比較はAPIとして実装**: DB接続が必要なためスクリプトでは実行できず、
  `/admin/compare_halflife` エンドポイントとして本番DB上で実行できるように設計

### 残課題・次のステップ
- `/admin/compare_halflife` を本番サーバーで実行して半減期の結果を確認し、
  最良の半減期を `als_optimizer.py` の `_HALFLIFE_DAYS` に反映する
- same_cat/cross_catのリークを前提に「速報補正」用途として明示的に位置づけ直す

```
## YYYY-MM-DD: タイトル
**コミット:** `hash`
**ブランチ:** branch-name

### 変更内容
- 変更したファイルと概要

### 変更意図・背景
なぜその変更をしたか。どんな課題を解決したか。

### 技術的決定事項
設計上の選択肢とその理由（複数案があった場合は比較も書く）。

### 残課題・次のステップ
この変更で積み残したこと、次に着手すべきこと。
```

---

## 2026-05-12: 世界ランキング試算ブラッシュアップ（予測モード・大会フィルタ）
**コミット:** `（コミット後に記載）`
**ブランチ:** claude/world-ranking-future-dates-WIZhK

### 変更内容
- `frontend/src/api.ts`: `getUpcomingEvents()` でCANCELLED/POSTPONED大会をフィルタアウト
- `frontend/src/api.ts`: AlgoliaクエリのfacetFiltersを修正し、World Championships配下のParatriathlonイベント（子要素）もカバー
- `frontend/src/api.ts`: `WorldRankingResponse.include_predictions` を `prediction_mode` に変更
- `frontend/src/api.ts`: `api.getWorldRanking()` のシグネチャを `predictionMode` / `startlistEventIds` に更新
- `app/routers/world_ranking.py`: `include_predictions: bool` → `prediction_mode: str`（none/all/startlist_only）に変更
- `app/routers/world_ranking.py`: 未来レース予測ロジックを実装（強さランク上位30名を予測参加者とし、強さ順を予測順位として使用）
- `app/routers/world_ranking.py`: `startlist_event_ids` パラメータを追加（startlist_only モード用）
- `frontend/src/pages/WorldRanking.tsx`: 「準備中」チェックボックスを3段階ラジオボタン（予測なし/スタートリストあり大会のみ/全大会）に置き換え
- `frontend/src/pages/WorldRanking.css`: 予測モード選択のスタイル更新

### 変更意図・背景
- CANCELLED/POSTEPONEDな大会が大会選択ドロップダウンに表示されていたため、誤選択を防ぐ
- World Triathlon Championship Finals等の親イベントの中にある「Para Championships」子イベントが従来のfacetFiltersでキャッチできていなかった（sport_categories が Paratriathlon になる場合がある）
- 「未来レース予測」機能が「準備中」のままで実際に動作しなかったため、強さランクベースの予測を実装
- スタートリストが公開済みの大会のみに絞り込むオプションを追加

### 技術的決定事項
- 予測ロジック: `get_optimized_program()` で取得した強さ（strength値が小さいほど速い）の上位30名を仮想出場者とし、強さ順を予測順位として `_calc_position_points()` でポイントを計算
- 実績がある選手の実績結果は上書きしない（将来実績が予測より優先される）
- `startlist_only` モード: フロントエンドがAlgoliaから取得したスタートリスト公開済みイベントのIDをバックエンドに渡し、`Race.event_id` と照合。DBにないAlgolia IDは無視される
- Algoliaクエリ: `specification_categories:Paratriathlon OR sport_categories:Paratriathlon` の1段階フィルタに変更（World Champs子要素が `sport_categories:Paratriathlon` を持つ可能性に対応）

### 残課題・次のステップ
- 実際のスタートリスト（選手名）をWT APIから取得して予測に使う機能（現状は強さランク全員が出場という仮定）
- DBにない未来レース（まだインポートされていないWT大会）への対応
- 予測の精度評価

---

## 過去の履歴（git log より）

### 2026-05-11: GitHubへの公開・デプロイ設計確定
**コミット:** `7dd0b3f`

- masterブランチをmainにリネームし、GitHub（Adaachill/triathlon_analysis）へ公開
- デプロイ構成をRender（FastAPI）+ Neon（PostgreSQL）+ GitHub Pages（フロントエンド）に決定
- feature/als-optimizerをmainにマージ
- .gitignoreにraw_excelのロックファイル除外を追加

---

### 2026-03-10: ALSオプティマイザー導入・フロントエンド強化
**コミット:** `cdec5dd` → `14098a6`

- ALS（交互最小二乗法）による選手強度・レース難易度の計算エンジンを導入（`als_optimizer.py`）
- 予測エンドポイント（`predict.py`）を新規追加
- フロントエンドにALS難易度・セグメント比較・外れ値ハイライト表示を追加
- 予測ページ（`Predict.tsx`）を新規追加

---

### 2026-02-25: 選手・レースページの情報強化
**コミット:** `591f638` → `e5df459` → `698cec3` → `a25dd42`

- 選手ページに順位逆転情報・セグメントタイムを追加
- 逆転確率の計算ロジックを実装
- レースページにセグメントタイム表示を追加
- カテゴリ内だけでなくPTWCを除く全カテゴリ横断の難易度も計算・表示

---

### 2026-02-23: プロジェクト初期構築
**コミット:** `2cbe7d3`

- FastAPI（バックエンド）+ React/Vite（フロントエンド）のMVP構築
- SQLiteによるDB設計（Race, Result, Athleteモデル）
- Excelインポート機能（`import_excel.py`）
- GitHub Pages自動デプロイ用のGitHub Actions設定（`.github/workflows/deploy-pages.yml`）

---

## 2026-05-11: Render + Neon デプロイ対応・GitHub Pages SPA修正
**コミット:** `1dec7fd`
**ブランチ:** main

### 変更内容
- `app/database.py`: `DATABASE_URL` 環境変数でSQLite/PostgreSQL切り替え対応
- `requirements.txt`: `psycopg2-binary==2.9.10` を追加
- `render.yaml`: Renderデプロイ設定ファイルを新規作成
- `frontend/vite.config.ts`: `VITE_BASE_URL` 環境変数でGitHub Pagesのベースパス制御
- `.github/workflows/deploy-pages.yml`: ビルド時に `VITE_BASE_URL=/triathlon_analysis/` を注入
- `frontend/public/404.html`: GitHub Pages SPA直接URLアクセスの404回避
- `frontend/index.html`: 404.htmlからのリダイレクトパス復元スクリプト追加

### 変更意図・背景
ローカル専用だったアプリをWeb公開するための対応。DBをSQLiteからNeon（PostgreSQL）に
移行し、バックエンドをRenderで公開する。フロントエンドはGitHub Pagesで継続。

### 技術的決定事項

**Render + Neon + GitHub Pages を選んだ理由（vs Firebase）:**

| 検討項目 | Firebase Cloud Functions | Render + Neon |
|---|---|---|
| 既存コードの変更量 | 大（FastAPI→Cloud Functions形式に書き直し） | 最小（DB接続文字列のみ） |
| SQLiteからの移行 | FirestoreかCloud SQL（有料）が必要 | NeonでPostgreSQL、無料で使える |
| ALS計算の実行 | 関数タイムアウト・コールドスタートが懸念 | 常駐プロセスのため問題なし |
| Pythonサポート | Gen2で不安定 | ネイティブ対応 |
| コスト | 無料枠はあるがスケール時に複雑 | 無料プランが明快 |

→ 既存のFastAPI資産をそのまま活かせるRender + Neonが最小リスク・最速で選定。

**GitHub Pages SPA routing問題:**
`BrowserRouter` を使っているため、`/races/123` への直接アクセスでGitHub Pagesが404を
返す。`public/404.html` でパスをクエリ文字列にエンコードして `index.html` に転送し、
`index.html` 側のスクリプトで復元する標準的な回避策（spa-github-pages手法）を採用。
`HashRouter` への変更も検討したが、URLの見た目が変わるため採用しなかった。

### 残課題・次のステップ
1. Neonでデータベースを作成し接続文字列を取得
2. Renderにリポジトリをデプロイし `DATABASE_URL` を設定
3. GitHubリポジトリのSecretsに `VITE_API_URL`（RenderのURL）を登録
4. GitHubリポジトリのPagesを有効化（Settings → Pages → GitHub Actions）
5. Renderにデプロイ後、既存データをExcelから再インポート

---

## 2026-05-11: READMEにデプロイ手順を追記
**コミット:** `c723f5c`
**ブランチ:** main

### 変更内容
- `README.md`: Neon + Render + GitHub Pages の手順を詳細に追記

### 変更意図・背景
デプロイ手順をコード内に残しておくことで、環境を再構築する際に迷わないようにする。

### 残課題・次のステップ
- Renderデプロイ完了後にデータ（Excel）を再投入する
- GitHub PagesのURLを確認して動作確認する

---

## 2026-05-11: Webからのレース結果アップロード機能・公開URL追加
**コミット:** `351cbda`
**ブランチ:** main

### 変更内容
- `app/models.py`: `Race`モデルに`points`フィールド（優勝ポイント）を追加
- `app/database.py`: 起動時に`points`カラムをALTER TABLEで自動マイグレーション
- `app/routers/admin.py`: アップロードエンドポイントに大会名・日付・ポイント・補足のFormフィールドを追加。ポイントの範囲バリデーション（150〜750）も実装
- `app/services/import_excel.py`: メタデータをRaceレコードに保存する処理を追加
- `frontend/src/api.ts`: `uploadRaceResult`関数を追加（FormDataで全フィールドを送信）
- `frontend/src/pages/Admin.tsx`: アップロードフォームページを新規作成
- `frontend/src/App.tsx`: `/admin`ルートとナビリンク「アップロード」を追加
- `frontend/src/pages/pages.css`: フォームUI用のスタイルを追加
- `README.md`: 公開URLを追記

### 変更意図・背景
ローカルのSwagger UIでしかデータ投入できなかったのを、フロントエンドのUIから
直接アップロードできるようにした。大会情報（名前・日付・ポイント・補足）を
Excelと一緒に登録することで、レース一覧での表示情報を充実させる。

### 技術的決定事項
- DBマイグレーションはAlembicを使わず`ALTER TABLE ... ADD COLUMN`を起動時に実行する
  シンプルな方式を採用。個人開発規模では十分で、複雑な依存関係を避けられる。
- `uploadApi`を`file: File`から`form: FormData`を受け取る汎用形式に変更し、
  ファイル以外のフィールドも送れるようにした。

### 残課題・次のステップ
- 既存のRenderにデプロイされているデータには`points`がNULLのまま。
  アップロードページから再アップロードすることで補完可能。

---

## 2026-05-11: レース編集フォームに優勝ポイントを追加
**コミット:** `58bb249`
**ブランチ:** main

### 変更内容
- `app/routers/races.py`: `RaceUpdate`に`points`を追加。一覧・詳細・PATCHレスポンスにも`points`を含める。150〜750のバリデーションあり
- `frontend/src/api.ts`: `Race`と`RaceUpdateBody`に`points`フィールドを追加
- `frontend/src/pages/RaceDetail.tsx`: 編集フォームに「優勝ポイント（150〜750）」入力欄を追加。保存・表示にも対応

### 変更意図・背景
アップロード済みのレースでも後からポイントを設定・修正できるようにした。
アップロード時に設定し忘れた場合や、ポイントの変更が必要な場合に対応。

---

## 2026-05-11: 予想リザルトをアップロード型に変更・ナビ名修正
**コミット:** `e69237d`
**ブランチ:** main

### 変更内容
- `app/routers/predict.py`: ローカルファイル依存を廃止。スタートリストはメモリ上で処理するのみ。`GET /predict/2026-devonport` と `GET /predict/uploaded-startlist` を削除し、`POST /predict/upload-startlist` のみに一本化
- `frontend/src/pages/Predict.tsx`: 固定データソースを廃止し、アップロード型UIに全面リライト。アップロード前は案内画面、アップロード後は結果画面に切り替わる
- `frontend/src/api.ts`: 削除したエンドポイント（getPredictDevonport、getPredictUploaded）を削除
- `frontend/src/App.tsx`: ナビリンクを「アップロード」→「レース結果アップロード」に変更

### 変更意図・背景
Render（無料プラン）ではファイルシステムがエフェメラルなため、ローカルの
スタートリストファイルに依存する `GET /predict/2026-devonport` が常にエラーに
なっていた（"Failed to Fetch"）。ファイル保存をやめてメモリ処理に変更することで
Render上でも動作するようにした。

### 技術的決定事項
スタートリストをDBやクラウドストレージに保存する方法も検討したが、個人用途では
セッション内のみで予想結果を確認できれば十分と判断し、最もシンプルなメモリ処理を採用。
ページをリロードすると結果は消えるが、再アップロードで即座に復元できる。

### 残課題・次のステップ
- 将来的に「大会ごとにスタートリストを保存・切り替えたい」場合はDB保存に変更する

---

## 2026-05-11: マージ済みPRへの追加コミット禁止ルールを追加
**PR:** #21
**ブランチ:** claude/update-claude-rules-RuN8

### 変更内容
- `CLAUDE.md`: 「マージ済みPRへの追加コミット禁止」セクションをブランチ・PR運用ルールに追加

### 変更意図・背景
マージ後の修正・追加は必ず新しいブランチ・新しいPRで行うことを明文化し、マージ済みブランチへの追加コミットを禁止することで、git historyの整合性と変更追跡を維持。

---

## 2026-05-11: TS型エラー3件を修正（GitHub Actions ビルド失敗対応）
**PR:** #19
**ブランチ:** claude/fix-ts-errors-qWpK

### 変更内容
- `frontend/src/api.ts`: ISO3_TO_ISO2 オブジェクトの重複キー（POR）を削除
- `frontend/src/pages/RaceDetail.tsx`: `LabelList` の `content` コールバック型エラーを修正
- `frontend/src/pages/AthleteDetail.tsx`: 同様の型エラーを修正

### 変更意図・背景
GitHub Actions でのビルドが失敗していた。esbuild（開発）では実行可能だったが、tsc（CI）で検出される型エラーを修正。

---

## 2026-05-11: 世界ランク試算の大会選択をParatriathlon Triathlonのみに絞り込む
**PR:** #18
**ブランチ:** claude/wt-para-filter-VgK3

### 変更内容
- `frontend/src/api.ts`: `getUpcomingEvents()` に facetFilters を追加し、Aquathlon・Duathlon等を除外

### 変更意図・背景
ドロップダウンに Paratriathlon Triathlon 以外の種目（Aquathlon等）が混入していた問題を修正。

---

## 2026-05-11: UI全体の改善 - アイコン・国旗・グラフ強化
**PR:** #17
**ブランチ:** claude/improve-ui-with-icons-jNUuB

### 変更内容
- ナビゲーションバーとサイトロゴに絵文字アイコンを追加（📖🏆🏁🔮📤🌍）
- 全テーブルに国旗絵文字を表示（ISO alpha-3コード対応、約80ヵ国）
- Admin・Predictページに世界連盟からの「全カテゴリ一括Excel」取得方法の注意書きを追加
- レース結果ページ: Gap列追加・累積セグメントチャートに順位番号・累積タイム表示・逆転を ↑↓ と色で可視化
- 選手個人ページ: メイン行を実タイム表示に変更・セグメント累積バーチャート追加・ラインチャートにタイムラベル追加

### 変更意図・背景
UIの視認性・操作性を大幅改善。特にモバイルでのレース展開可視化、選手個人ページのセグメント別成績表示を強化。

---

## 2026-05-11: 世界ランク試算: 基準日に未来の日付・大会連動・予測結果トグルを追加
**PR:** #16
**ブランチ:** claude/world-ranking-future-dates-WIZhK

### 変更内容
- 基準日の上限制限を撤廃（未来の日付を自由に指定可能）
- 「大会から選択」モードを追加（大会日の30日前を自動計算）
- 「未開催レースの予測結果を含める」トグルを追加（準備中）
- `WorldRankingRace` に `is_future` フィールドを追加

### 変更意図・背景
予想ランキング計算の検証用。未来の日付を基準に計算できることで、大会前の順位予測が可能に。

---

## 2026-05-11: ローカル開発環境の再現手順を整備（バックエンド起動・DBセットアップ）
**PR:** #15
**ブランチ:** claude/add-backend-setup-docs-sozmD

### 変更内容
- `.gitignore`: `raw_excel/*.xlsx` / `*.xls` の除外を撤廃（Excel ファイルを git 管理対象に）
- `CLAUDE.md` のPRテンプレートにバックエンド起動手順と `import_raw_excel` データ投入手順を追記

### 変更意図・背景
クローン直後にバックエンド起動とDB再現ができるように環境構築手順を整備。

---

## 2026-05-11: 評価APIのNaN値JSONシリアライズエラーを修正
**PR:** #14
**ブランチ:** claude/fix-eval-nan-json-v9m2

### 変更内容
- `eval_difficulty.py`: `_mae`、`_rmse` の戻り値型を `float | None` に変更、データなしのとき `None` を返す

### 変更意図・背景
`/admin/evaluate_difficulty` で 500 Internal Server Error が発生していた。データなしのとき `float("nan")` が JSON で シリアライズできない問題を修正。

---

## 2026-05-11: Render起動クラッシュの修正（rankings.py ImportError）
**PR:** #13
**ブランチ:** claude/fix-rankings-import-error-x3k9

### 変更内容
- `rankings.py` line 6: `compute_optimized_program` → `compute_optimized_unified` に変更
- `/rankings/diff`: 新しい戻り値構造に対応

### 変更意図・背景
PR #10 でリネームされた関数の import が更新されておらず、Render デプロイ時に ImportError でサーバーが起動できない状態だった。

---

## 2026-05-11: レース結果に累積セグメントチャートを追加（スワイプ・アニメーション対応）
**PR:** #12
**ブランチ:** claude/cumulative-segment-chart-k7p2

### 変更内容
- レース結果ページの棒グラフをセグメント累積（積み上げ）チャートに刷新
- チェックポイント5段階（Swim → T1 → Bike → T2 → Run）でレース展開を可視化
- スワイプ・矢印ボタン・ドットタップでステップ切り替え、フェードスライドアニメーション追加
- セグメントアイコン（🏊⚡🚴🔄🏃🏁）をヘッダー・テーブル・凡例に追加

### 変更意図・背景
レース展開をより直感的に可視化し、選手のパフォーマンス変化をステップごとに確認できるように改善。

---

## 2026-05-11: Guideページに予測精度チェックセクションを追加
**PR:** #11
**ブランチ:** claude/eval-visualization-ui-qx4m

### 変更内容
- `api.ts`: `EvalResult` / `EvalModelStat` 型と `getEvaluation()` メソッドを追加
- Guide ページに「予測精度チェック」カード追加
- モデル別・セグメント別・カテゴリ別MAE を可視化（棒グラフ・比較グラフ・テーブル）

### 変更意図・背景
ALS難易度推定モデルの精度を確認し、改善効果を数値化できるようにした。

---

## 2026-05-11: Unified ALS with time decay and cross-program difficulty pooling
**PR:** #10
**ブランチ:** claude/unified-als-eval-kp9r

### 変更内容
- 統合ALS（新モデル）: プログラム別独立ALSから全プログラム横断ALSに変更
  - 難易度パラメータを全PTプログラムで共有（サンプル数不足カテゴリの精度向上）
  - 時間減衰ウェイト（半減期1年）追加（直近データを優先）
  - PTWC のバイク・ラン・T1/T2 は貢献ウェイト 0.3、スイムは 1.0
- レース結果ページ: 同一・クロスカテゴリ難易度表示を削除、ALS難易度のみ残す
- 評価エンドポイント: `GET /admin/evaluate_difficulty` で4モデル比較を実行可能

### 変更意図・背景
PTWC・PTVIなどサンプル数不足のカテゴリで精度を向上させるため、全カテゴリ横断で難易度を計算。時間減衰で直近データの重要性を反映。

### 技術的決定事項
PTWC のバイク・ラン・T1/T2 を 0.3 に設定した理由: ハンドサイクル・車いしの特性が健常者と異なるため、スイムの情報をより活用する。

---

## 2026-05-11: Add mobile hamburger side drawer navigation
**PR:** #9
**ブランチ:** claude/mobile-hamburger-nav-bq7p

### 変更内容
- 画面幅 ≤700px で上部ナビを非表示、右上にハンバーガーボタン（≡）を表示
- タップで右からドロワーメニューをスライドイン
- ドロワーはリンククリック・外側タップ・オーバーレイタップで閉じる

### 変更意図・背景
スマートフォンでの操作性を大幅改善。限定的な画面幅を有効活用。

---

## 2026-05-11: Filter out non-PT programs from import and API
**PR:** #8
**ブランチ:** claude/filter-pt-programs-only-ax3k

### 変更内容
- インポート時に `Program Name` が `"PT"` で始まらない行をスキップ
- `/programs` APIレスポンスから非PTプログラムを除外

### 変更意図・背景
World Triathlon のパラトリアスロン（PT）カテゴリのみを対象とするため、その他の種目（Aquathlon等）をフィルタリング。

---

## 2026-05-11: Redesign UI: guide as root, athlete period stats, segment ranks, difficulty toggle
**PR:** #7
**ブランチ:** claude/redesign-guide-race-athlete-ui-x7m2

### 変更内容
- ルート変更: `/` を使い方（Guide）ページに、ランキングを `/rankings` へ
- 使い方ページにサーバー起動待ちの通知追加
- レース結果ページ: 難易度ブロックをページ下部の折りたたみトグルに移動
- 選手詳細ページ: 期間別成績テーブル（過去365日 / 366〜730日前）をセグメントごとに追加
- 選手詳細ページ: 各セグメントの強さランキングチップを追加

### 変更意図・背景
初心者向けのガイドを目立たせ、使い方を最初に提示。選手詳細の過去成績追跡を強化。

---

## 2026-05-11: fix: event_id/race_id不整合の解消とアップロードバグ修正
**PR:** #6
**ブランチ:** claude/fix-event-id-race-id-consistency-np4w

### 変更内容
- サーバー起動時に自動マイグレーション実行（`init_db()`）
  - float形式の `Race.event_id` を整数文字列に正規化
  - 重複 Race を集約、孤立 Race を削除
  - `Race.event_id` に UNIQUE インデックスを追加
- 4つのアップロードバグ修正:
  1. pandasが数値Event IDをfloatで読む問題
  2. SQLite id再利用で別レースのResultsを誤削除
  3. 同event_idの別カテゴリ上書き削除
  4. エラーメッセージの握りつぶし

### 変更意図・背景
既存DBの不整合を修正し、以降のアップロードバグを防止。ユーザーに詳細なエラーメッセージを提供できるように改善。

---

## 2026-05-11: feat: 世界ランキングのperiod1/period2をcurrent/previousにリネーム
**PR:** #5
**ブランチ:** claude/world-ranking-page-bk92

### 変更内容
- APIレスポンスのフィールド名: period1_start/end → current_start/end、period2_start/end → previous_start/end
- フロントエンドのラベル: 「直近1年」→「Current」、「その前の1年」→「Previous」

### 変更意図・背景
ラベルをより明確で理解しやすくするため、期間を「current / previous」と命名。

---

## 2026-05-11: fix: アップロード時に同一Event IDの別カテゴリ結果を上書きするバグを修正
**PR:** #4
**ブランチ:** claude/fix-upload-overwrite-zq3k

### 変更内容
- pandasが数値Event IDをfloatで読む問題を `normalize_event_id()` で解決
- SQLiteの id 再利用で別レースの Results が誤削除される問題を修正（削除を `program_name` 単位に）
- 同一Event IDの別カテゴリを順番にアップロードしても先のデータが残るように修正
- `admin.py` で exception をcatchして詳細メッセージを返す

### 変更意図・背景
アップロード機能の複数バグを修正し、データの完全性を確保。

---

## 2026-05-11: feat: 世界ランキング試算ページを追加（開発中）
**PR:** #3
**ブランチ:** claude/world-ranking-page-bk92

### 変更内容
- バックエンド: `GET /world-ranking` API を新規追加
  - `as_of_date` と `program_name` から Period1・Period2 のランキング計算
  - Period1: 過去365日の上位3大会（全ポイント）
  - Period2: 366〜730日前の上位3大会（ポイント × 1/3）
  - 順位ポイント = 優勝ポイント × 0.925^(順位-1)
- フロントエンド: `/world-ranking` ページ新規追加
  - カテゴリ選択 + カレンダー日付選択でリアルタイム再計算
  - 行クリックで貢献レース内訳を展開（上位3大会ハイライト）
- ナビに「世界ランク試算」を控えめに表示、開発中バナー追加

### 変更意図・背景
選手の世界ランキングシミュレーション機能。基準日を変更して過去・未来の想定順位を計算可能に。

### 技術的決定事項
ランキング計算は DB クエリ（ORDER BY） ではなく Python で実装。柔軟な期間分割・加重計算を実現。

---

## 2026-05-11: ライトテーマ＋使い方ガイドページの追加
**PR:** #2
**ブランチ:** claude/light-theme-guide-pqrs

### 変更内容
- カラーテーマ変更: ダーク系 → 白ベース＋青（World Triathlonイメージ）
- 使い方ガイドページ追加 (`/guide`): クイックスタート・用語解説・機能一覧カード
- ナビ更新: 「使い方」リンク先頭追加、「レース結果アップロード」→「アップロード」短縮
- diff/チップ色調整: 白背景で視認できる緑・赤に変更
- `CLAUDE.md` に機能ごとブランチ・別PR ルール記載

### 変更意図・背景
初回アクセスユーザーへのオンボーディング改善。ダーク系からライト系に変更して親しみやすさ向上。

---

## 2026-05-11: レース一覧・結果ページUIリデザイン＋ライトテーマ＋使い方ガイド
**PR:** #1
**ブランチ:** claude/redesign-race-list-ui-umja8

### 変更内容
- レース一覧ページ: カテゴリ選択プルダウン削除、日付の新しい順ソート、テーブル形式に変更
- 結果ページ: 実タイム合計を太字強調、「表示」プルダウンで3モード切替（実タイム / 標準化タイム / ギャップ）
- カラーテーマ: ダーク系 → 白ベース＋青に変更
- 使い方ガイドページ (`/guide`) を新規追加
- ナビ: 「使い方」リンク追加

### 変更意図・背景
初期UIデザインの大幅リファクタリング。操作フロー改善とビジュアル刷新を同時実施。

---

## 2026-05-11: PRラベル必須化・開発ルール整備
**ブランチ:** claude/add-dev-rules-Xp3q

### 変更内容
- `CLAUDE.md`: PRラベル（feat/fix/docs/refactor/perf/test/chore）の必須化ルールを追加
- `CLAUDE.md`: リファクタリング安全ルール（リネーム前の全参照検索義務）を追加
- `CLAUDE.md`: マージ前チェックルール（`npm run build` + `tsc --noEmit`）を追加
- `CLAUDE.md`: テスト実行ルール（インポート機能などの変更時）を追加
- `CLAUDE.md`: ドキュメント更新ルール（変更種別と更新対象ファイルの対応表）を追加
- `CLAUDE.md`: セキュリティルール（バリデーション、ファイルシステム非依存、環境変数、エラーレスポンス）を明文化

### 変更意図・背景
CHANGELOG.mdの過去のPR分析から再発防止ルールとして必須化：
- PR #13（ImportError）→ リファクタリング安全ルール
- PR #19（TS型エラーのCIビルド失敗）→ マージ前チェックルール
- PR #6（インポート4バグ）→ テスト実行ルール
ドキュメント・セキュリティはガイドラインから強制力のあるルールに格上げ。

### 残課題・次のステップ
- pytest（バックエンド）・vitest（フロントエンド）の実際の導入
- GitHub Actions に `npm run build` + `tsc --noEmit` の自動実行ステップを追加

---

## 今後の記録はここより上に追記
