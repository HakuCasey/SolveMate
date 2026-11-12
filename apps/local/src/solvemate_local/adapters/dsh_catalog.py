"""通过 DSH 的模型目录接口检测，不创建或恢复用户会话。"""

import asyncio
import http.cookiejar
import json
import os
import re
import signal
import socket
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

from ..acp import launch_spec
from ..errors import ConnectionError
from ..processes import process_options, stop_process_tree
from ..transport import safe_error


class LocalRedirects(HTTPRedirectHandler):
    def __init__(self, origin):
        self.origin = origin

    def redirect_request(self, request, response, code, message, headers, newurl):
        parsed = urlsplit(newurl)
        if f"{parsed.scheme}://{parsed.netloc}" != self.origin:
            raise ConnectionError(
                "DSH 启动认证返回了非本机地址，已停止检测。", "protocol_invalid"
            )
        return super().redirect_request(
            request, response, code, message, headers, newurl
        )


def read_catalog(url, expected_port):
    parsed = urlsplit(url)
    if (
        parsed.scheme != "http"
        or parsed.hostname != "127.0.0.1"
        or parsed.port != expected_port
    ):
        raise ConnectionError("DSH 未返回有效的本机检测地址。", "protocol_invalid")
    origin = f"{parsed.scheme}://{parsed.netloc}"
    opener = build_opener(
        ProxyHandler({}),
        LocalRedirects(origin),
        HTTPCookieProcessor(http.cookiejar.CookieJar()),
    )
    try:
        # 启动令牌与 Cookie 仅留在本次本机检测内，不交给页面或日志。
        with opener.open(url, timeout=8):
            pass
        payload = {
            "type": "client-request",
            "rpcId": str(uuid4()),
            "method": "session/modelCatalog",
            "payload": {"args": {}},
        }
        request = Request(
            origin + "/api/session/modelCatalog",
            data=json.dumps(payload).encode("utf-8"),
            method="POST",
            headers={"Content-Type": "application/json", "Origin": origin},
        )
        with opener.open(request, timeout=12) as response:
            data = response.read(8 * 1024 * 1024 + 1)
        if len(data) > 8 * 1024 * 1024:
            raise ValueError("Catalog is too large")
        result = json.loads(data)["result"]
        if result.get("ok") is not True or not isinstance(result.get("value"), dict):
            raise ValueError("Invalid catalog result")
        return result["value"]
    except (
        HTTPError,
        URLError,
        TimeoutError,
        ValueError,
        KeyError,
        TypeError,
    ) as error:
        raise ConnectionError(
            "无法读取 DSH 模型目录，请检查 Harness 版本和模型服务配置后重新检测。",
            "catalog_unavailable",
        ) from error


def describe_catalog(catalog, selected=""):
    if not isinstance(catalog.get("groups"), list) or catalog.get("failures"):
        raise ConnectionError(
            "DSH 未能完整读取模型目录，请检查其模型服务配置后重新检测。",
            "models_unavailable",
        )
    models = []
    try:
        for group in catalog["groups"]:
            for item in group["models"]:
                option = {
                    "value": json.dumps(
                        [group["id"], item["id"]],
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ),
                    "name": item["name"],
                    "group": group["name"],
                }
                reasoning = item.get("reasoning")
                if reasoning is not None:
                    efforts = [
                        {
                            "value": str(effort["id"]),
                            "name": effort["name"],
                            "group": "",
                        }
                        for effort in reasoning["efforts"]
                    ]
                    if "defaultEffort" not in reasoning:
                        efforts.insert(
                            0, {"value": "", "name": "Provider default", "group": ""}
                        )
                    option.update(
                        reasoningOptions=efforts,
                        defaultReasoning=str(reasoning.get("defaultEffort", "")),
                    )
                models.append(option)
        default = catalog.get("default", {})
        current = selected or json.dumps(
            [default.get("provider"), default.get("model")],
            ensure_ascii=False,
            separators=(",", ":"),
        )
        option = next((item for item in models if item["value"] == current), None)
        if not models:
            raise ConnectionError(
                "DSH 未返回可选模型，请先在 Harness 中配置模型服务。", "models_missing"
            )
        # 旧模型缺失时仍允许展示真实目录，由用户重新选择，不静默换模型。
        return {
            "models": models,
            "currentModel": current if option else "",
            "reasoningOptions": option.get("reasoningOptions", []) if option else [],
            "currentReasoning": option.get("defaultReasoning", "") if option else "",
        }
    except (KeyError, TypeError) as error:
        raise ConnectionError(
            "DSH 返回的模型目录格式不受支持，请检查 Harness 版本。", "protocol_invalid"
        ) from error


def startup_failure(stderr, returncode):
    """按已知启动错误给出具体提示，原始配置和认证信息不进入界面。"""
    text = stderr.decode("utf-8", errors="replace")
    option = re.search(r"unknown option ['\"](--[a-zA-Z-]+)['\"]", text)
    if option:
        message = f"DSH 无法识别模型目录服务的启动参数 {option[1]}，请更新 SolveMate 或检查 Harness 版本后重新检测。"
    elif "EADDRINUSE" in text:
        message = "本机模型目录服务的端口被占用，请重新检测连接。"
    elif "Cannot find module" in text or "ERR_MODULE_NOT_FOUND" in text:
        message = "DSH 缺少启动所需的运行文件，请检查安装路径或重新安装 Harness。"
    else:
        message = f"DSH 模型目录服务启动失败（退出码 {returncode}），请重新检测连接。"
    return ConnectionError(message, "program_start_failed", details=safe_error(text))


async def catalog_options(acp_process, home, selected=""):
    argv, env = launch_spec(acp_process.executable, "web")
    env["DSH_HOME"] = str(home)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    with TemporaryDirectory(prefix="solvemate-dsh-catalog-") as directory:
        rows = []
        if acp_process.overlay_directory:
            rows = json.loads(
                (Path(acp_process.overlay_directory.name) / "providers.json").read_text(
                    encoding="utf-8"
                )
            )
        # 本次只查询目录，不启动计划任务、自动标题生成或热重载。
        rows += [
            {"id": ident, "disabled": True}
            for ident in ["schedule", "session-title-llm", "hmr"]
        ]
        patch = Path(directory) / "catalog.patch.json"
        descriptor = os.open(patch, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w", encoding="utf-8") as stream:
            json.dump(rows, stream, ensure_ascii=False)
        process = await asyncio.create_subprocess_exec(
            *argv,
            # DSH 先解析全局参数，再把第一个 Web 参数及后续参数交给 Web。
            "--patch",
            str(patch),
            "--no-open",
            "--host",
            "127.0.0.1",
            "--port",
            str(port),
            env=env,
            cwd=acp_process.workspace,
            **process_options(),
            stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        diagnostic = bytearray()

        async def drain_stderr():
            while chunk := await process.stderr.read(4096):
                diagnostic.extend(chunk)
                del diagnostic[:-8192]

        stderr = asyncio.create_task(drain_stderr())
        try:
            while line := await process.stdout.readline():
                match = re.search(rb"dsh web: (http://[^\s]+)", line)
                if match:
                    catalog = await asyncio.to_thread(
                        read_catalog, match[1].decode("utf-8"), port
                    )
                    return describe_catalog(catalog, selected)
            await process.wait()
            await stderr
            raise startup_failure(diagnostic, process.returncode)
        finally:

            async def cleanup():
                try:
                    if process.returncode is None:
                        await stop_process_tree(process, signal.SIGTERM)
                        try:
                            await asyncio.wait_for(process.wait(), 3)
                        except TimeoutError:
                            await stop_process_tree(
                                process, getattr(signal, "SIGKILL", signal.SIGTERM)
                            )
                            await process.wait()
                finally:
                    stderr.cancel()
                    await asyncio.gather(stderr, return_exceptions=True)

            task = asyncio.create_task(cleanup())
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                await task
                raise
