# 開発履歴

## ルール（2026-05-11 策定）

### 過去の記録
git commit logから概要のみ記載。詳細はコミットハッシュで追跡可能。

### 今後のルール
**コミットのたびに以下のフォーマットで追記する（新しい順）。**

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

## 今後の記録はここより上に追記
