"""验证系统差异不影响调用方式；不运行真实 Harness。"""

import asyncio
import signal
import sys
from types import SimpleNamespace

import pytest

from solvemate_local import processes


def test_managed_process_can_be_stopped_on_the_current_system(tmp_path):
    async def exercise():
        script = tmp_path / "中文 path.py"
        script.write_text(
            "import sys, time\nsys.stdout.write('ready\\n')\n"
            "sys.stdout.flush()\ntime.sleep(60)\n",
            encoding="utf-8",
        )
        child = await asyncio.create_subprocess_exec(
            sys.executable,
            str(script),
            stdout=asyncio.subprocess.PIPE,
            **processes.process_options(),
        )
        try:
            assert await asyncio.wait_for(child.stdout.readline(), 5) == b"ready\n"
            await asyncio.wait_for(
                processes.stop_process_tree(child, signal.SIGTERM), 5
            )
            await asyncio.wait_for(child.wait(), 5)
            assert child.returncode is not None
        finally:
            if child.returncode is None:
                child.kill()
                await child.wait()

    asyncio.run(exercise())


@pytest.mark.parametrize("error", [None, ProcessLookupError, PermissionError])
def test_posix_stop_uses_the_owned_group_and_reports_permission_failure(
    monkeypatch, error
):
    monkeypatch.setattr(processes.sys, "platform", "darwin")
    signals = []

    def killpg(pid, sig):
        signals.append((pid, sig))
        if error:
            raise error

    monkeypatch.setattr(processes.os, "killpg", killpg, raising=False)
    action = processes.stop_process_tree(SimpleNamespace(pid=12345), signal.SIGTERM)
    if error is PermissionError:
        with pytest.raises(PermissionError):
            asyncio.run(action)
    else:
        asyncio.run(action)
    assert signals == [(12345, signal.SIGTERM)]


@pytest.mark.parametrize("missing", [False, True])
def test_windows_stop_targets_only_the_owned_tree_and_reports_missing_command(
    monkeypatch, missing
):
    monkeypatch.setattr(processes.sys, "platform", "win32")
    calls = []
    waited = []

    async def wait():
        waited.append(True)
        return 0

    async def start(*args, **kwargs):
        calls.append((args, kwargs))
        if missing:
            raise FileNotFoundError("taskkill unavailable")
        return SimpleNamespace(wait=wait)

    monkeypatch.setattr(processes.asyncio, "create_subprocess_exec", start)
    action = processes.stop_process_tree(SimpleNamespace(pid=12345), signal.SIGTERM)
    if missing:
        with pytest.raises(FileNotFoundError):
            asyncio.run(action)
    else:
        asyncio.run(action)
    assert calls[0][0] == ("taskkill", "/PID", "12345", "/T", "/F")
    assert "shell" not in calls[0][1]
    assert bool(waited) is not missing
