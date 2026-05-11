# Claude Code ルール

## ブランチ・PR運用ルール

### 機能ごとに別ブランチ・別PRを作成する

ユーザーから新しい機能追加・変更依頼を受けたときは、**必ず新しいブランチを切って独立したPRを作成**すること。
複数の機能をひとつのPRにまとめてはいけない。

- ブランチ名の例: `claude/feature-name-xxxx`（末尾4文字はランダム）
- 依頼が別であれば、同じチャット内でも別ブランチ・別PRとする
- PRは常にdraftで作成し、mergeはユーザーが判断する

### マージ済みPRへの追加コミット禁止

一度マージされたPRのブランチに対して、追加コミットをpushしてはいけない。
マージ後に修正・追加が必要になった場合は、**必ず新しいブランチを切って新しいPRを作成する**こと。

- マージ済みブランチへの `git push` は絶対に行わない
- 同一チャット内でのフィックスも、必ず別ブランチ・別PRとする

## PR作成ルール

### 1. PRラベルの必須化

すべてのPRに以下のカテゴリラベルを**必ず一つ付与**すること。複合型は複数選択可。

| ラベル | 説明 | 例 |
|--------|------|-----|
| **feat** | 新機能追加・UI改善 | WT大会自動インポート、UI全体改善、新ページ追加 |
| **fix** | バグ修正・エラー対応 | ImportError修正、NaN値シリアライズエラー修正、型エラー修正 |
| **docs** | ドキュメント・コメント追加 | README更新、CLAUDE.md更新、CHANGELOG記載 |
| **refactor** | リファクタリング・コード整理 | 関数リネーム、構造変更（コンポーネント抽出等） |
| **perf** | パフォーマンス改善 | クエリ最適化、キャッシング導入、バンドルサイズ削減 |
| **test** | テスト追加・テスト改善 | ユニットテスト追加、統合テスト追加 |
| **chore** | 依存関係更新・設定変更 | package.json更新、GitHub Actions設定、環境変数追加 |

**ラベル付与のルール:**
- PR作成時に GitHub の「Labels」セクションで選択
- コミットメッセージの先頭にも `feat:` / `fix:` / `docs:` 等のプリフィックスを付与（Conventional Commits形式）
- 例: `feat: WT大会自動インポート機能追加` / `fix: ImportError対応`

### 2. スクリーンショットの添付

UIに関わる変更（フロントエンド、CSS、テンプレート等）を含むPRでは、必ず変更前後のスクリーンショットをPRのbodyに添付すること。

- 変更前と変更後を並べて示す
- スクリーンショットが取得できない場合はその旨を明記する

### 3. レビュアー向け確認手順

PRのbodyに、レビュアーが変更を確認するための手順を以下の折りたたみ形式で記載すること。

```markdown
<details>
<summary>ローカル確認手順</summary>

**バックエンド起動**
1. ブランチをチェックアウト: `git checkout <branch>`
2. 依存関係をインストール: `pip install -r requirements.txt`
3. バックエンドを起動: `uvicorn main:app --reload`
   - `DATABASE_URL` 未設定の場合は自動的に SQLite（`app.db`）を使用
4. データをインポート（初回のみ）: `curl -X POST http://localhost:8000/admin/import_raw_excel`
   - `raw_excel/` 内の全 Excel ファイルが DB に取り込まれる
   - APIドキュメント（http://localhost:8000/docs）からも実行可能

**フロントエンド起動**
5. `cd frontend && npm install`
6. `npm run dev`
7. ブラウザで http://localhost:5173 を開く

**確認項目:**
- [ ] 項目1
- [ ] 項目2

</details>
```

### 4. Changelog更新

**必ず以下を実施すること：**

PR作成時に、`dev_logs/CHANGELOG.md`にエントリを追加する。以下の形式で記載すること。

```markdown
## YYYY-MM-DD: 機能名・タイトル
**コミット:** `hash`
**ブランチ:** branch-name

### 変更内容
- 変更したファイルと概要を箇条書き

### 変更意図・背景
なぜその変更をしたか。どんな課題を解決したか。

### 技術的決定事項
設計上の選択肢とその理由（複数案があった場合は比較も書く）。

### 残課題・次のステップ
この変更で積み残したこと、次に着手すべきこと。
```

例：
```markdown
## 2026-05-11: ユーザー認証機能の追加
**コミット:** `abc1234`
**ブランチ:** claude/add-oauth-xxxx

### 変更内容
- `app/auth.py`: Google OAuth統合を実装
- `app/models.py`: Userモデルに認証フィールド追加
- `frontend/src/pages/Login.tsx`: ログインUIを新規作成

### 変更意図・背景
ユーザーがシステムに登録・ログインできるようにした。

### 技術的決定事項
OAuth vs セッション認証を検討し、セキュリティと実装の手軽さからOAuthを選択。

### 残課題・次のステップ
- ユーザープロフィール編集機能を実装
- パスワードリセット機能を追加
```

### 5. PRテンプレート構成

```markdown
## Summary
- 変更点を箇条書きで

## Screenshots
<!-- UIの変更がある場合、変更前後のスクリーンショットを貼る -->
| Before | After |
|--------|-------|
| (画像) | (画像) |

<details>
<summary>ローカル確認手順</summary>

**バックエンド起動**
1. `git checkout <branch-name>`
2. `pip install -r requirements.txt`
3. `uvicorn main:app --reload`
   - `DATABASE_URL` 未設定時は SQLite（`app.db`）を自動使用
4. データインポート（初回のみ）: `curl -X POST http://localhost:8000/admin/import_raw_excel`
   - または http://localhost:8000/docs の `/admin/import_raw_excel` から実行

**フロントエンド起動**
5. `cd frontend && npm install`
6. `npm run dev`
7. http://localhost:5173 で動作確認

**確認項目:**
- [ ] 項目1
- [ ] 項目2

</details>

## Test plan
- [ ] テスト項目
```

## 開発ガイドライン

### 生産性向上のための実践

1. **大規模リファクタリング前チェック**
   - 関数・変数のリネーム前に、必ず全プロジェクトで参照検索（grep/IDE検索）
   - 修正対象ファイルのリストを PR 説明に記載
   - 例：PR #13 の ImportError は関数リネーム（`compute_optimized_program` → `compute_optimized_unified`）の参照漏れが原因

2. **ローカル開発時から本番ビルドをテスト**
   - マージ前に必ず `npm run build` を実行（esbuild との差異検出）
   - 型チェック: `tsc --noEmit` をローカルで実行
   - 例：PR #19 の TS型エラー（ISO3_TO_ISO2 重複キー）はローカル esbuild では通ったが CI で検出

3. **バックエンド関数のユニットテスト**
   - CSV/Excel インポート機能は特に注意（PR #6 で 4つのバグ検出）
   - テストすべき項目：
     - float/int型の正規化
     - エラーメッセージの詳細化（握りつぶし防止）
     - 重複・上書き時の挙動
     - バリデーション

### セキュリティベストプラクティス

1. **入力値バリデーション**
   - DB フィールドに最小値・最大値制約がある場合、API レイヤーでもバリデーション実装
   - 例：優勝ポイント 150〜750 の範囲チェック（PR #11 以降で実装）

2. **エラーメッセージ管理**
   - 本番環境では詳細エラーを握りつぶす方針を統一（vs ユーザーヘルプ目的）
   - 開発環境での詳細ログは Render の環境変数で制御
   - 例：PR #6 で `try-catch` を追加し、例外を詳細メッセージで返すよう修正

3. **環境変数の厳格管理**
   - `DATABASE_URL`（本番 Neon）、`VITE_API_URL`（本番 Render）は GitHub Secrets で管理
   - ローカル開発は `.env.local` を使用（git 除外）
   - デフォルト値は安全な値（ローカル SQLite、localhost API）

4. **ファイルシステム依存の回避**
   - Render 無料プラン＝ファイルシステムエフェメラル を念頭に開発
   - ステートレス設計を心がける（セッションはメモリまたは DB に）
   - 例：PR #10 でスタートリスト（ローカルファイル）から メモリ処理に変更

### 改善の優先度

**高優先度（次のスプリント）:**
- [ ] ユニットテスト導入（pytest for backend, vitest for frontend）
- [ ] GitHub Actions に `npm run build` + `tsc --noEmit` を追加（PR commit時に自動実行）
- [ ] API エンドポイント全体の入力値バリデーション監査

**中優先度（1ヶ月以内）:**
- [ ] Alembic 導入またはマイグレーション記録ファイル（SQL 変更履歴）作成
- [ ] 技術仕様書作成（ALS算法、時間減衰ウェイト、PTWC補正ロジック等）
- [ ] GitHub Actions に統合テスト追加

**低優先度（1-2ヶ月）:**
- [ ] Render デプロイログの監視設定（エラー通知）
- [ ] パフォーマンスメトリクス収集（Core Web Vitals）
