import asyncio
import hashlib
import json
import logging
from copy import deepcopy
from importlib.metadata import PackageNotFoundError, version
from time import time
from uuid import uuid4

from .adapters import AdapterRegistry
from .adapters.types import HarnessEvent
from .connections import ConnectionManager
from .errors import ConnectionError
from .metadata import (
    UNKNOWN_CLIENT,
    normalized_detection,
    public_turn,
    validate_metadata,
)
from .prompting import TEMPLATE_VERSION, compose_prompt, prepare_prompt
from .store import Store

logger = logging.getLogger(__name__)
try:
    LOCAL_VERSION = version("solvemate-local")
except PackageNotFoundError:
    LOCAL_VERSION = None


def now():
    return int(time() * 1000)


class AiService:
    def __init__(self, store: Store, registry=None):
        self.store = store
        self.registry = registry or AdapterRegistry()
        self.workspace = store.directory / "workspace"
        self.workspace.mkdir(exist_ok=True)
        self.connections = ConnectionManager(
            store, self.registry, self.workspace, self.update, self.permission
        )
        self.jobs = {}
        self.session_turns = {}
        self.permissions = {}
        self.listeners = {}
        self.configuring = False
        self.renaming = set()
        self.disconnecting = set()

    async def rename_session(self, ident, request):
        binding = self.store.binding(ident, request.connectionId)
        if not binding or not binding["external_id"]:
            raise ConnectionError(
                "本机未保存对应的第三方会话编号，请恢复原本机数据后重试。",
                "binding_missing",
            )
        if (
            binding["connection_id"] != request.connectionId
            or binding["external_id"] != request.externalSessionId
        ):
            raise ConnectionError(
                "网页与本机的会话绑定不一致，未修改第三方会话名称。",
                "binding_mismatch",
            )
        adapter = self.registry.connection(binding["connection_id"])
        if not adapter.supports_rename:
            return {"status": "unsupported"}
        if (
            self.configuring
            or ident in self.renaming
            or any(turn["conversationId"] == ident for turn in self.jobs.values())
        ):
            raise ConnectionError(
                "此会话或连接正在处理其他操作，请稍后重试改名。",
                "conversation_busy",
            )
        adapter, saved = self.connections.resolve(binding["connection_id"])
        self.renaming.add(ident)
        try:
            executable = adapter.resolve(saved["config"]["executablePath"])
            await asyncio.wait_for(
                adapter.rename_session(
                    executable,
                    binding["external_id"],
                    request.title,
                    str(self.workspace),
                ),
                40,
            )
            return {"status": "synced"}
        except TimeoutError as error:
            raise ConnectionError(
                "等待第三方会话改名超时，无法确认是否完成。请查看原会话名称后重试。",
                "request_timeout",
            ) from error
        except OSError as error:
            raise ConnectionError(
                f"无法启动 {adapter.name} 或访问原会话目录，请检查连接配置后重试。",
                "program_start_failed",
            ) from error
        finally:
            self.renaming.discard(ident)

    def settings(self):
        saved = self.store.config()
        services = self.connections.services()
        default = (
            self.registry.provider(saved["config"]["provider"])
            if saved
            else self.registry.adapters[0]
        )
        service = next(item for item in services if item["id"] == default.id)
        preference = self.store.preferences()
        result = {
            "schemaVersion": 3,
            "preferencesRevision": preference["revision"],
            "enabled": any(
                value["enabled"] for value in self.store.connections().values()
            ),
            "defaultConnectionId": preference["defaultConnectionId"],
            "defaultModel": preference["defaultModel"],
            "config": saved["config"] if saved else None,
            "detection": saved["detection"] if saved else None,
            "connections": [
                {
                    "id": ident,
                    **value,
                    "state": "connected"
                    if value["enabled"] and value["check"]["status"] != "error"
                    else "disconnected",
                }
                for ident, value in self.store.connections().items()
            ],
            "services": services,
            "detectedPath": service["detectedPath"],
            "defaultPath": service["defaultPath"],
            "busy": bool(self.jobs),
        }
        deleted = set(self.store.deleted_connections()) - set(self.store.connections())
        if deleted:
            result["deletedConnectionIds"] = sorted(deleted)
        validate_metadata("AiSettings", result)
        return result

    async def probe(self, request):
        adapter = self.registry.provider(request.provider)
        if self.configuring or adapter.id in self.disconnecting:
            raise ConnectionError(
                "该服务正在断开或保存配置，请稍后重试。", "connection_busy"
            )
        before = self.store.connections().get(adapter.id)
        expected = (
            request.expectedRevision
            if request.expectedRevision is not None
            else (before or {}).get("revision", 0)
        )
        if expected != (before or {}).get("revision", 0):
            raise ConnectionError(
                "连接配置已变化，请刷新后重新检测。", "configuration_conflict"
            )
        try:
            result = normalized_detection(await self.connections.probe(request))
        except ConnectionError as error:
            if error.code not in {
                "detection_busy",
                "detection_cancelled",
                "probe_busy",
                "probe_uncertain",
                "probe_resume_failed",
            }:
                current = self.store.connections().get(adapter.id)
                if current and current["revision"] == expected:
                    self.store.set_connection_state(adapter.id, False, expected)
                    self.store.record_connection_check(adapter.id, "error", str(error))
                    await self.disconnect_resources(adapter.id)
            raise
        # 检测就是建连的判断；保存成功结果，不要求用户再点启用。
        current = self.store.connections().get(adapter.id)
        if (current or {}).get("revision", 0) != expected:
            raise ConnectionError(
                "连接状态已变化，本次检测结果未应用，请重新检测。",
                "configuration_conflict",
            )
        if before and before["config"]["model"] == result["currentModel"]:
            saved_effort = before["config"]["reasoningEffort"]
            if saved_effort in {item["value"] for item in result["reasoningOptions"]}:
                result["currentReasoning"] = saved_effort
        config = {
            "provider": request.provider,
            "executablePath": request.executablePath,
            "model": result["currentModel"],
            "reasoningEffort": result["currentReasoning"],
        }
        self.store.save_connection(
            adapter.id,
            {"config": config, "detection": result, "enabled": True},
            expected_revision=expected,
        )
        return result

    def record_probe(self, request, status, error=None):
        ident = self.registry.provider(request.provider).id
        saved = self.store.connections().get(ident)
        if (
            saved
            and saved["config"]["executablePath"] == request.executablePath
            and saved["config"]["model"] == request.model
        ):
            self.store.record_connection_check(ident, status, error)

    async def set_default(self, ident, revision, model_id=None):
        self.store.set_default(ident, revision, model_id)
        return self.settings()

    async def disconnect_resources(self, ident):
        await self.connections.stop_probe(ident)
        tasks = []
        for turn in list(self.jobs.values()):
            if turn["connectionId"] != ident:
                continue
            turn["stopRequested"] = True
            self.resolve_permissions(turn["id"])
            task = turn.get("task")
            if task and task is not asyncio.current_task():
                task.cancel()
                tasks.append(task)
        await asyncio.gather(*tasks, return_exceptions=True)
        await self.connections.close_connection(ident)

    async def delete_connection(self, ident, revision, preferences_revision):
        if self.configuring or self.renaming:
            raise ConnectionError("配置正在保存，请稍后删除。", "connection_busy")
        self.configuring = True
        try:
            # 先检查版本，再断开；资源释放失败时仍保留配置以便重试。
            current = self.store.connections().get(ident)
            if current and (
                current["revision"] != revision
                or self.store.preferences()["revision"] != preferences_revision
            ):
                raise ConnectionError(
                    "配置已变化，请刷新后重试。", "configuration_conflict"
                )
            await self.disconnect_resources(ident)
            self.store.delete_connection(ident, revision, preferences_revision)
            return self.settings()
        finally:
            self.configuring = False

    async def set_connection_state(self, ident, enabled, revision):
        if self.configuring or self.renaming:
            raise ConnectionError("配置正在保存，请稍后重试。", "connection_busy")
        if enabled:
            saved = self.store.connections().get(ident)
            if not saved:
                raise ConnectionError("请先检测连接。", "not_configured")
            # 兼容旧接口，不能再用布尔开关绕过检测。
            from .models import DetectRequest

            await self.probe(
                DetectRequest(
                    provider=saved["config"]["provider"],
                    executablePath=saved["config"]["executablePath"],
                    model=saved["config"]["model"],
                    expectedRevision=revision,
                )
            )
            return self.settings()
        self.disconnecting.add(ident)
        try:
            self.store.set_connection_state(ident, False, revision)
            try:
                await self.disconnect_resources(ident)
            except Exception as error:
                logger.exception(
                    "Failed to disconnect an AI service: connection=%s", ident
                )
                raise ConnectionError(
                    "未能完全断开连接，请重试断开。", "disconnect_failed"
                ) from error
            return self.settings()
        finally:
            self.disconnecting.discard(ident)

    async def save_settings(self, config):
        if self.configuring or self.renaming:
            raise ConnectionError("连接配置正在保存，请稍后重试。", "connection_busy")
        self.configuring = True
        try:
            return await self._save_settings(config)
        finally:
            self.configuring = False

    async def disable(self, expected_revision=None):
        if self.jobs or self.configuring or self.renaming:
            raise ConnectionError(
                "有对话正在生成或配置正在保存，请稍后停用连接。", "connection_busy"
            )
        self.configuring = True
        try:
            await self.connections.close()
            self.store.clear_config(expected_revision)
            return self.settings()
        finally:
            self.configuring = False

    def check_config_revision(self, config):
        preference = self.store.preferences()
        adapter = self.registry.provider(config.provider)
        current = self.store.connections().get(adapter.id)
        if (
            config.expectedRevision is not None
            and config.expectedRevision != (current or {}).get("revision", 0)
        ) or (
            config.expectedPreferencesRevision is not None
            and config.expectedPreferencesRevision != preference["revision"]
        ):
            raise ConnectionError(
                "AI 配置已在其他窗口更新，请重新读取后再保存。",
                "configuration_conflict",
            )

    async def _save_settings(self, config):
        self.check_config_revision(config)
        if self.jobs:
            raise ConnectionError(
                "有对话正在生成，请停止或等待完成后再保存连接配置。", "connection_busy"
            )
        adapter = self.registry.provider(config.provider)
        current = self.store.connections().get(adapter.id)
        # 选择已知模型不等于重新建连；程序配置未变时使用同一份目录校验。
        reusable = (
            current
            and current["enabled"]
            and current["check"]["status"] != "error"
            and current["config"]["executablePath"] == config.executablePath
        )
        if reusable:
            detection = normalized_detection(current["detection"])
        else:
            try:
                detection = normalized_detection(await self.connections.probe(config))
            except ConnectionError as error:
                if error.code not in {
                    "detection_busy",
                    "probe_busy",
                    "probe_uncertain",
                    "probe_resume_failed",
                }:
                    self.record_probe(config, "error", str(error))
                raise
        if not config.model or config.model not in {
            m["value"] for m in detection["models"]
        }:
            raise ConnectionError("请选择当前模型目录中的模型。", "model_missing")
        model_option = next(
            item for item in detection["models"] if item["value"] == config.model
        )
        reasoning_options = model_option.get(
            "reasoningOptions",
            detection["reasoningOptions"]
            if config.model == detection["currentModel"]
            else [],
        )
        options = {item["value"] for item in reasoning_options}
        if config.reasoningEffort and config.reasoningEffort not in options:
            raise ConnectionError(
                "当前模型尚未返回该推理等级，请重新检测后选择。",
                "reasoning_unsupported",
            )
        self.check_config_revision(config)
        values = config.model_dump(
            exclude={
                "expectedRevision",
                "expectedPreferencesRevision",
                "makeDefault",
                "enabled",
            }
        )
        # 配置保留用户填写的路径；解析后的程序路径只存于检测结果。
        # 两者可能分别指向应用目录和目录内的程序，不能在保存模型时互换。
        if not reusable:
            await self.connections.close_connection(adapter.id)
        saved = {"config": values, "detection": detection, "enabled": config.enabled}
        self.store.save_connection(
            adapter.id,
            saved,
            make_default=config.makeDefault,
            expected_revision=config.expectedRevision,
            expected_preferences_revision=config.expectedPreferencesRevision,
        )
        return self.settings()

    def create_turn(self, request):
        excluded = {
            field
            for field in [
                "conversationSnapshot",
                "connectionRevision",
                "robotRevision",
                "client",
                "readingContext",
            ]
            if getattr(request, field) is None
        }
        if not request.references:
            excluded.add("references")
        if not request.connectionId:
            excluded.add("connectionId")
        if request.externalSessionId is None:
            excluded.add("externalSessionId")
        request_hash = hashlib.sha256(
            request.model_dump_json(exclude=excluded).encode()
        ).hexdigest()
        existing = self.store.turn(request.id)
        if existing:
            hashes = {request_hash}
            if request._legacy_conversation_snapshot is not None:
                # 原样重试旧请求时按迁移前的序列化结果比较，不重发已接受的提问。
                legacy = request.model_dump(exclude=excluded)
                legacy["conversationSnapshot"] = request._legacy_conversation_snapshot
                hashes.add(
                    hashlib.sha256(
                        json.dumps(
                            legacy, ensure_ascii=False, separators=(",", ":")
                        ).encode()
                    ).hexdigest()
                )
            if existing["requestHash"] not in hashes:
                raise ConnectionError(
                    "该请求编号已用于其他内容，请重新提问。", "request_conflict"
                )
            return self.public_turn(existing)
        if self.configuring:
            raise ConnectionError("连接配置正在保存，请稍后提问。", "connection_busy")
        if request.conversationId in self.renaming:
            raise ConnectionError("此会话正在改名，请稍后提问。", "conversation_busy")
        if any(
            turn["conversationId"] == request.conversationId
            for turn in self.jobs.values()
        ):
            raise ConnectionError(
                "这个会话正在生成，请等待完成或先停止。", "conversation_busy"
            )
        metadata = request.conversationSnapshot
        ident = request.connectionId or (metadata or {}).get("aiConfig", {}).get(
            "connectionId"
        )
        binding = self.store.binding(request.conversationId, ident)
        if (
            request.externalSessionId
            and binding
            and binding["external_id"] != request.externalSessionId
        ):
            raise ConnectionError(
                "本机保存的会话绑定与网页记录不一致，未新建或替换原会话。请恢复原本机数据或新建对话。",
                "binding_mismatch",
            )
        if binding and not binding["external_id"]:
            raise ConnectionError(
                "上次建立原生会话的结果不明，已停止自动创建。请确认 Harness 中的记录，或明确新建一条对话。",
                "session_creation_uncertain",
            )
        ident = ident or (binding["connection_id"] if binding else "")
        adapter, saved = self.connections.resolve(ident)
        if request.restartSession and (
            not binding
            or binding["state"] != "missing"
            or request.externalSessionId != binding["external_id"]
            or (
                request.bindingRevision is not None
                and request.bindingRevision != binding["revision"]
            )
        ):
            raise ConnectionError(
                "原会话状态已变化，请重新读取后再确认。", "binding_mismatch"
            )
        previous = self.store.conversation_turns(request.conversationId)
        if previous and previous[0]["teacher"]["id"] != request.teacher.id:
            raise ConnectionError(
                "此对话已绑定另一个机器人，请新建对话后切换。", "teacher_mismatch"
            )
        if any(
            turn["userMessageId"] == request.userMessageId
            and turn["status"] == "completed"
            for turn in previous
        ):
            raise ConnectionError(
                "此问题已有回复，请查看原对话记录。", "message_already_answered"
            )
        metadata = request.conversationSnapshot
        selection = (
            {"kind": "model", "connectionId": adapter.id, "modelId": request.model}
            if request.model
            else {"kind": "connection-default"}
        )
        if (
            request.connectionRevision is not None
            and request.connectionRevision != saved["revision"]
        ):
            raise ConnectionError(
                "本轮使用的连接配置已改变，请重新读取 AI 配置后提问。",
                "configuration_conflict",
            )
        if metadata:
            if (
                metadata["id"] != request.conversationId
                or metadata["robotId"] != request.teacher.id
            ):
                raise ConnectionError(
                    "提问的会话或机器人与保存记录不一致。", "conversation_mismatch"
                )
            if metadata["status"] != "active":
                raise ConnectionError(
                    "此对话已归档或删除，请恢复或新建对话。", "conversation_inactive"
                )
            if metadata["aiConfig"]["connectionId"] != adapter.id:
                raise ConnectionError(
                    "提问连接与当前会话配置不一致。", "binding_mismatch"
                )
            selected_model = metadata["aiConfig"]["modelId"]
            if selected_model is not None and selected_model != request.model:
                raise ConnectionError(
                    "模型与当前会话配置不一致，请重新选择。", "model_mismatch"
                )
            if selected_model is None and request.model != saved["config"]["model"]:
                raise ConnectionError(
                    "连接默认模型已改变，请重新读取后提问。", "configuration_conflict"
                )
            selection = (
                {"kind": "model", "connectionId": adapter.id, "modelId": request.model}
                if request.model
                else {"kind": "connection-default"}
            )
        default_model = self.store.preferences().get("defaultModel")
        model = request.model or (
            default_model["modelId"]
            if not request.connectionId and default_model
            else saved["config"]["model"]
        )
        option = next(
            (item for item in saved["detection"]["models"] if item["value"] == model),
            None,
        )
        if option is None:
            raise ConnectionError(
                "所选模型已不在连接目录中，请重新选择。", "model_missing"
            )
        selected_reasoning = (
            metadata["aiConfig"].get("reasoningEffort") if metadata else None
        )
        if (
            selected_reasoning is not None
            and selected_reasoning != request.reasoningEffort
        ):
            raise ConnectionError(
                "推理等级与当前会话配置不一致，请重新选择。", "reasoning_mismatch"
            )
        # 显式空值也可能是 Harness 的默认选项，不能被连接中的旧等级替换。
        reasoning = (
            selected_reasoning
            if selected_reasoning is not None
            else (
                request.reasoningEffort
                or (
                    saved["config"]["reasoningEffort"]
                    if model == saved["config"]["model"]
                    else ""
                )
            )
        )
        snapshot = {
            "connectionId": adapter.id,
            "connectionRevision": saved["revision"],
            "conversationRevision": metadata["revision"] if metadata else None,
            "robotRevision": request.robotRevision,
            "providerId": adapter.provider,
            "serviceName": adapter.name,
            "modelSelection": deepcopy(selection),
            "requestedModelId": model,
            "requestedModelName": option["name"],
            "reasoningEffort": reasoning,
            "teacher": request.teacher.model_dump(),
            "client": deepcopy(request.client or UNKNOWN_CLIENT),
            "localServiceVersion": LOCAL_VERSION,
        }
        validate_metadata("TurnSnapshot", snapshot)
        turn = {
            "schemaVersion": 2,
            "submissionStatus": "accepted",
            "revision": 1,
            "snapshot": snapshot,
            "dispatch": None,
            "reportedModelId": None,
            "id": request.id,
            "conversationId": request.conversationId,
            "connectionId": adapter.id,
            "provider": adapter.provider,
            "protocol": adapter.protocol,
            "userMessageId": request.userMessageId,
            "assistantMessageId": request.id + "-assistant",
            "text": request.text,
            "teacher": request.teacher.model_dump(),
            "reference": request.reference.model_dump() if request.reference else None,
            **(
                {"readingContext": request.readingContext.model_dump()}
                if request.readingContext
                else {}
            ),
            **(
                {
                    "references": [
                        reference.model_dump() for reference in request.references
                    ]
                }
                if request.references
                else {}
            ),
            "model": request.model or saved["config"]["model"],
            "reasoningEffort": reasoning,
            "status": "running",
            "phase": "queued",
            "lastActivityAt": now(),
            "startedAt": now(),
            "content": "",
            "error": "",
            "tools": [],
            "permissions": [],
            "requestHash": request_hash,
        }
        self.store.save_turn(turn)
        self.jobs[request.id] = turn
        task = asyncio.create_task(self.run_turn(request, turn, saved["config"]))
        turn["task"] = task
        return self.public_turn(turn)

    def public_turn(self, turn):
        result = public_turn(turn)
        binding = self.store.binding_metadata(
            turn["conversationId"], turn["connectionId"]
        )
        if binding:
            result["binding"] = binding
        return result

    def persist(self, turn):
        self.store.save_turn(
            {key: value for key, value in turn.items() if key != "task"}
        )
        for listener in self.listeners.get(turn["id"], ()):
            listener.set()

    def progress(self, turn, phase):
        turn["phase"] = (
            "finished"
            if turn["status"] != "running"
            else ("stopping" if turn.get("stopRequested") else phase)
        )
        turn["lastActivityAt"] = now()
        self.persist(turn)

    async def stream(self, ident):
        """每次变更发送完整执行快照，断线后可按原编号恢复，不重新提问。"""
        listener = asyncio.Event()
        self.listeners.setdefault(ident, set()).add(listener)
        try:
            while True:
                listener.clear()
                turn = self.store.turn(ident)
                if not turn:
                    return
                yield (
                    "event: turn\ndata: "
                    + json.dumps(self.public_turn(turn), ensure_ascii=False)
                    + "\n\n"
                )
                if turn["status"] != "running":
                    return
                while not listener.is_set():
                    try:
                        await asyncio.wait_for(listener.wait(), 5)
                    except TimeoutError:
                        # 心跳只证明网页连接仍在，不代表模型已经产生了文字。
                        yield ": heartbeat\n\n"
        finally:
            listeners = self.listeners.get(ident)
            if listeners is not None:
                listeners.discard(listener)
                if not listeners:
                    self.listeners.pop(ident, None)

    async def run_turn(self, request, turn, config):
        process = None
        sid = None
        try:
            if turn.get("stopRequested"):
                turn["status"] = "cancelled"
                return
            adapter = self.registry.connection(turn["connectionId"])
            executable = adapter.resolve(config["executablePath"])
            harness_home = str(adapter.home())
            self.progress(turn, "connecting")
            process = await self.connections.runtime(adapter, executable)
            loaded = self.connections.loaded[adapter.id]
            binding = self.store.binding(request.conversationId, adapter.id)
            if request.restartSession:
                self.store.restart_binding(
                    request.conversationId, adapter.id, request.externalSessionId
                )
                loaded.discard(request.externalSessionId)
                binding = self.store.binding(request.conversationId, adapter.id)
            if not binding and request.externalSessionId:
                # 本机恢复已有编号仍由适配器核实，不能据此另建原生会话。
                self.store.bind(
                    request.conversationId,
                    request.externalSessionId,
                    executable,
                    str(self.workspace),
                    harness_home,
                    adapter.id,
                    adapter.protocol,
                    revision=request.bindingRevision or 1,
                )
                binding = self.store.binding(request.conversationId, adapter.id)
            if binding and request.externalSessionId == binding["external_id"]:
                self.store.retain_binding_revision(
                    request.conversationId,
                    adapter.id,
                    binding["external_id"],
                    request.bindingRevision,
                )
                binding = self.store.binding(request.conversationId, adapter.id)
            fresh = not binding
            if binding and binding["external_id"]:
                sid = binding["external_id"]
                turn["externalSessionId"] = sid
                self.persist(turn)
                if sid not in loaded:
                    # 程序和配置目录可能搬迁；是否能继续由原生会话恢复结果决定。
                    session = await adapter.resume(process, sid, binding["workspace"])
                else:
                    session = None
            else:
                # 先登记待确认的绑定，创建超时或进程中断后不能盲目另建原生会话。
                if not binding:
                    self.store.bind(
                        request.conversationId,
                        "",
                        executable,
                        str(self.workspace),
                        harness_home,
                        adapter.id,
                        adapter.protocol,
                    )
                fresh = True
                session = await adapter.new_session(
                    process, str(self.workspace), turn["model"]
                )
                sid = session.id
                self.store.complete_binding(request.conversationId, sid, adapter.id)
                turn["externalSessionId"] = sid
                self.persist(turn)
                session = await adapter.inspect_session(process, session)
            self.store.mark_binding(request.conversationId, "bound", adapter.id)
            loaded.add(sid)
            self.session_turns[(adapter.id, sid)] = turn["id"]
            turn["externalSessionId"] = sid
            self.persist(turn)
            if session:
                allowed_models = {m["value"] for m in session.options["models"]}
                if turn["model"] not in allowed_models:
                    raise ConnectionError(
                        "该模型不在当前 Harness 返回的列表中，请重新选择模型。",
                        "model_missing",
                    )
            # 已加载会话仍按检测所得列表校验；恢复时优先使用原生会话返回的列表。
            model_session = session
            options = await adapter.select_model(
                process, sid, turn["model"], model_session
            )
            if turn["reasoningEffort"] or any(
                option["value"] == "" for option in options["reasoningOptions"]
            ):
                if turn["reasoningEffort"] not in {
                    o["value"] for o in options["reasoningOptions"]
                }:
                    raise ConnectionError(
                        "当前模型不支持已配置的推理强度，请调整 AI 配置。",
                        "reasoning_unsupported",
                    )
                await adapter.select_reasoning(process, sid, turn["reasoningEffort"])
            if turn.get("stopRequested"):
                turn["status"] = "cancelled"
                return
            prepared = prepare_prompt(
                request, self.store.receipts(adapter.id, sid), fresh
            )
            info = self.connections.runtime_info.get(adapter.id, {})
            turn["dispatch"] = {
                "submittedModelId": turn["model"],
                "reasoningEffort": turn["reasoningEffort"] or None,
                "submittedAt": now(),
                "harnessVersion": info.get("version")
                if info.get("version") not in {None, "", "unknown"}
                else None,
                "adapterId": adapter.id,
                "adapterVersion": LOCAL_VERSION,
                "templateVersion": TEMPLATE_VERSION,
                "externalSessionId": sid,
                "contentKeys": prepared.content_keys,
                "messageIds": prepared.message_ids,
            }
            self.progress(turn, "waiting")
            result = await adapter.prompt(process, sid, prepared.text)
            self.confirm_delivery(turn)
            cancelled = turn.get("stopRequested") or result == "cancelled"
            turn["status"] = "cancelled" if cancelled else result
            if not cancelled and (result == "failed" or not turn["content"].strip()):
                turn.update(
                    status="failed",
                    error="Harness 未返回可显示的回答，请检查模型连接后重试。",
                )
        except asyncio.CancelledError:
            if turn.get("dispatch") and not turn["dispatch"].get("receivedAt"):
                turn["submissionStatus"] = "uncertain"
            turn.update(
                status="cancelled" if turn.get("stopRequested") else "interrupted",
                error="连接已断开，已收到的内容仍保留。"
                if turn.get("stopRequested")
                else "本机服务已停止，已收到的内容仍保留。",
            )
            raise
        except Exception as error:  # noqa: BLE001 - 后台执行必须保存失败状态，日志只记录类别。
            turn.update(
                status="cancelled" if turn.get("stopRequested") else "failed",
                error="第三方 Harness 中的会话无法匹配。"
                if getattr(error, "code", None) == "session_missing"
                else str(error)
                if isinstance(error, ConnectionError)
                else "AI 执行失败，请重新检测连接。",
                errorCode=getattr(error, "code", "execution_failed"),
            )
            if self.store.binding(request.conversationId, turn["connectionId"]):
                self.store.mark_binding(
                    request.conversationId,
                    "uncertain"
                    if not self.store.binding(
                        request.conversationId, turn["connectionId"]
                    )["external_id"]
                    else "missing"
                    if getattr(error, "code", None) == "session_missing"
                    else "restore-failed"
                    if not sid
                    or sid
                    not in self.connections.loaded.get(turn["connectionId"], set())
                    else "bound",
                    turn["connectionId"],
                )
            if turn.get("dispatch") and not turn["dispatch"].get("receivedAt"):
                turn["submissionStatus"] = "uncertain"
            logger.warning(
                "AI turn failed: %s", getattr(error, "code", type(error).__name__)
            )
            if isinstance(error, ConnectionError) and error.code in {
                "program_missing",
                "program_start_failed",
                "program_not_executable",
                "runtime_missing",
                "protocol_unsupported",
                "process_stopped",
                "request_timeout",
            }:
                saved = self.store.connections().get(turn["connectionId"])
                if saved:
                    self.store.set_connection_state(
                        turn["connectionId"], False, saved["revision"]
                    )
                    self.store.record_connection_check(
                        turn["connectionId"], "error", str(error)
                    )
                await self.disconnect_resources(turn["connectionId"])
        finally:
            turn["phase"] = "finished"
            turn["completedAt"] = now()
            turn["permissions"] = []
            self.resolve_permissions(turn["id"])
            if (
                turn.get("dispatch", {})
                and turn["dispatch"].get("receivedAt")
                and turn["content"]
            ):
                self.store.confirm_receipts(
                    turn["connectionId"],
                    turn["externalSessionId"],
                    [],
                    [turn["assistantMessageId"]],
                )
            self.persist(turn)
            if sid:
                self.session_turns.pop((turn["connectionId"], sid), None)
            self.jobs.pop(turn["id"], None)

    @staticmethod
    def compose(request, fresh):
        return compose_prompt(request, fresh)

    def confirm_delivery(self, turn):
        dispatch = turn.get("dispatch")
        if not dispatch or dispatch.get("receivedAt"):
            return
        dispatch["receivedAt"] = now()
        self.store.confirm_receipts(
            turn["connectionId"],
            dispatch["externalSessionId"],
            dispatch["contentKeys"],
            dispatch["messageIds"],
            turn,
        )

    def update(self, params: HarnessEvent, connection_id):
        ident = self.session_turns.get((connection_id, params.get("sessionId")))
        turn = self.jobs.get(ident)
        if not turn:
            return
        kind = params.get("kind")
        if kind == "text":
            text = params.get("text", "")
            turn["content"] = text if params.get("replace") else turn["content"] + text
            phase = "responding"
        elif kind == "thinking":
            phase = "thinking"
        elif kind == "turn":
            turn["externalTurnId"] = params["externalTurnId"]
            phase = "waiting"
        elif kind == "tool":
            tool_id = params.get("id")
            found = next(
                (tool for tool in turn["tools"] if tool["id"] == tool_id), None
            )
            if not found:
                found = {
                    "id": tool_id,
                    "title": params.get("title", "工具调用"),
                    "status": "pending",
                }
                turn["tools"].append(found)
                turn["tools"] = turn["tools"][-30:]
            found.update(
                {key: params[key] for key in ["title", "status"] if key in params}
            )
            phase = (
                "tool" if found["status"] in {"pending", "in_progress"} else "waiting"
            )
        else:
            return
        self.confirm_delivery(turn)
        self.progress(turn, phase)

    async def permission(self, params, connection_id):
        turn = self.jobs.get(
            self.session_turns.get((connection_id, params.get("sessionId")))
        )
        if not turn or turn.get("stopRequested"):
            return None
        self.confirm_delivery(turn)
        ident = str(uuid4())
        # 长期授权不作为一次点击的默认结果，只提供当前操作的一次性选择。
        options = [
            o
            for o in params.get("options", [])
            if o.get("kind") in {"allow_once", "reject_once"}
        ]
        future = asyncio.get_running_loop().create_future()
        self.permissions[ident] = (turn["id"], future)
        turn["permissions"].append(
            {
                "id": ident,
                "title": params.get("title", "Harness 请求执行工具"),
                "options": options,
            }
        )
        self.progress(turn, "permission")
        try:
            choice = await future
            return choice
        finally:
            self.permissions.pop(ident, None)
            turn["permissions"] = [
                item for item in turn["permissions"] if item["id"] != ident
            ]
            self.progress(turn, "tool")

    def decide(self, ident, request_id, option_id):
        turn = self.jobs.get(ident)
        record = self.permissions.get(request_id)
        permission = next(
            (p for p in (turn or {}).get("permissions", []) if p["id"] == request_id),
            None,
        )
        if not record or record[0] != ident or not permission:
            raise ConnectionError("这项权限请求已经结束。", "permission_expired")
        if option_id not in {o["optionId"] for o in permission["options"]}:
            raise ConnectionError("该权限选项不可用。", "permission_invalid")
        if not record[1].done():
            record[1].set_result(option_id)

    def resolve_permissions(self, ident):
        for owner, future in list(self.permissions.values()):
            if owner == ident and not future.done():
                future.set_result(None)

    async def cancel(self, ident):
        turn = self.jobs.get(ident)
        if not turn:
            existing = self.store.turn(ident)
            if not existing:
                raise ConnectionError("没有找到这次提问。", "turn_missing")
            return self.public_turn(existing)
        turn["stopRequested"] = True
        self.progress(turn, "stopping")
        self.resolve_permissions(ident)
        sid = turn.get("externalSessionId")
        process = self.connections.process_for(turn["connectionId"])
        if sid and process:
            await self.registry.connection(turn["connectionId"]).cancel(process, sid)
        self.persist(turn)
        return self.public_turn(turn)

    async def close(self):
        for turn in list(self.jobs.values()):
            self.resolve_permissions(turn["id"])
        await self.connections.close()
        tasks = [turn["task"] for turn in list(self.jobs.values())]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
