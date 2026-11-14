from ..acp import AcpProcess, describe_options, find_executable
from ..errors import ConnectionError
from ..installation import default_installation_path
from ..model_config import resolve_home
from .base import AcpAdapter, acp_permission, acp_update
from .dsh_catalog import catalog_options


class DshAcpAdapter(AcpAdapter):
    """保留 ACP 检测与合同验证入口；原生执行失败时不自动回退到这里。"""

    requires_probe_session = False
    short_name = "DSH"
    id = "deepseek-local"
    provider = "deepseek-harness"
    name = "DeepSeek Harness"
    describe = staticmethod(describe_options)
    resolve = staticmethod(find_executable)
    default_path = staticmethod(default_installation_path)
    home = staticmethod(resolve_home)

    def __init__(self, factory=AcpProcess):
        self.factory = factory

    def process(self, executable, workspace, on_update=None, on_permission=None):
        return self.factory(
            executable,
            workspace,
            acp_update(on_update),
            acp_permission(on_permission),
            harness_home=self.home(),
        )

    async def probe_options(self, process, model):
        return await catalog_options(process, self.home(), model)

    async def resume(self, process, sid, workspace):
        try:
            return await super().resume(process, sid, workspace)
        except ConnectionError as error:
            # DSH ACP 对不存在和不可恢复的会话返回同一种原生错误。
            if error.code == "harness_error":
                message = str(error) + "\n" + error.details
                if "session is not resumable:" in message:
                    raise ConnectionError(
                        "DeepSeek Harness 未找到可恢复的原会话。请检查当前 Harness 的会话记录；本地记录仍保留，未创建新会话。",
                        "session_missing",
                    ) from error
                if "session cwd does not match:" in message:
                    raise ConnectionError(
                        "DeepSeek Harness 要求恢复时使用原会话的工作目录，当前目录与其记录不一致。原记录仍保留，未创建新会话。",
                        "session_workspace_mismatch",
                    ) from error
                if (
                    "session is already active:" in message
                    or "is already owned by an active write handle" in message
                ):
                    raise ConnectionError(
                        "原会话正在其他 DeepSeek Harness 进程中打开。请关闭占用它的会话，或退出对应的 DSH 进程后重试。",
                        "session_busy",
                    ) from error
            raise

    async def select_model(self, process, sid, model, session):
        result = await process.call(
            "session/set_config_option",
            {"sessionId": sid, "configId": "model", "value": model},
        )
        return self.describe(result)

    async def select_reasoning(self, process, sid, value):
        await process.call(
            "session/set_config_option",
            {"sessionId": sid, "configId": "reasoning_effort", "value": value},
        )

    async def release_session(self, process, sid):
        await process.call("session/close", {"sessionId": sid})


class DshAdapter(DshAcpAdapter):
    """复用程序查找与连接标识；正式会话操作全部由原生实现处理。"""

    protocol = "dsh-native"
    supports_rename = True

    def __init__(self, factory=None):
        from .dsh_process import DshProcess

        self.factory = factory or DshProcess

    def process(self, executable, workspace, on_update=None, on_permission=None):
        return self.factory(
            executable, workspace, on_update, on_permission, harness_home=self.home()
        )

    def public_capabilities(self, raw):
        result = super().public_capabilities({"sessionCapabilities": {"resume": {}}})
        result["rawTextDeltas"] = "supported"
        return result

    async def start(self, process):
        return await process.start()

    async def probe_options(self, process, model):
        return await process.catalog(model)

    async def new_session(self, process, workspace, model=""):
        return await process.create(workspace)

    async def inspect_session(self, process, session):
        return await process.inspect(session.id)

    async def resume(self, process, sid, workspace):
        return await process.resume(sid, workspace)

    async def rename_session(self, executable, sid, title, workspace):
        process = self.process(executable, workspace)
        try:
            await process.start()
            await process.rename(sid, title)
        finally:
            await process.close()

    async def select_model(self, process, sid, model, session):
        return await process.select(sid, model)

    async def select_reasoning(self, process, sid, value):
        model = process.sessions[sid].options["currentModel"]
        await process.select(sid, model, value)

    async def prompt(self, process, sid, text, request_id=None):
        return await process.prompt(sid, text, request_id)

    async def cancel(self, process, sid):
        await process.cancel(sid)

    async def release_session(self, process, sid):
        await process.release(sid)

    async def finish_turn(self, process, sid):
        await process.release(sid)
        return True
