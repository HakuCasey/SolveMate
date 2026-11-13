"""同时验证两种协议转换、旧数据迁移和会话绑定，普通测试不调用真实模型。"""

import asyncio
import json
import sqlite3
import sys
from typing import ClassVar
from uuid import uuid4

import pytest
from test_service import FakeAcp, fake_registry

from solvemate_local.adapters.hermes import HermesAdapter, HermesProcess, find_hermes
from solvemate_local.errors import ConnectionError
from solvemate_local.models import ConnectionConfig, DetectRequest, TurnRequest
from solvemate_local.service import AiService
from solvemate_local.store import Store


class FakeHermes(FakeAcp):
    calls: ClassVar[list] = []
    sessions: ClassVar[set] = set()

    async def start(self):
        self.capabilities["loadSession"] = True
        return await super().start()

    async def call(self, method, params, timeout=40):
        if method == "session/load":
            self.calls.append((method, params))
            if params["sessionId"] not in self.sessions:
                raise ConnectionError("Session missing", "session_missing")
            result = {}
        else:
            result = await super().call(method, params, timeout)
        if method in {"session/new", "session/load", "session/resume"}:
            return {
                **result,
                "configOptions": [
                    {
                        "id": "reasoning_effort",
                        "currentValue": "medium",
                        "options": [
                            {"value": level, "name": level}
                            for level in ("medium", "high")
                        ],
                    }
                ],
                "models": {
                    "currentModelId": "custom:school:c-model",
                    "availableModels": [
                        {"modelId": "custom:school:c-model", "name": "C Model"},
                        {"modelId": "custom:school:other", "name": "Other Model"},
                    ],
                },
            }
        if method == "session/set_config_option":
            assert params["configId"] == "reasoning_effort"
            return {
                "configOptions": [
                    {
                        "id": "reasoning_effort",
                        "currentValue": params["value"],
                        "options": [
                            {"value": level, "name": level}
                            for level in ("medium", "high")
                        ],
                    }
                ]
            }
        return result


async def completed(service, ident):
    task = service.jobs.get(ident, {}).get("task")
    if task:
        await task
    return service.store.turn(ident)


def question(
    conversation="dialog",
    connection="hermes-local",
    model="custom:school:c-model",
    teacher="c",
):
    return TurnRequest(
        id=str(uuid4()),
        conversationId=conversation,
        connectionId=connection,
        userMessageId=str(uuid4()),
        text="为什么整数除法会截断？",
        teacher={"id": teacher, "name": "C 语言教师", "prompt": "清楚回答。"},
        model=model,
    )


def test_provider_sessions_are_separate_and_model_change_preserves_binding(tmp_path):
    async def exercise():
        store = Store(tmp_path)
        service = AiService(store, registry=fake_registry(FakeHermes))
        try:
            await service.save_settings(
                ConnectionConfig(executablePath=sys.executable, model="opaque-model-a")
            )
            await service.save_settings(
                ConnectionConfig(
                    provider="hermes",
                    executablePath=sys.executable,
                    model="custom:school:c-model",
                )
            )
            assert len(service.settings()["connections"]) == 2
            first = question()
            service.create_turn(first)
            one = await completed(service, first.id)
            assert one["status"] == "completed"
            two = question(model="custom:school:other")
            service.create_turn(two)
            assert (await completed(service, two.id))["externalSessionId"] == one[
                "externalSessionId"
            ]
            switch = question(connection="deepseek-local", model="opaque-model-a")
            service.create_turn(switch)
            switched = await completed(service, switch.id)
            assert switched["status"] == "completed"
            assert switched["externalSessionId"] != one["externalSessionId"]
            with pytest.raises(ConnectionError, match="另一个机器人"):
                service.create_turn(question(teacher="math"))
            # 全局默认改回 DSH，旧 Hermes 对话仍恢复原生会话。
            await service.save_settings(
                ConnectionConfig(executablePath=sys.executable, model="opaque-model-a")
            )
            third = question()
            service.create_turn(third)
            restored = await completed(service, third.id)
            assert restored["externalSessionId"] == one["externalSessionId"]
            assert restored["connectionId"] == "hermes-local"
            dsh = question("dsh-dialog", "deepseek-local", "opaque-model-a")
            service.create_turn(dsh)
            assert (await completed(service, dsh.id))["status"] == "completed"
            assert (
                store.binding("dialog", "hermes-local")["connection_id"]
                == "hermes-local"
            )
            assert (
                store.binding("dsh-dialog")["external_id"] != one["externalSessionId"]
            )
            assert any(method == "session/set_model" for method, _ in FakeHermes.calls)
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


def test_detection_reuses_one_session_across_detect_save_and_restart(tmp_path):
    async def exercise():
        FakeHermes.calls = []
        store = Store(tmp_path)
        service = AiService(store, registry=fake_registry(FakeHermes))
        request = DetectRequest(provider="hermes", executablePath=sys.executable)
        try:
            await service.probe(request)
            await service.probe(request)
            await service.save_settings(
                ConnectionConfig(
                    provider="hermes",
                    executablePath=sys.executable,
                    model="custom:school:c-model",
                )
            )
            await service.close()
            service = AiService(store, registry=fake_registry(FakeHermes))
            await service.probe(request)
            creates = [
                params for method, params in FakeHermes.calls if method == "session/new"
            ]
            assert len(creates) == 1
            assert not any(method == "session/close" for method, _ in FakeHermes.calls)
            FakeHermes.sessions.clear()
            before = len(creates)
            with pytest.raises(ConnectionError) as failed:
                await service.probe(request)
            assert failed.value.code == "probe_resume_failed"
            assert len([m for m, _ in FakeHermes.calls if m == "session/new"]) == before
            await service.probe(request.model_copy(update={"resetProbe": True}))
            assert (
                len([m for m, _ in FakeHermes.calls if m == "session/new"])
                == before + 1
            )
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


def test_legacy_config_and_binding_migrate_without_replacing_native_id(tmp_path):
    db = sqlite3.connect(tmp_path / "state.sqlite3")
    db.executescript(
        "CREATE TABLE config(id INTEGER PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE bindings(conversation_id TEXT PRIMARY KEY, external_id TEXT NOT NULL, executable TEXT NOT NULL, workspace TEXT NOT NULL);"
    )
    config = {
        "config": {"provider": "deepseek-harness", "model": "opaque-model-a"},
        "detection": {},
    }
    db.execute("INSERT INTO config VALUES(1, ?)", (json.dumps(config),))
    db.execute(
        "INSERT INTO bindings VALUES('old', 'native-original', '/program', '/workspace')"
    )
    db.commit()
    db.close()
    store = Store(tmp_path)
    try:
        assert (
            store.connections()["deepseek-local"]["config"]["model"]
            == config["config"]["model"]
        )
        assert store.preferences()["defaultConnectionId"] == "deepseek-local"
        assert (
            store.db.execute("SELECT COUNT(*) FROM metadata_backups").fetchone()[0] == 3
        )
        assert store.binding("old")["external_id"] == "native-original"
        assert store.binding("old")["connection_id"] == "deepseek-local"
    finally:
        store.close()


@pytest.mark.parametrize("platform", ["darwin", "win32"])
def test_hermes_launcher_keeps_paths_and_arguments_separate(
    monkeypatch, tmp_path, platform
):
    from solvemate_local.adapters import hermes

    monkeypatch.setattr(hermes.sys, "platform", platform)
    monkeypatch.setenv("HERMES_HOME", str(tmp_path / "配置 空格"))
    launcher = tmp_path / ("Hermes 中文.exe" if platform == "win32" else "hermes")
    launcher.touch()
    launcher.chmod(0o700)
    executable = find_hermes(str(launcher))
    argv, env = asyncio.run(HermesProcess(executable, str(tmp_path)).prepare_launch())
    assert argv == [str(launcher.resolve()), "acp"]
    assert env["HERMES_HOME"] == str(tmp_path / "配置 空格")
    assert "ELECTRON_RUN_AS_NODE" not in env


def test_hermes_refuses_batch_file_and_missing_program(tmp_path):
    wrapper = tmp_path / "hermes.cmd"
    wrapper.touch()
    with pytest.raises(ConnectionError) as error:
        find_hermes(str(wrapper))
    assert error.value.code == "launcher_unsupported"
    with pytest.raises(ConnectionError) as error:
        find_hermes(str(tmp_path / "missing"))
    assert error.value.code == "program_missing"


def test_opaque_model_ids_are_not_derived_from_display_names():
    options = HermesAdapter.describe(
        {
            "models": {
                "currentModelId": "custom:a:model",
                "availableModels": [{"modelId": "custom:a:model", "name": "Friendly"}],
            }
        }
    )
    assert options["models"][0]["value"] == "custom:a:model"


def test_unknown_session_creation_is_not_repeated(tmp_path):
    class LostCreation(FakeAcp):
        creates = 0

        async def call(self, method, params, timeout=40):
            if method == "session/new" and self.on_update:
                type(self).creates += 1
                raise ConnectionError("Creation result lost", "request_timeout")
            return await super().call(method, params, timeout)

    async def exercise():
        store = Store(tmp_path)
        service = AiService(store, registry=fake_registry(dsh_factory=LostCreation))
        try:
            await service.save_settings(
                ConnectionConfig(executablePath=sys.executable, model="opaque-model-a")
            )
            first = question(connection="deepseek-local", model="opaque-model-a")
            service.create_turn(first)
            assert (await completed(service, first.id))["status"] == "failed"
            with pytest.raises(ConnectionError) as error:
                service.create_turn(
                    question(connection="deepseek-local", model="opaque-model-a")
                )
            assert error.value.code == "session_creation_uncertain"
            assert LostCreation.creates == 1
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


@pytest.mark.parametrize("found", [True, False])
def test_browser_binding_restores_the_original_id_after_server_data_loss(
    tmp_path, found
):
    async def exercise():
        store = Store(tmp_path)
        service = AiService(store, registry=fake_registry())
        try:
            await service.save_settings(
                ConnectionConfig(executablePath=sys.executable, model="opaque-model-a")
            )
            FakeAcp.sessions.discard("native-existing")
            if found:
                FakeAcp.sessions.add("native-existing")
            request = question(
                connection="deepseek-local", model="opaque-model-a"
            ).model_copy(
                update={"externalSessionId": "native-existing", "bindingRevision": 50}
            )
            before = len([m for m, _ in FakeAcp.calls if m == "session/new"])
            service.create_turn(request)
            result = await completed(service, request.id)
            assert result["status"] == ("completed" if found else "failed")
            if not found:
                assert result["errorCode"] == "session_missing"
            assert store.binding("dialog")["external_id"] == "native-existing"
            assert store.binding("dialog")["revision"] > 50
            assert len([m for m, _ in FakeAcp.calls if m == "session/new"]) == before
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


def test_hermes_load_refuses_missing_session_without_using_fallback_resume():
    class Missing(FakeHermes):
        async def call(self, method, params, timeout=40):
            assert method == "session/load"

    async def exercise():
        adapter = HermesAdapter(Missing)
        process = adapter.process(sys.executable, "/workspace")
        await process.start()
        with pytest.raises(ConnectionError) as error:
            await adapter.resume(process, "missing-native", "/workspace")
        assert error.value.code == "session_missing"

    asyncio.run(exercise())


def test_windows_hermes_candidate_matches_official_source_installer(
    monkeypatch, tmp_path
):
    from solvemate_local.adapters import hermes

    monkeypatch.setattr(hermes.sys, "platform", "win32")
    monkeypatch.delenv("HERMES_HOME", raising=False)
    monkeypatch.delenv("HERMES_DATA_DIR_SUFFIX", raising=False)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path / "Local 中文"))
    assert hermes.default_path() == str(tmp_path / "Local 中文/hermes/bin/hermes.exe")


def test_hermes_home_honors_platform_suffix_and_expands_override(monkeypatch, tmp_path):
    from solvemate_local.adapters import hermes

    monkeypatch.setattr(hermes.sys, "platform", "win32")
    monkeypatch.delenv("HERMES_HOME", raising=False)
    monkeypatch.setenv("LOCALAPPDATA", str(tmp_path))
    monkeypatch.setenv("HERMES_DATA_DIR_SUFFIX", "-preview")
    assert hermes.hermes_home() == tmp_path / "hermes-preview"
    monkeypatch.setenv("SM_TEST_HOME", str(tmp_path / "自定义"))
    monkeypatch.setenv("HERMES_HOME", "$SM_TEST_HOME")
    assert hermes.hermes_home() == tmp_path / "自定义"


@pytest.mark.parametrize("phase", ["start", "create", "close"])
def test_detection_deadline_closes_process_and_preserves_uncertain_creation(
    tmp_path, monkeypatch, phase
):
    from solvemate_local import connections

    monkeypatch.setattr(connections, "PROBE_TIMEOUT", 0.02)

    async def exercise():
        instances = []

        class SlowHermes(FakeHermes):
            async def start(self):
                instances.append(self)
                if phase == "start":
                    await asyncio.sleep(1)
                return await super().start()

            async def call(self, method, params, timeout=40):
                if phase == "create" and method == "session/new":
                    await asyncio.sleep(1)
                return await super().call(method, params, timeout)

            async def close(self):
                if phase == "close":
                    await asyncio.sleep(0.05)
                await super().close()

        store = Store(tmp_path)
        service = AiService(store, registry=fake_registry(SlowHermes))
        request = DetectRequest(provider="hermes", executablePath=sys.executable)
        try:
            with pytest.raises(ConnectionError) as failed:
                await service.probe(request)
            assert failed.value.code == "detection_timeout"
            assert len(instances) == 1
            assert not instances[0].is_running()
            assert not service.connections.probe_locks["hermes-local"].locked()
            if phase == "create":
                with pytest.raises(ConnectionError) as uncertain:
                    await service.probe(request)
                assert uncertain.value.code == "probe_uncertain"
                assert len(instances) == 1
        finally:
            await service.close()
            store.close()

    asyncio.run(exercise())


def test_slow_service_does_not_queue_duplicate_checks_or_block_another_service(
    tmp_path,
):
    async def exercise():
        started, release = asyncio.Event(), asyncio.Event()

        class SlowHermes(FakeHermes):
            async def start(self):
                started.set()
                await release.wait()
                return await super().start()

        store = Store(tmp_path)
        service = AiService(store, registry=fake_registry(SlowHermes))
        request = DetectRequest(provider="hermes", executablePath=sys.executable)
        pending = asyncio.create_task(service.probe(request))
        try:
            await started.wait()
            with pytest.raises(ConnectionError) as duplicate:
                await service.probe(request)
            assert duplicate.value.code == "detection_busy"
            other = await asyncio.wait_for(
                service.probe(DetectRequest(executablePath=sys.executable)), 1
            )
            assert other["models"]
            release.set()
            assert (await pending)["models"]
        finally:
            release.set()
            await pending
            await service.close()
            store.close()

    asyncio.run(exercise())
