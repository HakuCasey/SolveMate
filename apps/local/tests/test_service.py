import asyncio
import io
import sys
from time import sleep
from types import SimpleNamespace
from typing import ClassVar
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from pypdf import PdfWriter

from solvemate_local.acp import ConnectionError, launch_spec, safe_error
from solvemate_local.adapters import AdapterRegistry
from solvemate_local.adapters.base import acp_update
from solvemate_local.adapters.dsh import DshAdapter
from solvemate_local.adapters.hermes import HermesAdapter
from solvemate_local.main import create_app
from solvemate_local.store import Store

HEADERS = {"origin": "http://127.0.0.1:4173", "x-solvemate-client": "web"}
MODELS = [
    {
        "id": "model",
        "type": "select",
        "name": "Model",
        "currentValue": "opaque-model-a",
        "options": [
            {
                "group": "vendor",
                "name": "Test provider",
                "options": [
                    {"value": "opaque-model-a", "name": "Model A"},
                    {"value": "opaque-model-b", "name": "Model B"},
                ],
            }
        ],
    },
    {
        "id": "reasoning_effort",
        "type": "select",
        "name": "Reasoning",
        "currentValue": "off",
        "options": [{"value": "off", "name": "Off"}],
    },
]


class FakeAcp:
    calls: ClassVar[list] = []
    sessions: ClassVar[set] = set()

    def __init__(
        self,
        executable,
        workspace,
        on_update=None,
        on_permission=None,
        *,
        harness_home=None,
    ):
        self.executable, self.workspace = executable, workspace
        self.on_update, self.on_permission = on_update, on_permission
        self.process = SimpleNamespace(returncode=None)
        self.capabilities = {"sessionCapabilities": {"resume": {}}}
        self.waiters = {}

    def is_running(self):
        return self.process.returncode is None

    async def start(self):
        return {"protocolVersion": 1, "agentCapabilities": self.capabilities}

    async def call(self, method, params, timeout=40):
        self.calls.append((method, params))
        if method == "session/new":
            sid = str(uuid4())
            self.sessions.add(sid)
            return {"sessionId": sid, "configOptions": MODELS}
        if method == "session/resume":
            if params["sessionId"] not in self.sessions:
                raise ConnectionError(
                    "Harness 返回错误：session is not resumable: "
                    + params["sessionId"],
                    "harness_error",
                )
            return {"configOptions": MODELS}
        if method == "session/set_config_option":
            return {"configOptions": MODELS}
        if method == "session/prompt":
            sid = params["sessionId"]
            text = params["prompt"][0]["text"]
            self.emit(sid, "partial ")
            if "permission-test" in text:
                decision = await self.on_permission(
                    {
                        "sessionId": sid,
                        "toolCall": {"title": "Read one course file"},
                        "options": [
                            {"optionId": "once", "name": "Allow", "kind": "allow_once"},
                            {"optionId": "no", "name": "Reject", "kind": "reject_once"},
                            {
                                "optionId": "always",
                                "name": "Always",
                                "kind": "allow_always",
                            },
                        ],
                    }
                )
                self.emit(sid, decision["outcome"].get("optionId", "cancelled"))
            if "wait-test" in text:
                self.waiters[sid] = asyncio.Event()
                await self.waiters[sid].wait()
                return {"stopReason": "cancelled"}
            await asyncio.sleep(0.02)
            self.emit(sid, "answer")
            return {"stopReason": "end_turn"}
        return {}

    def emit(self, sid, text):
        if self.on_update:
            self.on_update(
                {
                    "sessionId": sid,
                    "update": {
                        "sessionUpdate": "agent_message_chunk",
                        "content": {"type": "text", "text": text},
                    },
                }
            )

    async def notify(self, method, params):
        self.calls.append((method, params))
        if params.get("sessionId") in self.waiters:
            self.waiters[params["sessionId"]].set()

    async def close(self):
        self.process.returncode = 0
        for event in self.waiters.values():
            event.set()


@pytest.fixture(autouse=True)
def reset_fake(monkeypatch, tmp_path):
    monkeypatch.setenv("DSH_HOME", str(tmp_path / "harness"))
    FakeAcp.calls = []
    FakeAcp.sessions = set()


def connect(client):
    detected = client.post(
        "/local-api/v1/detect", json={"executablePath": sys.executable}
    )
    assert detected.status_code == 200, detected.text
    response = client.put(
        "/local-api/v1/settings",
        json={
            "executablePath": sys.executable,
            "model": "opaque-model-a",
            "reasoningEffort": "off",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def payload(text="hello", conversation_id=None):
    return {
        "id": str(uuid4()),
        "conversationId": conversation_id or str(uuid4()),
        "userMessageId": str(uuid4()),
        "text": text,
        "teacher": {
            "id": "teacher",
            "name": "C 语言教师",
            "prompt": "Explain carefully.",
            "icon": "bot",
        },
    }


def settled(client, ident):
    for _ in range(150):
        value = client.get("/local-api/v1/turns/" + ident).json()
        if value["status"] != "running":
            return value
        sleep(0.01)
    pytest.fail("AI turn did not settle.")


def fake_registry(hermes_factory=None, dsh_factory=FakeAcp):
    adapters = [DshAdapter(dsh_factory)]
    if hermes_factory:
        adapters.append(HermesAdapter(hermes_factory))
    return AdapterRegistry(adapters)


def client_for(path):
    return TestClient(create_app(path, registry=fake_registry()), headers=HEADERS)


def test_detection_does_not_invoke_model_and_settings_use_opaque_values(tmp_path):
    with client_for(tmp_path) as client:
        settings = connect(client)
        assert settings["config"]["model"] == "opaque-model-a"
        assert settings["detection"]["models"][1]["name"] == "Model B"
        assert not any(method == "session/prompt" for method, _ in FakeAcp.calls)
        failed = client.put(
            "/local-api/v1/settings",
            json={"executablePath": sys.executable, "model": "invented-model"},
        )
        assert failed.status_code == 422
        assert (
            client.get("/local-api/v1/settings").json()["config"] == settings["config"]
        )
        assert (
            client.request("DELETE", "/local-api/v1/settings", json={}).json()["config"]
            is None
        )


def test_real_text_reference_teacher_and_custom_model_are_sent(tmp_path):
    with client_for(tmp_path) as client:
        connect(client)
        body = payload("为什么这段代码输出 2.0？\n```c\ndouble b = 5 / 2;\n```")
        body["model"] = "opaque-model-b"
        body["reference"] = {
            "title": "C chapter",
            "content": "double b = a / 2;",
            "selection": {
                "courseId": "c-language",
                "kind": "textbooks",
                "itemId": "CB001",
                "chapterIndex": 0,
            },
        }
        body["history"] = [{"role": "user", "content": "Earlier question"}]
        assert client.post("/local-api/v1/turns", json=body).status_code == 202
        result = settled(client, body["id"])
        assert result["status"] == "completed"
        assert result["content"] == "partial answer"
        assert result["model"] == "opaque-model-b"
        prompt = next(
            params["prompt"][0]["text"]
            for method, params in FakeAcp.calls
            if method == "session/prompt"
        )
        assert prompt.startswith(body["text"] + "\n\n")
        assert prompt.count(body["text"]) == 1
        assert all(
            part in prompt
            for part in [
                "C 语言教师",
                "Explain carefully.",
                "double b = a / 2;",
                "Earlier question",
            ]
        )


def test_request_id_deduplicates_and_parallel_turn_in_same_session_is_rejected(
    tmp_path,
):
    with client_for(tmp_path) as client:
        connect(client)
        body = payload("wait-test")
        client.post("/local-api/v1/turns", json=body)
        assert client.post("/local-api/v1/turns", json=body).status_code == 202
        assert (
            client.post(
                "/local-api/v1/turns", json={**body, "text": "different"}
            ).status_code
            == 409
        )
        assert (
            client.post(
                "/local-api/v1/turns", json=payload("second", body["conversationId"])
            ).status_code
            == 409
        )
        assert (
            client.put(
                "/local-api/v1/settings",
                json={"executablePath": sys.executable, "model": "opaque-model-a"},
            ).status_code
            == 409
        )
        client.post(f"/local-api/v1/turns/{body['id']}/cancel", json={})
        result = settled(client, body["id"])
        assert result["status"] == "cancelled"
        assert sum(method == "session/prompt" for method, _ in FakeAcp.calls) <= 1


def test_resume_after_service_restart_uses_same_external_session_without_replaying_history(
    tmp_path,
):
    body = payload()
    with client_for(tmp_path) as client:
        connect(client)
        client.post("/local-api/v1/turns", json=body)
        first = settled(client, body["id"])
    with client_for(tmp_path) as client:
        follow = payload("follow-up", body["conversationId"])
        follow["history"] = [{"role": "user", "content": "DO_NOT_REPLAY"}]
        client.post("/local-api/v1/turns", json=follow)
        second = settled(client, follow["id"])
        assert second["externalSessionId"] == first["externalSessionId"]
        assert any(method == "session/resume" for method, _ in FakeAcp.calls)
        prompt = [
            params["prompt"][0]["text"]
            for method, params in FakeAcp.calls
            if method == "session/prompt"
        ][-1]
        assert prompt.startswith(follow["text"] + "\n\n")
        assert "DO_NOT_REPLAY" not in prompt


def test_permission_requires_explicit_one_shot_choice(tmp_path):
    with client_for(tmp_path) as client:
        connect(client)
        body = payload("permission-test")
        client.post("/local-api/v1/turns", json=body)
        for _ in range(100):
            turn = client.get("/local-api/v1/turns/" + body["id"]).json()
            if turn["permissions"]:
                break
            sleep(0.01)
        permission = turn["permissions"][0]
        assert [option["optionId"] for option in permission["options"]] == [
            "once",
            "no",
        ]
        endpoint = f"/local-api/v1/turns/{body['id']}/permission"
        assert (
            client.post(
                endpoint, json={"requestId": permission["id"], "optionId": "always"}
            ).status_code
            == 422
        )
        assert (
            client.post(
                endpoint, json={"requestId": permission["id"], "optionId": "once"}
            ).status_code
            == 200
        )
        assert "once" in settled(client, body["id"])["content"]


@pytest.mark.parametrize(
    "headers",
    [
        {"origin": "https://untrusted.example", "x-solvemate-client": "web"},
        {"origin": "http://127.0.0.1:4173"},
        {"x-solvemate-client": "web"},
        {
            "origin": "http://127.0.0.1:4173",
            "x-solvemate-client": "web",
            "host": "attacker.example",
        },
    ],
)
def test_untrusted_requests_cannot_start_a_program(tmp_path, headers):
    with client_for(tmp_path) as client:
        client.headers.clear()
        response = client.post(
            "/local-api/v1/detect",
            headers=headers,
            json={"executablePath": sys.executable},
        )
        assert response.status_code == 403
        assert not FakeAcp.calls


def test_interrupted_runs_are_preserved_on_restart(tmp_path):
    store = Store(tmp_path)
    store.save_turn(
        {
            "id": "run",
            "conversationId": "chat",
            "status": "running",
            "content": "partial",
            "permissions": [],
            "text": "旧问题",
            "teacher": {"id": "teacher", "name": "教师", "prompt": ""},
            "model": "old-model",
            "startedAt": 1,
            "userMessageId": "user",
            "assistantMessageId": "answer",
            "error": "",
            "tools": [],
        }
    )
    store.close()
    store = Store(tmp_path)
    assert store.turn("run")["status"] == "interrupted"
    assert store.turn("run")["content"] == "partial"
    assert store.turn("run")["phase"] == "finished"
    store.close()


def test_windows_desktop_launcher_handles_spaces_and_unicode_without_shell(tmp_path):
    root = tmp_path / "程序 空格"
    root.mkdir()
    exe = root / "DeepSeek Harness.exe"
    exe.touch()
    (root / "resources").mkdir()
    (root / "resources/app.asar").touch()
    argv, env = launch_spec(str(exe), "acp", platform="win32")
    assert argv[0] == str(exe)
    assert argv[-1] == "acp"
    assert argv[1] == "--expose-internals"
    assert env["ELECTRON_RUN_AS_NODE"] == "1"
    assert "cmd.exe" not in argv
    wrapper = root / "resources/runtime/cli/bin/dsh.cmd"
    wrapper.parent.mkdir(parents=True)
    wrapper.touch()
    assert launch_spec(str(wrapper), "--version", platform="win32")[0][0] == str(exe)
    (root / "resources/app.asar").unlink()
    with pytest.raises(ConnectionError) as missing:
        launch_spec(str(exe), "acp", platform="win32")
    assert missing.value.code == "runtime_missing"


def test_errors_redact_credentials():
    value = safe_error(
        "token=private-value api_key=secret-value Bearer hidden-value sk-secret-key"
    )
    assert all(
        secret not in value
        for secret in ["private-value", "secret-value", "hidden-value", "sk-secret-key"]
    )


def test_missing_external_session_is_reported_without_replacing_binding(tmp_path):
    body = payload()
    with client_for(tmp_path) as client:
        connect(client)
        client.post("/local-api/v1/turns", json=body)
        first = settled(client, body["id"])
    FakeAcp.sessions.clear()
    new_calls = len(FakeAcp.calls)
    with client_for(tmp_path) as client:
        follow = payload("follow-up", body["conversationId"])
        client.post("/local-api/v1/turns", json=follow)
        result = settled(client, follow["id"])
        assert result["status"] == "failed"
        assert result["errorCode"] == "session_missing"
        assert "未找到可恢复的原会话" in result["error"]
        assert not any(
            method == "session/new" for method, _ in FakeAcp.calls[new_calls:]
        )
        assert (
            client.get(
                "/local-api/v1/conversations/" + body["conversationId"] + "/turns"
            ).json()[0]["externalSessionId"]
            == first["externalSessionId"]
        )


def test_cancel_keeps_received_text(tmp_path):
    with client_for(tmp_path) as client:
        connect(client)
        body = payload("wait-test")
        client.post("/local-api/v1/turns", json=body)
        for _ in range(100):
            turn = client.get("/local-api/v1/turns/" + body["id"]).json()
            if turn["content"]:
                break
            sleep(0.01)
        assert turn["content"] == "partial "
        client.post(f"/local-api/v1/turns/{body['id']}/cancel", json={})
        result = settled(client, body["id"])
        assert result["status"] == "cancelled"
        assert result["content"] == "partial "


def test_parallel_conversations_keep_independent_external_sessions(tmp_path):
    with client_for(tmp_path) as client:
        connect(client)
        first, second = payload("first"), payload("second")
        client.post("/local-api/v1/turns", json=first)
        client.post("/local-api/v1/turns", json=second)
        a, b = settled(client, first["id"]), settled(client, second["id"])
        assert a["content"] == b["content"] == "partial answer"
        assert a["externalSessionId"] != b["externalSessionId"]
        assert a["conversationId"] != b["conversationId"]


def test_auto_connection_keeps_discovery_mode_and_binds_actual_program(
    monkeypatch, tmp_path
):
    from solvemate_local.adapters.dsh import DshAdapter

    monkeypatch.setattr(
        DshAdapter, "resolve", staticmethod(lambda value="": sys.executable)
    )
    with client_for(tmp_path) as client:
        saved = client.put("/local-api/v1/settings", json={"model": "opaque-model-a"})
        assert saved.status_code == 200
        assert saved.json()["config"]["executablePath"] == ""
        body = payload()
        client.post("/local-api/v1/turns", json=body)
        assert settled(client, body["id"])["status"] == "completed"
    store = Store(tmp_path)
    assert store.binding(body["conversationId"])["executable"] == sys.executable
    assert store.binding(body["conversationId"])["harness_home"] == str(
        tmp_path / "harness"
    )
    store.close()


def test_stream_delivers_partial_reply_before_terminal_and_disconnect_preserves_job(
    tmp_path,
):
    import json

    from solvemate_local.models import ConnectionConfig, TurnRequest
    from solvemate_local.service import AiService

    async def exercise():
        store = Store(tmp_path)
        service = AiService(store, registry=fake_registry())
        try:
            await service.save_settings(
                ConnectionConfig(executablePath=sys.executable, model="opaque-model-a")
            )
            request = TurnRequest.model_validate(payload("wait-test"))
            service.create_turn(request)
            stream = service.stream(request.id)
            first = json.loads((await anext(stream)).split("data: ", 1)[1])
            assert first["status"] == "running" and "requestHash" not in first
            partial = json.loads(
                (await asyncio.wait_for(anext(stream), 2)).split("data: ", 1)[1]
            )
            assert partial["content"] == "partial " and partial["status"] == "running"
            await stream.aclose()
            assert not service.listeners and request.id in service.jobs
            resumed = service.stream(request.id)
            assert "partial " in await anext(resumed)
            await service.cancel(request.id)
            async for frame in resumed:
                result = json.loads(frame.split("data: ", 1)[1])
                if result["status"] != "running":
                    assert result["status"] == "cancelled"
                    assert result["content"] == "partial "
            assert not service.listeners
            assert sum(method == "session/prompt" for method, _ in FakeAcp.calls) == 1
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


def test_thinking_updates_activity_without_saving_reasoning_text(tmp_path):
    from solvemate_local.models import ConnectionConfig, TurnRequest
    from solvemate_local.service import AiService

    async def exercise():
        store = Store(tmp_path)
        service = AiService(store, registry=fake_registry())
        try:
            await service.save_settings(
                ConnectionConfig(executablePath=sys.executable, model="opaque-model-a")
            )
            request = TurnRequest.model_validate(payload("wait-test"))
            service.create_turn(request)
            while not service.store.turn(request.id).get("externalSessionId"):
                await asyncio.sleep(0.01)
            sid = service.store.turn(request.id)["externalSessionId"]
            acp_update(lambda event: service.update(event, "deepseek-local"))(
                {
                    "sessionId": sid,
                    "update": {
                        "sessionUpdate": "agent_thought_chunk",
                        "content": {
                            "type": "text",
                            "text": "private reasoning must not be saved",
                        },
                    },
                }
            )
            value = store.turn(request.id)
            assert value["phase"] == "thinking"
            assert "private reasoning" not in str(value)
            await service.cancel(request.id)
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


def test_event_endpoint_requires_client_header_and_sends_finished_record(tmp_path):
    with client_for(tmp_path) as client:
        connect(client)
        body = payload()
        client.post("/local-api/v1/turns", json=body)
        settled(client, body["id"])
        response = client.get(f"/local-api/v1/turns/{body['id']}/events")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        assert "event: turn" in response.text and "requestHash" not in response.text
        assert '"phase": "finished"' in response.text
        client.headers.pop("x-solvemate-client")
        assert client.get(f"/local-api/v1/turns/{body['id']}/events").status_code == 403


def test_multiple_reference_fragments_keep_text_and_page_in_prompt(tmp_path):
    with client_for(tmp_path) as client:
        connect(client)
        writer = PdfWriter()
        writer.add_blank_page(width=600, height=800)
        writer.add_blank_page(width=600, height=800)
        stream = io.BytesIO()
        writer.write(stream)
        imported = client.post(
            "/local-api/v1/materials",
            params={"filename": "lesson.pdf"},
            content=stream.getvalue(),
            headers={"content-type": "application/octet-stream"},
        )
        assert imported.status_code == 202
        for _ in range(200):
            material = client.get("/local-api/v1/materials").json()[0]
            if material["version"]["status"] != "processing":
                break
            sleep(0.01)
        assert material["version"]["status"] == "ready"
        body = payload("比较两个代码片段")
        body["references"] = [
            {
                "title": f"C textbook · 第 {page} 页",
                "content": text,
                "selection": None,
                "material": {
                    "materialId": material["id"],
                    "contentVersion": material["currentVersion"],
                    "pageNumber": page,
                },
                "quoteKind": "selection",
            }
            for page, text in [(1, "int a = 5 / 2;"), (2, "double b = 5.0 / 2;")]
        ]
        assert client.post("/local-api/v1/turns", json=body).status_code == 202
        turn = settled(client, body["id"])
        assert turn["status"] == "completed"
        assert turn["references"] == body["references"]
        prompt = next(
            params["prompt"][0]["text"]
            for method, params in FakeAcp.calls
            if method == "session/prompt"
        )
        assert prompt.startswith(body["text"])
        for reference in body["references"]:
            assert prompt.count(reference["content"]) == 1
            assert f"资料页码：第 {reference['material']['pageNumber']} 页" in prompt
        from copy import deepcopy

        bad = deepcopy(body)
        bad["id"] = str(uuid4())
        bad["references"][1]["material"]["pageNumber"] = 3
        assert client.post("/local-api/v1/turns", json=bad).status_code == 422
        # 相同编号重试不重复执行；更改引用后重用编号必须拒绝。
        assert client.post("/local-api/v1/turns", json=body).status_code == 202
        assert sum(method == "session/prompt" for method, _ in FakeAcp.calls) == 1
        body["references"].pop()
        assert client.post("/local-api/v1/turns", json=body).status_code == 409


def test_reference_list_rejects_excess_content_and_ambiguous_legacy_field(tmp_path):
    with client_for(tmp_path) as client:
        body = payload("引用校验")
        reference = {
            "title": "课程",
            "content": "a" * 60000,
            "selection": {
                "courseId": "c-language",
                "kind": "textbooks",
                "itemId": "CB001",
                "chapterIndex": 0,
            },
        }
        body["references"] = [reference, reference]
        assert client.post("/local-api/v1/turns", json=body).status_code == 422
        body["references"] = [{**reference, "content": "片段"}] * 5
        assert client.post("/local-api/v1/turns", json=body).status_code == 422
        body["references"] = [{**reference, "content": "片段"}]
        body["reference"] = reference
        assert client.post("/local-api/v1/turns", json=body).status_code == 422
        assert not any(method == "session/prompt" for method, _ in FakeAcp.calls)
