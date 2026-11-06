"""运行参数；正式部署时显式指定数据与发布目录。"""

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    content_dir: Path
    cors_origins: tuple[str, ...] = ()

    @classmethod
    def from_env(cls) -> "Settings":
        repository = Path(__file__).resolve().parents[4]
        origins = os.environ.get(
            "SOLVEMATE_CORS_ORIGINS",
            "http://127.0.0.1:5173,http://127.0.0.1:5174,"
            "http://localhost:5173,http://localhost:5174",
        )
        return cls(
            data_dir=Path(os.environ.get("SOLVEMATE_DATA_DIR", repository / "data")),
            content_dir=Path(
                os.environ.get(
                    "SOLVEMATE_CONTENT_DIR", repository / "apps/server/.content"
                )
            ),
            cors_origins=tuple(
                value.strip() for value in origins.split(",") if value.strip()
            ),
        )
