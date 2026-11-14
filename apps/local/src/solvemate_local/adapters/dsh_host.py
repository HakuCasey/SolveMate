"""DSH 本机 Host 的启动、认证和退出；认证信息不交给网页。"""

import asyncio
import http.cookiejar
import json
import logging
import os
import re
import signal
import socket
import threading
from pathlib import Path
from tempfile import TemporaryDirectory
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import (
    HTTPCookieProcessor,
    HTTPRedirectHandler,
    ProxyHandler,
    Request,
    build_opener,
)
from uuid import uuid4

from websockets.asyncio.client import connect

from ..acp import launch_spec
from ..errors import ConnectionError
from ..processes import process_options, stop_process_tree
from ..transport import safe_error


def native_error(error):
    code = error.get("code", "") if isinstance(error, dict) else ""
    message, mapped = {
        "session/not-found": ("第三方 Harness 中的会话无法匹配。", "session_missing"),
        "session/writer-held": (
            "原会话正在其他 DSH 进程中使用，请关闭对应会话后重试。",
            "session_busy",
        ),
        "session/model-unavailable": (
            "当前模型或推理等级不可用，请重新选择。",
            "model_missing",
        ),
    }.get(code, ("DSH 原生接口返回错误，已保留现有记录。", "native_request_failed"))
    return ConnectionError(message, mapped, details=safe_error(code))


# 重定向也只能留在本次 Host，避免将启动令牌或 Cookie 发到其他地址。
class LocalRedirects(HTTPRedirectHandler):
    def __init__(self, origin):
        self.origin = origin

    def redirect_request(self, request, response, code, message, headers, newurl):
        parsed = urlsplit(newurl)
        if f"{parsed.scheme}://{parsed.netloc}" != self.origin:
            raise ConnectionError("DSH 返回了非本机认证地址。", "protocol_invalid")
        return super().redirect_request(
            request, response, code, message, headers, newurl
        )


class DshHttp:
    def __init__(self, url, port):
        parsed = urlsplit(url)
        if (
            parsed.scheme != "http"
            or parsed.hostname != "127.0.0.1"
            or parsed.port != port
        ):
            raise ConnectionError("DSH 未返回有效的本机地址。", "protocol_invalid")
        self.origin = f"http://127.0.0.1:{port}"
        self.jar = http.cookiejar.CookieJar()
        self.opener = build_opener(
            ProxyHandler({}), LocalRedirects(self.origin), HTTPCookieProcessor(self.jar)
        )
        self.lock = threading.Lock()
        with self.opener.open(url, timeout=8):
            pass
        if not list(self.jar):
            raise ConnectionError(
                "DSH 未完成本机认证，请检查 Harness 版本。", "protocol_unsupported"
            )

    @property
    def cookie(self):
        return "; ".join(f"{item.name}={item.value}" for item in self.jar)

    def rpc(self, method, request=None):
        args = (
            {}
            if request is None
            else request
            if method == "$events/result"
            else {"request": request}
        )
        payload = {
            "type": "client-request",
            "rpcId": str(uuid4()),
            "method": method,
            "payload": {"args": args},
        }
        message = Request(
            self.origin + "/api/" + method,
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json", "Origin": self.origin},
        )
        try:
            with self.lock, self.opener.open(message, timeout=12) as response:
                data = response.read(16 * 1024 * 1024 + 1)
            if len(data) > 16 * 1024 * 1024:
                raise ValueError("Native response too large")
            result = json.loads(data)["result"]
            if not isinstance(result, dict) or not isinstance(result.get("ok"), bool):
                raise TypeError("Invalid native response")
            if result.get("ok") is not True:
                raise native_error(result.get("error"))
            return result.get("value")
        except ConnectionError:
            raise
        except (HTTPError, URLError, TimeoutError, OSError) as error:
            raise ConnectionError(
                "无法连接 DSH 本机服务，已收到的内容仍保留。", "native_transport_lost"
            ) from error
        except (KeyError, ValueError, TypeError) as error:
            raise ConnectionError(
                "DSH 接口格式不受支持，请检查 Harness 版本。", "protocol_invalid"
            ) from error


def startup_failure(stderr, returncode):
    text = stderr.decode("utf-8", errors="replace")
    option = re.search(r"unknown option ['\"](--[a-zA-Z-]+)['\"]", text)
    if option:
        message = f"DSH 无法识别启动参数 {option[1]}，请检查 Harness 版本后重新检测。"
    elif "EADDRINUSE" in text:
        message = "DSH 本机服务的端口被占用，请重试。"
    elif "Cannot find module" in text or "ERR_MODULE_NOT_FOUND" in text:
        message = "DSH 缺少运行文件，请检查安装位置或重新安装 Harness。"
    else:
        message = f"DSH 本机服务启动失败（退出码 {returncode}），请重新检测连接。"
    return ConnectionError(message, "program_start_failed", details=safe_error(text))


async def open_stream(socket, endpoint, request=None):
    """两个逻辑订阅共用同一种原生封包，避免分别维护字段。"""
    args = {} if request is None else {"request": request}
    await socket.send(
        json.dumps(
            {
                "type": "open",
                "streamId": str(uuid4()),
                "endpoint": endpoint,
                "payload": {"args": args},
            }
        )
    )


class DshHost:
    def __init__(self, executable, workspace, home, rows=()):
        self.executable, self.workspace, self.home = (
            executable,
            str(workspace),
            str(home),
        )
        self.rows = list(rows)
        self.process = None
        self.readers = []
        self.http = None
        self.directory = None
        self.closing = False
        self.close_task = None

    async def start(self):
        argv, env = launch_spec(self.executable, "web")
        env["DSH_HOME"] = self.home
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        self.directory = TemporaryDirectory(prefix="solvemate-dsh-")
        patch = Path(self.directory.name) / "runtime.patch.json"
        rows = self.rows + [
            {"id": ident, "disabled": True}
            for ident in ["config-editor", "schedule", "session-title-llm", "hmr"]
        ]
        descriptor = os.open(patch, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(rows, stream, ensure_ascii=False)
        diagnostic = bytearray()
        ready = asyncio.get_running_loop().create_future()

        async def stdout():
            while line := await self.process.stdout.readline():
                match = re.search(rb"dsh web: (http://[^\s]+)", line)
                if match and not ready.done():
                    ready.set_result(match[1].decode("utf-8"))
            if not ready.done():
                ready.set_result(None)

        async def stderr():
            while chunk := await self.process.stderr.read(4096):
                diagnostic.extend(chunk)
                del diagnostic[:-8192]

        try:
            self.process = await asyncio.create_subprocess_exec(
                *argv,
                "--patch",
                str(patch),
                "--no-open",
                "--host",
                "127.0.0.1",
                "--port",
                str(port),
                env=env,
                cwd=self.workspace,
                **process_options(),
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            self.readers = [
                asyncio.create_task(stdout()),
                asyncio.create_task(stderr()),
            ]
            async with asyncio.timeout(20):
                url = await ready
                if not url:
                    await self.process.wait()
                    await self.readers[1]
                    raise startup_failure(diagnostic, self.process.returncode)
                self.http = await asyncio.to_thread(DshHttp, url, port)
        except BaseException:
            await self.close()
            raise
        return self

    def is_running(self):
        return (
            self.process is not None
            and self.process.returncode is None
            and not self.closing
        )

    async def rpc(self, method, request=None):
        if not self.is_running():
            raise ConnectionError(
                "DSH 会话进程已退出，已收到的内容仍保留，可恢复原会话后继续。",
                "host_stopped",
            )
        return await asyncio.to_thread(self.http.rpc, method, request)

    async def subscribe(self, endpoint, request=None):
        # WebSocket 调试日志包含握手 Cookie，此通道不输出原始帧或请求头。
        socket_logger = logging.getLogger("solvemate.dsh.socket")
        socket_logger.disabled = True
        socket = await connect(
            self.http.origin.replace("http:", "ws:") + "/api/remote.mux",
            origin=self.http.origin,
            additional_headers={"Cookie": self.http.cookie},
            proxy=None,
            open_timeout=8,
            close_timeout=2,
            max_size=16 * 1024 * 1024,
            logger=socket_logger,
        )
        try:
            await open_stream(socket, endpoint, request)
        except BaseException:
            await socket.close()
            raise
        return socket

    async def snapshot(self, sid):
        socket = await self.subscribe(
            "session/follow",
            {
                "address": {"kind": "session", "sessionId": sid},
                "assistantStream": True,
                "maxMessages": 1,
            },
        )
        try:
            async with asyncio.timeout(15):
                while True:
                    wire = json.loads(await socket.recv())
                    if wire.get("type") == "error":
                        raise native_error(wire.get("error"))
                    if wire.get("value", {}).get("type") == "snapshot":
                        return wire["value"]
        finally:
            await socket.close()

    async def close(self):
        if self.close_task:
            if not self.close_task.done() or not self.close_task.exception():
                await asyncio.shield(self.close_task)
                return
            # 清理失败保留进程引用，允许调用方重试，不伪装已经释放。
            self.close_task = None
        self.closing = True

        async def cleanup():
            try:
                if self.process and self.process.returncode is None:
                    await stop_process_tree(self.process, signal.SIGTERM)
                    try:
                        await asyncio.wait_for(self.process.wait(), 3)
                    except TimeoutError:
                        await stop_process_tree(
                            self.process, getattr(signal, "SIGKILL", signal.SIGTERM)
                        )
                        await asyncio.wait_for(self.process.wait(), 3)
            finally:
                for task in self.readers:
                    task.cancel()
                await asyncio.gather(*self.readers, return_exceptions=True)
                if self.directory:
                    self.directory.cleanup()

        task = self.close_task = asyncio.create_task(cleanup())
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            await task
            raise
