"""共享 Schema 校验和旧记录转换；不从当前配置补造历史调用信息。"""

import json
from functools import lru_cache
from importlib.resources import files

from jsonschema import Draft202012Validator

SCHEMA = json.loads(
    files("solvemate_local").joinpath("schemas/ai-metadata.schema.json").read_text()
)
LEGACY_SCHEMA = json.loads(
    files("solvemate_local").joinpath("schemas/ai-metadata-v2.schema.json").read_text()
)
UNKNOWN_CLIENT = {"appVersion": None, "buildId": None, "clientKind": None}
LEGACY_CONNECTIONS = {
    "deepseek-harness": "deepseek-local",
    "hermes": "hermes-local",
    "codex": "codex-local",
}


@lru_cache
def validator(name):
    return Draft202012Validator({**SCHEMA, "anyOf": [{"$ref": f"#/$defs/{name}"}]})


def validate_metadata(name, value):
    error = next(validator(name).iter_errors(value), None)
    if error:
        # 只返回字段路径和规则，不把密钥、资料或问题正文写入异常。
        path = "/".join(str(part) for part in error.absolute_path)
        raise ValueError(f"Invalid {name} metadata: {path or '/'} ({error.validator})")


def upgrade_conversation_metadata(value):
    if value.get("schemaVersion") != 2:
        return value
    Draft202012Validator(
        {**LEGACY_SCHEMA, "anyOf": [{"$ref": "#/$defs/ConversationMetadata"}]}
    ).validate(value)
    result = dict(value)
    old = value["aiConfig"]
    model = old["model"]
    result.update(
        schemaVersion=3,
        aiConfig={
            "connectionId": old["connectionId"],
            "modelId": model.get("modelId") if model["kind"] == "model" else None,
        },
    )
    return result


def normalized_detection(value):
    result = {
        "executablePath": "",
        "version": "",
        "models": [],
        "currentModel": "",
        "reasoningOptions": [],
        "currentReasoning": "",
        "capabilities": {},
        **value,
    }
    for field in ("models", "reasoningOptions"):
        result[field] = [
            {**item, "group": item.get("group", "")} for item in result[field]
        ]
    states = {"supported", "unsupported", "unknown"}
    caps = result["capabilities"]
    keys = SCHEMA["$defs"]["CapabilitySupport"]["required"]
    if (
        not isinstance(caps, dict)
        or set(caps) != set(keys)
        or any(value not in states for value in caps.values() if isinstance(value, str))
        or any(not isinstance(value, str) for value in caps.values())
    ):
        result["capabilities"] = {key: "unknown" for key in keys}
    return result


def upgrade_turn(value):
    if value.get("schemaVersion") == 2:
        return dict(value)
    turn = dict(value)
    provider = turn.get("provider")
    ident = turn.get("connectionId") or LEGACY_CONNECTIONS.get(
        provider, "deepseek-local"
    )
    provider = provider or next(
        (key for key, item in LEGACY_CONNECTIONS.items() if item == ident), None
    )
    teacher = {**turn["teacher"], "icon": turn["teacher"].get("icon", "bot")}
    turn.update(
        schemaVersion=2,
        submissionStatus="accepted",
        revision=turn.get("revision", 1),
        connectionId=ident,
        provider=provider,
        protocol=turn.get("protocol")
        or ("codex-app-server" if provider == "codex" else "acp" if provider else None),
        teacher=teacher,
        reference=turn.get("reference"),
        reasoningEffort=turn.get("reasoningEffort", ""),
        phase=turn.get(
            "phase", "waiting" if turn["status"] == "running" else "finished"
        ),
        lastActivityAt=turn.get(
            "lastActivityAt", turn.get("completedAt", turn["startedAt"])
        ),
        dispatch=None,
        reportedModelId=None,
    )
    turn["snapshot"] = {
        "connectionId": ident,
        "connectionRevision": None,
        "conversationRevision": None,
        "robotRevision": None,
        "providerId": provider,
        "serviceName": None,
        "modelSelection": {
            "kind": "model",
            "connectionId": ident,
            "modelId": turn["model"],
        }
        if turn.get("model")
        else {"kind": "connection-default"},
        "requestedModelId": turn.get("model", ""),
        "requestedModelName": None,
        "reasoningEffort": turn["reasoningEffort"],
        "teacher": teacher,
        "client": dict(UNKNOWN_CLIENT),
        "localServiceVersion": None,
    }
    return turn


def public_turn(value):
    upgraded = upgrade_turn(value)
    result = {
        key: upgraded[key]
        for key in SCHEMA["$defs"]["AiTurn"]["properties"]
        if key in upgraded
    }
    validate_metadata("AiTurn", result)
    return result
