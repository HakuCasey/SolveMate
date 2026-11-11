"""通过真实 stdio 子进程检查 app-server 适配，普通测试不调用模型。"""

import asyncio
import json
import os
import sys
from time import sleep
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from test_service import HEADERS

from solvemate_local.adapters import AdapterRegistry
from solvemate_local.adapters.codex import (
    CodexAdapter,
    default_path,
    find_codex,
    npm_native,
)
from solvemate_local.adapters.codex_process import CodexProcess
from solvemate_local.errors import ConnectionError
from solvemate_local.main import create_app
from solvemate_local.store import Store

AGENT = r"""
import json,sys
from pathlib import Path
state_path=Path.cwd()/"fake-codex.json"
state=json.loads(state_path.read_text()) if state_path.exists() else {"threads":[],"calls":[],"turns":0}
active=None

def send(value):
 sys.stdout.buffer.write((json.dumps(value,ensure_ascii=False)+"\n").encode("utf-8"));sys.stdout.buffer.flush()
def persist():state_path.write_text(json.dumps(state),encoding="utf-8")
def event(method,params):send({"method":method,"params":params})
def item(kind,text,tid):
 return {"type":"agentMessage","id":kind,"text":text}
def done(sid,tid,status="completed",items=None,error=None):
 event("turn/completed",{"threadId":sid,"turn":{"id":tid,"status":status,"items":items or [],"error":error}})
def delta(sid,tid,text,ident="message-1"):
 event("item/agentMessage/delta",{"threadId":sid,"turnId":tid,"itemId":ident,"delta":text})

for raw in sys.stdin.buffer:
 req=json.loads(raw)
 method=req.get("method"); params=req.get("params",{})
 if not method:
  state["approval"]=req;persist()
  sid,tid=active
  delta(sid,tid,json.dumps(req.get("result") or req.get("error"),ensure_ascii=False))
  done(sid,tid);continue
 if method=="initialized":continue
 state["calls"].append(method);persist()
 result={}
 if method=="initialize":result={"userAgent":"codex/0.162.1"}
 elif method=="account/read":result={"requiresOpenaiAuth":True,"account":{"type":"chatgpt"}}
 elif method=="config/read":result={"config":{"model":"model-a","model_reasoning_effort":"low","private_setting":"not copied"}}
 elif method=="model/list":
  name="model-b" if params.get("cursor") else "model-a"
  result={"data":[{"id":"opaque-picker-id-"+name,"model":name,"displayName":name.upper(),"isDefault":name=="model-a","defaultReasoningEffort":"low","supportedReasoningEfforts":[{"reasoningEffort":"low"},{"reasoningEffort":"high"}]}],"nextCursor":None if params.get("cursor") else "page-2"}
 elif method=="thread/start":
  sid="native-中文-"+str(len(state["threads"])+1);state["threads"].append(sid);persist();result={"thread":{"id":sid}}
 elif method=="thread/resume":
  if params["threadId"] not in state["threads"]:
   send({"id":req["id"],"error":{"code":-32600,"message":"Thread not found"}});continue
  result={"thread":{"id":params["threadId"]}}
 elif method=="turn/start":
  state["turns"]+=1;state["lastTurnParams"]=params;persist()
  sid,tid=params["threadId"],"turn-"+str(state["turns"])
  text=params["input"][0]["text"];active=(sid,tid)
  delta(sid,"unrelated-native-turn","FOREIGN MESSAGE")
  delta(sid,tid,"初稿") # 允许在请求确认前到达。
  if "permission" in text:
   method_name="item/permissions/requestApproval" if "permission-profile" in text else "item/commandExecution/requestApproval"
   event("item/reasoning/textDelta",{"threadId":sid,"turnId":tid,"itemId":"reason","delta":"PRIVATE THOUGHT"})
   send({"id":"approval-1","method":method_name,"params":{"threadId":sid,"turnId":tid,"itemId":"cmd","command":"read course.txt","reason":"Read one course file","permissions":{"network":{"enabled":True}}}})
  send({"id":req["id"],"result":{"turn":{"id":tid,"status":"inProgress","items":[]}}})
  if "permission" in text:continue
  if "disconnect" in text:sys.exit(0)
  if "wait" in text:continue
  if "fail" in text:
   done(sid,tid,"failed",error={"message":"Unauthorized sk-private-123456"});continue
  delta(sid,tid,"增量")
  for status,action in [("inProgress","item/started"),("completed","item/completed")]:
   event(action,{"threadId":sid,"turnId":tid,"item":{"id":"tool-1","type":"commandExecution","status":status,"command":"echo test"}})
  event("item/reasoning/textDelta",{"threadId":sid,"turnId":tid,"delta":"PRIVATE THOUGHT"})
  first=item("message-1","最终正文",tid)
  event("item/completed",{"threadId":sid,"turnId":tid,"item":first})
  second=item("message-2","第二段",tid)
  event("item/completed",{"threadId":sid,"turnId":tid,"item":second})
  done(sid,tid,items=[first,second]);continue
 elif method=="turn/interrupt":
  state["interrupted"]=params;persist()
  done(params["threadId"],params["turnId"],"interrupted")
 else:
  send({"id":req.get("id"),"error":{"code":-32601,"message":"Unknown method"}});continue
 if "id" in req:send({"id":req["id"],"result":result})
"""


def client_for(tmp_path):
    script = tmp_path / "agent.py"
    script.write_text(AGENT, encoding="utf-8")

    class TestProcess(CodexProcess):
        async def prepare_launch(self):
            return [sys.executable, str(script)], os.environ.copy()

    return TestClient(
        create_app(
            tmp_path / "store", registry=AdapterRegistry([CodexAdapter(TestProcess)])
        ),
        headers=HEADERS,
    )


def connect(client):
    config = {
        "provider": "codex",
        "executablePath": sys.executable,
        "model": "model-a",
        "reasoningEffort": "low",
    }
    response = client.put("/local-api/v1/settings", json=config)
    assert response.status_code == 200, response.text
    return response.json()


def question(text="explain", model="model-a"):
    return {
        "id": str(uuid4()),
        "conversationId": "codex-dialog",
        "connectionId": "codex-local",
        "userMessageId": str(uuid4()),
        "text": text,
        "model": model,
        "teacher": {
            "id": "c-teacher",
            "name": "C 语言教师",
            "prompt": "Explain clearly.",
        },
    }


def wait_for(client, ident, condition=lambda value: value["status"] != "running"):
    for _ in range(200):
        value = client.get(f"/local-api/v1/turns/{ident}").json()
        if condition(value):
            return value
        sleep(0.01)
    pytest.fail("Codex turn did not reach the expected state")


def test_detection_reads_paginated_catalog_without_creating_threads(tmp_path):
    with client_for(tmp_path) as client:
        settings = connect(client)
        assert [m["value"] for m in settings["detection"]["models"]] == [
            "model-a",
            "model-b",
        ]
        assert settings["detection"]["version"] == "0.162.1"
        assert "private_setting" not in json.dumps(settings)
        assert settings["connections"][0]["id"] == "codex-local"
    state = json.loads((tmp_path / "store/workspace/fake-codex.json").read_text())
    assert "thread/start" not in state["calls"] and state["threads"] == []
    with Store(tmp_path / "store").db as db:
        assert db.execute("SELECT COUNT(*) FROM probes").fetchone()[0] == 0


def test_stream_reconciles_final_messages_and_restores_same_thread_after_restart(
    tmp_path,
):
    with client_for(tmp_path) as client:
        connect(client)
        first = question()
        assert client.post("/local-api/v1/turns", json=first).status_code == 202
        turn = wait_for(client, first["id"])
        assert turn["content"] == "最终正文\n\n第二段"
        assert turn["externalTurnId"] == "turn-1"
        assert turn["protocol"] == "codex-app-server"
        assert turn["tools"] == [
            {"id": "tool-1", "title": "执行命令", "status": "completed"}
        ]
        assert "PRIVATE THOUGHT" not in json.dumps(turn)
        assert "FOREIGN MESSAGE" not in json.dumps(turn)
    with client_for(tmp_path) as client:
        follow = question(model="model-b")
        client.post("/local-api/v1/turns", json=follow)
        result = wait_for(client, follow["id"])
        assert result["externalSessionId"] == turn["externalSessionId"]
        assert result["model"] == "model-b"
        assert len(client.get("/local-api/v1/settings").json()["connections"]) == 1
    state = json.loads((tmp_path / "store/workspace/fake-codex.json").read_text())
    assert len(state["threads"]) == 1
    assert "thread/resume" in state["calls"]
    assert state["lastTurnParams"]["model"] == "model-b"


@pytest.mark.parametrize(
    "text,status", [("wait", "cancelled"), ("disconnect", "failed"), ("fail", "failed")]
)
def test_stop_disconnect_and_native_error_keep_received_text(tmp_path, text, status):
    with client_for(tmp_path) as client:
        connect(client)
        req = question(text)
        client.post("/local-api/v1/turns", json=req)
        if text == "wait":
            pending = wait_for(client, req["id"], lambda value: bool(value["content"]))
            client.post(f"/local-api/v1/turns/{req['id']}/cancel", json={})
        result = wait_for(client, req["id"])
        assert result["status"] == status
        assert result["content"] == "初稿"
        if text == "fail":
            assert "sk-private" not in result["error"]
        if text == "disconnect":
            assert result["errorCode"] == "process_stopped"
        if text == "wait":
            state = json.loads(
                (tmp_path / "store/workspace/fake-codex.json").read_text()
            )
            assert state["interrupted"]["turnId"] == pending["externalTurnId"]


@pytest.mark.parametrize(
    "text,choice",
    [
        ("permission", "allow-once"),
        ("permission", "reject-once"),
        ("permission-profile", "allow-once"),
    ],
)
def test_native_permissions_wait_for_ownership_and_only_grant_once(
    tmp_path, text, choice
):
    with client_for(tmp_path) as client:
        connect(client)
        req = question(text)
        client.post("/local-api/v1/turns", json=req)
        turn = wait_for(client, req["id"], lambda value: bool(value["permissions"]))
        permission = turn["permissions"][0]
        client.post(
            f"/local-api/v1/turns/{req['id']}/permission",
            json={"requestId": permission["id"], "optionId": choice},
        )
        result = wait_for(client, req["id"])
        assert result["status"] == "completed"
        assert "acceptForSession" not in result["content"]
        if text == "permission-profile":
            assert '"scope": "turn"' in result["content"]
        else:
            assert (
                '"decision": "accept"'
                if choice == "allow-once"
                else '"decision": "decline"'
            ) in result["content"]


def test_missing_native_thread_does_not_create_a_replacement(tmp_path):
    with client_for(tmp_path) as client:
        connect(client)
        req = question()
        client.post("/local-api/v1/turns", json=req)
        wait_for(client, req["id"])
    state_file = tmp_path / "store/workspace/fake-codex.json"
    state = json.loads(state_file.read_text())
    state["threads"] = []
    state_file.write_text(json.dumps(state))
    with client_for(tmp_path) as client:
        req = question()
        client.post("/local-api/v1/turns", json=req)
        result = wait_for(client, req["id"])
        assert result["status"] == "failed"
    assert json.loads(state_file.read_text())["threads"] == []


def test_repeated_model_cursor_fails_without_looping_forever():
    class Repeating:
        async def call(self, *args):
            return {"data": [{"model": "one"}], "nextCursor": "same"}

    async def exercise():
        with pytest.raises(ConnectionError) as failed:
            await CodexAdapter().probe_options(Repeating())
        assert failed.value.code == "protocol_invalid"

    asyncio.run(exercise())


@pytest.mark.parametrize(
    "machine,target,package",
    [
        ("AMD64", "x86_64-pc-windows-msvc", "codex-win32-x64"),
        ("ARM64", "aarch64-pc-windows-msvc", "codex-win32-arm64"),
    ],
)
def test_windows_npm_launcher_resolves_native_binary_without_shell(
    tmp_path, machine, target, package
):
    exe = (
        tmp_path
        / "node_modules/@openai/codex/node_modules/@openai"
        / package
        / "vendor"
        / target
        / "codex/codex.exe"
    )
    exe.parent.mkdir(parents=True)
    exe.touch()
    exe.chmod(0o700)
    assert npm_native(tmp_path, machine) == exe


def test_windows_batch_without_official_native_binary_is_not_executed(tmp_path):
    shim = tmp_path / "codex.cmd"
    shim.write_text("echo must not run")
    with pytest.raises(ConnectionError) as failed:
        find_codex(str(shim))
    assert failed.value.code == "program_missing"


def test_platform_default_path_and_process_arguments(monkeypatch, tmp_path):
    from solvemate_local.adapters import codex

    monkeypatch.setattr(codex.sys, "platform", "win32")
    assert default_path().endswith("codex.exe")

    async def exercise():
        process = CodexProcess(str(tmp_path / "Codex 中文.exe"), str(tmp_path))
        argv, _ = await process.prepare_launch()
        assert argv == [
            str(tmp_path / "Codex 中文.exe"),
            "app-server",
            "--listen",
            "stdio://",
        ]

    asyncio.run(exercise())


def test_authentication_failure_explains_login_without_reading_credentials():
    class SignedOut:
        async def start(self):
            return {"userAgent": "codex/0.162.1"}

        async def call(self, method, params):
            assert method == "account/read"
            return {"requiresOpenaiAuth": True, "account": None}

    async def exercise():
        with pytest.raises(ConnectionError) as failed:
            await CodexAdapter().start(SignedOut())
        assert failed.value.code == "auth_required"
        assert "codex login" in str(failed.value)

    asyncio.run(exercise())


def test_model_schema_changes_fail_with_a_clear_error():
    class Changed:
        async def call(self, *args):
            return {"data": [{"id": "new-picker-without-model-field"}]}

    async def exercise():
        with pytest.raises(ConnectionError) as failed:
            await CodexAdapter().probe_options(Changed())
        assert failed.value.code == "protocol_unsupported"

    asyncio.run(exercise())


def test_long_permission_details_cannot_be_approved_without_full_display():
    from solvemate_local.adapters.codex_process import CodexExecution

    async def exercise():
        shown = []

        async def choose(params):
            shown.append(params)
            return "allow-once"  # 错误的调用方也不能绕过显示范围校验。

        process = CodexProcess("unused", "/workspace", on_permission=choose)
        state = CodexExecution(
            asyncio.get_running_loop().create_future(), turn_id="turn"
        )
        process.active["thread"] = state
        result = await process.handle_request(
            "item/commandExecution/requestApproval",
            {"threadId": "thread", "turnId": "turn", "reason": "x" * 700},
        )
        assert [option["kind"] for option in shown[0]["options"]] == ["reject_once"]
        assert result["decision"] == "cancel"
        state.future.cancel()

    asyncio.run(exercise())


def test_file_approval_identifies_the_requested_files_and_rejects_foreign_turns():
    from solvemate_local.adapters.codex_process import CodexExecution

    async def exercise():
        shown = []

        async def choose(params):
            shown.append(params)
            return "reject-once"

        process = CodexProcess("unused", "/workspace", on_permission=choose)
        state = CodexExecution(
            asyncio.get_running_loop().create_future(), turn_id="turn"
        )
        process.active["thread"] = state
        process.item(
            "thread",
            state,
            {
                "type": "fileChange",
                "id": "file-item",
                "changes": [{"path": "/materials/课本.md"}],
            },
            False,
        )
        params = {"threadId": "thread", "turnId": "turn", "itemId": "file-item"}
        result = await process.handle_request("item/fileChange/requestApproval", params)
        assert result["decision"] == "decline"
        assert "/materials/课本.md" in shown[0]["title"]
        result = await process.handle_request(
            "item/fileChange/requestApproval", {**params, "turnId": "foreign"}
        )
        assert result["decision"] == "cancel" and len(shown) == 1
        state.future.cancel()

    asyncio.run(exercise())


def test_configured_custom_model_is_kept_when_not_in_builtin_catalog():
    class Custom:
        def __init__(self):
            self.config = {"model": "school/model-x", "model_reasoning_effort": "high"}

        async def call(self, *args):
            return {
                "data": [{"model": "built-in", "isDefault": True}],
                "nextCursor": None,
            }

    async def exercise():
        options = await CodexAdapter().probe_options(Custom())
        assert options["currentModel"] == "school/model-x"
        assert options["reasoningOptions"] == []
        assert options["models"][-1] == {
            "value": "school/model-x",
            "name": "school/model-x",
            "group": "当前配置",
        }

    asyncio.run(exercise())
