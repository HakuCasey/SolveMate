import os
import shutil
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

from .errors import ConnectionError
from .model_config import desktop_overlay, resolve_home
from .processes import process_options
from .transport import AcpTransport, safe_error  # noqa: F401


def find_executable(value=""):
    if value.strip():
        candidate = Path(value).expanduser()
        if candidate.suffix == ".app":
            candidate /= "Contents/Resources/runtime/cli/bin/dsh"
        elif candidate.is_dir() and sys.platform == "win32":
            candidate /= "DeepSeek Harness.exe"
        if not candidate.is_absolute() or not candidate.is_file():
            raise ConnectionError(
                "该位置未找到 DeepSeek Harness，请填写实际安装路径后重新检测。",
                "program_missing",
            )
        if os.name != "nt" and not os.access(candidate, os.X_OK):
            raise ConnectionError("所选文件没有执行权限。", "program_not_executable")
        return str(candidate.resolve())
    registered = shutil.which("dsh")
    if registered:
        return str(Path(registered).resolve())
    raise ConnectionError(
        "未找到 dsh 命令，请填写 DeepSeek Harness 的安装路径。", "program_missing"
    )


def launch_spec(executable, argument, platform=None):
    """Windows 直接启动桌面包的运行时，避免经 cmd 拼接中文和空格路径。"""
    platform = platform or sys.platform
    path = Path(executable)
    env = os.environ.copy()
    if platform == "win32":
        if path.suffix.lower() in {".cmd", ".bat"}:
            if len(path.parents) > 4 and path.parent.name.lower() == "bin":
                desktop = path.parents[4] / "DeepSeek Harness.exe"
                if desktop.is_file():
                    path = desktop
            if path.suffix.lower() in {".cmd", ".bat"}:
                raise ConnectionError(
                    "请在 Windows 上选择 DeepSeek Harness.exe 或原生 dsh.exe，暂不执行第三方批处理入口。",
                    "launcher_unsupported",
                )
        resources = path.parent / "resources"
        if path.name.lower() == "deepseek harness.exe":
            if not (resources / "app.asar").is_file():
                raise ConnectionError(
                    "该安装目录缺少 Harness 运行时，请检查安装位置或重新安装。",
                    "runtime_missing",
                )
            env["ELECTRON_RUN_AS_NODE"] = "1"
            entry = (
                resources
                / "app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js"
            )
            return [str(path), "--expose-internals", str(entry), argument], env
    return [str(path), argument], env


def flatten_options(options, group=""):
    result = []
    for option in options:
        if "options" in option:
            result.extend(flatten_options(option["options"], option.get("name", group)))
        elif isinstance(option.get("value"), str):
            result.append(
                {
                    "value": option["value"],
                    "name": option.get("name", option["value"]),
                    "group": group,
                }
            )
    return result


def describe_options(session):
    config = session.get("configOptions", [])
    model = next((item for item in config if item.get("id") == "model"), {})
    reasoning = next(
        (item for item in config if item.get("id") == "reasoning_effort"), {}
    )
    return {
        "models": flatten_options(model.get("options", [])),
        "currentModel": model.get("currentValue", ""),
        "reasoningOptions": flatten_options(reasoning.get("options", [])),
        "currentReasoning": reasoning.get("currentValue", ""),
    }


class AcpProcess(AcpTransport):
    """DSH 启动与模型补丁；协议收发由公共传输层负责。"""

    def __init__(self, *args, harness_home=None, **kwargs):
        super().__init__(*args, **kwargs)
        self.harness_home = Path(harness_home) if harness_home else resolve_home()
        self.overlay_directory = None

    async def prepare_launch(self):
        argv, env = launch_spec(self.executable, "acp")
        env["DSH_HOME"] = str(self.harness_home)
        overlay = await desktop_overlay(self.harness_home, argv, env, process_options())
        if overlay:
            self.overlay_directory = TemporaryDirectory(prefix="solvemate-acp-")
            patch = Path(self.overlay_directory.name) / "providers.json"
            descriptor = os.open(patch, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
                stream.write(overlay)
            argv += ["--patch", str(patch)]
        return argv, env

    def cleanup_launch(self):
        if self.overlay_directory:
            self.overlay_directory.cleanup()
            self.overlay_directory = None
