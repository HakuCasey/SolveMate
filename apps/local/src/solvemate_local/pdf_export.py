"""笔记 PDF 打印；程序查找与无界面浏览器进程隔离在本机服务中。"""

import asyncio
import os
import shutil
import signal
import sys
from html import escape
from html.parser import HTMLParser
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.parse import quote

from fastapi import APIRouter, Request
from fastapi.responses import Response
from pydantic import Field

from .models import RequestModel
from .processes import process_options, stop_process_tree
from .user_data import UserDataError

router = APIRouter(prefix="/local-api/v1/user/exports")


def find_pdf_browser(platform=None, environ=None, which=None):
    platform = platform or sys.platform
    environ = os.environ if environ is None else environ
    which = which or shutil.which
    explicit = environ.get("SOLVEMATE_PDF_BROWSER")
    if explicit:
        candidate = Path(explicit).expanduser()
        if candidate.suffix.lower() in {".cmd", ".bat"}:
            raise UserDataError(
                "请选择 Chrome 或 Edge 的可执行文件，不支持批处理入口。",
                "pdf_browser_missing",
                422,
            )
        if candidate.is_file():
            return str(candidate)
        raise UserDataError(
            "指定的 PDF 打印程序不存在，请检查 SOLVEMATE_PDF_BROWSER。",
            "pdf_browser_missing",
            422,
        )
    for name in ("google-chrome", "chromium", "chromium-browser", "chrome", "msedge"):
        found = which(name)
        if found and Path(found).suffix.lower() not in {".cmd", ".bat"}:
            return found
    candidates = []
    if platform == "darwin":
        candidates = [
            directory / app / "Contents/MacOS" / binary
            for directory in (Path("/Applications"), Path.home() / "Applications")
            for app, binary in (
                ("Google Chrome.app", "Google Chrome"),
                ("Microsoft Edge.app", "Microsoft Edge"),
                ("Chromium.app", "Chromium"),
            )
        ]
    elif platform == "win32":
        candidates = [
            Path(environ[key]) / suffix
            for key in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA")
            if environ.get(key)
            for suffix in (
                "Microsoft/Edge/Application/msedge.exe",
                "Google/Chrome/Application/chrome.exe",
            )
        ]
    for candidate in candidates:
        if candidate.is_file():
            return str(candidate)
    raise UserDataError(
        "生成 PDF 需要本机安装 Chrome 或 Microsoft Edge。安装后可重新导出。",
        "pdf_browser_missing",
        422,
    )


class ExportMarkup(HTMLParser):
    def handle_starttag(self, tag, attrs):
        if tag in {
            "script",
            "meta",
            "title",
            "base",
            "link",
            "iframe",
            "frame",
            "frameset",
            "object",
            "embed",
        }:
            raise UserDataError(
                "导出内容包含不支持的页面元素，请检查笔记后重试。",
                "pdf_markup_invalid",
                422,
            )

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)


async def render_pdf(html, timeout=45, *, title="笔记本"):
    ExportMarkup().feed(html)
    executable = find_pdf_browser()
    # CSP 在正文之前生效，导出只使用内嵌字体与本机字体，禁止脚本、外部文件和网络资源。
    policy = "default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; script-src 'none'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"
    with TemporaryDirectory(prefix="solvemate-notebook-") as temporary:
        directory = Path(temporary)
        source, result = directory / "notebook.html", directory / "notebook.pdf"
        source.write_text(
            '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
            + '<meta http-equiv="Content-Security-Policy" content="'
            + policy
            + '"><title>'
            + escape(title)
            + "</title></head><body>"
            + html
            + "</body></html>",
            encoding="utf-8",
        )
        args = [
            executable,
            "--headless",
            "--disable-extensions",
            "--disable-background-networking",
            "--no-first-run",
            "--no-default-browser-check",
            "--no-pdf-header-footer",
            "--virtual-time-budget=3000",
            "--user-data-dir=" + str(directory / "profile"),
            "--print-to-pdf=" + str(result),
            source.as_uri(),
        ]
        try:
            process = await asyncio.create_subprocess_exec(
                *args,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
                **process_options(),
            )
        except OSError as error:
            raise UserDataError(
                "无法启动 PDF 打印程序，请检查安装和执行权限后重试。",
                "pdf_start_failed",
                422,
            ) from error
        try:
            await asyncio.wait_for(process.wait(), timeout)
            if (
                process.returncode
                or not result.is_file()
                or result.stat().st_size > 128 * 1024 * 1024
            ):
                raise UserDataError(
                    "PDF 未能生成，请重试或分批整理笔记后导出。",
                    "pdf_export_failed",
                    422,
                )
            data = result.read_bytes()
            if not data.startswith(b"%PDF-") or not data.rstrip().endswith(b"%%EOF"):
                raise UserDataError(
                    "打印程序未返回有效的 PDF，请重试。", "pdf_export_failed", 422
                )
            return data
        except TimeoutError as error:
            raise UserDataError(
                "生成 PDF 超时，笔记内容保留，请稍后重试。", "pdf_export_timeout", 504
            ) from error
        finally:
            if process.returncode is None:
                await stop_process_tree(
                    process, getattr(signal, "SIGKILL", signal.SIGTERM)
                )
                await process.wait()


class NotebookPdf(RequestModel):
    notebookId: str = Field(min_length=1, max_length=200)
    revision: int = Field(ge=1)
    notes: dict[str, int]
    html: str = Field(min_length=1, max_length=20 * 1024 * 1024)


@router.post("/notebook.pdf")
async def notebook_pdf(body: NotebookPdf, request: Request):
    state = request.app.state.user.state()["value"]
    library = (state or {}).get("noteLibrary") or {}
    notebook = next(
        (
            book
            for book in library.get("notebooks", [])
            if book["id"] == body.notebookId
        ),
        None,
    )
    current = {
        note["id"]: note["revision"]
        for note in library.get("notes", [])
        if note["notebookId"] == body.notebookId
    }
    if (
        notebook is None
        or notebook["revision"] != body.revision
        or current != body.notes
    ):
        raise UserDataError(
            "笔记本内容已变化，请刷新数据后重新导出。", "revision_conflict", 409
        )
    lock = request.app.state.pdf_export_lock
    if lock.locked():
        raise UserDataError(
            "已有笔记本正在导出，请等待完成后重试。", "pdf_export_busy", 409
        )
    async with lock:
        # 标题从已核对版本的笔记本读取，不接受网页另传一份名称。
        task = asyncio.create_task(render_pdf(body.html, title=notebook["title"]))
        try:
            while not task.done():
                await asyncio.wait({task}, timeout=0.25)
                if await request.is_disconnected():
                    task.cancel()
                    await asyncio.gather(task, return_exceptions=True)
                    return Response(status_code=499)
            data = await task
        finally:
            if not task.done():
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
    filename = quote("笔记本-" + notebook["title"] + ".pdf", safe="")
    return Response(
        data,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f"attachment; filename=notebook.pdf; filename*=UTF-8''{filename}",
            "Cache-Control": "no-store",
        },
    )
