import asyncio
import os
import shutil
import sys
from pathlib import Path
from uuid import uuid4

from ..acp import describe_options
from ..errors import ConnectionError
from ..transport import AcpTransport
from .base import AcpAdapter, acp_permission, acp_update
from .hermes_reasoning import session_reasoning
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


def _require_load_session(process):
    if not process.capabilities.get("loadSession"):
        raise ConnectionError(
            "当前 Hermes 未声明严格加载会话的能力，请更新 Hermes 后重试。",
            "resume_unsupported",
        )


class HermesProcess(AcpTransport):
    async def start(self):
        try:
            initialized = await super().start()
            _require_load_session(self)
            result = await self.native_request("check")
            if result.get("ready") is not True:
                raise ConnectionError(
                    "Hermes 原生接口未就绪，请更新 Hermes 后重新检测连接。",
                    "hermes_sdk_unavailable",
                )
            return initialized
        except ConnectionError as error:
            if error.code == "process_stopped":
                raise ConnectionError(
                    "Hermes ACP 未能启动，请在终端运行 hermes acp --check，确认 ACP 依赖与 Hermes 配置可用后重新检测。",
                    "program_start_failed",
                ) from error
            raise

    async def native_request(self, operation, **payload):
        from .hermes_gateway import native_request

        return await native_request(self, operation, **payload)

    async def prepare_launch(self):
        env = os.environ.copy()
        env["HERMES_HOME"] = str(hermes_home())
        return [self.executable, "acp"], env


class HermesAdapter(AcpAdapter):
    supports_rename = True
    requires_probe_session = False
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

    async def probe_options(self, process, model=""):
        result = await process.native_request("catalog", model=model)
        options = self.describe(result)
        options.update(
            {key: result[key] for key in ("reasoningOptions", "currentReasoning")}
        )
        for item in options["models"]:
            item.update(
                reasoningOptions=options["reasoningOptions"],
                defaultReasoning=options["currentReasoning"],
            )
        if model:
            if model not in {item["value"] for item in options["models"]}:
                raise ConnectionError(
                    "所选模型已不在 Hermes 目录中，请重新选择。", "model_missing"
                )
            options["currentModel"] = model
        return options

    async def new_session(self, process, workspace, model=""):
        if not model:
            raise ConnectionError("请先选择 Hermes 模型。", "model_missing")
        _require_load_session(process)
        result = await process.native_request(
            "create", model=model, workspace=workspace, requestId=uuid4().hex
        )
        sid = result.get("sessionId")
        if not isinstance(sid, str) or not sid:
            raise ConnectionError(
                "Hermes 未返回有效的原生会话编号。", "session_invalid"
            )
        # 先把已知编号交给公共服务保存，再加载；加载失败不能丢失已创建的原生会话。
        return HarnessSession(sid, {})

    async def inspect_session(self, process, session):
        if not session.options:
            return await self.resume(process, session.id, process.workspace)
        options = session.options
        native = bool(options["reasoningOptions"])
        if not native:
            options.update(await session_reasoning(process, session.id))
        # Hermes 的推理等级属于会话，模型目录中的每项复用同一份原生选项。
        options["models"] = [
            {
                **model,
                "reasoningOptions": options["reasoningOptions"],
                "defaultReasoning": options["currentReasoning"],
            }
            for model in options["models"]
        ]
        if not hasattr(process, "session_options"):
            process.session_options = {}
            process.native_reasoning = {}
        process.session_options[session.id] = options
        process.native_reasoning[session.id] = native
        return session

    async def resume(self, process, sid, workspace):
        # 某些旧版 Hermes 的 resume 会在找不到会话时新建；load 不会替换原编号。
        _require_load_session(process)
        result = await process.call(
            "session/load", {"sessionId": sid, "cwd": workspace, "mcpServers": []}
        )
        if result is None or result == {}:
            raise ConnectionError(
                "Hermes 未找到原会话。请检查当前 Hermes 的会话记录；SolveMate 中的记录仍保留，未创建新会话。",
                "session_missing",
            )
        if not isinstance(result, dict):
            raise ConnectionError(
                "Hermes 返回的会话信息不完整，未继续提问。", "session_invalid"
            )
        if result.get("sessionId", sid) != sid:
            raise ConnectionError(
                "Hermes 返回的会话编号与原绑定不同，未继续提问。", "binding_mismatch"
            )
        if not self.describe(result)["models"]:
            raise ConnectionError(
                "Hermes 返回的会话信息不完整，未继续提问。", "session_invalid"
            )
        return await self.inspect_session(
            process, HarnessSession(sid, self.describe(result))
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
        described = describe_options(session)
        return {
            "models": described["models"]
            or [
                {
                    "value": item["modelId"],
                    "name": item.get("name", item["modelId"]),
                    "group": "",
                }
                for item in models.get("availableModels", [])
            ],
            "currentModel": described["currentModel"]
            or models.get("currentModelId", ""),
            "reasoningOptions": described["reasoningOptions"],
            "currentReasoning": described["currentReasoning"],
        }

    async def select_model(self, process, sid, model, session):
        # Hermes 使用不透明的 provider:model 标识；不能从显示名称反推模型编号。
        if session and sid not in getattr(process, "session_options", {}):
            session = await self.inspect_session(process, session)
        response = await process.call(
            "session/set_model", {"sessionId": sid, "modelId": model}
        )
        result = dict(session.options if session else process.session_options[sid])
        if response.get("configOptions") and process.native_reasoning[sid]:
            updated = describe_options(response)
            result.update(
                {key: updated[key] for key in ("reasoningOptions", "currentReasoning")}
            )
        result["currentModel"] = model
        process.session_options[sid] = result
        return result

    async def select_reasoning(self, process, sid, value):
        options = process.session_options[sid]
        if value not in {item["value"] for item in options["reasoningOptions"]}:
            raise ConnectionError(
                "Hermes 不支持所选推理等级，请重新选择。", "reasoning_unsupported"
            )
        if process.native_reasoning[sid]:
            result = await process.call(
                "session/set_config_option",
                {
                    "sessionId": sid,
                    "configId": "reasoning_effort",
                    "value": value,
                },
            )
            updated = describe_options(result)
            if updated["currentReasoning"] != value:
                raise ConnectionError(
                    "Hermes 未确认所选推理等级，未继续提问。", "reasoning_unavailable"
                )
        else:
            updated = await session_reasoning(process, sid, value)
        options.update(
            {key: updated[key] for key in ("reasoningOptions", "currentReasoning")}
        )
