import ctypes
import os
import sys
from pathlib import Path
from uuid import UUID


def windows_known_folder(identifier):
    """读取 Windows 用户目录，尊重系统重定向并释放 Shell 返回的内存。"""
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
        folder = (ctypes.c_byte * 16).from_buffer_copy(UUID(identifier).bytes_le)
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


def downloads_directory():
    if sys.platform == "win32":
        value = windows_known_folder("374DE290-123F-4565-9164-39C4925E467B")
        if value:
            return Path(value)
        # 系统 API 失败时不写入猜测目录，避免把成功文件保存到用户找不到的位置。
        raise OSError("Windows Downloads folder is unavailable.")
    if sys.platform == "linux":
        config = (
            Path(os.environ.get("XDG_CONFIG_HOME", str(Path.home() / ".config")))
            / "user-dirs.dirs"
        )
        if config.is_file():
            for line in config.read_text(encoding="utf-8").splitlines():
                if line.startswith('XDG_DOWNLOAD_DIR="') and line.endswith('"'):
                    value = Path(
                        line.split('"', 2)[1].replace("$HOME", str(Path.home()))
                    )
                    if value.is_absolute():
                        return value
    return Path.home() / "Downloads"
