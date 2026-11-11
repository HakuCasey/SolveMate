import asyncio
import json
import logging
import os
import re
import signal
import sys

from .errors import ConnectionError

logger = logging.getLogger(__name__)


def safe_error(message):
    text = re.sub(r"sk-[\w-]+", "[redacted]", str(message))
    text = re.sub(r"(?i)(bearer\s+)[^\s\"']+", r"\1[redacted]", text)
    text = re.sub(
        r"(?i)((?:api[_-]?key|token|password)[\"']?\s*[:=]\s*[\"']?)[^\s\"'&,}]+",
        r"\1[redacted]",
        text,
    )
    return text[:600]


def process_options():
    if sys.platform == "win32":
        return {"creationflags": 0x00000200}  # CREATE_NEW_PROCESS_GROUP
    return {"start_new_session": True}


class UnsupportedClientMethod(Exception):
    pass


class JsonRpcProcess:
    def __init__(
        self,
        executable,
        workspace,
        on_update=None,
        on_permission=None,
        *,
        harness_home=None,
    ):
        self.executable = executable
        self.workspace = workspace
        self.on_update = on_update
        self.on_permission = on_permission
        self.pending = {}
        self.sequence = 0
        self.process = None
        self.reader_task = None
        self.stderr_task = None
        self.requests = set()
        self.capabilities = {}
        self.closed = False

    def is_running(self):
        return bool(
            not self.closed
            and self.process
            and self.process.returncode is None
            and self.reader_task
            and not self.reader_task.done()
        )

    async def start(self):
        argv, env = await self.prepare_launch()
        try:
            self.process = await asyncio.create_subprocess_exec(
                *argv,
                env=env,
                **process_options(),
                cwd=self.workspace,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                limit=8 * 1024 * 1024,
            )
        except BaseException:
            self.cleanup_launch()
            raise
        self.reader_task = asyncio.create_task(self._read())
        self.stderr_task = asyncio.create_task(self._stderr())
        return await self.initialize()

    async def initialize(self):
        raise NotImplementedError

    def notification(self, method, params):
        pass

    def disconnected(self):
        pass

    async def handle_request(self, method, params):
        raise UnsupportedClientMethod

    async def _stderr(self):
        # 运行时诊断可能含用户路径或服务信息，不把原文写入日志或网页。
        while await self.process.stderr.readline():
            pass

    async def _write(self, item):
        if self.closed or self.process.returncode is not None:
            raise ConnectionError(
                "Harness 进程已经停止，请重新检测连接。", "process_stopped"
            )
        self.process.stdin.write((json.dumps(item, ensure_ascii=False) + "\n").encode())
        await self.process.stdin.drain()

    async def _read(self):
        try:
            while line := await self.process.stdout.readline():
                item = json.loads(line)
                if not isinstance(item, dict):
                    raise TypeError("JSON-RPC object expected.")
                if "method" in item:
                    if "id" in item:
                        task = asyncio.create_task(self._request(item))
                        self.requests.add(task)
                        task.add_done_callback(self.requests.discard)
                    else:
                        self.notification(item["method"], item.get("params", {}))
                else:
                    future = self.pending.get(item.get("id"))
                    if future and not future.done():
                        future.set_result(item)
        except (ValueError, TypeError, KeyError, OSError, asyncio.LimitOverrunError):
            logger.error("Failed to read JSON-RPC protocol output.")
        finally:
            self.disconnected()
            for future in list(self.pending.values()):
                if not future.done():
                    future.set_exception(
                        ConnectionError(
                            "Harness 连接已断开，已收到的内容仍保留。",
                            "process_stopped",
                        )
                    )

    async def _request(self, item):
        try:
            try:
                result = await self.handle_request(
                    item["method"], item.get("params", {})
                )
                response = {"jsonrpc": "2.0", "id": item["id"], "result": result}
            except UnsupportedClientMethod:
                response = {
                    "jsonrpc": "2.0",
                    "id": item["id"],
                    "error": {
                        "code": -32601,
                        "message": "Client method is not supported.",
                    },
                }
            except Exception as error:  # noqa: BLE001 - 原生请求需要明确收到失败结果。
                logger.warning(
                    "Harness client request failed: %s", type(error).__name__
                )
                response = {
                    "jsonrpc": "2.0",
                    "id": item["id"],
                    "error": {"code": -32603, "message": "Client request failed."},
                }
            await self._write(response)
        except (ConnectionError, OSError):
            logger.warning("Failed to return a JSON-RPC client response.")

    async def call(self, method, params, timeout=40):
        self.sequence += 1
        ident = self.sequence
        future = asyncio.get_running_loop().create_future()
        self.pending[ident] = future
        try:
            await self._write(
                {"jsonrpc": "2.0", "id": ident, "method": method, "params": params}
            )
            item = await asyncio.wait_for(future, timeout)
            if "error" in item:
                raise ConnectionError(
                    "Harness 返回错误："
                    + safe_error(item["error"].get("message", "未知错误")),
                    "harness_error",
                )
            return item.get("result", {})
        except TimeoutError as error:
            raise ConnectionError(
                "等待 Harness 响应超时，请确认运行状态后重试。", "request_timeout"
            ) from error
        finally:
            self.pending.pop(ident, None)

    async def notify(self, method, params):
        await self._write({"jsonrpc": "2.0", "method": method, "params": params})

    async def close(self):
        if not self.process or self.closed:
            self.cleanup_launch()
            return
        for task in list(self.requests):
            task.cancel()
        await asyncio.gather(*self.requests, return_exceptions=True)
        self.process.stdin.close()
        try:
            await asyncio.wait_for(self.process.wait(), 5)
        except TimeoutError:
            await self._stop_process_tree(signal.SIGTERM)
            try:
                await asyncio.wait_for(self.process.wait(), 3)
            except TimeoutError:
                await self._stop_process_tree(
                    getattr(signal, "SIGKILL", signal.SIGTERM)
                )
                await self.process.wait()
        self.closed = True
        await asyncio.gather(self.reader_task, self.stderr_task, return_exceptions=True)
        self.cleanup_launch()

    async def prepare_launch(self):
        raise NotImplementedError

    def cleanup_launch(self):
        pass

    async def _stop_process_tree(self, sig):
        if sys.platform == "win32":
            child = await asyncio.create_subprocess_exec(
                "taskkill",
                "/PID",
                str(self.process.pid),
                "/T",
                "/F",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await child.wait()
        else:
            try:
                os.killpg(self.process.pid, sig)
            except ProcessLookupError:
                pass


class AcpTransport(JsonRpcProcess):
    async def initialize(self):
        info = await self.call(
            "initialize",
            {
                "protocolVersion": 1,
                "clientCapabilities": {},
                "clientInfo": {"name": "solvemate", "version": "0.1.0"},
            },
            timeout=30,
        )
        if info.get("protocolVersion") != 1:
            raise ConnectionError(
                "Harness 返回了不支持的 ACP 版本。", "protocol_unsupported"
            )
        self.capabilities = info.get("agentCapabilities", {})
        return info

    def notification(self, method, params):
        if method == "session/update" and self.on_update:
            self.on_update(params)

    async def handle_request(self, method, params):
        if method != "session/request_permission":
            raise UnsupportedClientMethod
        if self.on_permission:
            return await self.on_permission(params)
        return {"outcome": {"outcome": "cancelled"}}
