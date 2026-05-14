"""管理用API（Excelアップロードなど）"""
import tempfile
import os
from typing import Optional
from fastapi import APIRouter, BackgroundTasks, UploadFile, File, Form, Depends, HTTPException, Query
from sqlmodel import Session
from app.deps import get_db
from app.services.import_excel import import_excel_file, import_all_from_raw_excel

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/upload_excel")
async def upload_excel(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    race_name: str = Form(...),
    race_date: str = Form(...),
    points: int = Form(...),
    note: str = Form(""),
    session: Session = Depends(get_db),
):
    """Excelファイルをアップロードしてインポート"""
    if not (150 <= points <= 750):
        raise HTTPException(status_code=422, detail="pointsは150〜750の整数で指定してください")

    with tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx") as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = import_excel_file(
            tmp_path, session,
            race_name=race_name,
            race_date_str=race_date,
            points=points,
            note=note,
        )
        from app.services.als_optimizer import invalidate_cache, recompute_and_save_als
        invalidate_cache()
        background_tasks.add_task(recompute_and_save_als)
        return {"message": "Import successful", **result}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        os.unlink(tmp_path)


@router.post("/import_raw_excel")
async def import_raw_excel(
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_db),
):
    """raw_excelディレクトリ内の全ファイルをインポート"""
    results = import_all_from_raw_excel(session)
    from app.services.als_optimizer import invalidate_cache, recompute_and_save_als
    invalidate_cache()
    background_tasks.add_task(recompute_and_save_als)
    return {
        "message": "Import completed",
        "results": results,
    }


@router.get("/evaluate_difficulty")
async def evaluate_difficulty(
    session: Session = Depends(get_db),
    since_years: Optional[int] = Query(
        default=None,
        ge=1, le=10,
        description="直近N年のレースのみ評価対象にする。未指定なら全期間。推奨: 2",
    ),
    min_athlete_races: int = Query(
        default=1,
        ge=1, le=10,
        description="出場レース数がこの値未満の選手をALSから除外する。推奨: 2",
    ),
):
    """難易度推定モデルの精度評価（レースアウト CV）。
    旧 ALS・新統合 ALS・同一カテゴリ・クロスカテゴリの MAE / RMSE を比較する。

    高速化のヒント:
      ?since_years=2&min_athlete_races=2 を付けると大幅に高速化します。
    """
    from app.services.eval_difficulty import evaluate_difficulty_models
    return evaluate_difficulty_models(
        session,
        since_years=since_years,
        min_athlete_races=min_athlete_races,
    )


@router.get("/compare_halflife")
async def compare_halflife(
    session: Session = Depends(get_db),
    since_years: Optional[int] = Query(
        default=None,
        ge=1, le=10,
        description="直近N年のレースのみ評価対象にする。推奨: 2",
    ),
    min_athlete_races: int = Query(
        default=1,
        ge=1, le=10,
        description="出場レース数がこの値未満の選手をALSから除外する。推奨: 2",
    ),
    sample_ratio: float = Query(
        default=0.5,
        ge=0.1, le=1.0,
        description="LOOCVに使うレースの割合。0.5なら半分をランダムサンプリング。高速化には0.3〜0.5を推奨。",
    ),
):
    """時間減衰の半減期（365/270/180日）別に統合ALS精度を比較する（レースアウト CV）。

    高速化のヒント:
      ?since_years=2&min_athlete_races=2&sample_ratio=0.3 で大幅に高速化します。
    """
    from app.services.eval_difficulty import evaluate_halflife_comparison
    return evaluate_halflife_comparison(
        session,
        since_years=since_years,
        min_athlete_races=min_athlete_races,
        sample_ratio=sample_ratio,
    )
