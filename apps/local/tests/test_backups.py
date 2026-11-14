"""完整备份、并发保护和中断回退使用独立存储，不调用真实 Harness。"""

import asyncio
import io
import json
import os
import sqlite3
import stat
import zipfile
from copy import deepcopy
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from test_materials import finished, pdf_bytes, upload
from test_service import HEADERS, connect, fake_registry
from test_user_data import data

from solvemate_local import backups
from solvemate_local.backups import Backups, Maintenance, MaintenanceMiddleware
from solvemate_local.main import create_app
from solvemate_local.store import Store

BASE = "/local-api/v1/user/backups"
STATE = "/local-api/v1/user/state"


def exported(client):
    response = client.post(
        BASE + "/export", json={"filename": "学习备份.zip", "saveToDownloads": False}
    )
    assert response.status_code == 200, response.text
    response = client.get(f"{BASE}/{response.json()['token']}/download")
    assert response.status_code == 200, response.text
    return response.content


def inspected(client, archive):
    response = client.post(
        BASE + "/inspect",
        content=archive,
        headers={"content-type": "application/octet-stream"},
    )
    assert response.status_code == 200, response.text
    return response.json()["token"]


def rewrite(raw, change):
    result = io.BytesIO()
    with (
        zipfile.ZipFile(io.BytesIO(raw)) as source,
        zipfile.ZipFile(result, "w") as target,
    ):
        entries = {name: source.read(name) for name in source.namelist()}
        change(entries)
        for key, value in entries.items():
            target.writestr(key, value)
    return result.getvalue()


def test_roundtrip_files_records_native_binding_and_stale_window(tmp_path, monkeypatch):
    monkeypatch.setenv("DSH_HOME", str(tmp_path / "harness"))
    app = create_app(tmp_path / "ai", registry=fake_registry())
    with TestClient(app, headers=HEADERS) as client:
        configured = connect(client)
        original = data()
        saved = client.put(
            STATE, json={"value": original, "expectedRevision": 0}
        ).json()
        material = finished(client, upload(client).json()["id"])
        # 独立数据库连接只登记测试原生编号，不启动任何 Harness。
        store = Store(tmp_path / "ai")
        store.bind(
            "conversation-test",
            "native-original",
            "/old/path",
            "/old/work",
            protocol="dsh-native",
        )
        store.close()
        (tmp_path / "community/history").mkdir(parents=True)
        (tmp_path / "community/history/package.zip").write_bytes(b"old version")
        (tmp_path / "backups/old.zip").write_bytes(b"must not include")
        (tmp_path / "ai/workspace/example.txt").write_text(
            "work file", encoding="utf-8"
        )
        archive = exported(client)
        with zipfile.ZipFile(io.BytesIO(archive)) as package:
            assert not any("backups" in p for p in package.namelist())
            assert package.read("ai/workspace/example.txt") == b"work file"
            assert package.read("community/history/package.zip") == b"old version"
        changed = deepcopy(original)
        changed["noteLibrary"]["notes"][0]["content"] = "changed after backup"
        newer = client.put(
            STATE, json={"value": changed, "expectedRevision": saved["revision"]}
        ).json()
        (tmp_path / "community/history/package.zip").unlink()
        token = inspected(client, archive)
        restored = client.post(f"{BASE}/{token}/restore", json={})
        assert restored.status_code == 200, restored.text
        assert (tmp_path / "backups" / restored.json()["safetyBackup"]).is_file()
        current = client.get(STATE).json()
        assert current["value"] == original
        assert current["storeId"] == saved["storeId"]
        assert current["revision"] > newer["revision"]
        assert (
            client.put(
                STATE, json={"value": changed, "expectedRevision": newer["revision"]}
            ).status_code
            == 409
        )
        settings = client.get("/local-api/v1/settings").json()
        assert settings["config"]["model"] == configured["config"]["model"]
        assert (
            settings["connections"][0]["revision"]
            > configured["connections"][0]["revision"]
        )
        route = f"/local-api/v1/materials/{material['id']}/{material['currentVersion']}"
        assert client.get(route + "/reader").content == pdf_bytes()
        assert (
            tmp_path / "community/history/package.zip"
        ).read_bytes() == b"old version"
        with sqlite3.connect(tmp_path / "ai/state.sqlite3") as db:
            assert (
                db.execute("SELECT external_id FROM bindings").fetchone()[0]
                == "native-original"
            )
        assert client.post(f"{BASE}/{token}/restore", json={}).status_code == 410


@pytest.mark.parametrize(
    "kind",
    [
        "not-zip",
        "hash",
        "new-version",
        "traversal",
        "symlink",
        "database",
        "manifest-type",
        "boolean-version",
    ],
)
def test_invalid_backup_retains_current_data(tmp_path, kind):
    with TestClient(create_app(tmp_path / "ai"), headers=HEADERS) as client:
        client.put(STATE, json={"value": data(), "expectedRevision": 0})
        original = client.get(STATE).json()
        raw = exported(client)

        def change(entries):
            manifest = json.loads(entries["manifest.json"])
            if kind == "manifest-type":
                entries["manifest.json"] = b"[]"
                return
            if kind == "boolean-version":
                manifest["version"] = True
            if kind == "hash":
                entries["app.sqlite3"] = b"damaged"
            elif kind == "new-version":
                manifest["version"] = 999
            elif kind == "traversal":
                entries["../outside"] = b"bad"
                manifest["files"]["../outside"] = {
                    "size": 3,
                    "sha256": backups.hashlib.sha256(b"bad").hexdigest(),
                }
            elif kind == "database":
                entries["app.sqlite3"] = b"not a database"
                manifest["files"]["app.sqlite3"] = {
                    "size": len(entries["app.sqlite3"]),
                    "sha256": backups.hashlib.sha256(
                        entries["app.sqlite3"]
                    ).hexdigest(),
                }
            entries["manifest.json"] = json.dumps(manifest).encode()

        if kind == "not-zip":
            raw = b"not zip"
        elif kind == "symlink":
            stream = io.BytesIO()
            with (
                zipfile.ZipFile(io.BytesIO(raw)) as source,
                zipfile.ZipFile(stream, "w") as target,
            ):
                for name in source.namelist():
                    info = zipfile.ZipInfo(name)
                    if name == "app.sqlite3":
                        info.external_attr = (stat.S_IFLNK | 0o777) << 16
                    target.writestr(info, source.read(name))
            raw = stream.getvalue()
        else:
            raw = rewrite(raw, change)
        result = client.post(
            BASE + "/inspect",
            content=raw,
            headers={"content-type": "application/octet-stream"},
        )
        assert result.status_code == 422, result.text
        assert client.get(STATE).json() == original
        assert not (tmp_path / "outside").exists()


def test_failed_install_rolls_back_original_files(tmp_path, monkeypatch):
    with TestClient(create_app(tmp_path / "ai"), headers=HEADERS) as client:
        client.put(STATE, json={"value": data(), "expectedRevision": 0})
        archive = exported(client)
        changed = data()
        changed["noteLibrary"]["notes"][0]["content"] = "current data"
        client.put(STATE, json={"value": changed, "expectedRevision": 1})
        token = inspected(client, archive)
        replace = os.replace

        def fail(source, destination):
            if (
                str(source).endswith(".new")
                and Path(destination).name == "state.sqlite3"
            ):
                raise OSError("Simulated disk failure")
            return replace(source, destination)

        monkeypatch.setattr(backups.os, "replace", fail)
        response = client.post(f"{BASE}/{token}/restore", json={})
        assert response.status_code == 503, response.text
        assert client.get(STATE).json()["value"] == changed
        assert not (tmp_path / "backups/restore.json").exists()
        monkeypatch.setattr(backups.os, "replace", replace)
        assert client.post(f"{BASE}/{token}/restore", json={}).status_code == 200


@pytest.mark.parametrize("phase", ["applying", "complete"])
def test_startup_recovers_interrupted_restore(tmp_path, phase):
    manager = Backups(tmp_path, tmp_path / "ai", tmp_path / "uploads")
    ident = str(uuid4())
    old, new = b"original", b"restored"
    existed = {key: path.exists() for key, path in manager.paths.items()}
    existed["app.sqlite3"] = True
    target = manager.paths["app.sqlite3"]
    target.write_bytes(new)
    manager.siblings("app.sqlite3", ident)[1].write_bytes(old)
    manager.write_journal({"id": ident, "phase": phase, "existed": existed})
    manager.close()
    reopened = Backups(tmp_path, tmp_path / "ai", tmp_path / "uploads")
    assert target.read_bytes() == (old if phase == "applying" else new)
    assert not reopened.journal.exists()
    reopened.close()


def test_busy_background_and_default_download(tmp_path, monkeypatch):
    monkeypatch.setattr(
        "solvemate_local.file_exports.downloads_directory",
        lambda: tmp_path / "downloads",
    )
    app = create_app(tmp_path / "ai")
    with TestClient(app, headers=HEADERS) as client:
        app.state.ai.jobs["busy-test"] = {}
        result = client.post(BASE + "/export", json={"filename": "学习.zip"})
        assert result.status_code == 409
        app.state.ai.jobs.clear()
        for expected in ("学习.zip", "学习 (1).zip"):
            result = client.post(BASE + "/export", json={"filename": "学习.zip"})
            assert result.status_code == 200, result.text
            assert result.json()["filename"] == expected
            assert zipfile.is_zipfile(tmp_path / "downloads" / expected)
        assert (
            client.post(BASE + "/export", json={"filename": "../bad.zip"}).status_code
            == 422
        )


def test_maintenance_excludes_new_requests_without_serializing_reads():
    async def scenario():
        gate = Maintenance()
        started, release = asyncio.Event(), asyncio.Event()

        async def endpoint(scope, receive, send):
            started.set()
            await release.wait()

        middleware = MaintenanceMiddleware(endpoint, gate)

        async def ignore(*args):
            pass

        active = asyncio.create_task(
            middleware(
                {"type": "http", "path": "/local-api/v1/user/state"}, ignore, ignore
            )
        )
        await started.wait()
        entered = asyncio.Event()

        async def maintain():
            async with gate.exclusive():
                entered.set()

        operation = asyncio.create_task(maintain())
        await asyncio.sleep(0)
        assert not entered.is_set()
        responses = []

        async def capture(message):
            responses.append(message)

        await middleware(
            {"type": "http", "path": "/local-api/v1/settings"}, ignore, capture
        )
        assert responses[0]["status"] == 503
        release.set()
        await active
        await operation
        assert entered.is_set() and not gate.busy

    asyncio.run(scenario())


def test_restore_keeps_unsent_drafts_and_study_history(tmp_path):
    with TestClient(create_app(tmp_path / "ai"), headers=HEADERS) as client:
        saved = client.put(STATE, json={"value": data(), "expectedRevision": 0}).json()
        interval = {"startMs": 1700000000000, "endMs": 1700000060000}
        study = client.post(
            "/local-api/v1/user/study",
            json={"expectedStoreId": saved["storeId"], "intervals": [interval]},
        ).json()
        archive = exported(client)
        changed = data()
        changed["drafts"] = {"conversation:test": "未发送的问题"}
        client.put(STATE, json={"value": changed, "expectedRevision": 1})
        token = inspected(client, archive)
        result = client.post(f"{BASE}/{token}/restore", json={})
        assert result.status_code == 200, result.text
        assert client.get(STATE).json()["value"]["drafts"] == changed["drafts"]
        assert client.get("/local-api/v1/user/study").json()["days"] == study["days"]


def test_restore_into_another_configured_data_directory(tmp_path):
    first = tmp_path / "first"
    with TestClient(create_app(first / "ai"), headers=HEADERS) as client:
        client.put(STATE, json={"value": data(), "expectedRevision": 0})
        material = finished(client, upload(client).json()["id"])
        archive = exported(client)
    second = tmp_path / "second"
    app = create_app(
        tmp_path / "external-ai",
        user_directory=second,
        materials_directory=tmp_path / "external-uploads",
    )
    with TestClient(app, headers=HEADERS) as client:
        original_store = client.get(STATE).json()["storeId"]
        token = inspected(client, archive)
        assert client.post(f"{BASE}/{token}/restore", json={}).status_code == 200
        result = client.get(STATE).json()
        assert result["storeId"] == original_store
        assert result["value"] == data()
        route = f"/local-api/v1/materials/{material['id']}/{material['currentVersion']}"
        assert client.get(route + "/reader").content == pdf_bytes()
        assert (tmp_path / "external-ai/state.sqlite3").is_file()
        assert (
            tmp_path / "external-uploads" / material["id"] / "record.json"
        ).is_file()


def test_preparation_crash_only_removes_staged_files(tmp_path):
    manager = Backups(tmp_path, tmp_path / "ai", tmp_path / "uploads")
    ident = str(uuid4())
    target = manager.paths["app.sqlite3"]
    target.write_bytes(b"current")
    manager.siblings("app.sqlite3", ident)[0].write_bytes(b"unfinished")
    manager.write_journal(
        {
            "id": ident,
            "phase": "preparing",
            "existed": {key: path.exists() for key, path in manager.paths.items()},
        }
    )
    manager.close()
    recovered = Backups(tmp_path, tmp_path / "ai", tmp_path / "uploads")
    assert target.read_bytes() == b"current"
    assert not recovered.siblings("app.sqlite3", ident)[0].exists()
    recovered.close()
