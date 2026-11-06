"""只读取已经发布的不可变内容包，校验失败时不返回下载内容。"""

import hashlib
import json
from pathlib import Path

from pydantic import BaseModel, ValidationError

from .models import CatalogEntry, PublishedCatalog, ReleaseManifest


def json_bytes(value: BaseModel | dict) -> bytes:
    if isinstance(value, BaseModel):
        value = value.model_dump(mode="json")
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def sha256_file(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


class RepositoryError(Exception):
    """发布数据缺失、损坏或越过允许的文件目录。"""


class ContentNotFound(Exception):
    """课程或版本没有出现在已提交的发布目录中。"""


class ContentRepository:
    def __init__(self, root: Path):
        self.root = root.resolve()

    def _path(self, *parts: str) -> Path:
        try:
            path = self.root.joinpath(*parts).resolve(strict=True)
            path.relative_to(self.root)
            if not path.is_file():
                raise ValueError("Expected a content file.")
            return path
        except (OSError, ValueError) as error:
            raise RepositoryError("Published content file is unavailable.") from error

    def catalog(self) -> PublishedCatalog:
        try:
            return PublishedCatalog.model_validate_json(
                self._path("catalog.json").read_bytes()
            )
        except (OSError, ValidationError) as error:
            raise RepositoryError("Published catalog is invalid.") from error

    @staticmethod
    def course(catalog: PublishedCatalog, course_id: str) -> CatalogEntry:
        entry = next(
            (item for item in catalog.courses if item.course.id == course_id), None
        )
        if entry is None:
            raise ContentNotFound("Course was not found.")
        return entry

    def release(
        self, entry: CatalogEntry, version: str
    ) -> tuple[ReleaseManifest, Path]:
        if version not in entry.versions:
            raise ContentNotFound("Content version was not found.")
        try:
            manifest_path = self._path(
                "courses", entry.course.id, version, "manifest.json"
            )
            manifest = ReleaseManifest.model_validate_json(manifest_path.read_bytes())
            archive = self._path("courses", entry.course.id, version, "content.zip")
            if (
                manifest.course.id != entry.course.id
                or manifest.version != version
                or manifest.sha256 != version
                or manifest.download_url
                != f"/api/v1/courses/{entry.course.id}/versions/{version}/download"
                or archive.stat().st_size != manifest.size_bytes
                or sha256_file(archive) != manifest.sha256
                or (version == entry.latest_version and manifest.course != entry.course)
            ):
                raise RepositoryError(
                    "Published content checksum or metadata does not match."
                )
            return manifest, archive
        except (OSError, ValidationError) as error:
            raise RepositoryError("Published content manifest is invalid.") from error

    def validate(self) -> PublishedCatalog:
        catalog = self.catalog()
        for course in catalog.courses:
            for version in course.versions:
                self.release(course, version)
        return catalog
