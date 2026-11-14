"""与网页使用相同样例核对来源转换、时间保留、备份与原子保存。"""

import json
import sqlite3
from copy import deepcopy
from pathlib import Path

import pytest
from test_user_data import data

from solvemate_local.metadata import MAX_NOTE_TITLE_LENGTH
from solvemate_local.note_metadata import migrate_note_metadata
from solvemate_local.user_data import UserData, UserDataError, encoded, validate_data

FIXTURES = json.loads(
    (
        Path(__file__).resolve().parents[3]
        / "packages/contracts/fixtures/note-metadata.json"
    ).read_text(encoding="utf-8")
)


@pytest.mark.parametrize("fixture", FIXTURES, ids=lambda value: value["name"])
def test_shared_note_migration(fixture):
    value = data()
    value["noteLibrary"]["notes"] = [fixture["note"]]
    original = deepcopy(value)
    changed = migrate_note_metadata(value)
    note = changed["noteLibrary"]["notes"][0]
    assert note == {
        **{
            key: fixture["note"][key]
            for key in ("id", "notebookId", "title", "content", "tagIds", "revision")
        },
        "title": fixture["note"]["title"][:MAX_NOTE_TITLE_LENGTH],
        "origins": fixture["origins"],
        "createdAt": None,
        "updatedAt": None,
    }
    validate_data(changed)
    assert value == original
    assert migrate_note_metadata(changed) is changed


def legacy_database(root, value):
    store = UserData(root)
    with store.db:
        store.db.execute("INSERT INTO state VALUES (1,?,7)", (encoded(value),))
    store.close()


def test_startup_migrates_once_and_retains_an_exact_backup(tmp_path):
    value = data()
    value["noteLibrary"]["notes"] = [deepcopy(entry["note"]) for entry in FIXTURES]
    for index, note in enumerate(value["noteLibrary"]["notes"]):
        note["id"] = f"note-{index}"
    value["drafts"] = {"chat:general": "尚未发送的草稿"}
    legacy_database(tmp_path, value)
    store = UserData(tmp_path)
    current = store.state()
    assert current["revision"] == 8
    assert current["value"] == migrate_note_metadata(value)
    backups = list((tmp_path / "backups").glob("notes-*.json"))
    assert len(backups) == 1
    assert json.loads(backups[0].read_text(encoding="utf-8")) == value
    store.close()
    reopened = UserData(tmp_path)
    assert reopened.state() == current
    assert list((tmp_path / "backups").glob("notes-*.json")) == backups
    reopened.close()


def test_backup_failure_leaves_original_database_unchanged(tmp_path, monkeypatch):
    value = data()
    value["noteLibrary"]["notes"] = [FIXTURES[0]["note"]]
    legacy_database(tmp_path, value)
    from solvemate_local import user_data

    def fail(*_):
        raise OSError("test backup failure")

    monkeypatch.setattr(user_data, "atomic_write", fail)
    failed = UserData(tmp_path)
    with pytest.raises(UserDataError, match="备份未能保存"):
        failed.state()
    failed.close()
    with sqlite3.connect(tmp_path / "app.sqlite3") as db:
        raw, revision = db.execute("SELECT value,revision FROM state").fetchone()
        assert json.loads(raw) == value
        assert revision == 7


def test_bad_source_and_outdated_browser_write_cannot_replace_records(tmp_path):
    value = data()
    value["noteLibrary"]["notes"] = [deepcopy(FIXTURES[1]["note"])]
    value["noteLibrary"]["notes"][0]["source"]["pageNumber"] = 0
    legacy_database(tmp_path, value)
    failed = UserData(tmp_path)
    with pytest.raises(UserDataError):
        failed.state()
    failed.close()
    with sqlite3.connect(tmp_path / "app.sqlite3") as db:
        assert json.loads(db.execute("SELECT value FROM state").fetchone()[0]) == value
    other = tmp_path / "valid"
    store = UserData(other)
    store.save(data(), 0)
    old = deepcopy(data())
    old["noteLibrary"]["notes"] = [FIXTURES[0]["note"]]
    with pytest.raises(UserDataError):
        store.save(old, 1)
    assert store.state()["value"] == data()
    store.close()


def test_restore_old_backup_keeps_note_content_and_source_ids(tmp_path):
    import hashlib

    from fastapi.testclient import TestClient
    from test_backups import BASE, STATE, exported, inspected, rewrite
    from test_service import HEADERS

    from solvemate_local.main import create_app

    with TestClient(create_app(tmp_path / "live" / "ai"), headers=HEADERS) as client:
        saved = client.put(STATE, json={"value": data(), "expectedRevision": 0})
        assert saved.status_code == 200
        archive = exported(client)
        old = data()
        old["noteLibrary"]["notes"] = [deepcopy(FIXTURES[4]["note"])]

        def replace(entries):
            file = tmp_path / "old-app.sqlite3"
            file.write_bytes(entries["app.sqlite3"])
            with sqlite3.connect(file) as db:
                db.execute("UPDATE state SET value=?", (encoded(old),))
            db.close()
            raw = file.read_bytes()
            entries["app.sqlite3"] = raw
            manifest = json.loads(entries["manifest.json"])
            manifest["files"]["app.sqlite3"] = {
                "size": len(raw),
                "sha256": hashlib.sha256(raw).hexdigest(),
            }
            entries["manifest.json"] = json.dumps(manifest).encode()

        token = inspected(client, rewrite(archive, replace))
        restored = client.post(f"{BASE}/{token}/restore", json={})
        assert restored.status_code == 200, restored.text
        assert client.get(STATE).json()["value"] == migrate_note_metadata(old)


def test_browser_import_retains_original_payload_and_converts_note_sources(tmp_path):
    store = UserData(tmp_path)
    old = data()
    old["noteLibrary"]["notes"] = [deepcopy(FIXTURES[3]["note"])]
    payload = {"value": old, "versions": [], "heads": []}
    result = store.migrate(
        {
            "sourceId": "11111111-1111-4111-8111-111111111111",
            "expectedRevision": 0,
            "payload": payload,
        }
    )
    assert result["value"] == migrate_note_metadata(old)
    backups = list((tmp_path / "backups").glob("browser-*.json"))
    assert len(backups) == 1
    assert json.loads(backups[0].read_text(encoding="utf-8")) == payload
    store.close()


def test_note_update_time_cannot_precede_creation_time(tmp_path):
    store = UserData(tmp_path)
    value = data()
    note = value["noteLibrary"]["notes"][0]
    note.update(createdAt=100, updatedAt=99)
    with pytest.raises(UserDataError):
        store.save(value, 0)
    assert store.state()["value"] is None
    store.close()
