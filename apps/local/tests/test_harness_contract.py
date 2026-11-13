"""使用没有 RPC 方法的替代适配器，验证业务服务不依赖 ACP 或 app-server。"""

import asyncio
import sys
from pathlib import Path
from uuid import uuid4

from solvemate_local.adapters import AdapterRegistry
from solvemate_local.adapters.base import HarnessAdapter
from solvemate_local.adapters.types import HarnessSession
from solvemate_local.models import ConnectionConfig, TurnRequest
from solvemate_local.service import AiService
from solvemate_local.store import Store

OPTIONS = {
    "models": [{"value": "one", "name": "One"}, {"value": "two", "name": "Two"}],
    "currentModel": "one",
    "reasoningOptions": [],
    "currentReasoning": "",
}


class PlainProcess:
    """故意不提供 call、notify 或协议能力字段。"""

    def __init__(self, update, permission):
        self.open = True
        self.update, self.permission = update, permission
        self.stopped = asyncio.Event()

    def is_running(self):
        return self.open

    async def close(self):
        self.open = False
        self.stopped.set()


class PlainAdapter(HarnessAdapter):
    provider = "codex"
    id = "codex-local"
    name = short_name = "Alternative"
    protocol = "codex-app-server"
    requires_probe_session = False
    resolve = staticmethod(lambda value="": sys.executable)
    default_path = staticmethod(lambda: sys.executable)
    home = staticmethod(Path.home)

    def __init__(self):
        self.created = 0
        self.resumed = 0
        self.cancelled = 0

    def process(self, executable, workspace, on_update=None, on_permission=None):
        return PlainProcess(on_update, on_permission)

    async def start(self, process):
        return {"version": "test", "capabilities": {}}

    async def probe_options(self, process, model=""):
        return OPTIONS

    async def new_session(self, process, workspace, model=""):
        self.created += 1
        return HarnessSession("opaque-native-id", OPTIONS)

    async def resume(self, process, sid, workspace):
        assert sid == "opaque-native-id"
        self.resumed += 1
        return HarnessSession(sid, OPTIONS)

    async def select_model(self, process, sid, model, session):
        process.model = model
        return OPTIONS

    async def prompt(self, process, sid, text):
        process.update(
            {"sessionId": sid, "kind": "turn", "externalTurnId": "native-turn"}
        )
        process.update({"sessionId": sid, "kind": "text", "text": process.model})
        if "permission" in text:
            choice = await process.permission(
                {
                    "sessionId": sid,
                    "title": "Read course",
                    "options": [
                        {"optionId": "once", "name": "Once", "kind": "allow_once"}
                    ],
                }
            )
            process.update(
                {"sessionId": sid, "kind": "text", "text": choice or "rejected"}
            )
        if "wait" in text:
            await process.stopped.wait()
            return "cancelled"
        return "completed"

    async def cancel(self, process, sid):
        self.cancelled += 1
        process.stopped.set()


def request(text="question", model="one"):
    return TurnRequest(
        id=str(uuid4()),
        conversationId="plain",
        connectionId="codex-local",
        userMessageId=str(uuid4()),
        text=text,
        model=model,
        teacher={"id": "teacher", "name": "Teacher", "prompt": "Explain clearly."},
    )


def test_common_service_works_without_protocol_calls_and_recovers_same_session(
    tmp_path,
):
    async def exercise():
        store = Store(tmp_path)
        adapter = PlainAdapter()
        service = AiService(store, registry=AdapterRegistry([adapter]))
        try:
            await service.save_settings(ConnectionConfig(provider="codex", model="one"))
            for model in ["one", "two"]:
                req = request(model=model)
                service.create_turn(req)
                await service.jobs[req.id]["task"]
                turn = store.turn(req.id)
                assert turn["status"] == "completed"
                assert turn["content"] == model
                assert turn["protocol"] == "codex-app-server"
                assert turn["externalTurnId"] == "native-turn"
            await service.close()
            service = AiService(store, registry=AdapterRegistry([adapter]))
            req = request()
            service.create_turn(req)
            await service.jobs[req.id]["task"]
            assert store.turn(req.id)["externalSessionId"] == "opaque-native-id"
            assert adapter.created == adapter.resumed == 1
            assert store.db.execute("SELECT COUNT(*) FROM probes").fetchone()[0] == 0
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


def test_common_permission_and_cancel_are_adapter_operations(tmp_path):
    async def exercise():
        store = Store(tmp_path)
        adapter = PlainAdapter()
        service = AiService(store, registry=AdapterRegistry([adapter]))
        try:
            await service.save_settings(ConnectionConfig(provider="codex", model="one"))
            req = request("permission wait")
            service.create_turn(req)
            for _ in range(100):
                if store.turn(req.id)["permissions"]:
                    break
                await asyncio.sleep(0.01)
            permission = store.turn(req.id)["permissions"][0]
            service.decide(req.id, permission["id"], "once")
            await asyncio.sleep(0.01)
            await service.cancel(req.id)
            await service.jobs[req.id]["task"]
            assert store.turn(req.id)["status"] == "cancelled"
            assert store.turn(req.id)["content"] == "oneonce"
            assert adapter.cancelled == 1
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())
