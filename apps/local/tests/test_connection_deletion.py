"""连接删除只修改 SolveMate 配置，不调用真实 Harness 或删除原生会话。"""

import sqlite3

from fastapi.testclient import TestClient
from test_adapters import FakeHermes
from test_metadata import add_hermes
from test_service import HEADERS, client_for, connect, fake_registry, payload, settled

from solvemate_local.main import create_app


def remove(client, settings, ident="deepseek-local"):
    connection = next(item for item in settings["connections"] if item["id"] == ident)
    return client.request(
        "DELETE",
        f"/local-api/v1/connections/{ident}",
        json={
            "expectedRevision": connection["revision"],
            "expectedPreferencesRevision": settings["preferencesRevision"],
        },
    )


def test_delete_default_preserves_history_bindings_and_other_connection(tmp_path):
    with TestClient(
        create_app(tmp_path, registry=fake_registry(FakeHermes)), headers=HEADERS
    ) as client:
        connect(client)
        settings = add_hermes(client)
        request = payload()
        client.post("/local-api/v1/turns", json=request)
        original = settled(client, request["id"])
        response = remove(client, settings)
        assert response.status_code == 200, response.text
        updated = response.json()
        assert updated["defaultConnectionId"] is None
        assert [item["id"] for item in updated["connections"]] == ["hermes-local"]
        assert updated["enabled"]
        assert updated["deletedConnectionIds"] == ["deepseek-local"]
        history = client.get(f"/local-api/v1/turns/{request['id']}").json()
        assert history == original
        blocked = client.post(
            "/local-api/v1/turns",
            json={
                **payload(conversation_id=request["conversationId"]),
                "connectionId": "deepseek-local",
            },
        )
        assert blocked.json()["code"] == "connection_deleted"
        repeated = remove(client, settings)
        assert repeated.status_code == 200
        assert repeated.json()["preferencesRevision"] == updated["preferencesRevision"]
    with sqlite3.connect(tmp_path / "state.sqlite3") as db:
        deleted = db.execute("SELECT * FROM deleted_connections").fetchone()
        assert deleted[1] == settings["connections"][0]["revision"] + 1
        assert len(deleted) == 3  # 只保留编号、版本和删除时间，不保存已删除配置正文。
        assert (
            db.execute("SELECT external_id FROM bindings").fetchone()[0]
            == original["externalSessionId"]
        )


def test_delete_non_default_keeps_default_and_rejects_stale_preferences(tmp_path):
    with TestClient(
        create_app(tmp_path, registry=fake_registry(FakeHermes)), headers=HEADERS
    ) as client:
        connect(client)
        settings = add_hermes(client)
        stale = {**settings, "preferencesRevision": settings["preferencesRevision"] - 1}
        assert remove(client, stale, "hermes-local").status_code == 409
        assert len(client.get("/local-api/v1/settings").json()["connections"]) == 2
        removed = remove(client, settings, "hermes-local")
        assert removed.status_code == 200
        assert removed.json()["defaultConnectionId"] == "deepseek-local"


def test_deleted_connection_revision_cannot_delete_a_recreated_connection(tmp_path):
    with client_for(tmp_path) as client:
        settings = connect(client)
        assert remove(client, settings).status_code == 200
        recreated = connect(client)
        assert (
            recreated["connections"][0]["revision"]
            > settings["connections"][0]["revision"] + 1
        )
        assert "deepseek-local" not in recreated.get("deletedConnectionIds", [])
        assert remove(client, settings).status_code == 409
        assert len(client.get("/local-api/v1/settings").json()["connections"]) == 1


def test_delete_running_connection_stops_owned_job_and_preserves_history(tmp_path):
    with client_for(tmp_path) as client:
        settings = connect(client)
        request = payload("wait-test")
        client.post("/local-api/v1/turns", json=request)
        response = remove(client, settings)
        assert response.status_code == 200
        assert client.get("/local-api/v1/settings").json()["connections"] == []
        assert settled(client, request["id"])["status"] == "cancelled"
        assert client.get(
            f"/local-api/v1/conversations/{request['conversationId']}/turns"
        ).json()


def test_delete_conflict_and_persistence_survive_service_restart(tmp_path):
    with client_for(tmp_path) as client:
        settings = connect(client)
        stale = {
            **settings,
            "connections": [
                {
                    **settings["connections"][0],
                    "revision": settings["connections"][0]["revision"] - 1,
                }
            ],
        }
        assert remove(client, stale).status_code == 409
        assert remove(client, settings).status_code == 200
    with client_for(tmp_path) as client:
        settings = client.get("/local-api/v1/settings").json()
        assert settings["connections"] == []
        assert not settings["enabled"]
        assert settings["defaultConnectionId"] is None
        assert settings["deletedConnectionIds"] == ["deepseek-local"]
