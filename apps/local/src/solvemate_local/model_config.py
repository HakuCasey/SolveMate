import asyncio
import json
import os
from pathlib import Path

import yaml

from .errors import ConnectionError

PROVIDER_PLUGIN = "@deepseek-ai/dsh-llm-pi-ai"


def resolve_home():
    """与 DSH 一致：使用本进程的 DSH_HOME，未设置时使用当前用户的 .dsh。"""
    configured = os.environ.get("DSH_HOME", "")
    if not configured.strip():
        return Path.home() / ".dsh"
    if configured == "~":
        return Path.home()
    if configured.startswith(("~/", "~\\")):
        return (Path.home() / configured[2:]).absolute()
    return Path(configured).absolute()


class DynamicValue:
    pass


class ConfigLoader(yaml.SafeLoader):
    pass


# 桌面配置中其他插件可能使用动态标签；解析时不执行表达式，也不复制这些插件。
ConfigLoader.add_constructor(None, lambda loader, node: DynamicValue())


def read_rows(text):
    try:
        rows = yaml.load(text, Loader=ConfigLoader)
    except yaml.YAMLError as error:
        raise ConnectionError(
            "DSH 模型配置无法解析，请检查配置文件。", "model_config_invalid"
        ) from error
    if rows is None:
        return []
    if not isinstance(rows, list):
        raise ConnectionError("DSH 模型配置格式不受支持。", "model_config_invalid")
    return [row for row in rows if isinstance(row, dict)]


def provider_config(rows):
    matches = [row for row in rows if row.get("name") == PROVIDER_PLUGIN]
    if len(matches) > 1:
        raise ConnectionError(
            "DSH 配置包含多份模型提供方设置，当前无法自动复用。",
            "model_config_unsupported",
        )
    row = matches[0] if matches else {}
    config = row.get("config", {})
    if not isinstance(config, dict) or not isinstance(
        config.get("providers", {}), dict
    ):
        raise ConnectionError(
            "DSH 模型提供方配置格式不受支持。", "model_config_invalid"
        )
    return row, config


async def desktop_overlay(home, argv, env, process_options):
    source = home / "profiles/desktop/cordis.patch.yml"
    try:
        text = source.read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    except (OSError, UnicodeError) as error:
        raise ConnectionError(
            "无法读取 DSH 桌面模型配置，请检查配置目录和文件权限。",
            "model_config_unreadable",
        ) from error
    _, desktop = provider_config(read_rows(text))
    if not desktop.get("providers"):
        return None

    # 由 DSH 组合 ACP 和共享配置，保留其现有提供方设置，避免自行猜测覆盖顺序。
    child = await asyncio.create_subprocess_exec(
        *argv,
        "--dump-config",
        env=env,
        **process_options,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    try:
        stdout, _ = await asyncio.wait_for(child.communicate(), 20)
    except (TimeoutError, asyncio.CancelledError) as error:
        if child.returncode is None:
            child.kill()
        await child.wait()
        if isinstance(error, asyncio.CancelledError):
            raise
        raise ConnectionError(
            "读取 DSH 模型配置超时。", "model_config_timeout"
        ) from error
    if child.returncode:
        raise ConnectionError("无法读取 DSH 的 ACP 配置。", "model_config_invalid")
    try:
        row, current = provider_config(read_rows(stdout.decode("utf-8")))
    except UnicodeError as error:
        raise ConnectionError(
            "DSH 配置编码不受支持。", "model_config_invalid"
        ) from error
    overlay = {
        "id": row.get("id", "llm-pi-ai"),
        "name": PROVIDER_PLUGIN,
        "config": {
            **current,
            "providers": {**desktop["providers"], **current.get("providers", {})},
        },
    }
    try:
        # 动态表达式和其他 YAML 对象不能被静默转换成错误的模型配置。
        return json.dumps([overlay], ensure_ascii=False)
    except (TypeError, ValueError, RecursionError) as error:
        raise ConnectionError(
            "模型提供方配置含动态表达式或不支持的数据，当前无法自动复用。",
            "model_config_unsupported",
        ) from error
