import ctypes
from pathlib import Path, PureWindowsPath
from uuid import UUID

import pytest

from solvemate_local import installation, system_paths


def test_mac_default_is_the_application_bundle(monkeypatch):
    monkeypatch.setattr(installation.sys, "platform", "darwin")
    assert (
        installation.default_installation_path() == "/Applications/DeepSeek Harness.app"
    )


@pytest.mark.parametrize(
    "programs", [r"D:\应用 空间\Programs", r"C:\Users\中文 用户\AppData\Local\Programs"]
)
def test_windows_uses_system_programs_folder_including_redirected_paths(
    monkeypatch, programs
):
    monkeypatch.setattr(installation.sys, "platform", "win32")
    monkeypatch.setattr(installation, "windows_programs_directory", lambda: programs)
    assert installation.default_installation_path() == str(
        PureWindowsPath(programs) / "DeepSeek Harness"
    )


def test_windows_known_folder_failure_uses_current_local_app_data(monkeypatch):
    monkeypatch.setattr(installation.sys, "platform", "win32")
    monkeypatch.setattr(installation, "windows_programs_directory", lambda: "")
    monkeypatch.setenv("LOCALAPPDATA", r"D:\用户 资料\Local")
    assert (
        installation.default_installation_path()
        == r"D:\用户 资料\Local\Programs\DeepSeek Harness"
    )


def test_windows_without_environment_uses_current_home(monkeypatch):
    monkeypatch.setattr(installation.sys, "platform", "win32")
    monkeypatch.setattr(installation, "windows_programs_directory", lambda: "")
    monkeypatch.delenv("LOCALAPPDATA", raising=False)
    monkeypatch.setattr(Path, "home", lambda: PureWindowsPath(r"C:\Users\学生"))
    assert (
        installation.default_installation_path()
        == r"C:\Users\学生\AppData\Local\Programs\DeepSeek Harness"
    )


def test_unsupported_platform_has_no_invented_default(monkeypatch):
    monkeypatch.setattr(installation.sys, "platform", "linux")
    assert installation.default_installation_path() == ""


@pytest.mark.parametrize("status", [0, -1])
def test_known_folder_api_uses_correct_id_and_frees_memory_on_success_or_failure(
    monkeypatch, status
):
    allocation = ctypes.create_unicode_buffer(r"D:\用户 程序")
    freed = []

    class Function:
        def __init__(self, operation):
            self.operation = operation

        def __call__(self, *args):
            return self.operation(*args)

    def folder(identifier, flags, token, output):
        assert (
            ctypes.string_at(identifier, 16)
            == UUID("5CD7AEE2-2219-4A67-B85D-6C9CE15660CB").bytes_le
        )
        assert flags == 0 and token is None
        ctypes.cast(output, ctypes.POINTER(ctypes.c_void_p))[0] = ctypes.addressof(
            allocation
        )
        return status

    class Shell:
        SHGetKnownFolderPath = Function(folder)

    class Ole:
        CoTaskMemFree = Function(lambda pointer: freed.append(pointer.value))

    monkeypatch.setattr(
        system_paths.ctypes,
        "WinDLL",
        lambda name, **kwargs: Shell() if name == "shell32" else Ole(),
        raising=False,
    )
    assert installation.windows_programs_directory() == (
        r"D:\用户 程序" if status == 0 else ""
    )
    assert freed == [ctypes.addressof(allocation)]


def test_real_windows_default_path_is_absolute():
    if installation.sys.platform != "win32":
        pytest.skip("The native Windows Shell API requires Windows.")
    value = installation.windows_programs_directory()
    if value:
        assert PureWindowsPath(value).is_absolute()
    assert PureWindowsPath(installation.default_installation_path()).is_absolute()
