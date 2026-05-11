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

### 1. スクリーンショットの添付

UIに関わる変更（フロントエンド、CSS、テンプレート等）を含むPRでは、必ず変更前後のスクリーンショットをPRのbodyに添付すること。

- 変更前と変更後を並べて示す
- スクリーンショットが取得できない場合はその旨を明記する

### 2. レビュアー向け確認手順

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

### 3. Changelog更新

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

### 4. PRテンプレート構成

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
