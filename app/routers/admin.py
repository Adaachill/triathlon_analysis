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
        return {"message": "Import successful", **result}
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
