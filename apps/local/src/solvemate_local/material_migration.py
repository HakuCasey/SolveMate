"""把已知的旧资料记录转换到统一目录；保持编号、文件和历史版本不变。"""

import hashlib
import json
import shutil
import sqlite3
import time
import zipfile
from pathlib import Path

from .material_repository import MaterialRepository
from .user_data import UserDataError, atomic_write, encoded

DATA = Path(__file__).resolve().parents[4] / "data"


def index_course(
    repository, course, version, files, directory, installed=0, active=False
):
    """发布包只提供内容版本；不覆盖本地标题、学科或当前版本。"""
    result = []
    for file in files:
        kind = file["kind"]
        if kind not in ("textbook", "questions"):
            continue
        ident = (
            f"{course['id']}:textbooks:{file['id']}"
            if kind == "textbook"
            else f"{course['id']}:questions"
        )
        original = directory / file["path"]
        if not original.is_file():
            raise UserDataError(f"资料文件缺失：{file['path']}，原记录已保留。")
        if kind == "textbook":
            title = original.read_text(encoding="utf-8").splitlines()[0].lstrip("# ")
            pdf = next(
                (
                    f
                    for f in files
                    if f["kind"] == "textbook-pdf" and f["id"] == file["id"] + "-pdf"
                ),
                None,
            )
            if pdf is None:
                # 旧包的原文校验一致才允许使用随应用提供的 PDF。
                bundled = DATA / course["id"] / "textbooks/primer.pages.json"
                if not bundled.is_file():
                    raise UserDataError("旧资料缺少可核实的 PDF，原记录已保留。")
                index = json.loads(bundled.read_text(encoding="utf-8"))
                if (
                    index["sourceSha256"]
                    != hashlib.sha256(original.read_bytes()).hexdigest()
                ):
                    raise UserDataError("旧资料的 PDF 与原文不匹配，原记录已保留。")
                target = directory / "textbooks/primer.pdf"
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(bundled.with_name("primer.pdf"), target)
                pdf = {"path": "textbooks/primer.pdf"}
            path = directory / pdf["path"]
            from .materials import read_pdf

            count = read_pdf(path)
            media_type = "application/pdf"
            # 发布的 PDF 是资料原文件，Markdown 仅属于发布包。
            asset = pdf["path"]
        else:
            title = course["title"] + "题目"
            path = original
            count = None
            media_type = "application/json"
            asset = file["path"]
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        detail = {
            "contentVersion": version,
            "mediaType": media_type,
            "originalAssetId": asset,
            "readerAssetId": asset,
            "storagePath": directory.relative_to(repository.user.root).as_posix(),
            "filename": path.name,
            "sizeBytes": path.stat().st_size,
            "sha256": digest,
            "pageCount": count,
            "status": "ready",
            "error": None,
            "processor": None,
            "processorVersion": None,
        }
        row = repository.db.execute(
            "SELECT value FROM materials WHERE id=?", (ident,)
        ).fetchone()
        if row:
            record = json.loads(row[0])
            # 这里只登记版本，切换指针必须由用户执行更新操作。
            repository.db.execute(
                "INSERT OR IGNORE INTO material_versions VALUES (?,?,?)",
                (ident, version, encoded(detail)),
            )
        else:
            record = {
                "id": ident,
                "title": title,
                "subjectId": course["id"],
                "source": "community",
                "kind": "textbooks" if kind == "textbook" else "questions",
                "publisher": {"courseId": course["id"], "itemId": file["id"]},
                "currentVersion": version,
                "revision": 1,
                "createdAt": int(installed),
                "updatedAt": int(installed),
                "deletedAt": None if active else 0,
                "version": detail,
            }
            repository.put(record)
        result.append(ident)
    return result


def index_packages(repository, active=False):
    for row in repository.db.execute("SELECT * FROM versions").fetchall():
        manifest = json.loads(row["manifest"])
        package = repository.user.package_path(row["course"], row["version"])
        if not package.is_file():
            continue  # 已登记的资料保留，读取时报告文件缺失。
        directory = package.parent / "files"
        with zipfile.ZipFile(package) as archive:
            for entry in manifest["files"]:
                target = directory / entry["path"]
                if not target.resolve().is_relative_to(directory.resolve()):
                    raise UserDataError("内容包路径无效。")
                if not target.is_file():
                    atomic_write(target, archive.read(entry["path"]))
        index_course(
            repository,
            manifest["course"],
            row["version"],
            manifest["files"],
            directory,
            row["installed"],
            active=active,
        )


def migrate_materials(user, uploads):
    repository = MaterialRepository(user)
    if user.db.execute("SELECT 1 FROM metadata WHERE id='unifiedMaterials'").fetchone():
        return repository
    # 学习记录无法读取时暂停转换，保留服务与备份恢复入口。
    if user.record_error is not None:
        return repository
    # 使用 SQLite backup，连同 WAL 中已提交的数据保存，迁移失败可完整恢复。
    backup = user.root / "backups" / f"materials-{time.time_ns()}.sqlite3"
    backup.parent.mkdir(parents=True, exist_ok=True)
    with user.lock, sqlite3.connect(backup) as destination:
        user.db.backup(destination)
    with user.lock, user.db:
        row = user.db.execute("SELECT value FROM state WHERE id=1").fetchone()
        state = json.loads(row[0]) if row else {}
        subjects = {s["id"]: s for s in state.get("subjects", [])}
        for path in Path(uploads).glob("*/record.json"):
            record = json.loads(path.read_text(encoding="utf-8"))
            record["subjectId"] = record.pop("courseId", None)
            record["kind"] = "textbooks"
            record["version"]["storagePath"] = (
                Path("uploads") / record["id"] / record["currentVersion"]
            ).as_posix()
            subject = subjects.get(record["subjectId"])
            if subject and subject.get("deleted") and subject.get("materialsDeleted"):
                record["deletedAt"] = record.get("deletedAt") or 0
            repository.put(record)
        # 随应用分发的内容也登记为资料，文件固定保存，后续源码更新不改变旧版本。
        catalog = json.loads((DATA / "catalog.json").read_text(encoding="utf-8"))
        for course in catalog["courses"]:
            directory = user.root / "community" / course["id"] / "example-1" / "files"
            if not directory.exists():
                shutil.copytree(DATA / course["id"], directory)
            index_course(
                repository, course, "example-1", course["files"], directory, active=True
            )
        index_packages(repository, active=True)
        apply_legacy_catalog(repository, state)
        if row:
            from .material_locations import unify_locations

            state = unify_locations(state)
            state.pop("officialMaterials", None)
            from .user_data import validate_data

            validate_data(state)
            user.db.execute(
                "UPDATE state SET value=?,revision=revision+1 WHERE id=1",
                (encoded(state),),
            )
        user.db.execute("INSERT INTO metadata VALUES ('unifiedMaterials','1')")
    return repository


def apply_legacy_catalog(repository, state):
    subjects = {s["id"]: s for s in state.get("subjects", [])}
    heads = dict(repository.db.execute("SELECT course, version FROM heads"))
    old = {r["id"]: r for r in state.get("officialMaterials", [])}
    for item in repository.list():
        if item["source"] != "community":
            continue
        previous = old.get(item["id"], {})
        item["title"] = previous.get("customTitle", item["title"])
        item["subjectId"] = previous.get("subjectId", item["subjectId"])
        version = previous.get(
            "version", heads.get(item["publisher"]["courseId"], item["currentVersion"])
        )
        item["deletedAt"] = previous.get("deletedAt")
        subject = subjects.get(item["subjectId"])
        if version is None or (subject and subject.get("deleted")):
            item["deletedAt"] = item["deletedAt"] or 0
        if version:
            item["version"] = repository.version(item["id"], version)
            item["currentVersion"] = version
        item["updatedAt"] = int(previous.get("updatedAt", item["updatedAt"]))
        repository.put(item)
