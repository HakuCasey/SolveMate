"""将 DSH 模型目录转换为共享选项，检测不创建会话。"""

import json
from pathlib import Path

from ..errors import ConnectionError
from .dsh_host import DshHost, startup_failure  # noqa: F401


def describe_catalog(catalog, selected=""):
    if (
        not isinstance(catalog, dict)
        or not isinstance(catalog.get("groups"), list)
        or catalog.get("failures")
    ):
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


async def catalog_options(acp_process, home, selected=""):
    rows = []
    if acp_process.overlay_directory:
        rows = json.loads(
            (Path(acp_process.overlay_directory.name) / "providers.json").read_text(
                encoding="utf-8"
            )
        )
    host = DshHost(acp_process.executable, acp_process.workspace, home, rows)
    try:
        await host.start()
        return describe_catalog(await host.rpc("session/modelCatalog"), selected)
    finally:
        await host.close()
