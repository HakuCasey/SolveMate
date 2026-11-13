import os
import sys
from pathlib import Path, PureWindowsPath

from .system_paths import windows_known_folder


def windows_programs_directory():
    """与 DSH 安装器一致，读取可被系统重定向的用户程序目录。"""
    return windows_known_folder("5CD7AEE2-2219-4A67-B85D-6C9CE15660CB")


def default_installation_path():
    if sys.platform == "darwin":
        return "/Applications/DeepSeek Harness.app"
    if sys.platform == "win32":
        programs = windows_programs_directory()
        if not programs:
            local = os.environ.get("LOCALAPPDATA", "")
            if not local:
                local = str(Path.home() / "AppData" / "Local")
            if not PureWindowsPath(local).is_absolute():
                return ""
            programs = str(PureWindowsPath(local) / "Programs")
        if PureWindowsPath(programs).is_absolute():
            return str(PureWindowsPath(programs) / "DeepSeek Harness")
    # 不支持的系统不能套用其他系统的默认位置，仍可手动指定原生 CLI。
    return ""
