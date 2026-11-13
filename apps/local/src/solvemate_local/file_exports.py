"""导出文件默认保存到系统下载目录，不接受任意写入路径。"""

import asyncio
import json
import re
from pathlib import Path

from fastapi import APIRouter, Request

from .system_paths import downloads_directory
from .user_data import UserDataError

router = APIRouter(prefix="/local-api/v1/user/exports")
MAX_EXPORT_BYTES = 128 * 1024 * 1024


def validate_filename(filename):
    if (
        not filename
        or len(filename) > 180
        or len(filename.encode("utf-8")) > 240
        or re.search(r'[<>:"/\\|?*\x00-\x1f]', filename)
        or filename.endswith((".", " "))
        or Path(filename).suffix.lower() not in {".json", ".pdf"}
        or re.fullmatch(r"(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?", filename)
    ):
        raise UserDataError(
            "文件名无效，请修改后重试。", "export_filename_invalid", 422
        )
    return filename


def save_download(filename, content):
    directory = downloads_directory()
    directory.mkdir(parents=True, exist_ok=True)
    original = Path(validate_filename(filename))
    for number in range(1000):
        name = (
            original.name
            if not number
            else f"{original.stem} ({number}){original.suffix}"
        )
        target = directory / name
        try:
            output = target.open("xb")
        except FileExistsError:
            continue
        try:
            with output:
                output.write(content)
                output.flush()
        except BaseException:
            target.unlink(missing_ok=True)
            raise
        return {"filename": name, "directory": str(directory), "path": str(target)}
    raise UserDataError(
        "同名文件过多，请修改文件名后重试。", "export_name_conflict", 409
    )


@router.get("/directory")
async def export_directory():
    try:
        return {"directory": str(downloads_directory())}
    except OSError as error:
        raise UserDataError(
            "无法读取下载目录，请选择保存位置后重试。",
            "export_directory_unavailable",
            422,
        ) from error


@router.post("/save")
async def save_export(request: Request, filename: str):
    validate_filename(filename)
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > MAX_EXPORT_BYTES:
            raise UserDataError(
                "导出文件过大，请减少内容后重试。", "export_too_large", 413
            )
        content.extend(chunk)
    media_type = request.headers.get("content-type", "").split(";", 1)[0]
    if filename.lower().endswith(".pdf"):
        valid = media_type == "application/pdf" and content.startswith(b"%PDF-")
    else:
        valid = media_type == "application/json"
        try:
            json.loads(content)
        except (ValueError, UnicodeError):
            valid = False
    if not content or not valid:
        raise UserDataError(
            "导出文件内容无效，请重新导出。", "export_content_invalid", 422
        )
    try:
        return await asyncio.to_thread(save_download, filename, content)
    except OSError as error:
        raise UserDataError(
            "无法写入下载目录，请检查目录权限和磁盘空间，或选择其他位置后重试。",
            "export_write_failed",
            422,
        ) from error
