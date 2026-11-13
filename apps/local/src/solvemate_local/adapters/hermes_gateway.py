"""使用 Hermes 安装内的 SDK 读取目录、按指定模型创建原生会话。"""

import asyncio
import json
import os
from pathlib import Path


async def native_request(process, operation, **payload):
    from ..errors import ConnectionError
    from .hermes import hermes_home
    from .hermes_reasoning import _run, runtime_command

    env = os.environ.copy()
    env["HERMES_HOME"] = str(hermes_home())
    try:
        command = getattr(process, "gateway_command", None)
        if command is None:
            raw = await _run(
                [process.executable, "--print-runtime-command", "--module", "site"], env
            )
            command = runtime_command(raw, Path(__file__).resolve())
            process.gateway_command = command
        result = json.loads(
            await _run(command, env, {"operation": operation, **payload})
        )
        if not isinstance(result, dict):
            raise TypeError("Invalid Hermes SDK response")
        if result.get("error"):
            code = result["error"]
            if not isinstance(code, str):
                raise TypeError("Invalid Hermes SDK error")
            raise ConnectionError(
                "Hermes 原生接口未能完成操作，请确认模型配置后重新检测连接。"
                if code != "hermes_sdk_unavailable"
                else "当前 Hermes 不支持按指定模型创建原生会话，请更新 Hermes 后重新检测连接。",
                code,
            )
        return result
    except ConnectionError:
        raise
    except (OSError, ValueError, TypeError, IndexError, SyntaxError) as error:
        raise ConnectionError(
            "无法调用 Hermes 原生接口，请检查 Hermes 安装并重新检测连接。",
            "hermes_sdk_unavailable",
        ) from error


async def _native(request):
    # 由 Hermes 自己的 Python 运行；只使用官方 SDK，不加载 SolveMate 依赖或复制密钥。
    from hermes_cli.gateway_client import connect_gateway

    operation = request["operation"]
    if operation == "catalog":
        from acp_adapter.model_catalog import build_model_state
        from hermes_cli.config import load_config
        from hermes_cli.models import parse_model_input
        from hermes_constants import VALID_REASONING_EFFORTS

        config = load_config()
        configured = config.get("model") or {}
        configured = (
            configured if isinstance(configured, dict) else {"default": configured}
        )
        selected = request.get("model", "")
        provider, model = (
            parse_model_input(selected, "")
            if selected
            else (configured.get("provider", ""), configured.get("default", ""))
        )
        state = await asyncio.to_thread(build_model_state, model, provider, "")
        if state is None:
            return {"error": "models_missing"}
        choices = list(dict.fromkeys(["none", *VALID_REASONING_EFFORTS]))
        effort = (config.get("agent") or {}).get("reasoning_effort", "")
        return {
            "models": state.model_dump(by_alias=True),
            "reasoningOptions": [
                {"value": value, "name": value.capitalize(), "group": ""}
                for value in choices
            ],
            "currentReasoning": effort if effort in choices else "",
        }

    async with connect_gateway() as client:
        descriptor = await client.rpc("runtime.describe")
        if "acp" not in descriptor.get("session_create", {}).get(
            "sources", []
        ) or "acp-editor-policy-v1" not in descriptor.get("capabilities", []):
            return {"error": "hermes_sdk_unavailable"}
        if operation == "check":
            return {"ready": True}
        if operation != "create":
            raise ValueError("Unsupported Hermes operation")
        from hermes_cli.models import parse_model_input

        provider, model = parse_model_input(request["model"], "")
        if not provider or not model:
            return {"error": "model_missing"}
        # 显式传入模型和提供方，不能让原生创建流程解析全局默认模型。
        result = await client.rpc(
            "session.create",
            request_id=request["requestId"],
            source="acp",
            cwd=request["workspace"],
            provider=provider,
            model=model,
            editor={"mcp_servers": [], "edit_approval_policy": "ask"},
        )
        return {"sessionId": result["session_id"]}


if __name__ == "__main__":
    import contextlib
    import sys

    try:
        request = json.load(sys.stdin)
        with contextlib.redirect_stdout(sys.stderr):
            result = asyncio.run(_native(request))
    except ImportError:
        result = {"error": "hermes_sdk_unavailable"}
    except Exception:  # noqa: BLE001 - 原生进程边界只返回不含凭据的固定错误。
        # 不向宿主输出原生异常原文，避免其中包含提供方凭据。
        result = {"error": "hermes_native_failed"}
    print(json.dumps(result))
