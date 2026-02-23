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

### GitHub Pages デプロイ

1. バックエンドを Render 等にデプロイし、APIのURLを取得
2. リポジトリの Settings → Secrets に `VITE_API_URL` を登録
3. `main` ブランチに push で GitHub Actions が自動ビルド・デプロイ
4. Settings → Pages で "GitHub Actions" をデプロイ元に選択
