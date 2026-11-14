"""恢复依据是原生会话结果；路径、检测会话和连接删除不替代这个判断。"""

import asyncio
import sys
from copy import deepcopy
from typing import ClassVar

import pytest
from test_adapters import FakeHermes, completed, question
from test_service import FakeAcp, FakeDshAdapter

from solvemate_local.adapters import AdapterRegistry
from solvemate_local.adapters.dsh import DshAcpAdapter as DshAdapter
from solvemate_local.adapters.hermes import HermesAdapter
from solvemate_local.errors import ConnectionError
from solvemate_local.models import ConnectionConfig, DetectRequest
from solvemate_local.service import AiService
from solvemate_local.store import Store


@pytest.fixture(params=["dsh", "hermes"])
def harness(request, monkeypatch, tmp_path):
    if request.param == "dsh":
        adapter, factory, model, env = (
            FakeDshAdapter(FakeAcp),
            FakeAcp,
            "opaque-model-a",
            "DSH_HOME",
        )
    else:
        adapter, factory, model, env = (
            HermesAdapter(FakeHermes),
            FakeHermes,
            "custom:school:c-model",
            "HERMES_HOME",
        )
    factory.calls, factory.sessions = [], set()
    monkeypatch.setenv(env, str(tmp_path / "old-home"))
    return adapter, factory, model, env


@pytest.mark.parametrize("delete_connection", [False, True])
@pytest.mark.parametrize("missing", [False, True])
def test_recover_original_session_after_program_and_home_change(
    harness, monkeypatch, tmp_path, delete_connection, missing
):
    adapter, factory, model, env = harness

    async def exercise():
        store = Store(tmp_path / "store")
        service = AiService(store, registry=AdapterRegistry([adapter]))
        try:
            config = ConnectionConfig(
                provider=adapter.provider, executablePath=sys.executable, model=model
            )
            await service.save_settings(config)
            first = question(connection=adapter.id, model=model)
            service.create_turn(first)
            original = deepcopy(await completed(service, first.id))
            sid = original["externalSessionId"]
            binding = store.binding(first.conversationId)
            assert original["status"] == "completed"
            if delete_connection:
                await service.delete_connection(
                    adapter.id,
                    store.connections()[adapter.id]["revision"],
                    store.preferences()["revision"],
                )
            await service.close()
            # 新连接可以访问搬迁后的同一份原生记录，旧路径已不再可用。
            new_program = str(tmp_path / "new-install" / "harness")
            monkeypatch.setattr(adapter, "resolve", lambda value="": new_program)
            monkeypatch.setenv(env, str(tmp_path / "new-home"))
            service = AiService(store, registry=AdapterRegistry([adapter]))
            await service.save_settings(
                config.model_copy(update={"executablePath": new_program})
            )
            if missing:
                factory.sessions.remove(sid)
            before = len(factory.calls)
            follow = question(connection=adapter.id, model=model)
            service.create_turn(follow)
            result = await completed(service, follow.id)
            calls = factory.calls[before:]
            assert calls[0][0] == (
                "session/resume" if adapter.id == "deepseek-local" else "session/load"
            )
            assert calls[0][1]["sessionId"] == sid
            assert calls[0][1]["cwd"] == binding["workspace"]
            assert not any(method == "session/new" for method, _ in calls)
            assert store.binding(first.conversationId)["external_id"] == sid
            assert store.turn(first.id) == original
            if missing:
                assert result["status"] == "failed"
                assert result["errorCode"] == "session_missing"
                assert not any(method == "session/prompt" for method, _ in calls)
                assert store.binding(first.conversationId)["state"] == "missing"
                factory.sessions.add(sid)
                retry = question(connection=adapter.id, model=model)
                service.create_turn(retry)
                result = await completed(service, retry.id)
            assert result["status"] == "completed"
            assert result["externalSessionId"] == sid
            assert store.binding(first.conversationId)["state"] == "bound"
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


def test_missing_connection_test_session_does_not_disable_formal_sessions(
    harness, tmp_path
):
    adapter, factory, model, _ = harness

    async def exercise():
        store = Store(tmp_path / "store")
        service = AiService(store, registry=AdapterRegistry([adapter]))
        try:
            config = ConnectionConfig(
                provider=adapter.provider, executablePath=sys.executable, model=model
            )
            await service.save_settings(config)
            request = question(connection=adapter.id, model=model)
            service.create_turn(request)
            first = await completed(service, request.id)
            await service.close()
            factory.sessions.intersection_update({first["externalSessionId"]})
            service = AiService(store, registry=AdapterRegistry([adapter]))
            saved = deepcopy(store.connections()[adapter.id])
            before = len(factory.calls)
            detection = DetectRequest(
                provider=adapter.provider,
                executablePath=saved["config"]["executablePath"],
                model=model,
            )
            if adapter.requires_probe_session:
                with pytest.raises(ConnectionError) as failed:
                    await service.probe(detection)
                assert failed.value.code == "probe_resume_failed"
                assert store.connections()[adapter.id] == saved
            else:
                assert (await service.probe(detection))["models"]
                assert (
                    store.db.execute("SELECT COUNT(*) FROM probes").fetchone()[0] == 0
                )
                actual = store.connections()[adapter.id]["config"]
                assert all(
                    actual[key] == saved["config"][key]
                    for key in ("provider", "executablePath", "model")
                )
            follow = question(connection=adapter.id, model=model)
            service.create_turn(follow)
            assert (await completed(service, follow.id))["status"] == "completed"
            assert not any(m == "session/new" for m, _ in factory.calls[before:])
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


@pytest.mark.parametrize(
    "code", ["process_stopped", "request_timeout", "harness_error"]
)
def test_probe_preserves_connection_failures_instead_of_reporting_missing_session(
    harness, monkeypatch, tmp_path, code
):
    adapter, factory, model, _ = harness

    async def exercise():
        store = Store(tmp_path / "store")
        service = AiService(store, registry=AdapterRegistry([adapter]))
        try:
            config = ConnectionConfig(
                provider=adapter.provider, executablePath=sys.executable, model=model
            )
            await service.save_settings(config)
            saved = deepcopy(store.connections()[adapter.id])
            original = factory.call

            async def failed(process, method, params, timeout=40):
                if method in {"session/resume", "session/load"}:
                    raise ConnectionError("Test connection failure.", code)
                return await original(process, method, params, timeout)

            if adapter.requires_probe_session:
                monkeypatch.setattr(factory, "call", failed)
            else:

                async def failed_catalog(process, selected):
                    raise ConnectionError("Test connection failure.", code)

                monkeypatch.setattr(adapter, "probe_options", failed_catalog)
            with pytest.raises(ConnectionError) as failure:
                await service.probe(
                    DetectRequest(
                        provider=adapter.provider,
                        executablePath=saved["config"]["executablePath"],
                        model=model,
                    )
                )
            assert failure.value.code == code
            assert store.connections()[adapter.id]["check"]["status"] == "error"
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


@pytest.mark.parametrize(
    ("native_error", "code"),
    [
        ("session is not resumable: original", "session_missing"),
        ("session cwd does not match: /original", "session_workspace_mismatch"),
        ("session is already active: original", "session_busy"),
        (
            'session "original" is already owned by an active write handle',
            "session_busy",
        ),
        ("Authentication required", "harness_error"),
    ],
)
@pytest.mark.parametrize("in_details", [False, True])
def test_dsh_distinguishes_native_restore_failures(native_error, code, in_details):
    class Process:
        capabilities: ClassVar[dict] = {"sessionCapabilities": {"resume": {}}}

        async def call(self, method, params):
            raise ConnectionError(
                "Harness 返回错误："
                + ("Internal error" if in_details else native_error),
                "harness_error",
                details=native_error if in_details else "",
            )

    with pytest.raises(ConnectionError) as failed:
        asyncio.run(DshAdapter().resume(Process(), "original", "/original"))
    assert failed.value.code == code


@pytest.mark.parametrize("previous_status", ["ready", "unknown", "error"])
def test_disable_enable_and_busy_probe_do_not_block_original_formal_session(
    harness, monkeypatch, tmp_path, previous_status
):
    adapter, factory, model, _ = harness

    async def exercise():
        store = Store(tmp_path / "store")
        service = AiService(store, registry=AdapterRegistry([adapter]))
        try:
            await service.save_settings(
                ConnectionConfig(
                    provider=adapter.provider,
                    executablePath=sys.executable,
                    model=model,
                )
            )
            first = question(connection=adapter.id, model=model)
            service.create_turn(first)
            original = deepcopy(await completed(service, first.id))
            probe = store.db.execute("SELECT session_id FROM probes").fetchone()
            probe_sid = probe[0] if probe else None
            for enabled in [False, True]:
                await service.set_connection_state(
                    adapter.id, enabled, store.connections()[adapter.id]["revision"]
                )
            store.record_connection_check(
                adapter.id,
                previous_status,
                "Old detection failure." if previous_status == "error" else None,
            )
            saved = deepcopy(store.connections()[adapter.id])
            request = DetectRequest(
                provider=adapter.provider,
                executablePath=saved["config"]["executablePath"],
                model=model,
            )
            original_call = factory.call

            async def busy_probe(process, method, params, timeout=40):
                if (
                    method in {"session/resume", "session/load"}
                    and params["sessionId"] == probe_sid
                ):
                    raise ConnectionError(
                        "Test session is open elsewhere.", "session_busy"
                    )
                return await original_call(process, method, params, timeout)

            before = len(factory.calls)
            monkeypatch.setattr(factory, "call", busy_probe)
            if adapter.requires_probe_session:
                with pytest.raises(ConnectionError) as failed:
                    await service.probe(request)
                assert failed.value.code == "probe_busy"
                assert adapter.name in str(failed.value)
                assert "关闭" in str(failed.value)
                assert "正式对话" not in str(failed.value)
            else:
                assert (await service.probe(request))["models"]
                assert probe_sid is None
            current = store.connections()[adapter.id]
            assert current["check"]["status"] == (
                "ready" if not adapter.requires_probe_session else previous_status
            )
            assert current["config"] == saved["config"]
            assert current["detection"] == saved["detection"]
            if previous_status == "error" and adapter.requires_probe_session:
                with pytest.raises(ConnectionError) as unavailable:
                    service.create_turn(question(connection=adapter.id, model=model))
                assert unavailable.value.code == "connection_unavailable"
            monkeypatch.setattr(factory, "call", original_call)
            assert (await service.probe(request))["models"]
            assert store.connections()[adapter.id]["check"]["status"] == "ready"
            follow = question(connection=adapter.id, model=model)
            service.create_turn(follow)
            result = await completed(service, follow.id)
            assert result["status"] == "completed"
            assert result["externalSessionId"] == original["externalSessionId"]
            assert store.turn(first.id) == original
            assert not any(
                method == "session/new" for method, _ in factory.calls[before:]
            )
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


@pytest.mark.parametrize(
    ("result", "code"),
    [
        ({}, "session_missing"),
        (None, "session_missing"),
        ({"unexpected": True}, "session_invalid"),
        (
            {"sessionId": "different", "models": {"currentModelId": "one"}},
            "binding_mismatch",
        ),
    ],
)
def test_hermes_rejects_missing_invalid_or_different_session(result, code):
    class Process:
        capabilities: ClassVar[dict] = {"loadSession": True}

        async def call(self, method, params):
            assert method == "session/load"
            return result

    with pytest.raises(ConnectionError) as failed:
        asyncio.run(HermesAdapter().resume(Process(), "original", "/original"))
    assert failed.value.code == code
