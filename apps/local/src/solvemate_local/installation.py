import ctypes
import os
import sys
from pathlib import Path, PureWindowsPath
from uuid import UUID


def windows_programs_directory():
    """与 DSH 安装器一致，优先读取可被系统重定向的用户程序目录。"""
    try:
        shell = ctypes.WinDLL("shell32", use_last_error=True)
        ole = ctypes.WinDLL("ole32", use_last_error=True)
        shell.SHGetKnownFolderPath.argtypes = [
            ctypes.c_void_p,
            ctypes.c_uint32,
            ctypes.c_void_p,
            ctypes.POINTER(ctypes.c_void_p),
        ]
        shell.SHGetKnownFolderPath.restype = ctypes.c_int32
        ole.CoTaskMemFree.argtypes = [ctypes.c_void_p]
        ole.CoTaskMemFree.restype = None
        folder = (ctypes.c_byte * 16).from_buffer_copy(
            UUID("5CD7AEE2-2219-4A67-B85D-6C9CE15660CB").bytes_le
        )
        result = ctypes.c_void_p()
        try:
            status = shell.SHGetKnownFolderPath(
                ctypes.byref(folder), 0, None, ctypes.byref(result)
            )
            if status == 0 and result.value:
                return ctypes.wstring_at(result.value)
        finally:
            if result.value:
                ole.CoTaskMemFree(result)
    except (AttributeError, OSError):
        pass
    return ""


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
