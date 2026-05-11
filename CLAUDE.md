# Claude Code ルール

## ブランチ・PR運用ルール

### 機能ごとに別ブランチ・別PRを作成する

ユーザーから新しい機能追加・変更依頼を受けたときは、**必ず新しいブランチを切って独立したPRを作成**すること。
複数の機能をひとつのPRにまとめてはいけない。

- ブランチ名の例: `claude/feature-name-xxxx`（末尾4文字はランダム）
- 依頼が別であれば、同じチャット内でも別ブランチ・別PRとする
- PRは常にdraftで作成し、mergeはユーザーが判断する

## PR作成ルール

### 0. PR タイトルは日本語に統一

PR のタイトルは必ず日本語で記述する。英語混在は避ける。

- ✅ 例: `統合ALS実装と難易度推定の改善`
- ❌ 例: `Implement unified ALS with time decay`

### 1. スクリーンショットの添付

UIに関わる変更（フロントエンド、CSS、テンプレート等）を含むPRでは、必ず変更前後のスクリーンショットをPRのbodyに添付すること。

- 変更前と変更後を並べて示す
- スクリーンショットが取得できない場合はその旨を明記する

### 2. レビュアー向け確認手順

PRのbodyに、レビュアーが変更を確認するための手順を以下の折りたたみ形式で記載すること。

```markdown
<details>
<summary>ローカル確認手順</summary>

1. ブランチをチェックアウト: `git checkout <branch>`
2. 依存関係をインストール: `cd frontend && npm install`
3. 開発サーバーを起動: `npm run dev`
4. ブラウザで http://localhost:5173 を開く
5. 確認項目:
   - [ ] 項目1
   - [ ] 項目2

</details>
```

### 3. PRテンプレート構成

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

1. `git checkout <branch-name>`
2. `cd frontend && npm install`
3. `npm run dev`
4. http://localhost:5173 で動作確認

**確認項目:**
- [ ] 項目1
- [ ] 項目2

</details>

## Test plan
- [ ] テスト項目
```
