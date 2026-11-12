"""共享约定、数据库迁移和配置冲突验证，不调用真实模型。"""

import json
import sqlite3
import sys
from pathlib import Path

import pytest
from test_service import client_for, connect, payload, settled

from solvemate_local.metadata import public_turn, validate_metadata
from solvemate_local.store import Store

FIXTURES = json.loads(
    (
        Path(__file__).resolve().parents[3]
        / "packages/contracts/fixtures/ai-metadata.json"
    ).read_text(encoding="utf-8")
)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda value: value["name"])
def test_shared_contract_cases(fixture):
    if fixture["valid"]:
        validate_metadata(fixture["name"], fixture["value"])
    else:
        with pytest.raises(ValueError):
            validate_metadata(fixture["name"], fixture["value"])


def test_legacy_database_retains_native_binding_and_historical_unknowns(tmp_path):
    with client_for(tmp_path) as client:
        connect(client)
        request = payload()
        client.post("/local-api/v1/turns", json=request)
        settled(client, request["id"])
    db = sqlite3.connect(tmp_path / "state.sqlite3")
    original = json.loads(db.execute("SELECT value FROM turns").fetchone()[0])
    legacy = {
        key: value
        for key, value in original.items()
        if key
        not in {"schemaVersion", "revision", "snapshot", "dispatch", "reportedModelId"}
    }
    db.execute("UPDATE turns SET value=?", (json.dumps(legacy),))
    connection = json.loads(db.execute("SELECT value FROM connections").fetchone()[0])
    db.execute("UPDATE config SET value=?", (json.dumps(connection),))
    db.execute("DELETE FROM metadata_backups")
    db.execute("PRAGMA user_version=0")
    db.commit()
    db.close()
    store = Store(tmp_path)
    try:
        result = public_turn(store.turn(request["id"]))
        assert result["externalSessionId"] == original["externalSessionId"]
        assert result["content"] == original["content"]
        assert result["snapshot"]["connectionRevision"] is None
        assert result["snapshot"]["localServiceVersion"] is None
        assert result["reportedModelId"] is None
        assert result["dispatch"] is None
        assert store.preferences()["defaultConnectionId"] == "deepseek-local"
        backup = json.loads(
            store.db.execute("SELECT value FROM metadata_backups").fetchone()[0]
        )
        assert json.loads(backup["turns"][0]["value"])["content"] == original["content"]
    finally:
        store.close()
    again = Store(tmp_path)
    assert again.db.execute("SELECT COUNT(*) FROM metadata_backups").fetchone()[0] == 2
    again.close()


def test_settings_are_one_default_reference_and_stale_saves_are_rejected(tmp_path):
    with client_for(tmp_path) as client:
        connect(client)
        settings = client.get("/local-api/v1/settings").json()
        assert settings["schemaVersion"] == 3
        validate_metadata("AiSettings", settings)
        current = settings["connections"][0]
        response = client.put(
            "/local-api/v1/settings",
            json={
                **current["config"],
                "expectedRevision": current["revision"] - 1,
                "expectedPreferencesRevision": settings["preferencesRevision"],
            },
        )
        assert response.status_code == 409
        assert (
            client.get("/local-api/v1/settings").json()["connections"]
            == settings["connections"]
        )
        failed_disable = client.request(
            "DELETE",
            "/local-api/v1/settings",
            json={"expectedRevision": settings["preferencesRevision"] - 1},
        )
        assert failed_disable.status_code == 409
        assert client.get("/local-api/v1/settings").json()["enabled"]


def test_snapshot_keeps_requested_model_and_no_unreported_actual_model(tmp_path):
    with client_for(tmp_path) as client:
        connect(client)
        request = payload()
        request["model"] = "opaque-model-a"
        client.post("/local-api/v1/turns", json=request)
        result = settled(client, request["id"])
        validate_metadata("AiTurn", result)
        assert result["snapshot"]["requestedModelId"] == request["model"]
        assert result["snapshot"]["connectionRevision"] == 1
        assert result["dispatch"]["submittedModelId"] == request["model"]
        assert result["reportedModelId"] is None
        assert result["binding"]["externalSessionId"] == result["externalSessionId"]
        before = result["snapshot"]
        client.put(
            "/local-api/v1/settings",
            json={"executablePath": sys.executable, "model": "opaque-model-b"},
        )
        assert (
            client.get(f"/local-api/v1/turns/{request['id']}").json()["snapshot"]
            == before
        )


def test_future_database_version_is_not_downgraded(tmp_path):
    db = sqlite3.connect(tmp_path / "state.sqlite3")
    db.execute("PRAGMA user_version=99")
    db.close()
    with pytest.raises(ValueError, match="unsupported schema version"):
        Store(tmp_path)
    db = sqlite3.connect(tmp_path / "state.sqlite3")
    assert db.execute("PRAGMA user_version").fetchone()[0] == 99
    db.close()


def test_openapi_exposes_the_shared_metadata():
    from solvemate_local.main import create_app

    schema = create_app().openapi()
    assert (
        schema["components"]["schemas"]["ConversationMetadata"]["properties"][
            "schemaVersion"
        ]["const"]
        == 3
    )
    assert schema["paths"]["/local-api/v1/turns"]["post"]["responses"]["202"][
        "content"
    ]["application/json"]["schema"]["$ref"].endswith("AiTurn")


def add_hermes(client):
    response = client.put(
        "/local-api/v1/settings",
        json={
            "provider": "hermes",
            "executablePath": sys.executable,
            "model": "custom:school:c-model",
            "makeDefault": False,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_connection_management_is_independent_of_default_and_other_connections(
    tmp_path,
):
    from fastapi.testclient import TestClient
    from test_adapters import FakeHermes
    from test_service import HEADERS, fake_registry

    from solvemate_local.main import create_app

    with TestClient(
        create_app(tmp_path, registry=fake_registry(FakeHermes)), headers=HEADERS
    ) as client:
        connect(client)
        settings = add_hermes(client)
        assert settings["defaultConnectionId"] == "deepseek-local"
        assert {item["config"]["provider"] for item in settings["connections"]} == {
            "deepseek-harness",
            "hermes",
        }
        assert (
            any(item["provider"] == "codex" for item in settings["services"]) is False
        )  # 隔离注册表仅注册两个 ACP 假服务。
        dsh = next(
            item for item in settings["connections"] if item["id"] == "deepseek-local"
        )
        updated = client.patch(
            "/local-api/v1/connections/deepseek-local",
            json={"expectedRevision": dsh["revision"], "enabled": False},
        )
        assert updated.status_code == 200
        assert updated.json()["defaultConnectionId"] == "deepseek-local"
        request = {**payload(), "connectionId": "hermes-local"}
        assert client.post("/local-api/v1/turns", json=request).status_code == 202
        assert settled(client, request["id"])["status"] == "completed"
        blocked = client.post(
            "/local-api/v1/turns", json={**payload(), "connectionId": "deepseek-local"}
        )
        assert blocked.status_code == 422
        assert blocked.json()["code"] == "connection_disabled"
        selected = client.put(
            "/local-api/v1/default-connection",
            json={
                "connectionId": "hermes-local",
                "expectedRevision": settings["preferencesRevision"],
            },
        )
        assert selected.status_code == 200
        stale = client.put(
            "/local-api/v1/default-connection",
            json={
                "connectionId": "deepseek-local",
                "expectedRevision": settings["preferencesRevision"],
            },
        )
        assert stale.status_code == 409


def test_failed_detection_preserves_config_catalog_and_can_recover(
    tmp_path, monkeypatch
):
    from solvemate_local.errors import ConnectionError

    with client_for(tmp_path) as client:
        settings = connect(client)
        service = client.app.state.ai
        original = service.connections.probe

        async def failed(_):
            raise ConnectionError("Program is unavailable.", "program_missing")

        monkeypatch.setattr(service.connections, "probe", failed)
        current = settings["connections"][0]
        response = client.post(
            "/local-api/v1/detect",
            json={
                "provider": "deepseek-harness",
                "executablePath": current["config"]["executablePath"],
                "model": current["config"]["model"],
            },
        )
        assert response.status_code == 422
        failed_settings = client.get("/local-api/v1/settings").json()
        saved = failed_settings["connections"][0]
        assert saved["check"]["status"] == "error"
        assert saved["config"] == current["config"]
        assert saved["detection"] == current["detection"]
        assert failed_settings["defaultConnectionId"] == settings["defaultConnectionId"]
        assert (
            client.post("/local-api/v1/turns", json=payload()).json()["code"]
            == "connection_unavailable"
        )
        monkeypatch.setattr(service.connections, "probe", original)
        response = client.post(
            "/local-api/v1/detect",
            json={
                "provider": "deepseek-harness",
                "executablePath": current["config"]["executablePath"],
                "model": current["config"]["model"],
            },
        )
        assert response.status_code == 200
        assert (
            client.get("/local-api/v1/settings").json()["connections"][0]["check"][
                "status"
            ]
            == "ready"
        )


def test_v2_database_keeps_disabled_connections_and_history(tmp_path):
    with client_for(tmp_path) as client:
        connect(client)
        client.request("DELETE", "/local-api/v1/settings", json={})
    with sqlite3.connect(tmp_path / "state.sqlite3") as db:
        for ident, value in db.execute("SELECT id,value FROM connections").fetchall():
            value = json.loads(value)
            value.pop("enabled")
            value.pop("check")
            db.execute(
                "UPDATE connections SET value=? WHERE id=?", (json.dumps(value), ident)
            )
        db.execute("PRAGMA user_version=2")
        db.execute("DELETE FROM metadata_backups WHERE version=2")
    store = Store(tmp_path)
    assert store.db.execute("PRAGMA user_version").fetchone()[0] == 3
    assert not store.connections()["deepseek-local"]["enabled"]
    assert store.connections()["deepseek-local"]["config"]["model"] == "opaque-model-a"
    assert (
        store.db.execute(
            "SELECT count(*) FROM metadata_backups WHERE version=2"
        ).fetchone()[0]
        == 1
    )
    store.close()


@pytest.mark.parametrize("legacy", [False, True])
def test_flat_conversation_selection_and_legacy_requests_share_execution_rules(
    tmp_path, legacy
):
    from copy import deepcopy

    metadata = deepcopy(
        next(
            case["value"] for case in FIXTURES if case["name"] == "ConversationMetadata"
        )
    )
    with client_for(tmp_path) as client:
        connect(client)
        request = {
            **payload(conversation_id=metadata["id"]),
            "model": "opaque-model-a",
            "conversationSnapshot": metadata,
        }
        if legacy:
            metadata["schemaVersion"] = 2
            metadata["aiConfig"] = {
                "connectionId": "deepseek-local",
                "model": {
                    "kind": "model",
                    "connectionId": "deepseek-local",
                    "modelId": "opaque-model-a",
                },
            }
        started = client.post("/local-api/v1/turns", json=request)
        assert started.status_code == 202, started.text
        result = settled(client, request["id"])
        assert result["status"] == "completed"
        assert result["snapshot"]["requestedModelId"] == "opaque-model-a"
        assert result["snapshot"]["conversationRevision"] == 1
        request = {
            **payload(conversation_id=metadata["id"]),
            "model": "opaque-model-b",
            "conversationSnapshot": metadata,
        }
        assert (
            client.post("/local-api/v1/turns", json=request).json()["code"]
            == "model_mismatch"
        )


def test_migrated_v2_retry_returns_existing_turn_without_dispatching_again(tmp_path):
    import hashlib
    from copy import deepcopy

    from solvemate_local.models import TurnRequest

    metadata = deepcopy(
        next(
            case["value"] for case in FIXTURES if case["name"] == "ConversationMetadata"
        )
    )
    metadata.update(
        schemaVersion=2,
        aiConfig={
            "connectionId": "deepseek-local",
            "model": {
                "kind": "model",
                "connectionId": "deepseek-local",
                "modelId": "opaque-model-a",
            },
        },
    )
    with client_for(tmp_path) as client:
        connect(client)
        body = {
            **payload(conversation_id=metadata["id"]),
            "model": "opaque-model-a",
            "conversationSnapshot": metadata,
        }
        assert client.post("/local-api/v1/turns", json=body).status_code == 202
        before = settled(client, body["id"])
        service = client.app.state.ai
        old = TurnRequest(**body).model_dump(
            exclude={
                "references",  # 旧版请求不含多选段数组。
                "connectionRevision",
                "robotRevision",
                "client",
                "externalSessionId",
                "connectionId",
            }
        )
        old["conversationSnapshot"] = metadata
        with sqlite3.connect(tmp_path / "state.sqlite3") as db:
            turn = json.loads(
                db.execute(
                    "SELECT value FROM turns WHERE id=?", (body["id"],)
                ).fetchone()[0]
            )
            turn["requestHash"] = hashlib.sha256(
                json.dumps(old, ensure_ascii=False, separators=(",", ":")).encode()
            ).hexdigest()
            db.execute(
                "UPDATE turns SET value=? WHERE id=?", (json.dumps(turn), body["id"])
            )
        response = client.post("/local-api/v1/turns", json=body)
        assert response.status_code == 202, response.text
        assert response.json()["externalSessionId"] == before["externalSessionId"]
        assert response.json()["content"] == before["content"]
        assert not service.jobs


def test_new_questions_allow_four_references_and_reject_five():
    from pydantic import ValidationError

    from solvemate_local.models import TurnRequest

    body = payload("引用数量")
    reference = {
        "title": "学习资料",
        "content": "引用片段",
        "selection": {
            "courseId": "c-language",
            "kind": "textbooks",
            "itemId": "CB001",
            "chapterIndex": 0,
        },
    }
    body["references"] = [reference] * 4
    assert len(TurnRequest.model_validate(body).references) == 4
    body["references"].append(reference)
    with pytest.raises(ValidationError):
        TurnRequest.model_validate(body)
