"""PDF 导出的程序查找、请求边界和故障恢复；普通测试不启动真实浏览器。"""

import asyncio
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from test_service import HEADERS
from test_user_data import data

from solvemate_local import pdf_export
from solvemate_local.main import create_app
from solvemate_local.user_data import UserDataError


def test_windows_browser_discovery_checks_edge_without_shell(tmp_path):
    executable = tmp_path / "Programs/Microsoft/Edge/Application/msedge.exe"
    executable.parent.mkdir(parents=True)
    executable.touch()
    assert pdf_export.find_pdf_browser(
        "win32", {"LOCALAPPDATA": str(tmp_path / "Programs")}, lambda _: None
    ) == str(executable)


def test_explicit_missing_browser_is_not_silently_replaced(tmp_path):
    with pytest.raises(UserDataError) as failed:
        pdf_export.find_pdf_browser(
            "darwin",
            {"SOLVEMATE_PDF_BROWSER": str(tmp_path / "missing")},
            lambda _: "/other",
        )
    assert failed.value.code == "pdf_browser_missing"


@pytest.mark.parametrize(
    "element", ["script", "meta", "base", "iframe", "object", "title"]
)
def test_export_rejects_navigation_and_executable_elements(element):
    with pytest.raises(UserDataError) as failed:
        pdf_export.ExportMarkup().feed(f"<{element} src='file:///private/data'>")
    assert failed.value.code == "pdf_markup_invalid"


def test_export_checks_saved_notebook_snapshot_and_origin(monkeypatch, tmp_path):
    called = []

    async def render(html, *, title):
        called.append((html, title))
        return b"%PDF-1.7\nsample"

    monkeypatch.setattr(pdf_export, "render_pdf", render)
    with TestClient(create_app(tmp_path / "ai"), headers=HEADERS) as client:
        saved = client.put(
            "/local-api/v1/user/state", json={"value": data(), "expectedRevision": 0}
        )
        assert saved.status_code == 200
        body = {
            "notebookId": "notebook-unclassified",
            "revision": 1,
            "notes": {"note-original": 1},
            "html": "<h1>笔记</h1>",
        }
        result = client.post("/local-api/v1/user/exports/notebook.pdf", json=body)
        assert result.status_code == 200
        assert result.headers["content-type"] == "application/pdf"
        assert "filename*=" in result.headers["content-disposition"]
        stale = client.post(
            "/local-api/v1/user/exports/notebook.pdf",
            json={**body, "notes": {"note-original": 2}},
        )
        assert stale.status_code == 409
        denied = client.post(
            "/local-api/v1/user/exports/notebook.pdf",
            json=body,
            headers={"origin": "https://other.example"},
        )
        assert denied.status_code == 403
        assert called == [("<h1>笔记</h1>", "未分类")]
        assert client.get("/local-api/v1/user/state").json() == saved.json()


def test_timeout_removes_owned_process_and_temporary_files(monkeypatch):
    roots, killed = [], []

    class Process:
        returncode = None

        async def wait(self):
            await asyncio.sleep(10)

    child = Process()

    async def launch(*args, **kwargs):
        roots.append(
            Path(
                next(
                    value.removeprefix("--user-data-dir=")
                    for value in args
                    if value.startswith("--user-data-dir=")
                )
            ).parent
        )
        assert "--headless" in args and "--no-pdf-header-footer" in args
        assert "shell" not in kwargs
        return child

    async def stop(process, sig):
        killed.append(process)
        process.returncode = -1

        async def done():
            return -1

        process.wait = done

    monkeypatch.setattr(pdf_export, "find_pdf_browser", lambda: "/browser")
    monkeypatch.setattr(pdf_export.asyncio, "create_subprocess_exec", launch)
    monkeypatch.setattr(pdf_export, "stop_process_tree", stop)
    with pytest.raises(UserDataError) as failed:
        asyncio.run(pdf_export.render_pdf("<p>正文</p>", timeout=0.001))
    assert failed.value.code == "pdf_export_timeout"
    assert killed == [child]
    assert roots and not roots[0].exists()


def test_pdf_title_is_escaped_and_temporary_filename_is_not_used(monkeypatch):
    captured = []

    class Process:
        returncode = 0

        async def wait(self):
            return 0

    async def launch(*args, **kwargs):
        directory = Path(
            next(
                arg.removeprefix("--user-data-dir=")
                for arg in args
                if arg.startswith("--user-data-dir=")
            )
        ).parent
        captured.append((directory / "notebook.html").read_text(encoding="utf-8"))
        (directory / "notebook.pdf").write_bytes(b"%PDF-1.7\n%%EOF")
        return Process()

    monkeypatch.setattr(pdf_export, "find_pdf_browser", lambda: "/browser")
    monkeypatch.setattr(pdf_export.asyncio, "create_subprocess_exec", launch)
    title = '课程 </title> & "笔记"'
    assert asyncio.run(pdf_export.render_pdf("<p>正文</p>", title=title)).startswith(
        b"%PDF-"
    )
    assert "<title>课程 &lt;/title&gt; &amp; &quot;笔记&quot;</title>" in captured[0]
    assert "<p>正文</p>" in captured[0]
