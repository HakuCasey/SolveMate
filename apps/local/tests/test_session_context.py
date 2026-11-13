"""在独立数据库和模拟 Harness 中核对跨服务恢复、内容去重与明确确认。"""

import asyncio
import sys
from uuid import uuid4

import pytest
from test_adapters import FakeHermes, completed
from test_service import FakeAcp, fake_registry

from solvemate_local.errors import ConnectionError
from solvemate_local.models import ConnectionConfig, TurnRequest
from solvemate_local.prompting import content_key
from solvemate_local.service import AiService
from solvemate_local.store import Store


@pytest.fixture(autouse=True)
def isolated_harness(monkeypatch, tmp_path):
    monkeypatch.setenv("DSH_HOME", str(tmp_path / "dsh"))
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "hermes"))
    for cls in (FakeAcp, FakeHermes):
        cls.calls, cls.sessions = [], set()


def page(number=2, text="unique page body: int *p = &a;", version="v1"):
    return {
        "title": f"课本 · 第 {number} 页",
        "content": text,
        "selection": {
            "courseId": "c-language",
            "version": version,
            "kind": "textbooks",
            "itemId": "CB001",
            "pageNumber": number,
        },
    }


def question(text, connection="deepseek-local", **extra):
    return TurnRequest.model_validate(
        {
            "id": str(uuid4()),
            "conversationId": "one-learning-discussion",
            "userMessageId": str(uuid4()),
            "text": text,
            "connectionId": connection,
            "model": "custom:school:c-model"
            if connection == "hermes-local"
            else "opaque-model-a",
            "teacher": {"id": "robot", "name": "机器人", "prompt": "准确回答。"},
            **extra,
        }
    )


async def configure(service, hermes=False):
    await service.save_settings(
        ConnectionConfig(executablePath=sys.executable, model="opaque-model-a")
    )
    if hermes:
        await service.save_settings(
            ConnectionConfig(
                provider="hermes",
                executablePath=sys.executable,
                model="custom:school:c-model",
            )
        )


async def run(service, request):
    service.create_turn(request)
    result = await completed(service, request.id)
    assert result["status"] == "completed", result
    return result


def prompts(cls):
    return [
        params["prompt"][0]["text"]
        for method, params in cls.calls
        if method == "session/prompt"
        and not params["prompt"][0]["text"].startswith("/")
    ]


def test_a_b_a_keeps_two_sessions_and_only_catches_up_unreceived_messages(tmp_path):
    async def exercise():
        store = Store(tmp_path)
        service = AiService(store, registry=fake_registry(FakeHermes))
        try:
            await configure(service, hermes=True)
            first = question("first user question", readingContext=page())
            a = await run(service, first)
            history = [
                {
                    "id": first.userMessageId,
                    "role": "user",
                    "content": first.text,
                    "readingContext": page(),
                },
                {
                    "id": a["assistantMessageId"],
                    "role": "assistant",
                    "content": a["content"],
                },
            ]
            second = question(
                "second user question",
                "hermes-local",
                readingContext=page(),
                history=history,
            )
            b = await run(service, second)
            assert b["externalSessionId"] != a["externalSessionId"]
            assert prompts(FakeHermes)[0].count(page()["content"]) == 1
            assert "first user question" in prompts(FakeHermes)[0]
            history += [
                {"id": second.userMessageId, "role": "user", "content": second.text},
                {
                    "id": b["assistantMessageId"],
                    "role": "assistant",
                    "content": b["content"],
                },
            ]
            third = question(
                "third user question", readingContext=page(), history=history
            )
            resumed = await run(service, third)
            assert resumed["externalSessionId"] == a["externalSessionId"]
            assert page()["content"] not in prompts(FakeAcp)[1]
            assert "first user question" not in prompts(FakeAcp)[1]
            assert "second user question" in prompts(FakeAcp)[1]
            assert "内容标记：" in prompts(FakeAcp)[1]
            assert store.binding(first.conversationId) is None
            assert (
                store.binding(first.conversationId, "deepseek-local")["external_id"]
                == a["externalSessionId"]
            )
            assert (
                store.binding(first.conversationId, "hermes-local")["external_id"]
                == b["externalSessionId"]
            )
            assert (
                content_key(first.readingContext)
                in store.receipts("deepseek-local", a["externalSessionId"])["content"]
            )
            assert resumed["dispatch"]["contentKeys"] == []
            assert resumed["dispatch"]["receivedAt"] > 0
            assert resumed["dispatch"]["templateVersion"] == "learning-discussion-v2"
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


def test_receipts_survive_stop_restart_page_return_and_changed_content(tmp_path):
    async def exercise():
        store = Store(tmp_path)
        service = AiService(store, registry=fake_registry())
        try:
            await configure(service)
            first = question("wait-test", readingContext=page())
            service.create_turn(first)
            for _ in range(100):
                if (store.turn(first.id).get("dispatch") or {}).get("receivedAt"):
                    break
                await asyncio.sleep(0.01)
            assert store.turn(first.id)["dispatch"]["receivedAt"]
            await service.cancel(first.id)
            stopped = await completed(service, first.id)
            assert stopped["status"] == "cancelled"
            sid = stopped["externalSessionId"]
            await service.close()
            store.close()
            store = Store(tmp_path)
            service = AiService(store, registry=fake_registry())
            next_page = question(
                "another page", readingContext=page(3, "next page text")
            )
            await run(service, next_page)
            same = await run(
                service, question("return to original page", readingContext=page())
            )
            assert same["externalSessionId"] == sid
            assert page()["content"] not in prompts(FakeAcp)[-1]
            await run(
                service,
                question(
                    "same location new content",
                    readingContext=page(text="revised body"),
                ),
            )
            assert "revised body" in prompts(FakeAcp)[-1]
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


def test_no_receipt_is_inferred_when_prompt_disconnects_without_acknowledgment(
    tmp_path,
):
    class Silent(FakeAcp):
        async def call(self, method, params, timeout=40):
            if method == "session/prompt":
                raise ConnectionError("Process stopped.", "process_stopped")
            return await super().call(method, params, timeout)

    async def exercise():
        store = Store(tmp_path)
        service = AiService(store, registry=fake_registry(dsh_factory=Silent))
        try:
            await configure(service)
            req = question("not acknowledged", readingContext=page())
            service.create_turn(req)
            turn = await completed(service, req.id)
            assert turn["status"] == "failed"
            assert turn["submissionStatus"] == "uncertain"
            assert "receivedAt" not in turn["dispatch"]
            assert (
                store.receipts("deepseek-local", turn["externalSessionId"])["content"]
                == set()
            )
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


def test_missing_session_is_only_replaced_after_explicit_confirmation(tmp_path):
    async def exercise():
        store = Store(tmp_path)
        service = AiService(store, registry=fake_registry())
        try:
            await configure(service)
            first = await run(service, question("original", readingContext=page()))
            old_sid = first["externalSessionId"]
            await service.close()
            FakeAcp.sessions.clear()
            service = AiService(store, registry=fake_registry())
            failed_request = question(
                "restore original", externalSessionId=old_sid, readingContext=page()
            )
            service.create_turn(failed_request)
            failed = await completed(service, failed_request.id)
            assert failed["errorCode"] == "session_missing"
            assert store.binding(failed_request.conversationId)["state"] == "missing"
            created = len([m for m, _ in FakeAcp.calls if m == "session/new"])
            assert created == 1
            confirmed = question(
                "restore original",
                userMessageId=failed_request.userMessageId,
                externalSessionId=old_sid,
                restartSession=True,
                readingContext=page(),
            )
            new = await run(service, confirmed)
            assert new["externalSessionId"] != old_sid
            assert store.turn(first["id"])["externalSessionId"] == old_sid
            assert page()["content"] in prompts(FakeAcp)[-1]
            assert (
                len([m for m, _ in FakeAcp.calls if m == "session/new"]) == created + 1
            )
            service.create_turn(confirmed)
            assert (
                len([m for m, _ in FakeAcp.calls if m == "session/new"]) == created + 1
            )
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


@pytest.mark.parametrize(
    "code", ["session_busy", "request_timeout", "resume_unsupported"]
)
def test_other_restore_errors_do_not_permit_replacing_the_native_session(
    tmp_path, code
):
    class FailedResume(FakeAcp):
        async def call(self, method, params, timeout=40):
            if method == "session/resume":
                raise ConnectionError("Restore failed.", code)
            return await super().call(method, params, timeout)

    async def exercise():
        store = Store(tmp_path)
        service = AiService(store, registry=fake_registry())
        try:
            await configure(service)
            first = await run(service, question("original"))
            await service.close()
            service = AiService(store, registry=fake_registry(dsh_factory=FailedResume))
            req = question("retry", externalSessionId=first["externalSessionId"])
            service.create_turn(req)
            failed = await completed(service, req.id)
            assert failed["errorCode"] == code
            with pytest.raises(ConnectionError) as error:
                service.create_turn(
                    question(
                        "do not recreate",
                        externalSessionId=first["externalSessionId"],
                        restartSession=True,
                    )
                )
            assert error.value.code == (
                "connection_disabled"
                if code == "request_timeout"
                else "binding_mismatch"
            )
            assert (
                store.binding(req.conversationId)["external_id"]
                == first["externalSessionId"]
            )
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


def test_v3_binding_migration_preserves_all_columns_and_can_add_another_service(
    tmp_path,
):
    store = Store(tmp_path)
    store.bind(
        "dialog",
        "native-a",
        "/old/path",
        "/original/workspace",
        "/home",
        "deepseek-local",
    )
    # 还原真实的旧单列主键，核对升级不会丢失已有正式绑定。
    store.db.execute("ALTER TABLE bindings RENAME TO current_bindings")
    columns = store.db.execute("PRAGMA table_info(current_bindings)").fetchall()
    declaration = ",".join(
        f"{column['name']} {column['type']}"
        + (" PRIMARY KEY" if column["name"] == "conversation_id" else "")
        for column in columns
    )
    store.db.execute(f"CREATE TABLE bindings ({declaration})")
    store.db.execute("INSERT INTO bindings SELECT * FROM current_bindings")
    store.db.execute("DROP TABLE current_bindings")
    store.db.execute("DROP TABLE session_receipts")
    store.db.execute("PRAGMA user_version=3")
    store.db.commit()
    store.close()
    restored = Store(tmp_path)
    try:
        original = restored.binding("dialog", "deepseek-local")
        assert original["external_id"] == "native-a"
        assert original["workspace"] == "/original/workspace"
        restored.bind("dialog", "native-b", "/new/path", "/b", "", "hermes-local")
        assert restored.binding("dialog", "deepseek-local") == original
        assert restored.db.execute("PRAGMA user_version").fetchone()[0] == 4
        assert restored.db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
    finally:
        restored.close()
