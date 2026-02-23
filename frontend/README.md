# Triathlon Analysis UI

パラトライアスロンのレース分析結果をビジュアライズするフロントエンド。React + Vite + Recharts。

## 開発

```bash
cd frontend
npm install
npm run dev
```

バックエンドが `http://localhost:8000` で起動していることを前提に、Vite のプロキシで `/api` → バックエンドへ転送します。

## ビルド

```bash
npm run build
```

`dist/` に静的ファイルが出力されます。

## GitHub Pages へのデプロイ

### 1. バックエンドのデプロイ

バックエンドAPIを Render / Railway / Fly.io 等にデプロイし、URLを取得します。

### 2. フロントエンドのビルド

```bash
VITE_API_URL=https://your-api.onrender.com npm run build
```

### 3. GitHub Pages の設定

- **リポジトリルートで公開する場合**: `dist/` の中身を `docs/` にコピーし、GitHub の Pages 設定で "Deploy from a branch" → "docs" を選択
- **サブパスで公開する場合**（例: `username.github.io/triathlon_analysis/`）:
  ```bash
  vite build --base /triathlon_analysis/
  ```
  その後 `dist/` を `gh-pages` ブランチに push するか、GitHub Actions でデプロイ

### 4. CORS

バックエンドの `main.py` で `allow_origins=["*"]` が設定されているため、任意のオリジンからAPIを呼び出せます。本番では必要に応じて制限してください。
