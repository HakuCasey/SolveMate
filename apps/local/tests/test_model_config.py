import asyncio
import json
from pathlib import Path

import pytest

from solvemate_local import acp, model_config
from solvemate_local.errors import ConnectionError


def desktop_at(home, text):
    file = home / "profiles/desktop/cordis.patch.yml"
    file.parent.mkdir(parents=True)
    file.write_text(text, encoding="utf-8")


def fake_dump(monkeypatch, rows, calls):
    class Process:
        returncode = 0

        async def communicate(self):
            return json.dumps(rows).encode(), b""

    async def start(*argv, **kwargs):
        calls.append((argv, kwargs))
        return Process()

    monkeypatch.setattr(model_config.asyncio, "create_subprocess_exec", start)


@pytest.mark.parametrize("value", ["", "  ", "\t"])
def test_default_home_matches_current_user_on_each_platform(
    monkeypatch, tmp_path, value
):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    monkeypatch.setenv("DSH_HOME", value)
    assert model_config.resolve_home() == tmp_path / ".dsh"


def test_explicit_home_and_both_tilde_prefixes(monkeypatch, tmp_path):
    monkeypatch.setattr(Path, "home", lambda: tmp_path)
    for value in ["~/模型 配置", "~\\模型 配置"]:
        monkeypatch.setenv("DSH_HOME", value)
        assert model_config.resolve_home() == tmp_path / "模型 配置"
    chosen = tmp_path / "另一份配置"
    monkeypatch.setenv("DSH_HOME", str(chosen))
    assert model_config.resolve_home() == chosen


def test_automatic_discovery_uses_path_and_reports_missing_command(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(acp.shutil, "which", lambda name: None)
    with pytest.raises(ConnectionError) as missing:
        acp.find_executable()
    assert missing.value.code == "program_missing"
    program = tmp_path / "中文 空格" / "dsh"
    program.parent.mkdir()
    program.touch()
    monkeypatch.setattr(
        acp.shutil, "which", lambda name: str(program) if name == "dsh" else None
    )
    assert acp.find_executable() == str(program.resolve())


def test_manual_mac_bundle_and_windows_install_directory(monkeypatch, tmp_path):
    bundle = tmp_path / "自定义安装.app"
    command = bundle / "Contents/Resources/runtime/cli/bin/dsh"
    command.parent.mkdir(parents=True)
    command.touch()
    command.chmod(0o700)
    assert acp.find_executable(str(bundle)) == str(command.resolve())
    windows = tmp_path / "Windows 中文安装"
    windows.mkdir()
    executable = windows / "DeepSeek Harness.exe"
    executable.touch()
    executable.chmod(0o700)
    monkeypatch.setattr(acp.sys, "platform", "win32")
    assert acp.find_executable(str(windows)) == str(executable.resolve())


def test_missing_desktop_configuration_needs_no_overlay_or_dump(monkeypatch, tmp_path):
    async def unexpected(*args, **kwargs):
        pytest.fail("Missing desktop configuration must not start a config dump.")

    monkeypatch.setattr(model_config.asyncio, "create_subprocess_exec", unexpected)
    assert (
        asyncio.run(model_config.desktop_overlay(tmp_path, ["dsh", "acp"], {}, {}))
        is None
    )


def test_overlay_reuses_providers_preserves_acp_overrides_and_excludes_ui(
    monkeypatch, tmp_path
):
    desktop_at(
        tmp_path,
        """
- id: ui-secret
  name: desktop-only
  config:
    token: sk-do-not-copy
    expression: !!js ctx.desktop
- id: llm-pi-ai
  name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      custom:
        displayName: 自定义服务
        apiKeyEnv: SHARED_CREDENTIAL_REFERENCE
        models: [{id: custom-model}]
      existing:
        models: [{id: desktop-choice}]
""",
    )
    calls = []
    fake_dump(
        monkeypatch,
        [
            {
                "id": "llm-pi-ai",
                "name": model_config.PROVIDER_PLUGIN,
                "config": {
                    "providers": {
                        "existing": {"models": [{"id": "acp-choice"}]},
                        "acp-only": {},
                    }
                },
            }
        ],
        calls,
    )
    value = asyncio.run(
        model_config.desktop_overlay(
            tmp_path, ["中文 dsh", "acp"], {"DSH_HOME": str(tmp_path)}, {}
        )
    )
    assert "sk-do-not-copy" not in value
    rows = json.loads(value)
    assert len(rows) == 1
    providers = rows[0]["config"]["providers"]
    assert set(providers) == {"custom", "existing", "acp-only"}
    assert providers["existing"]["models"][0]["id"] == "acp-choice"
    assert providers["custom"]["apiKeyEnv"] == "SHARED_CREDENTIAL_REFERENCE"
    assert calls[0][0] == ("中文 dsh", "acp", "--dump-config")
    assert calls[0][1]["env"]["DSH_HOME"] == str(tmp_path)


def test_invalid_yaml_is_reported_without_starting_harness(tmp_path):
    desktop_at(tmp_path, "[")
    with pytest.raises(ConnectionError) as invalid:
        asyncio.run(model_config.desktop_overlay(tmp_path, ["dsh", "acp"], {}, {}))
    assert invalid.value.code == "model_config_invalid"


def test_dynamic_provider_expression_is_not_executed_or_silently_removed(
    monkeypatch, tmp_path
):
    desktop_at(
        tmp_path,
        """
- name: '@deepseek-ai/dsh-llm-pi-ai'
  config:
    providers:
      custom:
        apiKeyEnv: !!js ctx.secret
""",
    )
    fake_dump(
        monkeypatch, [{"id": "llm-pi-ai", "name": model_config.PROVIDER_PLUGIN}], []
    )
    with pytest.raises(ConnectionError) as unsupported:
        asyncio.run(model_config.desktop_overlay(tmp_path, ["dsh", "acp"], {}, {}))
    assert unsupported.value.code == "model_config_unsupported"


def test_cancelled_configuration_read_stops_its_subprocess(monkeypatch, tmp_path):
    desktop_at(
        tmp_path,
        json.dumps(
            [
                {
                    "name": model_config.PROVIDER_PLUGIN,
                    "config": {"providers": {"custom": {}}},
                }
            ]
        ),
    )

    async def exercise():
        started = asyncio.Event()

        class Process:
            returncode = None
            killed = False
            waited = False

            async def communicate(self):
                started.set()
                await asyncio.Event().wait()

            def kill(self):
                self.killed = True

            async def wait(self):
                self.waited = True

        child = Process()

        async def spawn(*args, **kwargs):
            return child

        monkeypatch.setattr(model_config.asyncio, "create_subprocess_exec", spawn)
        task = asyncio.create_task(
            model_config.desktop_overlay(tmp_path, ["dsh", "acp"], {}, {})
        )
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert child.killed and child.waited

    asyncio.run(exercise())
