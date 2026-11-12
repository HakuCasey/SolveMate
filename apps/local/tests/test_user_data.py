"""本机正式记录、浏览器迁移、课程版本和目录迁移的故障恢复验证。"""

import base64
import hashlib
import io
import json
import shutil
import sqlite3
import uuid
import zipfile
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient
from test_service import HEADERS

from solvemate_local import user_data
from solvemate_local.main import create_app
from solvemate_local.user_data import UserData, UserDataError, migrate_uploads


def data():
    return {
        "schemaVersion": 3,
        "robots": [],
        "defaultRobotId": None,
        "conversations": [],
        "settings": {"fontSize": 14, "appearance": "light", "globalModel": ""},
        "selection": {
            "courseId": "c-language",
            "kind": "questions",
            "itemId": "C001",
            "chapterIndex": 0,
        },
        "noteLibrary": {
            "notebooks": [
                {"id": "notebook-unclassified", "title": "未分类", "revision": 1}
            ],
            "notes": [
                {
                    "id": "note-original",
                    "notebookId": "notebook-unclassified",
                    "title": "笔记",
                    "content": "原笔记",
                    "summary": "",
                    "courseId": "c-language",
                    "questionId": "C001",
                    "revision": 1,
                    "tagIds": [],
                }
            ],
            "customTags": [],
        },
    }


def package(text="课程"):
    payload = text.encode()
    files = [
        {
            "path": "textbook.md",
            "size_bytes": len(payload),
            "sha256": hashlib.sha256(payload).hexdigest(),
        }
    ]
    course = {"id": "c-language", "title": "C 语言"}
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w") as archive:
        archive.writestr("course.json", json.dumps({"course": course, "files": files}))
        archive.writestr("textbook.md", payload)
    raw = stream.getvalue()
    sha = hashlib.sha256(raw).hexdigest()
    return {
        "manifest": {
            "course": course,
            "version": sha,
            "sha256": sha,
            "size_bytes": len(raw),
            "files": files,
        },
        "archive": base64.b64encode(raw).decode(),
        "installedAt": 1,
    }


def migration(value=None, **kwargs):
    original = value or data()
    return {
        "sourceId": str(uuid.uuid4()),
        "expectedRevision": 0,
        "payload": {
            "legacyState": {
                "id": "main",
                "value": original,
                "legacyBackup": {"schemaVersion": 1},
                "metadataBackups": {"2": {"saved": True}},
            },
            "value": original,
            "versions": [],
            "heads": [],
        },
        **kwargs,
    }


def test_two_clients_share_state_and_reject_stale_writes(tmp_path):
    app = create_app(tmp_path / "ai")
    with (
        TestClient(app, headers=HEADERS) as first,
        TestClient(app, headers=HEADERS) as second,
    ):
        original = first.get("/local-api/v1/user/state").json()
        assert original["value"] is None
        saved = first.put(
            "/local-api/v1/user/state", json={"value": data(), "expectedRevision": 0}
        )
        assert saved.status_code == 200, saved.text
        assert second.get("/local-api/v1/user/state").json() == saved.json()
        changed = data()
        changed["noteLibrary"]["notes"][0]["content"] = "其他浏览器的修改"
        assert (
            second.put(
                "/local-api/v1/user/state",
                json={"value": changed, "expectedRevision": 1},
            ).status_code
            == 200
        )
        assert (
            first.put(
                "/local-api/v1/user/state",
                json={"value": data(), "expectedRevision": 1},
            ).status_code
            == 409
        )
    with TestClient(create_app(tmp_path / "ai"), headers=HEADERS) as reopened:
        assert reopened.get("/local-api/v1/user/state").json()["value"] == changed
        assert (
            reopened.get("/local-api/v1/user/state").json()["storeId"]
            == original["storeId"]
        )


def test_retry_after_lost_response_is_idempotent(tmp_path):
    store = UserData(tmp_path)
    first = store.save(data(), 0)
    assert store.save(data(), 0) == first
    store.close()


@pytest.mark.parametrize("theme_id", [None, "default", "sky", "rain", "grayscale"])
def test_theme_choice_survives_reopening_and_accepts_old_settings(tmp_path, theme_id):
    value = data()
    if theme_id is not None:
        value["settings"]["themeId"] = theme_id
    store = UserData(tmp_path)
    store.save(value, 0)
    store.close()
    reopened = UserData(tmp_path)
    assert reopened.state()["value"]["settings"] == value["settings"]
    reopened.close()


def test_migration_backs_up_raw_envelope_and_is_repeatable(tmp_path):
    store = UserData(tmp_path)
    body = migration()
    saved = store.migrate(body)
    assert saved["value"] == body["payload"]["value"]
    assert store.migrate(body) == saved
    backups = list((tmp_path / "backups").glob("browser-*.json"))
    assert len(backups) == 1
    assert json.loads(backups[0].read_text()) == body["payload"]
    assert store.db.execute("SELECT COUNT(*) FROM migrations").fetchone()[0] == 1
    store.close()


def test_second_browser_requires_choice_and_preserves_both_copies(tmp_path):
    store = UserData(tmp_path)
    store.save(data(), 0)
    browser = data()
    browser["settings"]["appearance"] = "dark"
    body = migration(browser, expectedRevision=1)
    with pytest.raises(UserDataError, match="都有记录"):
        store.migrate(body)
    assert store.state()["value"] == data()
    assert list((tmp_path / "backups").glob("browser-*.json"))
    assert store.migrate({**body, "decision": "keep"})["value"] == data()
    # 原浏览器后来被旧版本改动时，变化的内容仍要重新确认。
    body["payload"]["value"]["settings"]["fontSize"] = 18
    with pytest.raises(UserDataError):
        store.migrate(body)
    assert (
        store.migrate({**body, "decision": "replace"})["value"]
        == body["payload"]["value"]
    )
    previous = next((tmp_path / "backups").glob("before-import-*.sqlite3"))
    with sqlite3.connect(previous) as database:
        assert (
            json.loads(database.execute("SELECT value FROM state").fetchone()[0])
            == data()
        )
    store.close()


def test_write_failure_and_invalid_import_do_not_replace_state(tmp_path, monkeypatch):
    store = UserData(tmp_path)
    store.save(data(), 0)
    broken = data()
    broken["noteLibrary"]["notes"][0]["notebookId"] = "missing"
    with pytest.raises(UserDataError):
        store.save(broken, 1)
    with pytest.raises(UserDataError):
        store.migrate(migration(broken, expectedRevision=1, decision="replace"))
    assert store.state()["value"] == data()
    changed = data()
    changed["settings"]["fontSize"] = 21
    monkeypatch.setattr(
        user_data,
        "atomic_write",
        lambda *args: (_ for _ in ()).throw(OSError("Disk full")),
    )
    with pytest.raises(OSError):
        store.migrate(migration(changed, expectedRevision=1, decision="replace"))
    assert store.state()["value"] == data()
    store.close()


def test_course_versions_are_retained_and_failed_updates_keep_head(
    tmp_path, monkeypatch
):
    store = UserData(tmp_path)
    first, second = package("旧版"), package("新版")
    old, new = first["manifest"]["version"], second["manifest"]["version"]
    store.install(first, None)
    corrupt = deepcopy(second)
    corrupt["archive"] = base64.b64encode(b"invalid").decode()
    with pytest.raises(UserDataError):
        store.install(corrupt, old)
    assert store.content()["heads"][0]["version"] == old
    store.install(second, old)
    assert len(store.content()["versions"]) == 2
    assert store.package_path("c-language", old).read_bytes() == base64.b64decode(
        first["archive"]
    )
    with pytest.raises(UserDataError):
        store.install(first, old)
    assert store.content()["heads"][0]["version"] == new
    store.close()


def test_migration_failure_after_package_write_retries_without_partial_index(
    tmp_path, monkeypatch
):
    store = UserData(tmp_path)
    body = migration()
    record = package()
    body["payload"]["versions"] = [record]
    body["payload"]["heads"] = [
        {"courseId": "c-language", "version": record["manifest"]["version"]}
    ]
    original = user_data.atomic_write

    def fail_manifest(path, content):
        if path.name == "manifest.json":
            raise OSError("Disk full")
        original(path, content)

    monkeypatch.setattr(user_data, "atomic_write", fail_manifest)
    with pytest.raises(OSError):
        store.migrate(body)
    assert store.state()["value"] is None
    assert store.content()["versions"] == []
    monkeypatch.setattr(user_data, "atomic_write", original)
    store.migrate(body)
    assert store.state()["value"] == data()
    assert store.content()["heads"] == body["payload"]["heads"]
    store.close()


def test_upload_directory_copy_and_interrupted_receipt_are_recoverable(
    tmp_path, monkeypatch
):
    old = tmp_path / "materials" / "original-id"
    old.mkdir(parents=True)
    (old / "record.json").write_text('{"id":"original-id"}')
    (old / "original.pdf").write_bytes(b"original")
    original = user_data.atomic_write
    monkeypatch.setattr(
        user_data,
        "atomic_write",
        lambda *args: (_ for _ in ()).throw(OSError("Disk full")),
    )
    with pytest.raises(OSError):
        migrate_uploads(tmp_path)
    assert old.exists()
    monkeypatch.setattr(user_data, "atomic_write", original)
    result = migrate_uploads(tmp_path)
    assert (result / "original-id/original.pdf").read_bytes() == b"original"
    assert (tmp_path / "backups/uploads-migration.json").exists()
    assert migrate_uploads(tmp_path) == result
    # 已迁移后重命名产生的新资料记录不会被旧副本覆盖。
    (result / "original-id/record.json").write_text("changed")
    migrate_uploads(tmp_path)
    assert (result / "original-id/record.json").read_text() == "changed"


def test_interrupted_copy_never_activates_partial_directory(tmp_path, monkeypatch):
    old = tmp_path / "materials"
    old.mkdir()
    (old / "a.pdf").write_bytes(b"a")
    monkeypatch.setattr(
        shutil,
        "copytree",
        lambda *args, **kwargs: (_ for _ in ()).throw(OSError("Disk full")),
    )
    with pytest.raises(OSError):
        migrate_uploads(tmp_path)
    assert not (tmp_path / "uploads").exists()
    assert (old / "a.pdf").read_bytes() == b"a"


def test_user_routes_apply_browser_boundary_and_safe_paths(tmp_path):
    with TestClient(create_app(tmp_path / "ai"), headers=HEADERS) as client:
        assert (
            client.put(
                "/local-api/v1/user/state",
                json={"value": data(), "expectedRevision": 0},
                headers={"origin": "https://other.test"},
            ).status_code
            == 403
        )
        assert (
            client.get(
                "/local-api/v1/user/state", headers={"x-solvemate-client": ""}
            ).status_code
            == 403
        )
        assert (
            client.post("/local-api/v1/user/migrate", json=migration()).status_code
            == 200
        )
        assert client.get("/local-api/v1/user/content/not-valid!/bad").status_code in {
            404,
            422,
        }
        assert (
            client.put(
                "/local-api/v1/user/state",
                json={"value": data(), "expectedRevision": -1},
            ).status_code
            == 422
        )


def test_native_session_ids_messages_and_historical_references_survive_migration(
    tmp_path,
):
    from pathlib import Path

    fixtures = json.loads(
        (
            Path(__file__).resolve().parents[3]
            / "packages/contracts/fixtures/ai-metadata.json"
        ).read_text()
    )
    conversation = deepcopy(
        next(
            item["value"]
            for item in fixtures
            if item["name"] == "ConversationMetadata" and item["valid"]
        )
    )
    conversation.update(
        binding={
            "conversationId": conversation["id"],
            "connectionId": "deepseek-local",
            "protocol": "acp",
            "externalSessionId": "original-native-session",
            "state": "bound",
            "revision": 1,
        },
        turns=[],
        messages=[{"id": "original-message", "role": "user", "content": "原问题"}],
        example=False,
    )
    value = data()
    value["conversations"] = [conversation]
    store = UserData(tmp_path)
    assert store.migrate(migration(value))["value"] == value
    store.close()
    reopened = UserData(tmp_path)
    assert reopened.state()["value"]["conversations"][0] == conversation
    reopened.close()


def test_sqlite_failure_rolls_back_and_future_database_is_preserved(tmp_path):
    store = UserData(tmp_path)
    store.save(data(), 0)
    store.db.execute(
        "CREATE TRIGGER reject_change BEFORE INSERT ON state BEGIN SELECT RAISE(ABORT, 'test failure'); END;"
    )
    changed = data()
    changed["settings"]["fontSize"] = 20
    with pytest.raises(sqlite3.IntegrityError):
        store.save(changed, 1)
    assert store.state()["value"] == data()
    assert store.state()["revision"] == 1
    store.db.execute("PRAGMA user_version=99")
    store.close()
    with pytest.raises(UserDataError, match="较新版本"):
        UserData(tmp_path)
    with sqlite3.connect(tmp_path / "app.sqlite3") as database:
        assert database.execute("PRAGMA user_version").fetchone()[0] == 99
        assert (
            json.loads(database.execute("SELECT value FROM state").fetchone()[0])
            == data()
        )


def test_deleted_shared_subject_cannot_receive_upload_from_stale_browser(tmp_path):
    from test_materials import pdf_bytes

    with TestClient(create_app(tmp_path / "ai"), headers=HEADERS) as client:
        value = data()
        value["subjects"] = [
            {
                "id": "c-language",
                "title": "C 语言",
                "deleted": True,
                "materialsDeleted": True,
            }
        ]
        assert (
            client.put(
                "/local-api/v1/user/state", json={"value": value, "expectedRevision": 0}
            ).status_code
            == 200
        )
        response = client.post(
            "/local-api/v1/materials?filename=lesson.pdf&courseId=c-language",
            content=pdf_bytes(),
            headers={"content-type": "application/octet-stream"},
        )
        assert response.status_code == 409
        assert response.json()["code"] == "subject_unavailable"
        assert client.get("/local-api/v1/materials").json() == []


def test_changed_directory_is_rejected_by_server_and_disk_failure_is_explicit(
    tmp_path, monkeypatch
):
    with TestClient(create_app(tmp_path / "ai"), headers=HEADERS) as client:
        assert (
            client.put(
                "/local-api/v1/user/state",
                json={
                    "value": data(),
                    "expectedRevision": 0,
                    "expectedStoreId": "another-directory",
                },
            ).status_code
            == 409
        )
        original = user_data.atomic_write
        monkeypatch.setattr(
            user_data,
            "atomic_write",
            lambda *args: (_ for _ in ()).throw(OSError("Disk full")),
        )
        response = client.post("/local-api/v1/user/migrate", json=migration())
        assert response.status_code == 503
        assert "磁盘空间" in response.json()["detail"]
        assert client.get("/local-api/v1/user/state").json()["value"] is None
        monkeypatch.setattr(user_data, "atomic_write", original)
        assert (
            client.post("/local-api/v1/user/migrate", json=migration()).status_code
            == 200
        )


def test_missing_course_file_does_not_delete_version_index_or_personal_records(
    tmp_path,
):
    store = UserData(tmp_path)
    original = data()
    store.save(original, 0)
    body = package()
    version = body["manifest"]["version"]
    store.install(body, None)
    path = store.package_path("c-language", version)
    raw = path.read_bytes()
    path.unlink()
    missing = store.content()
    assert missing["versions"][0]["available"] is False
    assert missing["heads"][0]["version"] == version
    assert store.state()["value"] == original
    path.write_bytes(raw)
    assert store.content()["versions"][0]["available"] is True
    assert store.state()["value"] == original
    store.close()


def test_official_material_metadata_survives_restart_and_stale_writes(tmp_path):
    value = data()
    value["officialMaterials"] = [
        {"id": "calculus:textbooks:B001", "subjectId": "calculus", "deletedAt": None}
    ]
    store = UserData(tmp_path)
    first = store.save(value, 0)
    changed = deepcopy(value)
    changed["officialMaterials"][0]["deletedAt"] = 123
    store.save(changed, first["revision"])
    with pytest.raises(UserDataError):
        store.save(value, first["revision"])
    store.close()
    reopened = UserData(tmp_path)
    assert reopened.state()["value"]["officialMaterials"][0]["deletedAt"] == 123
    assert reopened.state()["value"]["selection"] == value["selection"]
    reopened.close()


def test_official_material_metadata_rejects_duplicate_ids_without_replacing_state(
    tmp_path,
):
    store = UserData(tmp_path)
    value = data()
    store.save(value, 0)
    invalid = deepcopy(value)
    item = {"id": "calculus:questions", "subjectId": "calculus", "deletedAt": None}
    invalid["officialMaterials"] = [item, deepcopy(item)]
    with pytest.raises(UserDataError):
        store.save(invalid, 1)
    assert "officialMaterials" not in store.state()["value"]
    store.close()


@pytest.mark.parametrize(
    "source",
    [
        {
            "materialId": "11111111-1111-4111-8111-111111111111",
            "contentVersion": "a" * 64,
            "pageNumber": 3,
        },
        {
            "courseId": "calculus",
            "version": "example-1",
            "kind": "textbooks",
            "itemId": "B001",
            "chapterIndex": 2,
        },
        None,
    ],
)
def test_note_source_roundtrip_preserves_old_notes_and_rejects_stale_edits(
    tmp_path, source
):
    store = UserData(tmp_path)
    initial = data()
    store.save(initial, 0)
    changed = deepcopy(initial)
    note = deepcopy(changed["noteLibrary"]["notes"][0])
    note.update(id="note-source", source=source, courseId="", questionId="")
    changed["noteLibrary"]["notes"].append(note)
    saved = store.save(changed, 1)
    with pytest.raises(UserDataError):
        store.save(initial, 1)
    store.close()
    reopened = UserData(tmp_path)
    assert reopened.state()["revision"] == saved["revision"]
    assert reopened.state()["value"] == changed
    assert "source" not in reopened.state()["value"]["noteLibrary"]["notes"][0]
    reopened.close()


@pytest.mark.parametrize(
    "source",
    [
        {
            "materialId": "11111111-1111-4111-8111-111111111111",
            "contentVersion": "a" * 64,
            "pageNumber": 0,
        },
        {
            "courseId": "calculus",
            "kind": "textbooks",
            "itemId": "B001",
            "chapterIndex": -1,
        },
        {"path": "/tmp/unknown.pdf"},
    ],
)
def test_invalid_note_source_does_not_replace_old_state(tmp_path, source):
    store = UserData(tmp_path)
    initial = data()
    store.save(initial, 0)
    invalid = deepcopy(initial)
    invalid["noteLibrary"]["notes"][0]["source"] = source
    with pytest.raises(UserDataError):
        store.save(invalid, 1)
    assert store.state()["value"] == initial
    store.close()
