import os
import platform
import re
import shutil
import sys
from pathlib import Path

from ..errors import ConnectionError
from .base import HarnessAdapter
from .codex_process import CodexProcess
from .types import HarnessSession


def codex_home():
    configured = os.environ.get("CODEX_HOME", "").strip()
    return (
        Path(os.path.expandvars(configured or str(Path.home() / ".codex")))
        .expanduser()
        .resolve()
    )


def default_path():
    return str(
        Path.home()
        / ".local/bin"
        / ("codex.exe" if sys.platform == "win32" else "codex")
    )


def npm_native(root, machine=None):
    """仅定位官方 npm 包的原生程序，不执行或解析用户批处理内容。"""
    machine = (machine or platform.machine()).lower()
    target = (
        "aarch64-pc-windows-msvc"
        if machine in {"arm64", "aarch64"}
        else "x86_64-pc-windows-msvc"
    )
    package = (
        "codex-win32-arm64" if machine in {"arm64", "aarch64"} else "codex-win32-x64"
    )
    package_root = root / "node_modules/@openai/codex"
    candidates = [
        package_root / "vendor" / target / "codex/codex.exe",
        package_root
        / "node_modules/@openai"
        / package
        / "vendor"
        / target
        / "codex/codex.exe",
        root / "node_modules/@openai" / package / "vendor" / target / "codex/codex.exe",
    ]
    return next((item for item in candidates if item.is_file()), None)


def find_codex(value=""):
    found = value.strip() or shutil.which("codex") or ""
    candidate = Path(found).expanduser() if found else None
    if candidate and candidate.suffix.lower() in {".cmd", ".bat", ".ps1"}:
        candidate = npm_native(candidate.parent)
        if candidate is None:
            raise ConnectionError(
                "该 Codex 命令旁未找到官方 npm 包的原生程序，请填写 codex.exe 的完整路径。",
                "program_missing",
            )
    if not candidate or not candidate.is_absolute() or not candidate.is_file():
        raise ConnectionError(
            "未找到 codex 命令，请填写 Codex CLI 程序的完整路径。", "program_missing"
        )
    if os.name != "nt" and not os.access(candidate, os.X_OK):
        raise ConnectionError("所选 Codex 程序没有执行权限。", "program_not_executable")
    return str(candidate.resolve())


class CodexAdapter(HarnessAdapter):
    id = "codex-local"
    provider = "codex"
    protocol = "codex-app-server"
    name = short_name = "Codex"
    requires_probe_session = False

    def public_capabilities(self, raw):
        result = super().public_capabilities(raw)
        result.update(
            models="supported",
            resume="supported",
            textUpdates="supported",
            rawTextDeltas="supported",
        )
        return result

    resolve = staticmethod(find_codex)
    home = staticmethod(codex_home)
    default_path = staticmethod(default_path)

    def __init__(self, factory=CodexProcess):
        self.factory = factory

    def process(self, executable, workspace, on_update=None, on_permission=None):
        return self.factory(executable, workspace, on_update, on_permission)

    async def start(self, process):
        info = await process.start()
        account = await process.call("account/read", {"refreshToken": False})
        if account.get("requiresOpenaiAuth") and not account.get("account"):
            raise ConnectionError(
                "Codex 尚未登录，请先在终端运行 codex login，完成后重新检测连接。",
                "auth_required",
            )
        response = await process.call(
            "config/read", {"cwd": process.workspace, "includeLayers": False}
        )
        # 只保留选择模型所需字段，不复制完整配置或凭据。
        config = response.get("config", {})
        process.config = {
            key: config.get(key) for key in ("model", "model_reasoning_effort")
        }
        version = re.search(r"/([\d][\w.+-]*)", info.get("userAgent", ""))
        return {
            "version": version.group(1) if version else "unknown",
            "capabilities": {
                "protocol": self.protocol,
                "resume": True,
                "streaming": True,
            },
        }

    async def probe_options(self, process, model=""):
        data, cursor, seen = [], None, set()
        for _ in range(100):
            page = await process.call(
                "model/list",
                {
                    "limit": 100,
                    "includeHidden": False,
                    **({"cursor": cursor} if cursor else {}),
                },
            )
            entries = page.get("data") if isinstance(page, dict) else None
            if not isinstance(entries, list) or any(
                not isinstance(entry, dict)
                or not isinstance(entry.get("model"), str)
                or not entry["model"]
                for entry in entries
            ):
                raise ConnectionError(
                    "Codex 返回的模型目录格式不受支持，请更新 CLI 后重新检测。",
                    "protocol_unsupported",
                )
            data.extend(entries)
            cursor = page.get("nextCursor")
            if not cursor:
                break
            if cursor in seen:
                raise ConnectionError(
                    "Codex 重复返回同一模型分页，请更新 CLI 后重新检测。",
                    "protocol_invalid",
                )
            seen.add(cursor)
        else:
            raise ConnectionError(
                "Codex 模型目录分页超过限制，请重新检测连接。", "protocol_invalid"
            )
        configured = process.config.get("model")
        if configured and not any(entry["model"] == configured for entry in data):
            # 自定义提供方的当前模型可能不在内置目录中；保留原生配置，不猜测其他模型。
            data.append(
                {
                    "model": configured,
                    "displayName": configured,
                    "source": "config",
                    "supportedReasoningEfforts": [],
                }
            )
        if not data:
            raise ConnectionError(
                "Codex 没有返回模型，请先检查其登录和模型配置。", "models_missing"
            )
        process.catalog = data
        return self.options(process, model)

    @staticmethod
    def options(process, model=""):
        data = process.catalog
        preferred = model or process.config.get("model")
        selected = next((entry for entry in data if entry["model"] == preferred), None)
        if model and not selected:
            raise ConnectionError(
                "所选模型不在 Codex 的目录中，请重新检测并选择。", "model_missing"
            )
        selected = selected or next(
            (entry for entry in data if entry.get("isDefault")), data[0]
        )
        efforts = selected.get("supportedReasoningEfforts") or []
        if not isinstance(efforts, list) or any(
            not isinstance(item, dict)
            or not isinstance(item.get("reasoningEffort"), str)
            for item in efforts
        ):
            raise ConnectionError(
                "Codex 返回的推理选项格式不受支持，请更新 CLI 后重新检测。",
                "protocol_unsupported",
            )
        default = selected.get("defaultReasoningEffort") or ""
        configured = process.config.get("model_reasoning_effort")
        current = (
            configured
            if configured in {o["reasoningEffort"] for o in efforts}
            else default
        )
        return {
            "models": [
                {
                    "value": entry["model"],
                    "name": entry.get("displayName") or entry["model"],
                    "group": "当前配置" if entry.get("source") == "config" else "",
                }
                for entry in data
            ],
            "currentModel": selected["model"],
            "reasoningOptions": [
                {
                    "value": item["reasoningEffort"],
                    "name": item["reasoningEffort"],
                    "group": "",
                }
                for item in efforts
            ],
            "currentReasoning": current,
        }

    async def new_session(self, process, workspace):
        options = await self.probe_options(process)
        result = await process.call("thread/start", {"cwd": workspace})
        sid = (result.get("thread") or {}).get("id")
        if not isinstance(sid, str) or not sid:
            raise ConnectionError(
                "Codex 未返回有效的原生会话编号，未继续提问。", "session_invalid"
            )
        return HarnessSession(sid, options)

    async def resume(self, process, sid, workspace):
        options = await self.probe_options(process)
        result = await process.call(
            "thread/resume", {"threadId": sid, "cwd": workspace, "excludeTurns": True}
        )
        if (result.get("thread") or {}).get("id") != sid:
            raise ConnectionError(
                "Codex 返回的会话编号与原绑定不同，未继续提问。", "binding_mismatch"
            )
        return HarnessSession(sid, options)

    async def select_model(self, process, sid, model, session):
        options = self.options(process, model)
        process.selections[sid] = (model, "")
        return options

    async def select_reasoning(self, process, sid, value):
        model, _ = process.selections[sid]
        allowed = {o["value"] for o in self.options(process, model)["reasoningOptions"]}
        if value not in allowed:
            raise ConnectionError(
                "当前 Codex 模型不支持该推理强度，请重新选择。", "reasoning_unsupported"
            )
        process.selections[sid] = (model, value)

    async def prompt(self, process, sid, text):
        return await process.prompt(sid, text)

    async def cancel(self, process, sid):
        await process.interrupt(sid)
