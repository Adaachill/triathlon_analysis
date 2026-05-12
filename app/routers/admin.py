"""管理用API（Excelアップロードなど）"""
import tempfile
import os
from fastapi import APIRouter, UploadFile, File, Form, Depends, HTTPException
from sqlmodel import Session
from app.deps import get_db
from app.services.import_excel import import_excel_file, import_all_from_raw_excel

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/upload_excel")
async def upload_excel(
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
        from app.services.als_optimizer import invalidate_cache
        invalidate_cache()
        return {"message": "Import successful", **result}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        os.unlink(tmp_path)


@router.post("/import_raw_excel")
async def import_raw_excel(session: Session = Depends(get_db)):
    """raw_excelディレクトリ内の全ファイルをインポート"""
    results = import_all_from_raw_excel(session)
    return {
        "message": "Import completed",
        "results": results,
    }


@router.get("/evaluate_difficulty")
async def evaluate_difficulty(session: Session = Depends(get_db)):
    """難易度推定モデルの精度評価（レースアウト CV）。
    旧 ALS・新統合 ALS・同一カテゴリ・クロスカテゴリの MAE / RMSE を比較する。
    """
    from app.services.eval_difficulty import evaluate_difficulty_models
    return evaluate_difficulty_models(session)


@router.get("/compare_halflife")
async def compare_halflife(session: Session = Depends(get_db)):
    """時間減衰の半減期（365/270/180日）別に統合ALS精度を比較する（レースアウト CV）。

    NOTE: 計算に時間がかかります（各半減期につき全レース分の ALS を実行）。
    """
    from app.services.eval_difficulty import evaluate_halflife_comparison
    return evaluate_halflife_comparison(session)
