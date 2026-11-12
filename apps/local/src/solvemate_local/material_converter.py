"""PPTX 本机转换；不与 AI 服务选择或会话适配器耦合。"""

import asyncio
import os
import shutil
import signal
import sys
from pathlib import Path
from xml.sax.saxutils import escape

from .processes import process_options, stop_process_tree


class MaterialError(Exception):
    def __init__(self, message, code="material_invalid", status=422):
        super().__init__(message)
        self.code = code
        self.status = status


def find_libreoffice(platform=None, environ=None, which=None):
    platform = platform or sys.platform
    environ = os.environ if environ is None else environ
    which = which or shutil.which
    explicit = environ.get("SOLVEMATE_LIBREOFFICE")
    if explicit:
        path = Path(explicit).expanduser()
        if path.is_file():
            return str(path)
        raise MaterialError(
            "指定的 LibreOffice 程序不存在，请检查 SOLVEMATE_LIBREOFFICE 后重试。",
            "converter_missing",
        )
    for command in ("soffice", "libreoffice"):
        found = which(command)
        if found:
            return found
    candidates = []
    if platform == "darwin":
        candidates = [
            Path("/Applications/LibreOffice.app/Contents/MacOS/soffice"),
            Path.home() / "Applications/LibreOffice.app/Contents/MacOS/soffice",
        ]
    elif platform == "win32":
        candidates = [
            Path(environ[key]) / "LibreOffice/program" / filename
            for key in ("PROGRAMFILES", "PROGRAMFILES(X86)", "ProgramW6432")
            if environ.get(key)
            for filename in ("soffice.com", "soffice.exe")
        ]
    for path in candidates:
        if path.is_file():
            return str(path)
    raise MaterialError(
        "未找到 LibreOffice。请安装 LibreOffice 后点击“重试处理”；也可以将课件导出为 PDF 后导入。",
        "converter_missing",
    )


async def convert_pptx(source, output, timeout=120):
    executable = find_libreoffice()
    profile = output / "profile"
    args = [
        executable,
        "-env:UserInstallation=" + profile.resolve().as_uri(),
        "--headless",
        "--convert-to",
        "pdf:impress_pdf_Export",
        "--outdir",
        str(output),
        str(source),
    ]
    environment = dict(os.environ)
    if sys.platform == "darwin" and not environment.get("FONTCONFIG_FILE"):
        # macOS 无界面转换使用 Fontconfig，须同时提供系统中文字体和办公软件自带字体。
        directories = [
            Path("/System/Library/Fonts"),
            Path("/Library/Fonts"),
            Path.home() / "Library/Fonts",
            Path(executable).resolve().parents[1] / "Resources/fonts",
            Path("/Applications/LibreOffice.app/Contents/Resources/fonts"),
            Path.home() / "Applications/LibreOffice.app/Contents/Resources/fonts",
        ]
        config = output / "fonts.conf"
        config.write_text(
            '<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd"><fontconfig>'
            + "".join(
                f"<dir>{escape(str(path))}</dir>"
                for path in directories
                if path.is_dir()
            )
            + f"<cachedir>{escape(str(output / 'fontcache'))}</cachedir></fontconfig>",
            encoding="utf-8",
        )
        environment["FONTCONFIG_FILE"] = str(config)
    try:
        process = await asyncio.create_subprocess_exec(
            *args,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
            env=environment,
            **process_options(),
        )
    except OSError as error:
        raise MaterialError(
            "无法启动 LibreOffice，请检查程序路径和执行权限后重试。",
            "converter_start_failed",
        ) from error
    try:
        await asyncio.wait_for(process.wait(), timeout)
    except TimeoutError as error:
        raise MaterialError(
            "课件转换超过两分钟，原件已保留。请重试，或导出为 PDF 后导入。",
            "conversion_timeout",
        ) from error
    finally:
        if process.returncode is None:
            await stop_process_tree(process, getattr(signal, "SIGKILL", signal.SIGTERM))
            await process.wait()
    result = output / (source.stem + ".pdf")
    if process.returncode != 0 or not result.is_file() or result.stat().st_size == 0:
        raise MaterialError(
            "LibreOffice 未能生成阅读文件，原件已保留。请检查课件后重试，或导出为 PDF 后导入。",
            "conversion_failed",
        )
    return result
