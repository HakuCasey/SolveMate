import asyncio
import os
import shutil
import sys
from pathlib import Path

from ..errors import ConnectionError
from ..transport import AcpTransport
from .base import AcpAdapter, acp_permission, acp_update
from .types import HarnessSession


def hermes_home():
    override = os.environ.get("HERMES_HOME", "").strip()
    if override:
        return Path(os.path.expandvars(override)).expanduser().resolve()
    suffix = os.environ.get("HERMES_DATA_DIR_SUFFIX", "")
    if sys.platform == "win32":
        return Path(os.environ.get("LOCALAPPDATA") or Path.home() / "AppData/Local") / (
            "hermes" + suffix
        )
    return Path.home() / (".hermes" + suffix)


def default_path():
    if sys.platform == "win32":
        return str(hermes_home() / "bin/hermes.exe")
    return str(Path.home() / ".local/bin/hermes")


def find_hermes(value=""):
    candidate = Path(value).expanduser() if value.strip() else None
    if candidate is None:
        found = shutil.which("hermes")
        if found:
            candidate = Path(found)
    if candidate is None or not candidate.is_absolute() or not candidate.is_file():
        raise ConnectionError(
            "未找到 hermes 命令，请填写 Hermes CLI 程序的完整路径。", "program_missing"
        )
    # Windows 原生入口由 Python 安装器生成，不把用户输入拼接进 cmd.exe。
    if candidate.suffix.lower() in {".cmd", ".bat"}:
        raise ConnectionError(
            "请选择原生 hermes.exe；批处理或 WSL 中的命令不能由本机服务直接调用。",
            "launcher_unsupported",
        )
    if os.name != "nt" and not os.access(candidate, os.X_OK):
        raise ConnectionError(
            "所选 Hermes 程序没有执行权限。", "program_not_executable"
        )
    return str(candidate.resolve())


class HermesProcess(AcpTransport):
    async def start(self):
        try:
            return await super().start()
        except ConnectionError as error:
            if error.code == "process_stopped":
                raise ConnectionError(
                    "Hermes ACP 未能启动，请在终端运行 hermes acp --check，确认 ACP 依赖与 Hermes 配置可用后重新检测。",
                    "program_start_failed",
                ) from error
            raise

    async def prepare_launch(self):
        env = os.environ.copy()
        env["HERMES_HOME"] = str(hermes_home())
        return [self.executable, "acp"], env


class HermesAdapter(AcpAdapter):
    supports_rename = True
    short_name = "Hermes"
    id = "hermes-local"
    provider = "hermes"
    name = "Hermes"
    resolve = staticmethod(find_hermes)
    home = staticmethod(hermes_home)
    default_path = staticmethod(default_path)

    def __init__(self, factory=HermesProcess):
        self.factory = factory

    def process(self, executable, workspace, on_update=None, on_permission=None):
        return self.factory(
            executable, workspace, acp_update(on_update), acp_permission(on_permission)
        )

    async def resume(self, process, sid, workspace):
        # 某些旧版 Hermes 的 resume 会在找不到会话时新建；load 不会替换原编号。
        if not process.capabilities.get("loadSession"):
            raise ConnectionError(
                "当前 Hermes 未声明严格加载会话的能力，请更新 Hermes 后重试。",
                "resume_unsupported",
            )
        result = await process.call(
            "session/load", {"sessionId": sid, "cwd": workspace, "mcpServers": []}
        )
        if result is None or result == {}:
            raise ConnectionError(
                "Hermes 未找到原会话。请检查当前 Hermes 的会话记录；SolveMate 中的记录仍保留，未创建新会话。",
                "session_missing",
            )
        if not isinstance(result, dict) or not result.get("models"):
            raise ConnectionError(
                "Hermes 返回的会话信息不完整，未继续提问。", "session_invalid"
            )
        if result.get("sessionId", sid) != sid:
            raise ConnectionError(
                "Hermes 返回的会话编号与原绑定不同，未继续提问。", "binding_mismatch"
            )
        return HarnessSession(sid, self.describe(result))

    async def label_probe(self, process, sid):
        # Hermes 的 /title 是本地会话命令，不请求模型生成标题。
        await process.call(
            "session/prompt",
            {
                "sessionId": sid,
                "prompt": [{"type": "text", "text": "/title SolveMate 连接测试"}],
            },
        )

    async def rename_session(self, executable, sid, title, workspace):
        # 使用官方管理命令；标题作为独立参数传递，不能拼接到 shell 命令中。
        env = os.environ.copy()
        env["HERMES_HOME"] = str(self.home())
        process = await asyncio.create_subprocess_exec(
            executable,
            "sessions",
            "rename",
            sid,
            "--",
            title,
            cwd=workspace,
            env=env,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        try:
            try:
                code = await asyncio.wait_for(process.wait(), 20)
            except TimeoutError as error:
                raise ConnectionError(
                    "等待 Hermes 改名超时，无法确认是否完成。请查看原会话名称后重试。",
                    "request_timeout",
                ) from error
            if code:
                raise ConnectionError(
                    "Hermes 未完成会话改名。请确认原会话存在、名称未被占用，且 CLI 支持 sessions rename。",
                    "rename_failed",
                )
        finally:
            if process.returncode is None:
                try:
                    process.kill()
                except ProcessLookupError:
                    pass
                await process.wait()

    @staticmethod
    def describe(session):
        models = session.get("models") or {}
        return {
            "models": [
                {
                    "value": item["modelId"],
                    "name": item.get("name", item["modelId"]),
                    "group": "",
                }
                for item in models.get("availableModels", [])
            ],
            "currentModel": models.get("currentModelId", ""),
            "reasoningOptions": [],
            "currentReasoning": "",
        }

    async def select_model(self, process, sid, model, session):
        # Hermes 使用不透明的 provider:model 标识；不能从显示名称反推模型编号。
        await process.call("session/set_model", {"sessionId": sid, "modelId": model})
        result = (
            dict(session.options)
            if session
            else {"models": [], "reasoningOptions": [], "currentReasoning": ""}
        )
        result["currentModel"] = model
        return result

    async def select_reasoning(self, process, sid, value):
        raise ConnectionError(
            "Hermes 未提供此推理强度选项，请清空该配置。", "reasoning_unsupported"
        )
