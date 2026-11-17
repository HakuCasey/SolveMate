"""用短期限验证无进展超时，不启动第三方 Harness 或调用模型。"""

import asyncio
import sys
from types import SimpleNamespace

import pytest
from test_adapters import completed
from test_service import FakeAcp, fake_registry, payload

from solvemate_local import generation
from solvemate_local.errors import ConnectionError
from solvemate_local.generation import Generation
from solvemate_local.models import ConnectionConfig, TurnRequest
from solvemate_local.service import AiService
from solvemate_local.store import Store


@pytest.fixture(autouse=True)
def short_deadlines(monkeypatch):
    monkeypatch.setattr(generation, "GENERATION_IDLE_TIMEOUT", 0.15)
    monkeypatch.setattr(generation, "GENERATION_STOP_TIMEOUT", 0.1)


@pytest.mark.parametrize("kind", ["text", "thinking", "tool", "turn", "received"])
def test_actual_progress_can_continue_beyond_one_idle_period(kind):
    async def exercise():
        async def prompt(*args, **kwargs):
            for _ in range(6):
                await asyncio.sleep(0.04)
                execution.update({"sessionId": "original", "kind": kind, "text": "a"})
            return "completed"

        execution = Generation(SimpleNamespace(prompt=prompt), None, "original")
        assert await execution.run("question", "request") == "completed"
        assert execution.deadline is None

    asyncio.run(exercise())


@pytest.mark.parametrize(
    "event",
    [
        {"sessionId": "original", "kind": "heartbeat"},
        {"sessionId": "another", "kind": "text", "text": "other conversation"},
        {"sessionId": "original", "kind": "text", "text": ""},
    ],
)
def test_heartbeat_other_session_and_empty_chunk_do_not_extend_wait(event):
    async def exercise():
        stopped = asyncio.Event()
        calls = []

        async def prompt(*args, **kwargs):
            while not stopped.is_set():
                await asyncio.sleep(0.02)
                execution.update(event)
            return "cancelled"

        async def cancel(process, sid):
            calls.append(sid)
            stopped.set()

        adapter = SimpleNamespace(id="test", prompt=prompt, cancel=cancel)
        execution = Generation(adapter, None, "original")
        with pytest.raises(ConnectionError) as failed:
            await execution.run("question", "request")
        assert failed.value.code == "execution_unconfirmed"
        assert calls == ["original"]
        assert execution.deadline is None

    asyncio.run(exercise())


def test_no_progress_stop_failure_has_bounded_cleanup(monkeypatch):
    async def exercise():
        prompt_finished = asyncio.Event()
        stop_started = asyncio.Event()

        async def prompt(*args, **kwargs):
            try:
                await asyncio.Event().wait()
            finally:
                prompt_finished.set()

        async def cancel(*args):
            stop_started.set()
            await asyncio.Event().wait()

        adapter = SimpleNamespace(id="test", prompt=prompt, cancel=cancel)
        execution = Generation(adapter, None, "original")
        with pytest.raises(ConnectionError, match="未能确认第三方任务已停止"):
            await asyncio.wait_for(execution.run("question", "request"), 1)
        assert stop_started.is_set()
        assert prompt_finished.is_set()

    asyncio.run(exercise())


def test_manual_stop_and_external_cancellation_keep_existing_behavior():
    async def exercise():
        stopped = asyncio.Event()
        entered = asyncio.Event()
        finished = asyncio.Event()

        async def prompt(*args, **kwargs):
            entered.set()
            try:
                await stopped.wait()
                return "cancelled"
            finally:
                finished.set()

        execution = Generation(SimpleNamespace(prompt=prompt), None, "original")
        task = asyncio.create_task(execution.run("question", "request"))
        await entered.wait()
        stopped.set()
        assert await task == "cancelled"
        entered.clear()
        stopped.clear()
        finished.clear()
        task = asyncio.create_task(execution.run("question", "next-request"))
        await entered.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert finished.is_set()
        assert execution.deadline is None

    asyncio.run(exercise())


@pytest.mark.parametrize("progress_kind", ["text", "thinking"])
def test_service_resets_on_updates_preserves_partial_reply_and_resumes_same_session(
    tmp_path, monkeypatch, progress_kind
):
    class TimedAcp(FakeAcp):
        mode = "progress"

        async def call(self, method, params, timeout=40):
            if method != "session/prompt":
                return await super().call(method, params, timeout)
            assert timeout is None  # 传输层不再提前截断有进展的整轮生成。
            sid = params["sessionId"]
            self.calls.append((method, params))
            if self.mode == "progress":
                for _ in range(6):
                    await asyncio.sleep(0.04)
                    if progress_kind == "text":
                        self.emit(sid, "部分")
                    else:
                        self.on_update(
                            {
                                "sessionId": sid,
                                "update": {"sessionUpdate": "agent_thought_chunk"},
                            }
                        )
                self.emit(sid, "最终回答")
                return {"stopReason": "end_turn"}
            self.emit(sid, "保留这部分回答")
            self.waiters[sid] = asyncio.Event()
            await self.waiters[sid].wait()
            return {"stopReason": "cancelled"}

    async def exercise():
        monkeypatch.setenv("DSH_HOME", str(tmp_path / "harness"))
        TimedAcp.calls, TimedAcp.sessions = [], set()
        store = Store(tmp_path)
        service = AiService(store, registry=fake_registry(dsh_factory=TimedAcp))
        writes = []
        persist = service.persist

        def record_persist(turn):
            writes.append(turn["phase"])
            persist(turn)

        monkeypatch.setattr(service, "persist", record_persist)
        try:
            await service.save_settings(
                ConnectionConfig(executablePath=sys.executable, model="opaque-model-a")
            )
            first = TurnRequest.model_validate(payload())
            service.create_turn(first)
            result = await completed(service, first.id)
            assert result["status"] == "completed", result
            if progress_kind == "thinking":
                assert writes.count("thinking") == 1
            sid = result["externalSessionId"]
            TimedAcp.mode = "silence"
            second = TurnRequest.model_validate(
                payload(conversation_id=first.conversationId)
            )
            service.create_turn(second)
            failed = await completed(service, second.id)
            assert failed["status"] == "interrupted", failed
            assert failed["content"] == "保留这部分回答"
            assert failed["externalSessionId"] == sid
            assert store.connections()["deepseek-local"]["enabled"]
            assert any(method == "session/cancel" for method, _ in TimedAcp.calls)
            TimedAcp.mode = "progress"
            third = TurnRequest.model_validate(
                payload(conversation_id=first.conversationId)
            )
            service.create_turn(third)
            restored = await completed(service, third.id)
            assert restored["status"] == "completed", restored
            assert restored["externalSessionId"] == sid
            assert not service.generations
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())
