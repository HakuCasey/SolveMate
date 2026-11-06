"""使用真实示例资产的独立副本，测试发布不修改仓库内容。"""

import shutil
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from solvemate_server.config import Settings
from solvemate_server.main import create_app
from solvemate_server.publish import publish


@pytest.fixture
def content_settings(tmp_path: Path) -> Settings:
    data_dir = tmp_path / "data"
    shutil.copytree(Path(__file__).resolve().parents[3] / "data", data_dir)
    settings = Settings(
        data_dir=data_dir,
        content_dir=tmp_path / "published",
        cors_origins=("http://127.0.0.1:5174",),
    )
    publish(settings.data_dir, settings.content_dir)
    return settings


@pytest.fixture
def client(content_settings: Settings):
    with TestClient(create_app(content_settings)) as connection:
        yield connection
