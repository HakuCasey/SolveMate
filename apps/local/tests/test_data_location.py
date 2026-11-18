from fastapi.testclient import TestClient
from test_service import HEADERS
from test_user_data import data

from solvemate_local.main import create_app

DIRECTORY = "/local-api/v1/user/directory"
STATE = "/local-api/v1/user/state"


def open_service(root):
    return TestClient(create_app(user_directory=root), headers=HEADERS)


def change(client, path, migrate=True):
    return client.put(DIRECTORY, json={"path": str(path), "migrate": migrate})


def test_copy_includes_last_save_and_reopens_from_new_directory(tmp_path):
    old = tmp_path / "user"
    new = tmp_path / "新位置"
    with open_service(old) as client:
        assert client.get(DIRECTORY).json()["current"] == str(old)
        assert change(client, new).json()["pending"]["migrate"]
        assert not new.exists()
        initial = client.get(STATE).json()
        saved = client.put(STATE, json={"value": data(), "expectedRevision": 0})
        assert saved.is_success, saved.text
        for folder in ["uploads", "community", "ai", "backups"]:
            (old / folder).mkdir(exist_ok=True)
            (old / folder / "test.txt").write_text("kept", encoding="utf-8")
    for _ in range(2):
        with open_service(old) as client:
            assert client.get(DIRECTORY).json()["current"] == str(new)
            copied = client.get(STATE).json()
            assert copied["value"] == saved.json()["value"]
            assert copied["storeId"] != initial["storeId"]
            assert (
                client.put(
                    STATE,
                    json={
                        "value": data(),
                        "expectedRevision": copied["revision"],
                        "expectedStoreId": initial["storeId"],
                    },
                ).status_code
                == 409
            )
            for folder in ["uploads", "community", "ai", "backups"]:
                for root in (old, new):
                    assert (root / folder / "test.txt").read_text() == "kept"


def test_cancel_empty_switch_and_return_to_existing_data(tmp_path):
    old, new = tmp_path / "data", tmp_path / "empty"
    with open_service(old) as client:
        assert client.put(
            STATE, json={"value": data(), "expectedRevision": 0}
        ).is_success
        assert change(client, new, False).is_success
        assert change(client, old).json()["pending"] is None
    with open_service(old) as client:
        assert not new.exists()
        assert change(client, new, False).is_success
    with open_service(old) as client:
        state = client.get(STATE).json()
        assert state["value"] is None
        assert state["acceptLegacyBrowserData"] is False
        assert change(client, old, False).is_success
    with open_service(old) as client:
        assert client.get(STATE).json()["value"] is not None


def test_directory_validation_and_failed_switch_keeps_original(tmp_path):
    old, new = tmp_path / "user", tmp_path / "new"
    with open_service(old) as client:
        for invalid in ("relative", old / "inside", tmp_path):
            assert change(client, invalid).status_code == 422
        assert change(client, new).is_success
        new.mkdir()
        (new / "precious.txt").write_text("keep")
    with open_service(old) as client:
        info = client.get(DIRECTORY).json()
        assert info["current"] == str(old) and info["error"] and info["pending"] is None
        assert (new / "precious.txt").read_text() == "keep"
        assert (old / "app.sqlite3").is_file()
