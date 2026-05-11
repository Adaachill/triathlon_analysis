# 予想タイム算出アルゴリズム

## 概要

予想タイムは以下の式で算出される。

```
予想タイム = 選手強度（Athlete Strength） + レース難易度（Race Difficulty）
```

この計算は Swim / T1 / Bike / T2 / Run の各セグメントおよび合計タイムについて個別に行われる。

---

## ALS最適化（Alternating Least Squares）

**ファイル：** `app/services/als_optimizer.py`

### 数学的モデル

```
実測タイム[選手a, レースr, セグメントf] ≈ 強度[a, f] + 難易度[r, f]
```

- **強度（Strength）**：選手固有の「典型的なタイム水準」
- **難易度（Difficulty）**：コースの速さ・遅さを秒数で表したオフセット（全レース平均 = 0 に正規化）

### アルゴリズムの流れ（最大30回反復）

1. **初期化**
   - `diff = 0`（全レースの難易度を0とする）
   - `strength = 各選手の全レース平均タイム`

2. **反復ステップa：選手強度を更新**
   ```
   strength[a, f] = weighted_mean(actual[a, r, f] - diff[r, f])
   ```
   各選手について「実測タイム − 現在のレース難易度」の加重平均を計算する。

3. **反復ステップb：レース難易度を更新**
   ```
   diff[r, f] = weighted_mean(actual[a, r, f] - strength[a, f])
   ```
   各レースについて「実測タイム − 現在の選手強度」の加重平均を計算する。

4. **反復ステップc：識別制約（センタリング）**
   ```
   mean(diff[r, f]) = 0 を強制
   → diff の平均分を strength に加算して補正
   ```
   「難易度の基準点」を全レース平均に固定することで、強度と難易度の役割を一意に分離する。

5. **反復ステップd：外れ値処理（IRLS）**
   - 全選手×レース×セグメントの残差（実測 − 予測）を計算
   - MAD（Median Absolute Deviation）を計算
   - 閾値 = `2.5 × MAD × 1.4826`
   - 閾値を超えるペアの重みを下げる：`weight = max(0.1, threshold / |residual|)`
   - 次回反復でこの重みを使用することで外れ値の影響を自動抑制する

### 収束

典型的には10回程度の反復で収束する。収束後の結果はメモリ内にキャッシュされ、同じプログラムへの2回目以降のアクセスは計算不要で高速に返される。

---

## 予想タイムの算出

**ファイル：** `app/routers/predict.py`

### 2つの予想モード

| モード | 難易度オフセット | 用途 |
|--------|-----------------|------|
| `pred_avg` | 0（全レース平均コース） | ALS基準の汎用予想 |
| `pred_devonport` | 2025 Devonportレースの難易度 | Devonportコース固有の予想 |

### 計算式（セグメント単位）

```python
pred[seg] = strength[seg] + difficulty[seg]
```

- `strength[seg]`：ALS最適化で求めた選手固有のセグメント強度
- `difficulty[seg]`：対象レースのセグメント難易度（`pred_avg`の場合は0）

### 順位付け

予想合計タイムの昇順でカテゴリ内の順位を付与する。過去実績がない選手（ALS強度が計算できない選手）は予想なし・順位なし扱いとなる。

---

## データの流れ

```
raw_excel/*.xlsx
    │
    ▼
[インポート] import_excel.py
    │ Excelを読み込んでDBに格納
    ▼
DB (app.db)
  - Race テーブル
  - Result テーブル（status="Finished" のみ予想に使用）
    │
    ▼
[ALS最適化] als_optimizer.py
  get_optimized_program(session, program_name)
    │ 選手強度・レース難易度を同時推定
    │ キャッシュあり
    ▼
[予想生成] predict.py  _build_prediction(s_data, diff)
    │ strength + difficulty
    ▼
API レスポンス
  - pred_avg（平均コース）
  - pred_devonport（Devonportコース）
  - rank_avg / rank_devonport（順位）
    │
    ▼
フロントエンド Predict.tsx
  - タブ切替でモード選択
  - カテゴリ別・セグメント別で表示
```

---

## スタートリスト

予想はスタートリスト（出場選手リスト）に含まれる選手に対して生成される。

| ソース | ファイル | エンドポイント |
|--------|---------|----------------|
| 固定（2026 Devonport） | `raw_excel/event_startlist_195131.xlsx` | `GET /predict/2026-devonport` |
| アップロード | `raw_excel/uploaded_startlist_latest.xlsx` | `POST /predict/upload-startlist` |

スタートリストに含まれる選手が DB の Result に過去データを持つ場合、ALS強度が計算され予想タイムが生成される。過去データがない選手は `has_history: false` となり予想なし。

---

## 対象プログラム（カテゴリ）

ALSは以下のプログラムについて個別に最適化が実行される。

- PTVI（視覚障害）
- PTS2 / PTS3 / PTS4 / PTS5（立位）
- PTWC1 / PTWC2（車いす）

---

## 主要パラメータ

| パラメータ | 値 | 説明 |
|-----------|-----|------|
| `max_iter` | 30 | 最大反復回数 |
| `outlier_k` | 2.5 | 外れ値閾値（MAD倍率） |
| `min_weight` | 0.1 | 外れ値ペアに与える最小重み |
| 識別制約 | 難易度の全レース平均 = 0 | 強度・難易度の基準点固定 |

---

## 関連ファイル

| ファイル | 役割 |
|---------|------|
| `app/services/als_optimizer.py` | ALS最適化本体（強度・難易度の計算） |
| `app/routers/predict.py` | 予想生成・APIエンドポイント |
| `app/services/import_excel.py` | Excelインポート |
| `app/models.py` | DB モデル（Race, Result） |
| `frontend/src/pages/Predict.tsx` | 予想画面UI |
| `frontend/src/api.ts` | フロントエンドAPIクライアント |
