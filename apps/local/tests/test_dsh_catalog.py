"""模拟 DSH 的两阶段参数解析与进程退出，不启动 Harness 或调用模型。"""

import asyncio
from types import SimpleNamespace

import pytest

from solvemate_local.adapters import dsh_catalog
from solvemate_local.errors import ConnectionError


def test_catalog_launch_keeps_global_options_before_web_options_and_cleans_up(
    monkeypatch, tmp_path
):
    closed = []

    async def spawn(*argv, **kwargs):
        # 模拟 DSH：Web 参数之后的 --patch 会被 Web 解析器拒绝。
        valid = argv.index("--patch") < argv.index("--no-open")
        port = argv[argv.index("--port") + 1]
        stdout, stderr = asyncio.StreamReader(), asyncio.StreamReader()
        if valid:
            stdout.feed_data(f"dsh web: http://127.0.0.1:{port}/\n".encode())
        else:
            stderr.feed_data(b"error: unknown option '--patch'\n")
        stdout.feed_eof()
        stderr.feed_eof()
        child = SimpleNamespace(stdout=stdout, stderr=stderr, returncode=None)

        async def wait():
            child.returncode = 0 if valid else 1
            return child.returncode

        child.wait = wait
        return child

    async def stop(child, sig):
        closed.append(child)

    def read(url, port):
        return {
            "groups": [
                {"id": "test", "name": "Test", "models": [{"id": "m", "name": "Model"}]}
            ]
        }

    monkeypatch.setattr(dsh_catalog.asyncio, "create_subprocess_exec", spawn)
    monkeypatch.setattr(dsh_catalog, "stop_process_tree", stop)
    monkeypatch.setattr(dsh_catalog, "read_catalog", read)
    process = SimpleNamespace(
        executable=str(tmp_path / "dsh"),
        workspace=str(tmp_path),
        overlay_directory=None,
    )
    result = asyncio.run(dsh_catalog.catalog_options(process, tmp_path))
    assert result["models"][0]["name"] == "Model"
    assert len(closed) == 1


@pytest.mark.parametrize(
    ("diagnostic", "expected"),
    [
        (b"error: unknown option '--patch'", "启动参数 --patch"),
        (b"Error: EADDRINUSE", "端口被占用"),
        (b"Error: Cannot find module", "运行文件"),
        (b"Startup failed; token=private-value", "退出码 2"),
    ],
)
def test_startup_failure_reports_the_cause_without_exposing_raw_output(
    diagnostic, expected
):
    error = dsh_catalog.startup_failure(diagnostic, 2)
    assert isinstance(error, ConnectionError)
    assert expected in str(error)
    assert "private-value" not in str(error)
    assert "private-value" not in error.details
