"""导出只写隔离下载目录，覆盖跨平台路径、同名文件及失败清理。"""

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from test_service import HEADERS

from solvemate_local import file_exports, system_paths
from solvemate_local.main import create_app
from solvemate_local.user_data import UserDataError


def test_downloads_honors_windows_known_folder_redirect(monkeypatch):
    monkeypatch.setattr(system_paths.sys, "platform", "win32")
    called = []
    monkeypatch.setattr(
        system_paths,
        "windows_known_folder",
        lambda folder: called.append(folder) or "D:/用户/下载",
    )
    assert str(system_paths.downloads_directory()).replace("\\", "/") == "D:/用户/下载"
    assert called == ["374DE290-123F-4565-9164-39C4925E467B"]
    monkeypatch.setattr(system_paths, "windows_known_folder", lambda _: "")
    with pytest.raises(OSError):
        system_paths.downloads_directory()


def test_mac_downloads_and_linux_user_directory(monkeypatch, tmp_path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setattr(system_paths.sys, "platform", "darwin")
    assert system_paths.downloads_directory() == tmp_path / "Downloads"
    monkeypatch.setattr(system_paths.sys, "platform", "linux")
    monkeypatch.setenv("XDG_CONFIG_HOME", str(tmp_path))
    (tmp_path / "user-dirs.dirs").write_text(
        'XDG_DOWNLOAD_DIR="$HOME/下载"\n', encoding="utf-8"
    )
    assert system_paths.downloads_directory() == tmp_path / "下载"


@pytest.mark.parametrize(
    "name",
    ["../a.json", "a/b.pdf", "CON.json", "NUL.pdf", "a.exe", "a.json ", "a\x00.pdf"],
)
def test_invalid_export_names_are_rejected(name):
    with pytest.raises(UserDataError):
        file_exports.validate_filename(name)


def test_concurrent_exports_do_not_overwrite_existing_files(monkeypatch, tmp_path):
    monkeypatch.setattr(file_exports, "downloads_directory", lambda: tmp_path)
    (tmp_path / "配置.json").write_bytes(b"original")
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(
                lambda i: file_exports.save_download("配置.json", str(i).encode()),
                range(2),
            )
        )
    assert {item["filename"] for item in results} == {"配置 (1).json", "配置 (2).json"}
    assert (tmp_path / "配置.json").read_bytes() == b"original"
    assert {file.read_bytes() for file in tmp_path.glob("配置 (*).json")} == {
        b"0",
        b"1",
    }


def test_partial_write_is_removed_and_existing_files_are_kept(monkeypatch, tmp_path):
    monkeypatch.setattr(file_exports, "downloads_directory", lambda: tmp_path)
    original_open = Path.open

    class FailedWrite:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            pass

        def write(self, _):
            raise OSError("Disk full")

    def fail(path, mode="r", *args, **kwargs):
        if mode == "xb":
            original_open(path, mode).close()
            return FailedWrite()
        return original_open(path, mode, *args, **kwargs)

    monkeypatch.setattr(Path, "open", fail)
    with pytest.raises(OSError):
        file_exports.save_download("a.json", b"{}")
    assert not (tmp_path / "a.json").exists()


def test_save_route_validates_content_and_origin(monkeypatch, tmp_path):
    directory = tmp_path / "Downloads"
    monkeypatch.setattr(file_exports, "downloads_directory", lambda: directory)
    with TestClient(create_app(tmp_path / "user/ai"), headers=HEADERS) as client:
        assert client.get("/local-api/v1/user/exports/directory").json()[
            "directory"
        ] == str(directory)
        response = client.post(
            "/local-api/v1/user/exports/save?filename=机器人.json",
            content=b"{}",
            headers={"content-type": "application/json"},
        )
        assert response.status_code == 200, response.text
        assert Path(response.json()["path"]).read_bytes() == b"{}"
        failed = client.post(
            "/local-api/v1/user/exports/save?filename=a.pdf",
            content=b"not-pdf",
            headers={"content-type": "application/pdf"},
        )
        assert failed.status_code == 422
        assert not (directory / "a.pdf").exists()
        denied = client.post(
            "/local-api/v1/user/exports/save?filename=blocked.json",
            content=b"{}",
            headers={
                "content-type": "application/json",
                "origin": "https://untrusted.example",
            },
        )
        assert denied.status_code == 403
        monkeypatch.setattr(file_exports, "MAX_EXPORT_BYTES", 1)
        assert (
            client.post(
                "/local-api/v1/user/exports/save?filename=too-large.json",
                content=b"{}",
                headers={"content-type": "application/json"},
            ).status_code
            == 413
        )
