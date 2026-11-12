import json
from pathlib import Path

import pytest

from solvemate_server.config import Settings
from solvemate_server.publish import publish
from solvemate_server.repository import ContentRepository


def test_republish_is_deterministic_and_does_not_create_duplicate_versions(
    content_settings: Settings,
):
    root = content_settings.content_dir
    before = (root / "catalog.json").read_bytes()
    publish(content_settings.data_dir, root)
    assert (root / "catalog.json").read_bytes() == before
    assert all(
        len(course.versions) == 1
        for course in ContentRepository(root).validate().courses
    )


@pytest.mark.parametrize(
    "failure",
    [
        "invalid-json",
        "missing-file",
        "bad-question-reference",
        "bad-anchor",
        "unsafe-source-path",
    ],
)
def test_failed_publication_preserves_previous_catalog_and_packages(
    content_settings: Settings, failure: str
):
    data = content_settings.data_dir
    root = content_settings.content_dir
    before = (root / "catalog.json").read_bytes()
    repository = ContentRepository(root)
    old = repository.catalog().courses[0]
    _, archive = repository.release(old, old.latest_version)
    previous_bytes = archive.read_bytes()
    points_path = data / "calculus/memory/learning-points.json"
    if failure == "invalid-json":
        points_path.write_text("invalid JSON")
    elif failure == "missing-file":
        points_path.unlink()
    elif failure in ("bad-question-reference", "bad-anchor"):
        points = json.loads(points_path.read_bytes())
        if failure == "bad-anchor":
            points["points"][0]["source"]["textbook"] = "../textbooks/primer.md#missing"
        else:
            points["points"][0]["source"]["question_ids"] = ["M999"]
        points_path.write_text(json.dumps(points))
    else:
        catalog_path = data / "catalog.json"
        catalog = json.loads(catalog_path.read_bytes())
        catalog["courses"][0]["files"][0]["path"] = "../private-file.md"
        catalog_path.write_text(json.dumps(catalog))
    with pytest.raises((ValueError, OSError)):
        publish(data, root)
    assert (root / "catalog.json").read_bytes() == before
    assert repository.release(old, old.latest_version)[1].read_bytes() == previous_bytes
    assert not (root / ".publish-lock").exists()


def test_source_symlink_cannot_read_files_outside_course(
    content_settings: Settings, tmp_path: Path
):
    original = content_settings.data_dir / "calculus/textbooks/primer.md"
    private = tmp_path / "private.md"
    private.write_bytes(original.read_bytes())
    original.unlink()
    original.symlink_to(private)
    with pytest.raises(ValueError):
        publish(content_settings.data_dir, content_settings.content_dir)


def test_concurrent_publisher_cannot_change_existing_catalog(
    content_settings: Settings,
):
    root = content_settings.content_dir
    before = (root / "catalog.json").read_bytes()
    lock = root / ".publish-lock"
    lock.mkdir()
    with pytest.raises(RuntimeError, match="publish lock"):
        publish(content_settings.data_dir, root)
    assert (root / "catalog.json").read_bytes() == before
    assert lock.is_dir()


def test_package_write_failure_does_not_commit_new_catalog(
    content_settings: Settings, monkeypatch
):
    import solvemate_server.publish as module

    root = content_settings.content_dir
    before = (root / "catalog.json").read_bytes()
    path = content_settings.data_dir / "calculus/textbooks/primer.md"
    path.write_text(
        path.read_text(encoding="utf-8") + "\nNew content.\n", encoding="utf-8"
    )
    original_replace = module.os.replace

    def fail_package_commit(source, destination):
        if Path(source).name == "release":
            raise OSError("Simulated package commit failure.")
        return original_replace(source, destination)

    monkeypatch.setattr(module.os, "replace", fail_package_commit)
    with pytest.raises(OSError, match="commit failure"):
        publish(content_settings.data_dir, root)
    assert (root / "catalog.json").read_bytes() == before
    ContentRepository(root).validate()
    assert not (root / ".publish-lock").exists()
