"""管理用API（Excelアップロードなど）"""
from fastapi import APIRouter, UploadFile, File, Depends
from sqlmodel import Session
from app.deps import get_db
from app.services.import_excel import import_excel_file, import_all_from_raw_excel

router = APIRouter(prefix="/admin", tags=["admin"])


@router.post("/upload_excel")
async def upload_excel(
    file: UploadFile = File(...),
    session: Session = Depends(get_db),
):
    """Excelファイルをアップロードしてインポート"""
    import tempfile
    import os

    # 一時ファイルに保存
    with tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx") as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        result = import_excel_file(tmp_path, session)
        return {
            "message": "Import successful",
            **result,
        }
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
