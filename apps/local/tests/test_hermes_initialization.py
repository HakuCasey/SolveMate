"""创建时使用所选模型；读取目录、失败和恢复不能隐式创建默认模型会话。"""

import asyncio
import sys
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest
from test_adapters import FakeHermes, completed, question
from test_service import fake_registry

from solvemate_local.adapters import hermes_gateway
from solvemate_local.adapters.hermes import HermesAdapter, HermesProcess
from solvemate_local.errors import ConnectionError
from solvemate_local.models import ConnectionConfig, DetectRequest
from solvemate_local.service import AiService
from solvemate_local.store import Store


@pytest.fixture(autouse=True)
def isolated(monkeypatch, tmp_path):
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "hermes"))
    FakeHermes.calls, FakeHermes.sessions = [], set()


def install_sdk(monkeypatch, client, parse=None):
    @asynccontextmanager
    async def connect():
        yield client

    monkeypatch.setitem(
        sys.modules,
        "hermes_cli.gateway_client",
        SimpleNamespace(connect_gateway=connect),
    )
    monkeypatch.setitem(
        sys.modules,
        "hermes_cli.models",
        SimpleNamespace(
            parse_model_input=parse or (lambda raw, _: ("custom:school", "c-model"))
        ),
    )


def test_native_create_supplies_model_provider_and_acp_policy_before_initialization(
    monkeypatch,
):
    calls = []

    class Client:
        async def rpc(self, method, **params):
            calls.append((method, params))
            if method == "runtime.describe":
                return {
                    "session_create": {"sources": ["acp"]},
                    "capabilities": ["acp-editor-policy-v1"],
                }
            assert method == "session.create"
            assert params["model"] == "c-model"
            assert params["provider"] == "custom:school"
            assert params["source"] == "acp"
            assert params["editor"]["edit_approval_policy"] == "ask"
            return {"session_id": "native-selected"}

    install_sdk(monkeypatch, Client())
    result = asyncio.run(
        hermes_gateway._native(
            {
                "operation": "create",
                "model": "custom:school:c-model",
                "workspace": "/workspace",
                "requestId": "one-request",
            }
        )
    )
    assert result == {"sessionId": "native-selected"}
    assert [method for method, _ in calls] == ["runtime.describe", "session.create"]
    assert calls[-1][1]["request_id"] == "one-request"


def test_unsupported_native_api_does_not_fall_back_to_default_model(monkeypatch):
    class Client:
        async def rpc(self, method, **params):
            assert method == "runtime.describe"
            return {}

    install_sdk(monkeypatch, Client())
    assert asyncio.run(hermes_gateway._native({"operation": "create"})) == {
        "error": "hermes_sdk_unavailable"
    }


def test_catalog_reads_inventory_without_constructing_or_connecting_a_session(
    monkeypatch,
):
    def connect():
        raise AssertionError("Inventory must not create a Gateway session")

    monkeypatch.setitem(
        sys.modules,
        "hermes_cli.gateway_client",
        SimpleNamespace(connect_gateway=connect),
    )
    config = {
        "model": {"provider": "nous", "default": "free-default"},
        "agent": {"reasoning_effort": "medium"},
    }
    monkeypatch.setitem(
        sys.modules, "hermes_cli.config", SimpleNamespace(load_config=lambda: config)
    )
    monkeypatch.setitem(
        sys.modules,
        "hermes_cli.models",
        SimpleNamespace(
            parse_model_input=lambda model, _: ("custom:school", "c-model")
        ),
    )
    monkeypatch.setitem(
        sys.modules,
        "hermes_constants",
        SimpleNamespace(VALID_REASONING_EFFORTS=("low", "medium", "high")),
    )

    class Inventory:
        def model_dump(self, **kwargs):
            assert kwargs == {"by_alias": True}
            return {
                "currentModelId": "custom:school:c-model",
                "availableModels": [
                    {"modelId": "custom:school:c-model", "name": "C Model"}
                ],
            }

    def inventory(model, provider, base_url):
        assert (model, provider, base_url) == ("c-model", "custom:school", "")
        return Inventory()

    monkeypatch.setitem(
        sys.modules,
        "acp_adapter.model_catalog",
        SimpleNamespace(build_model_state=inventory),
    )
    result = asyncio.run(
        hermes_gateway._native(
            {"operation": "catalog", "model": "custom:school:c-model"}
        )
    )
    assert result["currentReasoning"] == "medium"
    assert result["models"]["currentModelId"] == "custom:school:c-model"
    assert config["model"] == {"provider": "nous", "default": "free-default"}


def test_creation_load_failure_retains_known_id_and_recovery_does_not_create_again(
    tmp_path,
):
    class LoadOnceFails(FakeHermes):
        fail = True

        async def call(self, method, params, timeout=40):
            if method == "session/load" and self.fail:
                type(self).fail = False
                raise ConnectionError("暂时无法加载。", "session_busy")
            return await super().call(method, params, timeout)

    async def exercise():
        store = Store(tmp_path)
        service = AiService(store, registry=fake_registry(LoadOnceFails))
        try:
            await service.save_settings(
                ConnectionConfig(
                    provider="hermes",
                    executablePath=sys.executable,
                    model="custom:school:c-model",
                )
            )
            req = question("selected-model-recovery")
            service.create_turn(req)
            first = await completed(service, req.id)
            assert first["errorCode"] == "session_busy"
            sid = store.binding(req.conversationId)["external_id"]
            assert sid and first["externalSessionId"] == sid
            assert not any(method == "session/new" for method, _ in FakeHermes.calls)
            created = [
                params
                for method, params in FakeHermes.calls
                if method == "gateway/session.create"
            ]
            assert len(created) == 1 and created[0]["model"] == req.model
            follow = question("selected-model-recovery")
            service.create_turn(follow)
            last = await completed(service, follow.id)
            assert last["status"] == "completed" and last["externalSessionId"] == sid
            assert (
                len([m for m, _ in FakeHermes.calls if m == "gateway/session.create"])
                == 1
            )
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


def test_detection_never_creates_session_even_without_selected_model(tmp_path):
    async def exercise():
        store = Store(tmp_path)
        service = AiService(store, registry=fake_registry(FakeHermes))
        try:
            for model in ("", "custom:school:c-model", "custom:school:other"):
                result = await service.probe(
                    DetectRequest(
                        provider="hermes", executablePath=sys.executable, model=model
                    )
                )
                assert result["models"]
            assert not FakeHermes.sessions
            assert not any(
                method
                in {
                    "session/new",
                    "session/load",
                    "gateway/session.create",
                    "session/prompt",
                }
                for method, _ in FakeHermes.calls
            )
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


def test_missing_selected_model_is_rejected_without_native_calls():
    async def exercise():
        process = FakeHermes(sys.executable, "/workspace")
        with pytest.raises(ConnectionError) as error:
            await HermesAdapter().new_session(process, "/workspace")
        assert error.value.code == "model_missing"
        assert not FakeHermes.calls

    asyncio.run(exercise())


def test_process_rejects_unsupported_sdk_before_creating_any_binding(monkeypatch):
    from solvemate_local.transport import AcpTransport

    async def start(self):
        self.capabilities = {"loadSession": True}
        return {"protocolVersion": 1}

    async def request(self, operation, **payload):
        assert operation == "check"
        raise ConnectionError("请更新 Hermes。", "hermes_sdk_unavailable")

    monkeypatch.setattr(AcpTransport, "start", start)
    monkeypatch.setattr(HermesProcess, "native_request", request)
    with pytest.raises(ConnectionError) as error:
        asyncio.run(HermesProcess("hermes", "/workspace").start())
    assert error.value.code == "hermes_sdk_unavailable"


def test_missing_load_capability_rejects_creation_before_native_call():
    async def exercise():
        process = FakeHermes(sys.executable, "/workspace")
        with pytest.raises(ConnectionError) as error:
            await HermesAdapter().new_session(
                process, "/workspace", "custom:school:c-model"
            )
        assert error.value.code == "resume_unsupported"
        assert not FakeHermes.calls

    asyncio.run(exercise())
