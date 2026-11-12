import asyncio
import hashlib
import logging
from time import monotonic

from .errors import ConnectionError

logger = logging.getLogger(__name__)

PROBE_TIMEOUT = 25


class ConnectionManager:
    """保存各服务配置，复用检测会话，并分别维护 Harness 进程及已加载会话。"""

    def __init__(self, store, registry, workspace, update, permission):
        self.store, self.registry, self.workspace = store, registry, str(workspace)
        self.update, self.permission = update, permission
        self.runtimes = {}
        self.runtime_info = {}
        self.loaded = {}
        self.lock = asyncio.Lock()
        self.probe_locks = {}
        self.probe_tasks = {}
        self.probe_cancellations = set()

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
                "该 AI 服务未连接，请先在设置中检测连接。", "connection_disabled"
            )
        if value["check"]["status"] == "error":
            raise ConnectionError(
                "该 AI 服务未连接，请先在设置中重新检测。", "connection_unavailable"
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
        adapter = self.registry.provider(request.provider)
        lock = self.probe_locks.setdefault(adapter.id, asyncio.Lock())
        if lock.locked():
            raise ConnectionError(
                f"{adapter.name} 正在检测连接，请等待本次结果后重试。", "detection_busy"
            )
        async with lock:
            self.probe_tasks[adapter.id] = asyncio.current_task()
            started = monotonic()
            try:
                # 为整次协议检测设定上限，避免多个 RPC 的等待时间不断累加。
                async with asyncio.timeout(PROBE_TIMEOUT):
                    return await self._probe(request, adapter)
            except asyncio.CancelledError:
                if adapter.id in self.probe_cancellations:
                    raise ConnectionError(
                        "检测已取消，连接已断开。", "detection_cancelled"
                    ) from None
                raise
            except TimeoutError as error:
                raise ConnectionError(
                    f"{adapter.name} 未在 {PROBE_TIMEOUT} 秒内完成连接检测，请检查其运行状态后重试。",
                    "detection_timeout",
                ) from error
            finally:
                self.probe_tasks.pop(adapter.id, None)
                self.probe_cancellations.discard(adapter.id)
                logger.info(
                    "Harness connection check finished: provider=%s elapsed=%.2fs",
                    adapter.provider,
                    monotonic() - started,
                )

    async def _probe(self, request, adapter):
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
                await self.cleanup_probe(adapter, process)
        identity = [adapter.id, executable, str(adapter.home()), self.workspace]
        # 主动删除配置后重新建立检测记录；普通重试始终复用同一会话。
        deleted_revision = self.store.deleted_connections().get(adapter.id, 0)
        if deleted_revision:
            identity.append(str(deleted_revision))
        key = hashlib.sha256("\0".join(identity).encode()).hexdigest()
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
                            f"连接测试会话正被其他 {adapter.name} 客户端占用。请关闭其中的连接测试会话后重新检测。",
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
            await self.cleanup_probe(adapter, process, sid if attached else None)

    async def cleanup_probe(self, adapter, process, sid=None):
        async def cleanup():
            try:
                if sid:
                    try:
                        async with asyncio.timeout(2):
                            await adapter.release_probe(process, sid)
                    except (ConnectionError, TimeoutError):
                        logger.warning(
                            "Failed to release a Harness connection-test viewer."
                        )
            finally:
                await process.close()

        # 超时和 HTTP 取消也必须关闭本次检测创建的进程，不能留下占用会话的进程。
        task = asyncio.create_task(cleanup())
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            await task
            raise

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

    async def stop_probe(self, ident):
        task = self.probe_tasks.get(ident)
        if task and task is not asyncio.current_task():
            self.probe_cancellations.add(ident)
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def close_connection(self, ident):
        existing = self.runtimes.get(ident)
        if existing:
            adapter = self.registry.connection(ident)
            # 释放本应用已恢复的会话，再关闭进程；不能只等应用退出。
            try:
                async with asyncio.timeout(3):
                    await asyncio.gather(
                        *(
                            adapter.release_session(existing[1], sid)
                            for sid in self.loaded.get(ident, set())
                        ),
                        return_exceptions=True,
                    )
            except TimeoutError:
                logger.warning(
                    "Timed out while releasing Harness sessions: connection=%s", ident
                )
            await existing[1].close()
            if self.runtimes.get(ident) is existing:
                self.runtimes.pop(ident, None)
        self.loaded.pop(ident, None)
        self.runtime_info.pop(ident, None)

    def process_for(self, ident):
        existing = self.runtimes.get(ident)
        return existing[1] if existing else None

    async def close(self):
        for ident in list(self.probe_tasks):
            await self.stop_probe(ident)
        for ident in list(self.runtimes):
            await self.close_connection(ident)
