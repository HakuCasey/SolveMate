"""从 data/catalog.json 发布课程；最后原子替换目录，失败时保留旧目录。"""

import argparse
import hashlib
import io
import logging
import os
import posixpath
import re
import tempfile
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

from pydantic import ValidationError

from .config import Settings
from .models import (
    CatalogEntry,
    ContentFile,
    CourseInfo,
    CourseSpec,
    DiscussionFile,
    LearningFile,
    PublishedCatalog,
    QuestionFile,
    ReleaseManifest,
    SourceCatalog,
)
from .repository import ContentRepository, RepositoryError, json_bytes

logger = logging.getLogger(__name__)


def read_course(data_dir: Path, course: CourseSpec) -> dict[str, bytes]:
    root = data_dir.resolve(strict=True)
    course_root = (root / course.id).resolve(strict=True)
    course_root.relative_to(root)
    files: dict[str, bytes] = {}
    by_kind = {item.kind: item for item in course.files}
    for item in course.files:
        source = (course_root / item.path).resolve(strict=True)
        source.relative_to(course_root)
        files[item.path] = source.read_bytes()

    textbook = files[by_kind["textbook"].path].decode("utf-8")
    if not textbook.strip():
        raise ValueError("Textbook must not be empty.")
    anchors = set(re.findall(r'<a\s+id="([^"]+)"\s*>', textbook))
    try:
        questions = QuestionFile.model_validate_json(files[by_kind["questions"].path])
    except ValidationError as error:
        raise ValueError(f"Invalid question data for course {course.id}.") from error
    question_ids = {item.id for item in questions.questions}
    if questions.course != course.title or len(question_ids) != len(
        questions.questions
    ):
        raise ValueError("Question course or question IDs are invalid.")

    for kind, model in [
        ("learning-points", LearningFile),
        ("discussion-points", DiscussionFile),
    ]:
        item = by_kind[kind]
        try:
            memory = model.model_validate_json(files[item.path])
        except ValidationError as error:
            raise ValueError(f"Invalid {kind} data for course {course.id}.") from error
        if memory.course != course.title or len(
            {point.id for point in memory.points}
        ) != len(memory.points):
            raise ValueError("Memory course or point IDs are invalid.")
        for point in memory.points:
            reference = urlsplit(point.source.textbook)
            target = posixpath.normpath(
                str(PurePosixPath(item.path).parent / reference.path)
            )
            if (
                reference.scheme
                or reference.netloc
                or reference.query
                or target != by_kind["textbook"].path
                or reference.fragment not in anchors
                or not set(point.source.question_ids).issubset(question_ids)
            ):
                raise ValueError("Memory reference does not match the course content.")
    return files


def build_release(data_dir: Path, course: CourseSpec) -> tuple[ReleaseManifest, bytes]:
    files = read_course(data_dir, course)
    info = CourseInfo.model_validate(course.model_dump(exclude={"files"}))
    descriptors = [
        ContentFile(
            **item.model_dump(),
            media_type="text/markdown; charset=utf-8"
            if item.kind == "textbook"
            else "application/json",
            size_bytes=len(files[item.path]),
            sha256=hashlib.sha256(files[item.path]).hexdigest(),
        )
        for item in sorted(course.files, key=lambda item: item.path)
    ]
    # 包内清单描述原始文件，包本身的哈希放在包外，避免相互依赖。
    files["course.json"] = json_bytes(
        {
            "schema_version": 1,
            "course": info.model_dump(),
            "files": [item.model_dump() for item in descriptors],
        }
    )
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path, content in sorted(files.items()):
            entry = zipfile.ZipInfo(path, date_time=(1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, content)
    payload = buffer.getvalue()
    version = hashlib.sha256(payload).hexdigest()
    manifest = ReleaseManifest(
        course=info,
        version=version,
        sha256=version,
        size_bytes=len(payload),
        files=descriptors,
        download_url=f"/api/v1/courses/{course.id}/versions/{version}/download",
    )
    return manifest, payload


def atomic_write(path: Path, payload: bytes) -> None:
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
            stream.close()
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def publish(data_dir: Path, content_dir: Path) -> PublishedCatalog:
    try:
        definition = SourceCatalog.model_validate_json(
            (data_dir / "catalog.json").read_bytes()
        )
    except ValidationError as error:
        raise ValueError("Invalid source catalog; check data/catalog.json.") from error
    # 所有课程先校验并打包；任何源文件错误都不会改变当前发布目录。
    releases = [build_release(data_dir, course) for course in definition.courses]
    content_dir.mkdir(parents=True, exist_ok=True)
    lock = content_dir / ".publish-lock"
    try:
        lock.mkdir()
    except FileExistsError as error:
        raise RuntimeError(
            "Another publication is running; the publish lock already exists."
        ) from error
    try:
        repository = ContentRepository(content_dir)
        previous = (
            repository.validate()
            if (content_dir / "catalog.json").exists()
            else PublishedCatalog(courses=[])
        )
        entries: list[CatalogEntry] = []
        for manifest, payload in releases:
            parent = content_dir / "courses" / manifest.course.id
            parent.mkdir(parents=True, exist_ok=True)
            destination = parent / manifest.version
            if destination.exists():
                if (destination / "content.zip").read_bytes() != payload or (
                    destination / "manifest.json"
                ).read_bytes() != json_bytes(manifest):
                    raise ValueError(
                        "Existing immutable content does not match this publication."
                    )
            else:
                with tempfile.TemporaryDirectory(dir=parent) as temporary:
                    staging = Path(temporary) / "release"
                    staging.mkdir()
                    atomic_write(staging / "content.zip", payload)
                    atomic_write(staging / "manifest.json", json_bytes(manifest))
                    os.replace(staging, destination)
            old = next(
                (
                    item
                    for item in previous.courses
                    if item.course.id == manifest.course.id
                ),
                None,
            )
            versions = list(old.versions) if old else []
            if manifest.version not in versions:
                versions.append(manifest.version)
            entries.append(
                CatalogEntry(
                    course=manifest.course,
                    latest_version=manifest.version,
                    versions=versions,
                )
            )
        catalog = PublishedCatalog(courses=entries)
        # 完整包全部落盘后才提交新目录；请求始终读到完整的旧目录或新目录。
        atomic_write(content_dir / "catalog.json", json_bytes(catalog))
        logger.info("Published content catalog: courses=%d", len(entries))
        return catalog
    finally:
        lock.rmdir()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    settings = Settings.from_env()
    parser = argparse.ArgumentParser(
        description="Publish SolveMate official course content."
    )
    parser.add_argument("--data-dir", type=Path, default=settings.data_dir)
    parser.add_argument("--content-dir", type=Path, default=settings.content_dir)
    arguments = parser.parse_args()
    try:
        publish(arguments.data_dir, arguments.content_dir)
    except (OSError, ValueError, RuntimeError, RepositoryError) as error:
        logger.error("Content publication failed: %s", error)
        raise SystemExit(1) from error


if __name__ == "__main__":
    main()
