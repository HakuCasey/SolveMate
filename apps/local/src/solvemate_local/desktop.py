"""桌面安装版的本机服务入口。"""

import argparse
import ctypes
import logging
import os
import sys
import threading
import time

import uvicorn

from .main import create_app


def arguments():
    parser = argparse.ArgumentParser(description="Run the SolveMate desktop service.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--parent-pid", type=int)
    return parser.parse_args()


def parent_is_running(parent_pid: int) -> bool:
    """检查桌面主进程是否仍然存在，避免异常退出后留下本机服务。"""
    if sys.platform == "win32":
        synchronize = 0x00100000
        wait_timeout = 0x00000102
        kernel32 = ctypes.windll.kernel32
        kernel32.OpenProcess.argtypes = [ctypes.c_uint32, ctypes.c_int, ctypes.c_uint32]
        kernel32.OpenProcess.restype = ctypes.c_void_p
        kernel32.WaitForSingleObject.argtypes = [ctypes.c_void_p, ctypes.c_uint32]
        kernel32.WaitForSingleObject.restype = ctypes.c_uint32
        kernel32.CloseHandle.argtypes = [ctypes.c_void_p]
        kernel32.CloseHandle.restype = ctypes.c_int
        handle = kernel32.OpenProcess(synchronize, False, parent_pid)
        if not handle:
            return False
        try:
            return kernel32.WaitForSingleObject(handle, 0) == wait_timeout
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(parent_pid, 0)
    except (OSError, ProcessLookupError):
        return False
    return True


def stop_after_parent_exit(server: uvicorn.Server, parent_pid: int):
    # Uvicorn 启动时会初始化退出状态；先等服务完成启动，避免过早写入的退出信号被覆盖。
    while not server.started:
        time.sleep(0.1)
    while parent_is_running(parent_pid):
        time.sleep(1)
    logging.getLogger(__name__).info("Desktop parent exited; stopping local service.")
    server.should_exit = True


def main():
    values = arguments()
    logging.basicConfig(
        level=os.environ.get("SOLVEMATE_LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    server = uvicorn.Server(
        uvicorn.Config(
            create_app(
                startup_progress=lambda: print("data-copy-progress", flush=True)
            ),
            host=values.host,
            port=values.port,
            log_level=os.environ.get("SOLVEMATE_LOG_LEVEL", "info").lower(),
            access_log=False,
        )
    )
    if values.parent_pid:
        threading.Thread(
            target=stop_after_parent_exit,
            args=(server, values.parent_pid),
            daemon=True,
        ).start()
    server.run()


if __name__ == "__main__":
    main()
