from ..acp import AcpProcess, describe_options, find_executable
from ..errors import ConnectionError
from ..installation import default_installation_path
from ..model_config import resolve_home
from .base import AcpAdapter, acp_permission, acp_update


class DshAdapter(AcpAdapter):
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

    async def resume(self, process, sid, workspace):
        try:
            return await super().resume(process, sid, workspace)
        except ConnectionError as error:
            # DSH ACP 对不存在和不可恢复的会话返回同一种原生错误。
            if error.code == "harness_error":
                message = str(error)
                if "session is not resumable:" in message:
                    raise ConnectionError(
                        "DeepSeek Harness 未找到可恢复的原会话。请检查当前 Harness 的会话记录；SolveMate 中的记录仍保留，未创建新会话。",
                        "session_missing",
                    ) from error
                if "session cwd does not match:" in message:
                    raise ConnectionError(
                        "DeepSeek Harness 要求恢复时使用原会话的工作目录，当前目录与其记录不一致。原记录仍保留，未创建新会话。",
                        "session_workspace_mismatch",
                    ) from error
                if "session is already active:" in message:
                    raise ConnectionError(
                        "原会话正在 DeepSeek Harness 的其他连接中使用。请结束该会话的其他连接后重试。",
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

    async def release_probe(self, process, sid):
        await process.call("session/close", {"sessionId": sid})
