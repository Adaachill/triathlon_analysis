# Triathlon Analysis MVP

レース結果を分析し、選手の強さを標準化タイムで評価するシステム。

## 構成

- **バックエンド**: FastAPI (Python)
- **フロントエンド**: React + Vite (GitHub Pages で公開)

## バックエンド

### セットアップ

```bash
pip install -r requirements.txt
```

### データのインポート

`raw_excel/` ディレクトリにExcelファイルを配置し、以下のコマンドでインポート：

```bash
python -m app.services.import_excel
```

または、FastAPIサーバー起動後、`POST /admin/upload_excel` エンドポイントを使用。

### サーバー起動

```bash
uvicorn app.main:app --reload
```

APIドキュメント: http://localhost:8000/docs

## フロントエンド（UI）

### ローカル開発

1. バックエンドを `http://localhost:8000` で起動
2. フロントエンドを起動：

```bash
cd frontend
npm install
npm run dev
```

3. http://localhost:5173 でUIを確認

### 本番デプロイ（Neon + Render + GitHub Pages）

#### 1. Neon（PostgreSQL）
1. [neon.tech](https://neon.tech) でプロジェクトを作成（リージョン: Singapore）
2. 接続文字列をコピー（`postgresql://...`形式）

#### 2. Render（バックエンド）
1. [render.com](https://render.com) で **New → Web Service** を作成
2. このリポジトリを選択（`render.yaml` が自動検出される）
3. Region: **Singapore**、Plan: **Free**
4. 環境変数 `DATABASE_URL` にNeonの接続文字列を設定してデプロイ
5. デプロイ完了後のURL（`https://xxxx.onrender.com`）をメモ

#### 3. GitHub（フロントエンド）
1. Settings → **Pages** → Source を **"GitHub Actions"** に設定
2. Settings → **Secrets and variables → Actions** → **New repository secret**
   - Name: `VITE_API_URL`
   - Value: RenderのURL（例: `https://xxxx.onrender.com`）
3. Actions タブ → "Deploy to GitHub Pages" → **Run workflow** で初回デプロイ
   - 以降は `main` ブランチへの push で自動デプロイ

#### 4. データ投入
Renderデプロイ後、`https://xxxx.onrender.com/docs` から `POST /admin/upload_excel` でExcelをアップロード。
