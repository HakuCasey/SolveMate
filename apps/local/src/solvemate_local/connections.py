import asyncio
import hashlib
import logging

from .errors import ConnectionError

logger = logging.getLogger(__name__)


class ConnectionManager:
    """保存各服务配置，复用检测会话，并分别维护 Harness 进程及已加载会话。"""

    def __init__(self, store, registry, workspace, update, permission):
        self.store, self.registry, self.workspace = store, registry, str(workspace)
        self.update, self.permission = update, permission
        self.runtimes = {}
        self.runtime_info = {}
        self.loaded = {}
        self.lock = asyncio.Lock()
        self.probe_lock = asyncio.Lock()

    def resolve(self, ident=""):
        if not ident:
            ident = self.store.preferences()["defaultConnectionId"]
        value = self.store.connections().get(ident)
        if not value:
            if ident in self.store.deleted_connections():
                raise ConnectionError(
                    "该对话使用的 AI 连接已删除，请重新配置或新建对话后选择其他服务。",
                    "connection_deleted",
                )
            raise ConnectionError(
                "该对话使用的 AI 服务尚未配置，请先在设置中检测并保存。",
                "not_configured",
            )
        if not value["enabled"]:
            raise ConnectionError(
                "该 AI 连接已停用，请先在设置中启用。", "connection_disabled"
            )
        if value["check"]["status"] == "error":
            raise ConnectionError(
                "该 AI 连接检测失败，请先在设置中重新检测。", "connection_unavailable"
            )
        return self.registry.connection(ident), value

    def services(self):
        result = []
        for adapter in self.registry.adapters:
            try:
                detected = adapter.resolve()
            except ConnectionError:
                detected = ""
            result.append(
                {
                    "id": adapter.id,
                    "provider": adapter.provider,
                    "name": adapter.name,
                    "shortName": adapter.short_name,
                    "defaultPath": adapter.default_path(),
                    "detectedPath": detected,
                }
            )
        return result

    async def probe(self, request):
        async with self.probe_lock:
            adapter = self.registry.provider(request.provider)
            executable = adapter.resolve(request.executablePath)
            if not adapter.requires_probe_session:
                process = adapter.process(executable, self.workspace)
                try:
                    initialized = await adapter.start(process)
                    initialized["capabilities"] = adapter.public_capabilities(
                        initialized.get("capabilities", {})
                    )
                    options = await adapter.probe_options(process, request.model)
                    return {"executablePath": executable, **initialized, **options}
                except OSError as error:
                    raise ConnectionError(
                        f"无法启动 {adapter.name}，请检查程序路径及 CLI 安装。",
                        "program_start_failed",
                    ) from error
                finally:
                    await process.close()
            key = hashlib.sha256(
                "\0".join(
                    [adapter.id, executable, str(adapter.home()), self.workspace]
                ).encode()
            ).hexdigest()
            if getattr(request, "resetProbe", False):
                self.store.reset_probe(key)
            record = self.store.probe(key)
            if record and not record["session_id"]:
                raise ConnectionError(
                    "上次创建检测会话时连接中断，无法确认是否成功。请确认后重建检测会话。",
                    "probe_uncertain",
                )
            process = adapter.process(executable, self.workspace)
            sid = None
            attached = False
            try:
                initialized = await adapter.start(process)
                initialized["capabilities"] = adapter.public_capabilities(
                    initialized.get("capabilities", {})
                )
                if record:
                    sid = record["session_id"]
                    try:
                        session = await adapter.resume(process, sid, self.workspace)
                    except ConnectionError as error:
                        if error.code == "session_busy":
                            raise ConnectionError(
                                "连接测试会话正被其他 Harness 进程占用。请关闭对应的测试会话，或退出占用它的进程后重新检测。未创建新的测试会话，其他正式对话仍可尝试使用。",
                                "probe_busy",
                            ) from error
                        if error.code != "session_missing":
                            raise
                        raise ConnectionError(
                            "未找到原来的连接测试会话，未创建新会话。可确认后重建连接测试会话；正式对话记录仍保留。",
                            "probe_resume_failed",
                        ) from error
                else:
                    # 先保存未知结果，超时或进程中断后不能盲目再建一个会话。
                    self.store.save_probe(key, None)
                    session = await adapter.new_session(process, self.workspace)
                    sid = session.id
                    self.store.save_probe(key, sid)
                attached = True
                await adapter.label_probe(process, sid)
                options = session.options
                if not options["models"]:
                    raise ConnectionError(
                        "Harness 未返回可选模型，请先在 Harness 中配置模型服务。",
                        "models_missing",
                    )
                if request.model:
                    if request.model not in {m["value"] for m in options["models"]}:
                        raise ConnectionError(
                            "所选模型已不在可用列表中，请重新选择。", "model_missing"
                        )
                    options = await adapter.select_model(
                        process, sid, request.model, session
                    )
                return {"executablePath": executable, **initialized, **options}
            except OSError as error:
                raise ConnectionError(
                    f"无法启动 {adapter.name}，请检查程序路径及 CLI 安装。",
                    "program_start_failed",
                ) from error
            finally:
                try:
                    if sid and attached:
                        try:
                            await adapter.release_probe(process, sid)
                        except ConnectionError:
                            logger.warning(
                                "Failed to release a Harness connection-test viewer."
                            )
                finally:
                    await process.close()

    async def runtime(self, adapter, executable):
        async with self.lock:
            existing = self.runtimes.get(adapter.id)
            identity = (executable, str(adapter.home()))
            if existing and existing[0] == identity and adapter.is_running(existing[1]):
                return existing[1]
            await self.close_connection(adapter.id)
            self.loaded[adapter.id] = set()
            process = adapter.process(
                executable,
                self.workspace,
                lambda params: self.update(params, adapter.id),
                lambda params: self.permission(params, adapter.id),
            )
            try:
                self.runtime_info[adapter.id] = await adapter.start(process)
            except BaseException:
                await process.close()
                raise
            self.runtimes[adapter.id] = (identity, process)
            return process

    async def close_connection(self, ident):
        existing = self.runtimes.pop(ident, None)
        if existing:
            await existing[1].close()
        self.loaded.pop(ident, None)

    def process_for(self, ident):
        existing = self.runtimes.get(ident)
        return existing[1] if existing else None

    async def close(self):
        for ident in list(self.runtimes):
            await self.close_connection(ident)
