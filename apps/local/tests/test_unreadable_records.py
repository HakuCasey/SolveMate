"""记录解析失败不影响服务启动；原 JSON 不会被空记录覆盖。"""

import sqlite3

from fastapi.testclient import TestClient
from test_backups import BASE, STATE, exported, inspected
from test_service import HEADERS
from test_user_data import data

from solvemate_local.main import create_app
from solvemate_local.user_data import UserData, encoded


def test_invalid_records_keep_the_service_available_and_refuse_overwrite(tmp_path):
    store = UserData(tmp_path)
    original = '{"broken":'
    with store.db:
        store.db.execute("INSERT INTO state VALUES (1,?,7)", (original,))
    store.close()
    with TestClient(create_app(tmp_path / "ai"), headers=HEADERS) as client:
        assert client.get("/healthz").status_code == 200
        assert client.get("/local-api/v1/settings").status_code == 200
        failed = client.get(STATE)
        assert failed.status_code == 422
        assert (
            client.put(STATE, json={"value": data(), "expectedRevision": 7}).status_code
            == 422
        )
        with sqlite3.connect(tmp_path / "app.sqlite3") as db:
            assert db.execute("SELECT value,revision FROM state").fetchone() == (
                original,
                7,
            )
            db.execute("UPDATE state SET value=?", (encoded(data()),))
        assert client.get(STATE).json()["value"] == data()


def test_existing_backup_can_restore_records_after_json_becomes_unreadable(tmp_path):
    with TestClient(create_app(tmp_path / "ai"), headers=HEADERS) as client:
        assert (
            client.put(STATE, json={"value": data(), "expectedRevision": 0}).status_code
            == 200
        )
        archive = exported(client)
        with sqlite3.connect(tmp_path / "app.sqlite3") as db:
            db.execute("UPDATE state SET value='broken'")
        assert client.get(STATE).status_code == 422
        token = inspected(client, archive)
        response = client.post(f"{BASE}/{token}/restore", json={})
        assert response.status_code == 200, response.text
        assert client.get(STATE).json()["value"] == data()
        assert list((tmp_path / "backups").glob("before-restore-*.zip"))


def test_invalid_json_shapes_do_not_prevent_the_service_from_starting(tmp_path):
    for index, raw in enumerate(["null", "[]", '{"noteLibrary":{"notes":[1]}}']):
        root = tmp_path / str(index)
        store = UserData(root)
        with store.db:
            store.db.execute("INSERT INTO state VALUES (1,?,1)", (raw,))
        store.close()
        with TestClient(create_app(root / "ai"), headers=HEADERS) as client:
            assert client.get("/healthz").status_code == 200
            assert client.get(STATE).status_code == 422
            with sqlite3.connect(root / "app.sqlite3") as db:
                assert db.execute("SELECT value FROM state").fetchone()[0] == raw
