# レース結果 → ランキング計算 検証フロー

## フロー全体図

```
[Excel] → [import_excel] → [Race / Result] → [races API]     → レース一覧・詳細
                                      ↘
                                        → [difficulty] → 難易度計算
                                      ↘
                                        → [athletes API] → 選手強さ・履歴
                                        → [rankings API] → 強さランキング
```

## 検証手順

### 事前準備

```bash
# 仮想環境有効化
.venv\Scripts\activate

# 検証スクリプト実行
python -m scripts.verify_flow
```

### Step 1: レース・結果のDB確認

- **確認内容**: Race と Result がDBに存在するか
- **成功条件**: レース数 > 0, 結果数 > 0
- **失敗時**: `raw_excel/` に Excel を配置し `python -m app.services.import_excel` でインポート

**重要チェック**:
- **Status 別**: athletes / rankings は `status == "Finished"` の結果のみ使用
- **Program Name 別**: API呼び出し時の `program_name` はここで表示された値と完全一致させる

### Step 2: 基準レースの確認

- **確認内容**: `is_reference=True` のレースが1件あるか
- **成功条件**: Event ID 188993 のレースがインポートされている
- **失敗時**: 該当 Excel をインポートするか、既存レースを `is_reference=True` に更新

**重要**: 基準レースに `status="Finished"` かつ `total_sec` ありの結果が入っていること

### Step 3: Program Name の取得

- **確認内容**: `status="Finished"` かつ `total_sec` ありの結果が存在するか
- **成功条件**: 少なくとも1つの program_name が取得できる
- **失敗時**: Step 1 の Status 分布を確認。多くが "nan" 等なら import_excel の Status 扱いを修正

### Step 4: レース難易度の計算

- **確認内容**: 各レースの難易度オフセットが計算できるか
- **ロジック**: 基準レースとの共通選手の total_sec 差分の平均
- **注意**: 共通選手0のレースは難易度0扱い

### Step 5: 選手強さの計算

- **確認内容**: サンプル選手の標準化 Total 平均が計算できるか
- **ロジック**: 全レースの `(total_sec - 難易度)` の平均

### Step 6: ランキング取得

- **確認内容**: 全選手の強さランキングが算出できるか

---

## 修正済みの問題

### 1. Status が "Finished" でない（修正済み）

- **原因**: Excel の Status 列が空/NaN の行が多く、athletes/rankings のフィルタに引っかからなかった
- **対策**: `import_excel.py` で Status が空/NaN の行を `"Finished"` 扱いにするよう修正

### 2. 難易度0のレースについて

- 基準レース（Event ID 188993）との**共通出場選手が0人**のレースは、難易度オフセット=0 となる
- その場合、標準化タイム = 生タイム のまま（補正なし）

---

## API 呼び出し例（検証成功後）

```
GET /races
GET /races/1?program_name=PTS5%20Men
GET /athletes/12345?program_name=PTS5%20Men
GET /rankings/top?program_name=PTS5%20Men
```

※ `program_name` は Step 1 の Program Name 一覧と完全一致させる（スペース・大文字小文字に注意）
