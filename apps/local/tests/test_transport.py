"""用真实 Python 子进程检查协议读写，各平台均不依赖 Harness 或模型账号。"""

import asyncio
import os
import sys
from pathlib import Path

import pytest

from solvemate_local import acp, transport
from solvemate_local.acp import AcpProcess, ConnectionError

AGENT = """
import json
import os
import sys

def send(value):
    sys.stdout.buffer.write((json.dumps(value, ensure_ascii=False) + "\\n").encode("utf-8"))
    sys.stdout.buffer.flush()

for raw in sys.stdin.buffer:
    request = json.loads(raw)
    method = request.get("method")
    result = {}
    if method == "initialize":
        result = {"protocolVersion": 1, "agentCapabilities": {"sessionCapabilities": {"resume": {}}}}
    elif method == "session/new":
        result = {"sessionId": "session-中文"}
    elif method == "session/prompt":
        text = request["params"]["prompt"][0]["text"]
        send({"jsonrpc": "2.0", "method": "session/update", "params": {
            "sessionId": "session-中文", "update": {
                "sessionUpdate": "agent_message_chunk", "content": {"type": "text", "text": "收到：" + text}
            }
        }})
        result = {"stopReason": "end_turn"}
    elif method == "test/disconnect":
        os._exit(0)
    elif method == "test/wait":
        continue
    elif method == "test/corrupt":
        sys.stdout.buffer.write(b"[]\\n")
        sys.stdout.buffer.flush()
        continue
    elif method == "test/error":
        send({"jsonrpc": "2.0", "id": request["id"], "error": {
            "code": -32603, "message": "Internal error", "data": request["params"].get("data")
        }})
        continue
    send({"jsonrpc": "2.0", "id": request["id"], "result": result})
"""


def client_at(directory, updates=None):
    directory.mkdir()
    # Python 将 acp 参数作为脚本路径，实际执行与生产环境相同的参数数组启动流程。
    (directory / "acp").write_text(AGENT, encoding="utf-8")
    return AcpProcess(
        sys.executable, str(directory), updates, harness_home=directory / "home"
    )


def test_real_subprocess_unicode_protocol_and_shutdown(tmp_path):
    async def exercise():
        updates = []
        client = client_at(tmp_path / "中文 path", updates.append)
        try:
            await client.start()
            session = await client.call("session/new", {"cwd": str(tmp_path)})
            assert session["sessionId"] == "session-中文"
            result = await client.call(
                "session/prompt",
                {
                    "sessionId": session["sessionId"],
                    "prompt": [{"type": "text", "text": "为什么是 2.0？"}],
                },
            )
            assert result["stopReason"] == "end_turn"
            assert updates[0]["update"]["content"]["text"] == "收到：为什么是 2.0？"
        finally:
            await client.close()
        assert client.process.returncode == 0
        assert client.reader_task.done()
        assert client.stderr_task.done()

    asyncio.run(exercise())


def test_subprocess_timeout_and_disconnect_fail_pending_request(tmp_path):
    async def exercise():
        client = client_at(tmp_path / "agent")
        try:
            await client.start()
            with pytest.raises(ConnectionError) as timeout:
                await client.call("test/wait", {}, timeout=0.05)
            assert timeout.value.code == "request_timeout"
            with pytest.raises(ConnectionError) as disconnect:
                await client.call("test/disconnect", {})
            assert disconnect.value.code == "process_stopped"
            assert not client.pending
        finally:
            await client.close()

    asyncio.run(exercise())


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        (
            {
                "details": 'session "original" is already owned by an active write handle'
            },
            'session "original" is already owned by an active write handle',
        ),
        ({"details": "api_key=private-value"}, "api_key=[redacted]"),
        ({"details": {"password": "private-value"}}, ""),
        ("private-value", ""),
        (None, ""),
    ],
)
def test_rpc_error_keeps_safe_details_for_adapter_without_exposing_them(
    tmp_path, data, expected
):
    async def exercise():
        client = client_at(tmp_path / "agent")
        try:
            await client.start()
            with pytest.raises(ConnectionError) as failed:
                await client.call("test/error", {"data": data})
            assert failed.value.code == "harness_error"
            assert failed.value.details == expected
            assert str(failed.value) == "Harness 返回错误：Internal error"
            assert not client.pending
        finally:
            await client.close()

    asyncio.run(exercise())


@pytest.mark.parametrize("fails_to_start", [False, True])
def test_provider_patch_is_private_and_removed_after_close_or_start_failure(
    monkeypatch, tmp_path, fails_to_start
):
    async def overlay(*args):
        return '[{"id":"llm-pi-ai","config":{"providers":{"custom":{}}}}]'

    monkeypatch.setattr(acp, "desktop_overlay", overlay)
    patches = []
    spawn = asyncio.create_subprocess_exec

    async def capture(*argv, **kwargs):
        patch = Path(argv[argv.index("--patch") + 1])
        assert patch.is_file()
        assert not patch.is_relative_to(tmp_path)
        if os.name != "nt":
            assert patch.stat().st_mode & 0o777 == 0o600
        patches.append(patch)
        if fails_to_start:
            raise OSError("Synthetic launch failure")
        return await spawn(*argv, **kwargs)

    monkeypatch.setattr(transport.asyncio, "create_subprocess_exec", capture)

    async def exercise():
        client = client_at(tmp_path / "中文 path")
        try:
            if fails_to_start:
                with pytest.raises(OSError):
                    await client.start()
                assert not patches[0].exists()
            else:
                await client.start()
                assert patches[0].exists()
        finally:
            await client.close()
        assert not patches[0].parent.exists()

    asyncio.run(exercise())


def test_running_child_with_a_stopped_reader_is_not_reused(tmp_path):
    async def exercise():
        client = client_at(tmp_path / "corrupt")
        try:
            await client.start()
            assert client.is_running()
            with pytest.raises(ConnectionError):
                await client.call("test/corrupt", {})
            assert client.process.returncode is None
            assert not client.is_running()
        finally:
            await client.close()

    asyncio.run(exercise())
