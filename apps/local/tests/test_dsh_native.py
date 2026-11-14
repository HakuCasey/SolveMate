"""原生流式接口的故障注入；不启动 Harness，不调用模型。"""

import asyncio
import copy
import json
import sys
from types import SimpleNamespace
from typing import ClassVar
from uuid import uuid4

import pytest

from solvemate_local.adapters import AdapterRegistry
from solvemate_local.adapters.dsh import DshAdapter
from solvemate_local.adapters.dsh_process import DshProcess
from solvemate_local.adapters.dsh_stream import DshStream, StreamGap
from solvemate_local.errors import ConnectionError
from solvemate_local.models import ConnectionConfig, TurnRequest
from solvemate_local.service import AiService
from solvemate_local.store import Store

SID = "registered-session"
MODEL = '["test","one"]'
CATALOG = {
    "groups": [
        {"id": "test", "name": "Test", "models": [{"id": "one", "name": "One"}]}
    ],
    "default": {"provider": "test", "model": "one"},
}


def event(seq, kind, **data):
    return {"seq": seq, "type": kind, "data": {"turn": 1, "step": 1, **data}}


def snapshot(events=(), active=None, revision=0):
    return {
        "type": "snapshot",
        "header": {"id": SID},
        "cursor": max((e["seq"] for e in events), default=0),
        "records": [{"event": e} for e in events],
        "assistantStream": {
            "revision": revision,
            **({"activeAttempt": active} if active else {}),
        },
    }


def frame(revision, kind, index=0, **extra):
    return {
        "type": kind,
        "revision": revision,
        "attemptId": "attempt",
        "turn": 1,
        "step": 1,
        "index": index,
        "startedAfterSeq": 0,
        **extra,
    }


def test_raw_delta_reconnect_duplicates_and_final_message_are_one_reply():
    emitted = []
    fold = DshStream(SID, emitted.append)
    fold.snapshot(snapshot())
    fold.frame(frame(1, "start"))
    fold.frame(frame(2, "chunk", chunk={"type": "text-delta", "text": "你"}))
    fold.snapshot(
        snapshot(
            active={
                "attemptId": "attempt",
                "turn": 1,
                "step": 1,
                "startedAfterSeq": 0,
                "nextIndex": 1,
                "stream": [{"type": "text-chunks", "texts": ["你"]}],
            },
            revision=2,
        )
    )
    fold.frame(frame(2, "chunk", chunk={"type": "text-delta", "text": "你"}))
    fold.frame(frame(3, "chunk", index=1, chunk={"type": "text-delta", "text": "好"}))
    fold.event(
        event(
            1,
            "assistant/message",
            message={"content": [{"type": "text", "text": "你好"}]},
        )
    )
    fold.frame(frame(4, "end", index=2, outcome={"kind": "committed", "seq": 1}))
    fold.event(event(2, "turn/end", reason={"kind": "completed"}))
    assert fold.content == "你好"
    assert fold.result == "completed"
    assert [e["text"] for e in emitted if e["kind"] == "text"] == ["你", "你好", "你好"]


def test_missing_delta_requires_resubscription_and_thought_is_not_displayed():
    emitted = []
    fold = DshStream(SID, emitted.append)
    fold.snapshot(snapshot())
    fold.frame(frame(1, "start"))
    fold.frame(
        frame(2, "chunk", chunk={"type": "thinking-delta", "text": "private thought"})
    )
    with pytest.raises(StreamGap):
        fold.frame(
            frame(4, "chunk", index=2, chunk={"type": "text-delta", "text": "lost"})
        )
    assert emitted == [{"sessionId": SID, "kind": "thinking"}]


def test_new_tool_step_and_retry_do_not_duplicate_previous_text():
    fold = DshStream(SID, lambda _: None)
    fold.snapshot(snapshot())
    fold.event(
        event(
            1,
            "assistant/message",
            message={"content": [{"type": "text", "text": "说明"}]},
        )
    )
    fold.frame(frame(1, "start", step=2, startedAfterSeq=1))
    fold.frame(
        frame(2, "chunk", step=2, chunk={"type": "text-delta", "text": "重试前"})
    )
    fold.event(event(2, "assistant/attempt", step=2, stream=[]))
    fold.frame(
        frame(3, "end", step=2, index=1, outcome={"kind": "committed", "seq": 2})
    )
    fold.frame(frame(4, "start", step=2, attemptId="retry", startedAfterSeq=2))
    fold.frame(
        frame(
            5,
            "chunk",
            step=2,
            attemptId="retry",
            chunk={"type": "text-delta", "text": "结论"},
        )
    )
    assert fold.content == "说明\n\n结论"


class FakeSocket:
    def __init__(self, host):
        self.host = host
        self.queue = asyncio.Queue()
        self.closed = False
        self.put({"type": "ready", "clientId": "client"})

    def put(self, value):
        self.queue.put_nowait({"type": "item", "value": copy.deepcopy(value)})

    async def send(self, _):
        self.put(self.host.opening)

    async def recv(self):
        item = await self.queue.get()
        if isinstance(item, Exception):
            raise item
        return json.dumps(item)

    async def close(self):
        self.closed = True


class FakeHost:
    instances: ClassVar[list] = []
    mode = "normal"

    def __init__(self, *args):
        self.closed = False
        self.dead = asyncio.Event()
        self.process = SimpleNamespace(wait=self.wait)
        self.socket = None
        self.opening = snapshot()
        self.calls = []
        self.producer = None
        self.permission_seen = asyncio.Event()
        self.terminal = 3
        self.sockets = []
        self.instances.append(self)

    async def wait(self):
        await self.dead.wait()
        return 0

    async def start(self):
        return self

    def is_running(self):
        return not self.closed

    async def snapshot(self, sid):
        if sid != SID:
            raise ConnectionError("missing", "session_missing")
        return self.opening

    async def subscribe(self, endpoint):
        assert endpoint == "$events"
        self.socket = FakeSocket(self)
        self.sockets.append(self.socket)
        return self.socket

    async def rpc(self, method, request=None):
        self.calls.append((method, request))
        if method == "session/modelCatalog":
            return CATALOG
        if method == "session/create":
            return {"sessionId": SID}
        if method == "session/state":
            return {"running": False}
        if method == "session/prompt":
            self.producer = asyncio.create_task(self.produce())
        elif method == "session/cancel":
            self.socket.put(
                {
                    "type": "event",
                    "event": event(
                        self.terminal,
                        "turn/end",
                        reason={"kind": "aborted", "reason": {"kind": "user"}},
                    ),
                }
            )
            return {"accepted": True}
        elif method == "$events/result":
            self.socket.put({"type": "cancel", "eventId": request["eventId"]})
            self.socket.put(
                {
                    "type": "event",
                    "event": event(
                        self.terminal, "turn/end", reason={"kind": "completed"}
                    ),
                }
            )
        return {}

    async def produce(self):
        self.socket.put({"type": "assistant-stream", "frame": frame(1, "start")})
        self.socket.put(
            {
                "type": "assistant-stream",
                "frame": frame(
                    2, "chunk", chunk={"type": "text-delta", "text": "部分"}
                ),
            }
        )
        if self.mode == "crash":
            await asyncio.sleep(0.02)
            self.dead.set()
            return
        if self.mode == "permission":
            self.terminal = 1
            self.socket.put(
                {
                    "type": "waterfall",
                    "eventId": "approval",
                    "agentId": SID,
                    "event": "approval/request",
                    "request": {"toolName": "bash"},
                }
            )
            return
        if self.mode == "reconnect":
            self.opening = snapshot(
                active={
                    "attemptId": "attempt",
                    "turn": 1,
                    "step": 1,
                    "startedAfterSeq": 0,
                    "nextIndex": 1,
                    "stream": [{"type": "text-chunks", "texts": ["部分"]}],
                },
                revision=2,
            )
            self.socket.queue.put_nowait(OSError("socket lost"))
            while len(self.sockets) < 2:
                await asyncio.sleep(0.01)
        if self.mode == "wait":
            self.terminal = 2
            self.socket.put(
                {
                    "type": "event",
                    "event": event(
                        1,
                        "assistant/message",
                        message={"content": [{"type": "text", "text": "部分"}]},
                    ),
                }
            )
            return
        self.socket.put(
            {
                "type": "assistant-stream",
                "frame": frame(
                    3, "chunk", index=1, chunk={"type": "text-delta", "text": "回复"}
                ),
            }
        )
        self.socket.put(
            {
                "type": "event",
                "event": event(
                    1,
                    "assistant/message",
                    message={"content": [{"type": "text", "text": "部分回复"}]},
                ),
            }
        )
        self.socket.put(
            {
                "type": "assistant-stream",
                "frame": frame(
                    4, "end", index=2, outcome={"kind": "committed", "seq": 1}
                ),
            }
        )
        self.socket.put(
            {
                "type": "event",
                "event": event(2, "turn/end", reason={"kind": "completed"}),
            }
        )

    async def close(self):
        self.closed = True
        self.dead.set()
        if self.producer:
            self.producer.cancel()
            await asyncio.gather(self.producer, return_exceptions=True)


class TestProcess(DshProcess):
    __test__ = False

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs, host_factory=FakeHost)

    async def start(self):
        return {"version": "test", "capabilities": {}}


@pytest.fixture(autouse=True)
def reset_hosts():
    FakeHost.instances = []
    FakeHost.mode = "normal"


def process(tmp_path, update, permission=None):
    return TestProcess(
        sys.executable, str(tmp_path), update, permission, harness_home=tmp_path
    )


def test_reconnect_reads_snapshot_without_resending_request(tmp_path):
    async def exercise():
        FakeHost.mode = "reconnect"
        events = []
        p = process(tmp_path, events.append)
        try:
            await p.resume(SID, str(tmp_path))
            assert await p.prompt(SID, "question", "stable-request") == "completed"
            host = p.sessions[SID].host
            assert len(host.sockets) == 2
            assert len([m for m, _ in host.calls if m == "session/prompt"]) == 1
            assert (
                next(v for m, v in host.calls if m == "session/prompt")["requestId"]
                == "stable-request"
            )
            assert [e["text"] for e in events if e["kind"] == "text"] == [
                "部分",
                "部分回复",
                "部分回复",
            ]
        finally:
            await p.close()

    asyncio.run(exercise())


@pytest.mark.parametrize("choice", ["allowed-once", "rejected", None])
def test_permission_uses_only_one_time_choice(tmp_path, choice):
    async def exercise():
        FakeHost.mode = "permission"

        async def permission(_):
            return choice

        p = process(tmp_path, lambda _: None, permission)
        try:
            await p.resume(SID, str(tmp_path))
            assert await p.prompt(SID, "question") == "completed"
            responses = [
                r for m, r in p.sessions[SID].host.calls if m == "$events/result"
            ]
            assert responses[0]["outcome"]["value"] == (
                "allowed-once" if choice == "allowed-once" else "rejected"
            )
        finally:
            await p.close()

    asyncio.run(exercise())


def test_permission_disconnect_cancels_waiter_and_never_grants_access(tmp_path):
    async def exercise():
        FakeHost.mode = "permission"
        cancelled = asyncio.Event()
        p = None

        async def permission(_):
            p.sessions[SID].host.socket.queue.put_nowait(OSError("disconnected"))
            try:
                await asyncio.Future()
            finally:
                cancelled.set()

        p = process(tmp_path, lambda _: None, permission)
        try:
            await p.resume(SID, str(tmp_path))
            with pytest.raises(ConnectionError, match="权限确认期间") as failed:
                await p.prompt(SID, "question")
            assert failed.value.code == "permission_interrupted"
            assert cancelled.is_set()
            assert not any(m == "$events/result" for m, _ in p.sessions[SID].host.calls)
        finally:
            await p.close()

    asyncio.run(exercise())


def test_host_exit_preserves_partial_content_without_creating_another_session(tmp_path):
    async def exercise():
        FakeHost.mode = "crash"
        events = []
        p = process(tmp_path, events.append)
        try:
            await p.resume(SID, str(tmp_path))
            with pytest.raises(ConnectionError) as failure:
                await p.prompt(SID, "question")
            assert failure.value.code == "host_stopped"
            assert events[-1]["text"] == "部分"
            assert len(FakeHost.instances) == 1
            assert not any(m == "session/create" for m, _ in p.sessions[SID].host.calls)
        finally:
            await p.close()

    asyncio.run(exercise())


def test_common_service_preserves_old_acp_binding_and_releases_each_turn(tmp_path):
    async def exercise():
        store = Store(tmp_path)
        adapter = DshAdapter(TestProcess)
        adapter.resolve = lambda value="": sys.executable
        adapter.home = lambda: tmp_path
        service = AiService(store, AdapterRegistry([adapter]))
        try:
            await service.save_settings(
                ConnectionConfig(provider="deepseek-harness", model=MODEL)
            )
            store.bind(
                "conversation",
                SID,
                sys.executable,
                str(service.workspace),
                str(tmp_path),
                protocol="acp",
            )
            for _ in range(2):
                request = TurnRequest(
                    id=str(uuid4()),
                    conversationId="conversation",
                    userMessageId=str(uuid4()),
                    text="question",
                    model=MODEL,
                    teacher={"id": "robot", "name": "机器人", "prompt": "清楚回答"},
                )
                service.create_turn(request)
                await service.jobs[request.id]["task"]
                turn = store.turn(request.id)
                assert turn["status"] == "completed"
                assert turn["content"] == "部分回复"
                assert turn["protocol"] == "dsh-native"
                assert turn["dispatch"]["receivedAt"]
                assert store.binding("conversation")["external_id"] == SID
                assert store.binding("conversation")["protocol"] == "dsh-native"
                assert SID not in service.connections.loaded[adapter.id]
                assert all(h.closed for h in FakeHost.instances)
            assert not any(
                m == "session/create" for h in FakeHost.instances for m, _ in h.calls
            )
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


def test_provider_failure_keeps_received_partial_and_retry_replaces_it():
    fold = DshStream(SID, lambda _: None)
    fold.snapshot(snapshot())
    fold.frame(frame(1, "start"))
    fold.frame(frame(2, "chunk", chunk={"type": "text-delta", "text": "保留部分"}))
    fold.event(
        event(
            1,
            "assistant/attempt",
            stream=[{"type": "text-chunks", "texts": ["保留部分"]}],
        )
    )
    fold.frame(frame(3, "end", index=1, outcome={"kind": "committed", "seq": 1}))
    assert fold.content == "保留部分"
    fold.frame(frame(4, "start", attemptId="retry", startedAfterSeq=1))
    fold.frame(
        frame(
            5,
            "chunk",
            attemptId="retry",
            chunk={"type": "text-delta", "text": "重试正文"},
        )
    )
    assert fold.content == "重试正文"


def test_stop_preserves_partial_and_releases_only_its_host(tmp_path):
    async def exercise():
        FakeHost.mode = "wait"
        updates = []
        p = process(tmp_path, updates.append)
        try:
            await p.resume(SID, str(tmp_path))
            turn = asyncio.create_task(p.prompt(SID, "question"))
            while not any(e["kind"] == "text" for e in updates):
                await asyncio.sleep(0.001)
            await p.cancel(SID)
            assert await turn == "cancelled"
            assert (
                next(e["text"] for e in reversed(updates) if e["kind"] == "text")
                == "部分"
            )
            await p.release(SID)
            assert FakeHost.instances[0].closed
            assert p.is_running()
        finally:
            await p.close()

    asyncio.run(exercise())


def test_stop_failure_closes_owned_host_and_reports_unconfirmed_stop(tmp_path):
    async def exercise():
        FakeHost.mode = "wait"
        updates = []
        p = process(tmp_path, updates.append)
        try:
            await p.resume(SID, str(tmp_path))
            host = p.sessions[SID].host
            rpc = host.rpc

            async def failed(method, request=None):
                if method == "session/cancel":
                    raise ConnectionError("transport lost", "native_transport_lost")
                return await rpc(method, request)

            host.rpc = failed
            turn = asyncio.create_task(p.prompt(SID, "question"))
            while not any(e["kind"] == "text" for e in updates):
                await asyncio.sleep(0.001)
            await p.cancel(SID)
            with pytest.raises(ConnectionError) as stopped:
                await turn
            assert stopped.value.code == "stop_unconfirmed"
            assert host.closed
        finally:
            await p.close()

    asyncio.run(exercise())


def test_service_marks_host_crash_interrupted_and_retains_binding(tmp_path):
    async def exercise():
        FakeHost.mode = "crash"
        store = Store(tmp_path)
        adapter = DshAdapter(TestProcess)
        adapter.resolve = lambda value="": sys.executable
        adapter.home = lambda: tmp_path
        service = AiService(store, AdapterRegistry([adapter]))
        try:
            await service.save_settings(
                ConnectionConfig(provider="deepseek-harness", model=MODEL)
            )
            req = TurnRequest(
                id=str(uuid4()),
                conversationId="crash",
                userMessageId="msg",
                text="保留问题",
                model=MODEL,
                teacher={"id": "robot", "name": "机器人", "prompt": "说明"},
            )
            service.create_turn(req)
            await service.jobs[req.id]["task"]
            turn = store.turn(req.id)
            assert turn["status"] == "interrupted"
            assert turn["text"] == "保留问题" and turn["content"] == "部分"
            assert (
                turn["assistantMessageId"]
                not in store.receipts(adapter.id, SID)["message"]
            )
            assert req.userMessageId in store.receipts(adapter.id, SID)["message"]
            assert store.binding("crash")["external_id"] == SID
            assert store.connections()[adapter.id]["enabled"]
            assert not service.permissions
            assert all(host.closed for host in FakeHost.instances)
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


def test_native_permission_cancellation_removes_pending_choice(tmp_path):
    async def exercise():
        FakeHost.mode = "permission"
        cancelled = asyncio.Event()
        p = None

        async def permission(_):
            host = p.sessions[SID].host
            host.socket.put({"type": "cancel", "eventId": "approval"})
            host.socket.put(
                {
                    "type": "event",
                    "event": event(1, "turn/end", reason={"kind": "completed"}),
                }
            )
            try:
                await asyncio.Future()
            finally:
                cancelled.set()

        p = process(tmp_path, lambda _: None, permission)
        try:
            await p.resume(SID, str(tmp_path))
            assert await p.prompt(SID, "question") == "completed"
            assert cancelled.is_set()
            assert not any(m == "$events/result" for m, _ in p.sessions[SID].host.calls)
        finally:
            await p.close()

    asyncio.run(exercise())


def test_thinking_notifications_are_only_sent_when_phase_changes():
    updates = []
    fold = DshStream(SID, updates.append)
    fold.snapshot(snapshot())
    fold.frame(frame(1, "start"))
    for n in range(100):
        fold.frame(
            frame(
                n + 2,
                "chunk",
                index=n,
                chunk={"type": "thinking-delta", "text": "private"},
            )
        )
    assert updates == [{"sessionId": SID, "kind": "thinking"}]


def test_successful_native_rpc_may_have_no_return_value():
    import threading

    from solvemate_local.adapters.dsh_host import DshHttp

    captured = []

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def read(self, _):
            return b'{"result":{"ok":true}}'

    def open_request(req, timeout):
        captured.append(json.loads(req.data))
        return Response()

    client = DshHttp.__new__(DshHttp)
    client.origin = "http://127.0.0.1:1234"
    client.lock = threading.Lock()
    client.opener = SimpleNamespace(open=open_request)
    request = {
        "clientId": "client",
        "eventId": "event",
        "outcome": {"kind": "result", "value": "allowed-once"},
    }
    assert client.rpc("$events/result", request) is None
    assert captured[0]["payload"]["args"] == request


def test_cleanup_failure_keeps_host_reference_for_retry(tmp_path):
    async def exercise():
        p = process(tmp_path, lambda _: None)
        await p.resume(SID, str(tmp_path))
        host = p.sessions[SID].host
        close = host.close

        async def failed():
            raise PermissionError("Cannot stop owned process")

        host.close = failed
        with pytest.raises(PermissionError):
            await p.release(SID)
        assert p.sessions[SID].host is host
        host.close = close
        await p.release(SID)
        assert SID not in p.sessions and host.closed
        await p.close()

    asyncio.run(exercise())


def test_tool_status_uses_same_native_call_id_before_and_after_result():
    updates = []
    fold = DshStream(SID, updates.append)
    fold.snapshot(snapshot())
    fold.event(event(1, "tool/call", callId="native-call", name="bash", arguments={}))
    fold.event(
        event(
            2,
            "tool/result",
            message={"toolCallId": "native-call", "isError": False, "content": []},
        )
    )
    tools = [item for item in updates if item["kind"] == "tool"]
    assert [item["id"] for item in tools] == ["native-call", "native-call"]
    assert [item["title"] for item in tools] == ["bash", "bash"]
    assert [item["status"] for item in tools] == ["in_progress", "completed"]


def test_reconnect_snapshot_retains_original_native_turn_identifier():
    updates = []
    fold = DshStream(SID, updates.append)
    fold.snapshot(snapshot())
    fold.snapshot(snapshot([event(1, "turn/start", turn=42)]))
    assert updates == [{"sessionId": SID, "kind": "turn", "externalTurnId": "42"}]


def test_different_sessions_keep_independent_hosts_when_one_exits(tmp_path):
    async def exercise():
        p = process(tmp_path, lambda _: None)
        try:
            await p.resume(SID, str(tmp_path))
            original = FakeHost.snapshot

            async def other_snapshot(self, sid):
                return {**self.opening, "header": {"id": sid}}

            FakeHost.snapshot = other_snapshot
            try:
                await p.resume("second", str(tmp_path))
            finally:
                FakeHost.snapshot = original
            first, second = p.sessions[SID].host, p.sessions["second"].host
            await p.release(SID)
            assert first.closed and not second.closed
            assert p.is_running() and "second" in p.sessions
            assert await second.rpc("session/state", {"sessionId": "second"}) == {
                "running": False
            }
        finally:
            await p.close()

    asyncio.run(exercise())


@pytest.mark.parametrize(
    "outcome", ["success", "missing", "busy", "invalid", "cancelled"]
)
def test_rename_only_updates_registered_session_and_releases_host(tmp_path, outcome):
    calls = []

    class RenameHost:
        closed = False

        async def rpc(self, method, body):
            calls.append((method, body))
            if outcome in {"missing", "busy"}:
                raise ConnectionError("Native rename rejected", "session_" + outcome)
            if outcome == "invalid":
                return {}
            if outcome == "cancelled":
                raise asyncio.CancelledError
            return {"title": body["title"], "seq": 8}

        async def close(self):
            self.closed = True

    async def scenario():
        host = RenameHost()
        process = DshProcess("unused", str(tmp_path), harness_home=tmp_path)

        async def owned_host(workspace):
            assert workspace == str(tmp_path)
            return host

        process.host = owned_host
        title = '指针讨论 & "地址"'
        if outcome == "success":
            await process.rename(SID, title)
        elif outcome == "cancelled":
            with pytest.raises(asyncio.CancelledError):
                await process.rename(SID, title)
        else:
            with pytest.raises(ConnectionError) as error:
                await process.rename(SID, title)
            assert error.value.code == (
                "rename_unconfirmed" if outcome == "invalid" else "session_" + outcome
            )
        assert calls == [("session/rename", {"sessionId": SID, "title": title})]
        assert host.closed
        assert not process.sessions

    asyncio.run(scenario())


def test_native_rename_adapter_reuses_process_and_cleans_up_start_failure():
    calls = []

    class Process:
        failure = None

        async def start(self):
            calls.append("start")
            if self.failure:
                raise self.failure

        async def rename(self, sid, title):
            calls.append((sid, title))

        async def close(self):
            calls.append("close")

    async def scenario():
        process = Process()
        adapter = DshAdapter(lambda *args, **kwargs: process)
        assert adapter.public_capabilities({})["rename"] == "supported"
        await adapter.rename_session("unused", SID, "新名称", "unused")
        assert calls == ["start", (SID, "新名称"), "close"]
        calls.clear()
        process.failure = ConnectionError("Host start failed", "program_start_failed")
        with pytest.raises(ConnectionError):
            await adapter.rename_session("unused", SID, "新名称", "unused")
        assert calls == ["start", "close"]

    asyncio.run(scenario())
