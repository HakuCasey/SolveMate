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
            assert resumed["dispatch"]["templateVersion"] == "learning-discussion-v6"
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
            from test_prompting import research_context

            req = question(
                "not acknowledged", readingContext=page(), research=research_context()
            )
            service.create_turn(req)
            turn = await completed(service, req.id)
            assert turn["status"] == "failed"
            assert turn["submissionStatus"] == "uncertain"
            assert "receivedAt" not in turn["dispatch"]
            assert not store.receipts("deepseek-local", turn["externalSessionId"]).get(
                "instructions"
            )
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


def test_tool_instructions_follow_each_native_session_and_survive_restart(tmp_path):
    from copy import deepcopy

    from test_prompting import research_context

    async def exercise():
        store = Store(tmp_path)
        service = AiService(store, registry=fake_registry(FakeHermes))
        try:
            await configure(service, hermes=True)
            original = research_context()
            first = await run(service, question("use A", research=original))
            sid = first["externalSessionId"]
            assert set(first["dispatch"]["instructionKeys"]) == {"skill", "template"}
            same = await run(service, question("continue A", research=original))
            assert same["dispatch"]["instructionKeys"] == {}
            changed = deepcopy(original)
            changed["template"]["content"] = "模板 B"
            b = await run(service, question("use B", research=changed))
            assert set(b["dispatch"]["instructionKeys"]) == {"template"}
            await service.close()
            store.close()
            store = Store(tmp_path)
            service = AiService(store, registry=fake_registry(FakeHermes))
            back = await run(service, question("return A", research=original))
            assert back["externalSessionId"] == sid
            assert set(back["dispatch"]["instructionKeys"]) == {"template"}
            other = await run(
                service, question("other service", "hermes-local", research=original)
            )
            assert set(other["dispatch"]["instructionKeys"]) == {"skill", "template"}
            again = await run(
                service, question("back to first service", research=original)
            )
            assert again["externalSessionId"] == sid
            assert again["dispatch"]["instructionKeys"] == {}
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


@pytest.mark.parametrize("connection", ["deepseek-local", "hermes-local"])
def test_tabs_on_same_page_keep_their_sessions_across_stop_and_reopen(
    tmp_path, connection
):
    def ask(tab, text):
        return question(text, connection, conversationId=tab, readingContext=page())

    async def exercise():
        store = Store(tmp_path)
        service = AiService(store, registry=fake_registry(FakeHermes))
        try:
            await configure(service, hermes=connection == "hermes-local")
            a = ask("tab-a", "wait-test A")
            service.create_turn(a)
            async with asyncio.timeout(3):
                while not (store.turn(a.id).get("dispatch") or {}).get("receivedAt"):
                    await asyncio.sleep(0.01)
            a_sid = store.turn(a.id)["externalSessionId"]
            b = await run(service, ask("tab-b", "question B"))
            b_sid = b["externalSessionId"]
            assert a_sid != b_sid
            assert store.turn(a.id)["status"] == "running"
            assert store.receipts(connection, a_sid)["message"] == {a.userMessageId}
            assert a.userMessageId not in store.receipts(connection, b_sid)["message"]
            assert b["dispatch"]["contentKeys"] == [content_key(a.readingContext)]
            await service.cancel(a.id)
            assert (await completed(service, a.id))["status"] == "cancelled"
            assert store.turn(b["id"]) == b

            await service.close()
            store.close()
            store = Store(tmp_path)
            service = AiService(store, registry=fake_registry(FakeHermes))
            factory = FakeHermes if connection == "hermes-local" else FakeAcp
            before = len(factory.calls)
            for tab, sid in [("tab-b", b_sid), ("tab-a", a_sid)]:
                result = await run(service, ask(tab, tab + " follow-up"))
                assert result["dispatch"]["externalSessionId"] == sid
                assert result["dispatch"]["contentKeys"] == []
            calls = factory.calls[before:]
            assert [
                p["sessionId"]
                for m, p in calls
                if m in {"session/load", "session/resume"}
            ] == [b_sid, a_sid]
            assert [p["sessionId"] for m, p in calls if m == "session/prompt"] == [
                b_sid,
                a_sid,
            ]
            assert not any(
                m in {"session/new", "gateway/session.create"} for m, p in calls
            )
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


def test_foreign_session_id_in_restore_or_create_cannot_take_over_running_turn(
    tmp_path, monkeypatch
):
    from solvemate_local.adapters.types import HarnessSession

    async def exercise():
        store = Store(tmp_path)
        service = AiService(store, registry=fake_registry(FakeHermes))
        try:
            await configure(service, hermes=True)
            req = question("wait-test owner", "hermes-local")
            service.create_turn(req)
            async with asyncio.timeout(3):
                while not (store.turn(req.id).get("dispatch") or {}).get("receivedAt"):
                    await asyncio.sleep(0.01)
            sid = store.turn(req.id)["externalSessionId"]
            before = len(FakeHermes.calls)
            adapter = service.registry.connection("hermes-local")

            async def duplicate(process, workspace, model):
                return HarnessSession(sid, {})

            monkeypatch.setattr(adapter, "new_session", duplicate)
            for tab, extra in [
                ("restored-tab", {"externalSessionId": sid}),
                ("new-tab", {}),
            ]:
                other = question(
                    "foreign prompt", "hermes-local", conversationId=tab, **extra
                )
                service.create_turn(other)
                result = await completed(service, other.id)
                assert result["errorCode"] == "binding_mismatch"
                assert (
                    not result.get("externalSessionId") and result["dispatch"] is None
                )
                assert not (store.binding(tab) or {}).get("external_id")
                assert service.session_turns[("hermes-local", sid)] == req.id
            assert FakeHermes.calls[before:] == []
            service.update(
                {"sessionId": sid, "kind": "text", "text": "original response"},
                "hermes-local",
            )
            assert "original response" in store.turn(req.id)["content"]
            await service.cancel(req.id)
            assert (await completed(service, req.id))["status"] == "cancelled"
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


def test_replaced_session_still_belongs_to_its_original_dialog(tmp_path):
    async def exercise():
        store = Store(tmp_path)
        service = AiService(store, registry=fake_registry())
        try:
            await configure(service)
            first = await run(service, question("first"))
            sid = first["externalSessionId"]
            store.mark_binding(first["conversationId"], "missing", "deepseek-local")
            await run(
                service,
                question("start again", externalSessionId=sid, restartSession=True),
            )
            req = question(
                "wrong restored ID", conversationId="another", externalSessionId=sid
            )
            before = len(FakeAcp.calls)
            service.create_turn(req)
            result = await completed(service, req.id)
            assert result["errorCode"] == "binding_mismatch"
            assert not result.get("externalSessionId") and result["dispatch"] is None
            assert FakeAcp.calls[before:] == []
            # 不同服务的编号命名空间彼此独立。
            store.bind(
                "another", sid, "harness", str(tmp_path), connection_id="hermes-local"
            )
            assert store.binding("another", "hermes-local")["external_id"] == sid
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


def test_stop_during_session_restore_does_not_send_native_cancel_or_prompt(
    tmp_path, monkeypatch
):
    async def exercise():
        store = Store(tmp_path)
        service = AiService(store, registry=fake_registry())
        try:
            await configure(service)
            first = await run(service, question("original"))
            await service.close()
            service = AiService(store, registry=fake_registry())
            adapter = service.registry.connection("deepseek-local")
            started, release = asyncio.Event(), asyncio.Event()
            resume = adapter.resume

            async def delay(process, sid, workspace):
                started.set()
                await release.wait()
                return await resume(process, sid, workspace)

            monkeypatch.setattr(adapter, "resume", delay)
            req = question("withdraw", externalSessionId=first["externalSessionId"])
            before = len(FakeAcp.calls)
            service.create_turn(req)
            await asyncio.wait_for(started.wait(), 3)
            await service.cancel(req.id)
            release.set()
            result = await completed(service, req.id)
            assert result["status"] == "cancelled" and result["dispatch"] is None
            assert not any(
                m in {"session/cancel", "session/prompt"}
                for m, _ in FakeAcp.calls[before:]
            )
            assert (
                store.binding(req.conversationId)["external_id"]
                == first["externalSessionId"]
            )
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


def test_old_duplicate_bindings_cannot_resume_or_rename_either_dialog(tmp_path):
    from solvemate_local.models import SessionRename

    async def exercise():
        store = Store(tmp_path)
        service = AiService(store, registry=fake_registry(FakeHermes))
        try:
            await configure(service, hermes=True)
            for tab in ("old-a", "old-b"):
                store.bind(
                    tab, tab, "harness", str(tmp_path), connection_id="hermes-local"
                )
            # 模拟旧备份中已经存在的重复关联，不能猜测其中哪一条才是原对话。
            with store.db:
                store.db.execute("UPDATE bindings SET external_id='shared'")
            before = len(FakeHermes.calls)
            for tab in ("old-a", "old-b"):
                req = question("follow-up", "hermes-local", conversationId=tab)
                service.create_turn(req)
                result = await completed(service, req.id)
                assert (
                    result["errorCode"] == "binding_mismatch"
                    and result["dispatch"] is None
                )
                with pytest.raises(ConnectionError) as failed:
                    await service.rename_session(
                        tab,
                        SessionRename(
                            connectionId="hermes-local",
                            externalSessionId="shared",
                            title="rename",
                        ),
                    )
                assert failed.value.code == "binding_mismatch"
            assert FakeHermes.calls[before:] == []
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())
