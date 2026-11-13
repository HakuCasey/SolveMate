"""推理等级只写原生会话；兼容入口、恢复、异常与进程清理。"""

import asyncio
import json
import sys
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest

from solvemate_local.adapters import hermes_reasoning as bridge
from solvemate_local.adapters.hermes import HermesAdapter
from solvemate_local.errors import ConnectionError


def options(value="medium"):
    return {
        "reasoningOptions": [
            {"value": x, "name": x, "group": ""} for x in ("medium", "high")
        ],
        "currentReasoning": value,
    }


@pytest.mark.parametrize("python", ["/目录 有空格/python", "C:\\程序 目录\\python.exe"])
def test_runtime_keeps_native_bootstrap_and_separate_helper_argument(python):
    raw = json.dumps(
        [
            python,
            "-I",
            "-c",
            "import sys, runpy; sys.path.insert(0, 'vendor'); import hermes_bootstrap; runpy.run_module('site', run_name='__main__', alter_sys=True)",
        ]
    )
    result = bridge.runtime_command(raw, "/helper 路径/control.py")
    assert result[:3] == [python, "-I", "-c"]
    assert "import hermes_bootstrap" in result[3]
    assert "runpy.run_path(sys.argv[1]" in result[3]
    assert result[4] == "/helper 路径/control.py"


@pytest.mark.parametrize(
    "raw", ["{}", '["python", "-c", "pass"]', '["python", "-I", "-c", "exec(unknown)"]']
)
def test_unknown_runtime_format_is_rejected(raw):
    with pytest.raises(ValueError):
        bridge.runtime_command(raw, "/helper.py")


def test_native_sdk_modifies_only_original_session_and_reads_back(monkeypatch):
    calls = []
    effort = "medium"

    class Client:
        async def rpc(self, method, **params):
            calls.append((method, params))
            assert params["session_id"] == "original-session"
            return {"value": effort}

    @asynccontextmanager
    async def connect():
        yield Client()

    class Mutations:
        async def apply(self, client, sid, operation, payload):
            nonlocal effort
            assert sid == "original-session" and operation == "reasoning"
            effort = payload["effort"]

    monkeypatch.setitem(
        sys.modules,
        "hermes_cli.gateway_client",
        SimpleNamespace(connect_gateway=connect),
    )
    monkeypatch.setitem(
        sys.modules,
        "hermes_cli.gateway_mutations",
        SimpleNamespace(PreparedMutations=Mutations),
    )
    monkeypatch.setitem(
        sys.modules,
        "hermes_constants",
        SimpleNamespace(VALID_REASONING_EFFORTS=("medium", "high")),
    )
    result = asyncio.run(
        bridge._native({"sessionId": "original-session", "value": "high"})
    )
    assert result["currentReasoning"] == "high"
    assert [x[0] for x in calls] == ["session.info", "config.get"]
    assert not any(x[0] == "config.set" for x in calls)


def test_legacy_adapter_restores_same_session_and_reapplies_reasoning(monkeypatch):
    calls = []

    async def control(process, sid, value=None):
        calls.append((sid, value))
        return options(value or "medium")

    from solvemate_local.adapters import hermes

    monkeypatch.setattr(hermes, "session_reasoning", control)

    class Process:
        def __init__(self):
            self.capabilities = {"loadSession": True}

        async def call(self, method, params):
            assert method in {"session/load", "session/set_model"}
            return {
                "models": {
                    "currentModelId": "model",
                    "availableModels": [{"modelId": "model"}],
                }
            }

    async def exercise():
        adapter, process = HermesAdapter(), Process()
        session = await adapter.resume(process, "original", "/workspace")
        assert session.id == "original"
        await adapter.select_model(process, session.id, "model", session)
        await adapter.select_reasoning(process, session.id, "high")
        assert process.session_options["original"]["currentReasoning"] == "high"
        # 新进程恢复后再次按 SolveMate 中的配置设置，不依赖旧进程缓存。
        restored = Process()
        await adapter.resume(restored, "original", "/workspace")
        await adapter.select_reasoning(restored, "original", "high")

    asyncio.run(exercise())
    assert calls == [
        ("original", None),
        ("original", "high"),
        ("original", None),
        ("original", "high"),
    ]


def test_sidecar_must_confirm_selected_value(monkeypatch):
    async def run(*args, **kwargs):
        return json.dumps(options("medium"))

    monkeypatch.setattr(bridge, "_run", run)
    with pytest.raises(ConnectionError) as caught:
        asyncio.run(
            bridge.session_reasoning(
                SimpleNamespace(reasoning_command=["fake"]), "original", "high"
            )
        )
    assert caught.value.code == "reasoning_unavailable"


@pytest.mark.parametrize("failure", [TimeoutError, asyncio.CancelledError])
def test_timeout_and_cancellation_close_owned_sidecar(monkeypatch, failure):
    from solvemate_local import processes

    killed = []

    class Child:
        returncode = None

        async def communicate(self, request):
            raise failure()

        async def wait(self):
            self.returncode = -1

    child = Child()

    async def start(*args, **kwargs):
        assert kwargs.get("shell") is None
        return child

    async def stop(process, sig):
        killed.append(process)

    monkeypatch.setattr(bridge.asyncio, "create_subprocess_exec", start)
    monkeypatch.setattr(processes, "stop_process_tree", stop)
    with pytest.raises(
        ConnectionError if failure is TimeoutError else asyncio.CancelledError
    ):
        asyncio.run(bridge._run(["fake"], {}))
    assert killed == [child]
    assert child.returncode == -1


def test_option_read_failure_keeps_registered_session_for_retry(monkeypatch, tmp_path):
    from test_adapters import FakeHermes
    from test_service import fake_registry

    from solvemate_local.adapters import hermes
    from solvemate_local.models import DetectRequest
    from solvemate_local.service import AiService
    from solvemate_local.store import Store

    fail = True

    class Legacy(FakeHermes):
        async def call(self, method, params, timeout=40):
            result = await super().call(method, params, timeout)
            result.pop("configOptions", None)
            return result

    async def control(process, sid, value=None):
        if fail:
            raise ConnectionError("暂时无法读取会话配置。", "reasoning_unavailable")
        return options()

    monkeypatch.setattr(hermes, "session_reasoning", control)

    async def exercise():
        nonlocal fail
        store = Store(tmp_path)
        service = AiService(store, registry=fake_registry(Legacy))
        try:
            request = DetectRequest(provider="hermes", executablePath=sys.executable)
            before = len([m for m, _ in Legacy.calls if m == "session/new"])
            with pytest.raises(ConnectionError):
                await service.probe(request)
            fail = False
            await service.probe(request)
            assert len([m for m, _ in Legacy.calls if m == "session/new"]) == before + 1
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


@pytest.mark.parametrize("confirmed", [True, False])
def test_acp_reasoning_uses_native_option_and_requires_confirmation(
    monkeypatch, confirmed
):
    from test_adapters import FakeHermes

    from solvemate_local.adapters import hermes

    async def forbidden(*args):
        raise AssertionError("Native ACP must not launch compatibility control")

    monkeypatch.setattr(hermes, "session_reasoning", forbidden)

    class Native(FakeHermes):
        async def call(self, method, params, timeout=40):
            result = await super().call(method, params, timeout)
            if method == "session/set_config_option" and not confirmed:
                result["configOptions"][0]["currentValue"] = "medium"
            return result

    async def exercise():
        adapter = HermesAdapter()
        process = Native(sys.executable, "/workspace")
        session = await adapter.new_session(process, "/workspace")
        session = await adapter.inspect_session(process, session)
        assert all(
            model["reasoningOptions"] == session.options["reasoningOptions"]
            for model in session.options["models"]
        )
        await adapter.select_model(
            process, session.id, "custom:school:c-model", session
        )
        if confirmed:
            await adapter.select_reasoning(process, session.id, "high")
            assert process.session_options[session.id]["currentReasoning"] == "high"
        else:
            with pytest.raises(ConnectionError) as failed:
                await adapter.select_reasoning(process, session.id, "high")
            assert failed.value.code == "reasoning_unavailable"
            assert process.session_options[session.id]["currentReasoning"] == "medium"
        with pytest.raises(ConnectionError) as failed:
            await adapter.select_reasoning(process, session.id, "unsupported")
        assert failed.value.code == "reasoning_unsupported"

    asyncio.run(exercise())
