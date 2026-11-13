"""旧版 Hermes ACP 的会话推理等级，通过安装内的原生 SDK 读写。"""

import ast
import asyncio
import json
import os
import signal
from pathlib import Path


def runtime_command(raw, helper):
    """保留 Hermes 生成的隔离启动环境，仅替换其最终入口。"""
    argv = json.loads(raw)
    if not isinstance(argv, list) or not all(isinstance(x, str) for x in argv):
        raise ValueError("Invalid Hermes runtime command")
    if len(argv) != 4 or argv[1:3] != ["-I", "-c"]:
        raise ValueError("Unsupported Hermes runtime command")
    tree = ast.parse(argv[3])
    entry = tree.body[-1]
    if not (
        isinstance(entry, ast.Expr)
        and isinstance(entry.value, ast.Call)
        and isinstance(entry.value.func, ast.Attribute)
        and isinstance(entry.value.func.value, ast.Name)
        and entry.value.func.value.id == "runpy"
        and entry.value.func.attr == "run_module"
        and entry.value.args
        and isinstance(entry.value.args[0], ast.Constant)
        and entry.value.args[0].value == "site"
    ):
        raise ValueError("Unsupported Hermes runtime entry")
    tree.body[-1] = ast.parse('runpy.run_path(sys.argv[1], run_name="__main__")').body[
        0
    ]
    return [*argv[:3], ast.unparse(tree), str(helper)]


async def _run(argv, env, request=None):
    from ..errors import ConnectionError
    from ..processes import process_options, stop_process_tree

    process = await asyncio.create_subprocess_exec(
        *argv,
        env=env,
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.DEVNULL,
        limit=1024 * 1024,
        **process_options(),
    )
    try:
        output, _ = await asyncio.wait_for(
            process.communicate(json.dumps(request).encode() if request else None), 20
        )
        if process.returncode or len(output) > 1024 * 1024:
            raise ValueError("Hermes control failed")
        return output.decode("utf-8")
    except TimeoutError as error:
        raise ConnectionError(
            "等待 Hermes 会话配置超时，请检查 Hermes 后重新检测连接。",
            "request_timeout",
        ) from error
    finally:
        if process.returncode is None:
            await stop_process_tree(process, signal.SIGTERM)
            await process.wait()


async def session_reasoning(process, sid, value=None):
    from ..errors import ConnectionError
    from .hermes import hermes_home

    env = os.environ.copy()
    env["HERMES_HOME"] = str(hermes_home())
    try:
        command = getattr(process, "reasoning_command", None)
        if command is None:
            raw = await _run(
                [process.executable, "--print-runtime-command", "--module", "site"], env
            )
            command = runtime_command(raw, Path(__file__).resolve())
            process.reasoning_command = command
        result = json.loads(
            await _run(command, env, {"sessionId": sid, "value": value})
        )
        if not isinstance(result, dict) or not result.get("reasoningOptions"):
            raise ValueError("Missing Hermes reasoning options")
        if value is not None and result.get("currentReasoning") != value:
            raise ValueError("Hermes reasoning readback mismatch")
        return result
    except ConnectionError:
        raise
    except (OSError, ValueError, IndexError, SyntaxError) as error:
        raise ConnectionError(
            "无法确认 Hermes 会话的推理等级，请更新 Hermes 后重新检测连接。",
            "reasoning_unavailable",
        ) from error


async def _native(request):
    # 此入口由 Hermes 自己的 Python 运行，不导入 SolveMate 的依赖。
    from hermes_cli.gateway_client import connect_gateway
    from hermes_cli.gateway_mutations import PreparedMutations
    from hermes_constants import VALID_REASONING_EFFORTS

    sid, value = request["sessionId"], request.get("value")
    choices = ["none", *VALID_REASONING_EFFORTS]
    if value is not None and value not in choices:
        raise ValueError("Unsupported reasoning effort")
    async with connect_gateway() as client:
        await client.rpc("session.info", session_id=sid)
        # 原生 mutation 校验会话编号与版本，只修改此会话，不写全局配置。
        if value is not None:
            await PreparedMutations().apply(client, sid, "reasoning", {"effort": value})
        result = await client.rpc("config.get", session_id=sid, key="reasoning")
        return {
            "reasoningOptions": [
                {"value": choice, "name": choice.capitalize(), "group": ""}
                for choice in choices
            ],
            "currentReasoning": result.get("value") or "",
        }


if __name__ == "__main__":
    import sys

    print(json.dumps(asyncio.run(_native(json.load(sys.stdin)))))
