"""原生改名只处理已绑定的编号，不发起提问或创建替代会话。"""

import asyncio
import sys
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from test_service import HEADERS, FakeAcp, FakeDshAdapter, connect

from solvemate_local.adapters import AdapterRegistry
from solvemate_local.adapters.codex import CodexAdapter
from solvemate_local.adapters.dsh import DshAdapter
from solvemate_local.adapters.hermes import HermesAdapter
from solvemate_local.errors import ConnectionError
from solvemate_local.main import create_app
from solvemate_local.models import ConnectionConfig, SessionRename
from solvemate_local.service import AiService
from solvemate_local.store import Store


@pytest.fixture(autouse=True)
def isolated_harness(monkeypatch, tmp_path):
    monkeypatch.setenv("DSH_HOME", str(tmp_path / "dsh"))
    FakeAcp.calls = []
    FakeAcp.sessions = set()


class RenamingAdapter(FakeDshAdapter):
    supports_rename = True

    def __init__(self):
        super().__init__(FakeAcp)
        self.names = []
        self.failure = None
        self.started = asyncio.Event()
        self.release = None

    async def rename_session(self, executable, sid, title, workspace):
        self.started.set()
        if self.release:
            await self.release.wait()
        if self.failure:
            raise self.failure
        self.names.append((sid, title))


def bind(store, workspace, external_id="native-id"):
    store.bind("conversation", external_id, "old-path", str(workspace))


def test_http_rename_uses_server_binding_and_preserves_records(tmp_path):
    adapter = RenamingAdapter()
    app = create_app(tmp_path, registry=AdapterRegistry([adapter]))
    with TestClient(app, headers=HEADERS) as client:
        connect(client)
        store = app.state.ai.store
        client.portal.call(bind, store, tmp_path / "no-longer-exists")
        original = client.portal.call(store.binding, "conversation")
        request = {
            "title": "  C 语言指针讨论  ",
            "connectionId": adapter.id,
            "externalSessionId": "native-id",
        }
        path = "/local-api/v1/conversations/conversation/native-title"
        response = client.put(path, json=request)
        assert response.status_code == 200, response.text
        assert response.json() == {"status": "synced"}
        assert adapter.names == [("native-id", "C 语言指针讨论")]
        assert client.portal.call(store.binding, "conversation") == original
        for field, value in [
            ("externalSessionId", "other-id"),
            ("connectionId", "other"),
        ]:
            response = client.put(path, json={**request, field: value})
            assert response.json()["code"] == (
                "binding_missing" if field == "connectionId" else "binding_mismatch"
            )
        assert len(adapter.names) == 1
        for title in [" ", "line\nbreak", "a" * 101, "nul\0value"]:
            assert client.put(path, json={**request, "title": title}).status_code == 422
        adapter.failure = ConnectionError("原会话不存在。", "session_missing")
        response = client.put(path, json=request)
        assert response.json()["code"] == "session_missing"
        assert client.portal.call(store.binding, "conversation") == original
        adapter.failure = None
        assert client.put(path, json=request).json()["status"] == "synced"
        assert not app.state.ai.renaming
        assert not any(method == "session/prompt" for method, _ in FakeAcp.calls)


def test_dsh_reports_unsupported_without_starting_or_changing_native_session(tmp_path):
    app = create_app(tmp_path, registry=AdapterRegistry([DshAdapter(FakeAcp)]))
    with TestClient(app, headers=HEADERS) as client:
        client.portal.call(bind, app.state.ai.store, tmp_path)
        response = client.put(
            "/local-api/v1/conversations/conversation/native-title",
            json={
                "title": "学习讨论",
                "connectionId": "deepseek-local",
                "externalSessionId": "native-id",
            },
        )
        assert response.json() == {"status": "unsupported"}
        assert DshAdapter().public_capabilities({})["rename"] == "unsupported"


def test_rename_rejects_missing_binding_disabled_connection_and_concurrent_writes(
    tmp_path,
):
    async def scenario():
        adapter = RenamingAdapter()
        store = Store(tmp_path)
        service = AiService(store, registry=AdapterRegistry([adapter]))
        request = SessionRename(
            title="学习讨论", connectionId=adapter.id, externalSessionId="native-id"
        )
        try:
            with pytest.raises(ConnectionError, match="未保存"):
                await service.rename_session("conversation", request)
            await service.save_settings(
                ConnectionConfig(executablePath=sys.executable, model="opaque-model-a")
            )
            bind(store, tmp_path)
            service.jobs["turn"] = {"conversationId": "conversation"}
            with pytest.raises(ConnectionError) as error:
                await service.rename_session("conversation", request)
            assert error.value.code == "conversation_busy"
            service.jobs.clear()
            saved = store.connections()[adapter.id]
            await service.set_connection_state(adapter.id, False, saved["revision"])
            with pytest.raises(ConnectionError) as error:
                await service.rename_session("conversation", request)
            assert error.value.code == "connection_disabled"
            await service.set_connection_state(
                adapter.id, True, store.connections()[adapter.id]["revision"]
            )
            adapter.release = asyncio.Event()
            pending = asyncio.create_task(
                service.rename_session("conversation", request)
            )
            await adapter.started.wait()
            with pytest.raises(ConnectionError) as error:
                await service.rename_session("conversation", request)
            assert error.value.code == "conversation_busy"
            with pytest.raises(ConnectionError) as error:
                await service.delete_connection(
                    adapter.id,
                    store.connections()[adapter.id]["revision"],
                    store.preferences()["revision"],
                )
            assert error.value.code == "connection_busy"
            adapter.release.set()
            assert await pending == {"status": "synced"}
            assert not service.renaming
        finally:
            await service.close()
            store.close()

    asyncio.run(scenario())


def test_codex_rename_only_calls_name_set_and_closes_on_failure():
    # 只使用替代进程对象，不查找或执行 Codex 程序。
    class Process:
        def __init__(self, *args):
            self.calls = []
            self.closed = False
            self.failure = None

        async def start(self):
            self.calls.append("initialize")

        async def call(self, method, params):
            self.calls.append((method, params))
            if self.failure:
                raise self.failure
            return {}

        async def close(self):
            self.closed = True

    async def scenario():
        process = Process()
        adapter = CodexAdapter(lambda *args: process)
        await adapter.rename_session("unused", "native-id", "学习讨论", "unused")
        assert process.calls == [
            "initialize",
            ("thread/name/set", {"threadId": "native-id", "name": "学习讨论"}),
        ]
        assert process.closed
        process.closed = False
        process.failure = ConnectionError("Method not found", "harness_error")
        with pytest.raises(ConnectionError) as error:
            await adapter.rename_session("unused", "native-id", "学习讨论", "unused")
        assert error.value.code == "rename_unsupported"
        assert process.closed

    asyncio.run(scenario())


@pytest.mark.parametrize("outcome", ["success", "failure", "timeout"])
def test_hermes_cli_rename_uses_literal_arguments_and_cleans_up(
    monkeypatch, tmp_path, outcome
):
    calls = []
    process = SimpleNamespace(returncode=None)

    async def wait():
        if process.returncode is not None:
            return process.returncode
        if outcome == "timeout":
            raise TimeoutError
        process.returncode = 0 if outcome == "success" else 1
        return process.returncode

    def kill():
        process.returncode = -9

    process.wait, process.kill = wait, kill

    async def launch(*args, **kwargs):
        calls.append((args, kwargs))
        return process

    monkeypatch.setattr(asyncio, "create_subprocess_exec", launch)
    monkeypatch.setenv("HERMES_HOME", str(tmp_path))

    async def scenario():
        adapter = HermesAdapter()
        action = adapter.rename_session(
            "hermes.exe", "native-id", "-讨论 $(not-a-command)", str(tmp_path)
        )
        if outcome == "success":
            await action
        else:
            with pytest.raises(ConnectionError) as error:
                await action
            assert error.value.code == (
                "request_timeout" if outcome == "timeout" else "rename_failed"
            )
        assert process.returncode is not None
        assert calls[0][0] == (
            "hermes.exe",
            "sessions",
            "rename",
            "native-id",
            "--",
            "-讨论 $(not-a-command)",
        )
        assert calls[0][1]["env"]["HERMES_HOME"] == str(tmp_path)

    asyncio.run(scenario())
