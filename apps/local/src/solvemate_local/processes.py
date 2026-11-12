"""本机子进程的系统差异；只操作调用方创建的进程组或进程树。"""

import asyncio
import os
import sys


def process_options():
    if sys.platform == "win32":
        return {"creationflags": 0x00000200}  # CREATE_NEW_PROCESS_GROUP
    return {"start_new_session": True}


async def stop_process_tree(process, sig):
    if sys.platform == "win32":
        child = await asyncio.create_subprocess_exec(
            "taskkill",
            "/PID",
            str(process.pid),
            "/T",
            "/F",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await child.wait()
    else:
        try:
            os.killpg(process.pid, sig)
        except ProcessLookupError:
            pass
