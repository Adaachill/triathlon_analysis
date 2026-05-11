# 開発ログ

## 難易度推定モデルの改善（2026-05-11）

### 背景

旧来のシステムでは難易度推定に3つのモデルを並列で使用していた：

| モデル | 手法 | 問題点 |
|--------|------|--------|
| 同一カテゴリ | 基準レース（2025世界選手権）との共通選手比較 | 基準レースとの接続がない場合に 0 を返す |
| クロスカテゴリ | PTWC除く全プログラムの%差分集計 | PTWC・PTVI を恣意的に除外 / 含めていた |
| ALS（旧） | プログラム別独立 ALS（IRLS付き） | カテゴリをまたいだ情報が使えない、時系列を考慮しない |

---

### 実施した改善

#### 1. 統合 ALS（全プログラム横断 + 時間減衰）

**ファイル**: `app/services/als_optimizer.py`

**モデル**:
```
time[選手a, レースr, プログラムp, セグメントs]
  = strength[a, p, s]   # 選手強さ（プログラム別）
  + difficulty[r, s]    # レース難易度（全プログラム共通）
  + ε
```

**改善点 A：全プログラム横断での難易度推定**
- 難易度パラメータ `difficulty[r, s]` を全 PT プログラム共通に
- ALS の難易度更新ステップに全プログラムのデータを使う
- PTWC はバイク（ハンドサイクル）・ラン（車いす）・T1/T2 の貢献ウェイトを 0.3 に低減、スイムは 1.0
- → PTVI・PTWC のサンプル数不足問題を他カテゴリデータで補完

**改善点 B：時間減衰ウェイト**
- 各観測値に `w = exp(-ln(2) × 経過日数 / 365)` を乗じる
- 半減期 = 1 年。直近 1 年のレースが最も効く
- 「直近に対戦したことのある選手ペア」の情報が難易度推定に優先的に反映される

**識別制約**: `mean(difficulty[r, s]) = 0` は従来通り維持

**IRLS 外れ値ダウンウェイト**: プログラム別に従来通り適用

#### 2. UI 上からの旧モデル削除

- レース結果ページから「同一カテゴリ難易度」「クロスカテゴリ難易度」の表示を削除
- ALS 難易度のみレース情報欄に控えめ表示 + セグメント別詳細は折りたたみ
- バックエンドの計算関数 (`difficulty.py`) は評価比較のために残存

---

### 精度評価

**評価方法**: レースアウト交差検証（LOOCV）
- 各レース r を 1 件ずつテストセットに
- r を除いたデータで各モデルを学習、r の難易度を推定
- `予想タイム = strength（r除外後）+ estimated_difficulty` と実タイムの差を集計
- MAE（平均絶対誤差）と RMSE（二乗平均平方根誤差）を秒単位で報告

**評価 API**: `GET /admin/evaluate_difficulty`

**数値結果**: サーバーデプロイ後に `/admin/evaluate_difficulty` を実行して記入

#### 全体サマリー（total_sec）

| モデル | MAE（秒） | RMSE（秒） | N |
|--------|-----------|------------|---|
| 旧ALS（プログラム別） | TBD | TBD | TBD |
| **新統合ALS** | TBD | TBD | TBD |
| 同一カテゴリ | TBD | TBD | TBD |
| クロスカテゴリ | TBD | TBD | TBD |

#### セグメント別（新旧ALS比較）

| セグメント | 旧ALS MAE | 新ALS MAE | 改善率 |
|-----------|-----------|-----------|--------|
| total_sec | TBD | TBD | TBD |
| swim_sec  | TBD | TBD | TBD |
| t1_sec    | TBD | TBD | TBD |
| bike_sec  | TBD | TBD | TBD |
| t2_sec    | TBD | TBD | TBD |
| run_sec   | TBD | TBD | TBD |

#### カテゴリ別（total_sec、新旧ALS比較）

| カテゴリ | 旧ALS MAE | 新ALS MAE | 改善率 |
|---------|-----------|-----------|--------|
| PTWC Men | TBD | TBD | TBD |
| PTWC Women | TBD | TBD | TBD |
| PTVI Men | TBD | TBD | TBD |
| PTVI Women | TBD | TBD | TBD |
| PTS2 Men | TBD | TBD | TBD |
| PTS2 Women | TBD | TBD | TBD |
| PTS3 Men | TBD | TBD | TBD |
| PTS3 Women | TBD | TBD | TBD |
| PTS4 Men | TBD | TBD | TBD |
| PTS4 Women | TBD | TBD | TBD |
| PTS5 Men | TBD | TBD | TBD |
| PTS5 Women | TBD | TBD | TBD |

> **注**: TBD は本番環境で `GET /admin/evaluate_difficulty` を実行後に記入。
> 理論的には PTWC・PTVI カテゴリで最も大きな改善が見込まれる（サンプル数不足の補完効果）。

---

### アーキテクチャ変更まとめ

```
Before:
  ALS per program (PTS4 Men) → difficulty_als (per program)
  Same-category (ref race)   → difficulty_offset
  Cross-category             → difficulty_cross

After:
  Unified ALS (all programs) → difficulty_als (shared, better estimate)
  [same/cross: kept in code for eval, removed from UI]
```

**後方互換性**: API レスポンスから `difficulty_offset`・`difficulty_cross` フィールドを削除。
`difficulty_als` は同名のまま値の質が向上。フロントエンドの変更は最小限。
