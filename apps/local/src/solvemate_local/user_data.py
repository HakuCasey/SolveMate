"""应用记录、课程包及浏览器迁移；数据库事务决定正式版本，原备份不删除。"""

import base64
import hashlib
import io
import json
import math
import os
import re
import shutil
import sqlite3
import tempfile
import threading
import uuid
import zipfile
from pathlib import Path

from jsonschema import Draft202012Validator
from referencing import Registry, Resource

from .metadata import SCHEMA, validate_metadata

APP_SCHEMA = json.loads(
    Path(__file__)
    .with_name("schemas")
    .joinpath("app-data.schema.json")
    .read_text(encoding="utf-8")
)
VALIDATOR = Draft202012Validator(
    APP_SCHEMA,
    registry=Registry().with_resource(SCHEMA["$id"], Resource.from_contents(SCHEMA)),
)


class UserDataError(Exception):
    def __init__(self, message, code="invalid_user_data", status=422):
        super().__init__(message)
        self.code, self.status = code, status


def encoded(value):
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    )


def validate_data(value):
    if next(VALIDATOR.iter_errors(value), None):
        raise UserDataError("学习记录格式不正确，原有数据已保留。")
    for key in ("robots", "conversations", "subjects", "officialMaterials"):
        ids = [item["id"] for item in value.get(key, [])]
        if len(set(ids)) != len(ids):
            raise UserDataError("学习记录包含重复编号。")
    if value["defaultRobotId"] is not None and value["defaultRobotId"] not in {
        r["id"] for r in value["robots"]
    }:
        raise UserDataError("默认教师不存在。")
    for conversation in value["conversations"]:
        fields = SCHEMA["$defs"]["ConversationMetadata"]["properties"]
        if (
            set(conversation)
            - set(fields)
            - {"binding", "bindings", "turns", "messages", "example"}
        ):
            raise UserDataError("对话记录包含不支持的字段，原有记录已保留。")
        try:
            validate_metadata(
                "ConversationMetadata",
                {key: conversation[key] for key in fields if key in conversation},
            )
        except ValueError as error:
            raise UserDataError("对话元数据未通过校验，原有记录已保留。") from error
        if conversation.get("bindings") is not None and conversation["binding"]:
            raise UserDataError("对话同时包含两份会话关联，原记录已保留。")
        bindings = conversation.get(
            "bindings", [conversation["binding"]] if conversation["binding"] else []
        )
        if (
            "bindings" not in conversation
            and conversation["binding"]
            and conversation["binding"]["connectionId"]
            != conversation["aiConfig"]["connectionId"]
        ):
            raise UserDataError("对话与第三方会话的关联不一致。")
        if len({item["connectionId"] for item in bindings}) != len(bindings):
            raise UserDataError("对话包含重复的服务会话关联。")
        if any(binding["conversationId"] != conversation["id"] for binding in bindings):
            raise UserDataError("对话与第三方会话的关联不一致。")
    library = value.get("noteLibrary")
    if library:
        for key in ("notebooks", "notes", "customTags"):
            ids = [item["id"] for item in library[key]]
            if len(set(ids)) != len(ids):
                raise UserDataError("笔记记录包含重复编号。")
        books = {item["id"] for item in library["notebooks"]}
        tags = {item["id"] for item in library["customTags"]}
        for note in library["notes"]:
            if note["notebookId"] not in books or any(
                not tag.startswith("subject:") and tag not in tags
                for tag in note["tagIds"]
            ):
                raise UserDataError("笔记本或标签的关联不完整。")


def atomic_write(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=".pending-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def migrate_uploads(root):
    """保留旧目录；完整复制校验后原子启用新目录，中断不会留下半套 uploads。"""
    old, target = root / "materials", root / "uploads"
    receipt = root / "backups" / "uploads-migration.json"
    if not old.exists() or receipt.exists():
        return target

    def verify(destination):
        for path in old.rglob("*"):
            if path.is_file():
                copied = destination / path.relative_to(old)
                with path.open("rb") as source, copied.open("rb") as output:
                    if (
                        hashlib.file_digest(source, "sha256").digest()
                        != hashlib.file_digest(output, "sha256").digest()
                    ):
                        raise OSError("Uploaded material copy verification failed.")

    def complete():
        atomic_write(
            receipt, b'{"source":"materials","target":"uploads","verified":true}\n'
        )

    if target.exists():
        # 文件已启用但回执尚未写入时，重启仍能校验并完成，不直接覆盖已有目录。
        try:
            verify(target)
        except OSError as error:
            raise UserDataError(
                "materials 和 uploads 同时存在且内容不一致，请保留两份目录并核对后再启动。"
            ) from error
        complete()
        return target
    stage = Path(tempfile.mkdtemp(prefix=".uploads-migration-", dir=root))
    try:
        shutil.copytree(old, stage, dirs_exist_ok=True)
        verify(stage)
        os.replace(stage, target)
        complete()
    finally:
        if stage.exists():
            shutil.rmtree(stage)
    return target


class UserData:
    def __init__(self, root):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.root / "app.sqlite3", check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        if self.db.execute("PRAGMA user_version").fetchone()[0] > 1:
            self.db.close()
            raise UserDataError(
                "本机学习记录由较新版本创建，请使用对应版本打开，原有数据已保留。"
            )
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript("""
          CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL, revision INTEGER NOT NULL);
          CREATE TABLE IF NOT EXISTS metadata (id TEXT PRIMARY KEY, value TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS migrations (source TEXT NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(source,digest));
          CREATE TABLE IF NOT EXISTS versions (course TEXT NOT NULL, version TEXT NOT NULL, manifest TEXT NOT NULL, installed REAL NOT NULL, PRIMARY KEY(course,version));
          CREATE TABLE IF NOT EXISTS heads (course TEXT PRIMARY KEY, version TEXT NOT NULL);
        """)
        with self.db:
            self.db.execute("PRAGMA user_version=1")
            self.db.execute(
                "INSERT OR IGNORE INTO metadata VALUES ('storeId',?)",
                (str(uuid.uuid4()),),
            )
        self.store_id = self.db.execute(
            "SELECT value FROM metadata WHERE id='storeId'"
        ).fetchone()[0]

    def close(self):
        self.db.close()

    def state(self):
        with self.lock:
            row = self.db.execute("SELECT * FROM state WHERE id=1").fetchone()
            if row:
                try:
                    value = json.loads(row["value"])
                except ValueError as error:
                    raise UserDataError(
                        "本机学习记录无法解析，原数据已保留，请从备份恢复。"
                    ) from error
                validate_data(value)
            return {
                "storeId": self.store_id,
                "revision": row["revision"] if row else 0,
                "value": value if row else None,
            }

    def save(self, value, expected):
        validate_data(value)
        serialized = encoded(value)
        with self.lock, self.db:
            self.db.execute("BEGIN IMMEDIATE")
            current = self.state()
            if current["revision"] != expected:
                # 成功响应丢失后，相同请求可确认结果；其他修改仍必须通过版本检查。
                if (
                    current["revision"] == expected + 1
                    and encoded(current["value"]) == serialized
                ):
                    return current
                raise UserDataError(
                    "其他窗口已更新记录，本页更改尚未保存，请重新读取。",
                    "revision_conflict",
                    409,
                )
            self.db.execute(
                "INSERT OR REPLACE INTO state VALUES (1,?,?)",
                (serialized, expected + 1),
            )
            return self.state()

    def require_subject(self, ident):
        if ident is None:
            return
        value = self.state()["value"]
        if not value or "subjects" not in value:
            return  # 尚未迁移的旧客户端沿用原有课程编号。
        subject = next(
            (item for item in value["subjects"] if item["id"] == ident), None
        )
        if subject is not None and not subject["deleted"]:
            return
        if subject is None and any(
            head["courseId"] == ident for head in self.content()["heads"]
        ):
            return
        raise UserDataError(
            "所选学科已删除或不可用，请重新读取并选择学科。", "subject_unavailable", 409
        )

    def package_path(self, course, version):
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", course) or not re.fullmatch(
            r"[a-f0-9]{64}", version
        ):
            raise UserDataError("课程编号或版本无效。")
        return self.root / "community" / course / version / "package.zip"

    def prepare_package(self, record):
        try:
            manifest = record["manifest"]
            course, version = manifest["course"]["id"], manifest["version"]
            path = self.package_path(course, version)
            archive = base64.b64decode(record["archive"], validate=True)
            if (
                len(archive) > 10 * 1024 * 1024
                or len(archive) != manifest["size_bytes"]
                or hashlib.sha256(archive).hexdigest() != manifest["sha256"]
                or version != manifest["sha256"]
            ):
                raise ValueError("Archive checksum mismatch.")
            files = manifest["files"]
            with zipfile.ZipFile(io.BytesIO(archive)) as package:
                expected = {item["path"]: item for item in files}
                names = package.namelist()
                if len(names) != len(set(names)) or set(names) != set(expected) | {
                    "course.json"
                }:
                    raise ValueError("Archive file list mismatch.")
                if (
                    sum(item.file_size for item in package.infolist())
                    > 20 * 1024 * 1024
                ):
                    raise ValueError("Archive is too large after decompression.")
                for info in package.infolist():
                    limit = (
                        expected[info.filename]["size_bytes"]
                        if info.filename in expected
                        else 256 * 1024
                    )
                    if (
                        limit > 20 * 1024 * 1024
                        or (info.file_size != limit and info.filename in expected)
                        or info.file_size > limit
                    ):
                        raise ValueError("Archive entry size mismatch.")
                    content = package.read(info)
                    if (
                        info.filename in expected
                        and hashlib.sha256(content).hexdigest()
                        != expected[info.filename]["sha256"]
                    ):
                        raise ValueError("Archive entry checksum mismatch.")
                inside = json.loads(package.read("course.json"))
                if inside["course"] != manifest["course"] or inside["files"] != files:
                    raise ValueError("Archive manifest mismatch.")
            installed = record["installedAt"]
            if (
                not isinstance(installed, (int, float))
                or isinstance(installed, bool)
                or installed < 0
                or not math.isfinite(installed)
            ):
                raise ValueError("Invalid installation time.")
        except (KeyError, ValueError, TypeError, zipfile.BadZipFile) as error:
            raise UserDataError("课程包校验失败，原有版本已保留。") from error
        # 文件完整落盘后再提交索引；失败最多留下未引用文件，不改变旧版指针。
        atomic_write(path, archive)
        atomic_write(path.with_name("manifest.json"), encoded(manifest).encode("utf-8"))
        return course, version, encoded(manifest), installed

    def content(self):
        with self.lock:
            return {
                "versions": [
                    {
                        "courseId": row["course"],
                        "version": row["version"],
                        "manifest": json.loads(row["manifest"]),
                        "installedAt": row["installed"],
                        "available": self.package_path(
                            row["course"], row["version"]
                        ).is_file(),
                    }
                    for row in self.db.execute("SELECT * FROM versions")
                ],
                "heads": [
                    {"courseId": row["course"], "version": row["version"]}
                    for row in self.db.execute("SELECT * FROM heads")
                ],
            }

    def install(self, record, expected):
        with self.lock:
            prepared = self.prepare_package(record)
            course, version, _, _ = prepared
            with self.db:
                self.db.execute("BEGIN IMMEDIATE")
                row = self.db.execute(
                    "SELECT version FROM heads WHERE course=?", (course,)
                ).fetchone()
                current = row[0] if row else None
                if current != expected and current != version:
                    raise UserDataError(
                        "其他窗口已更新课程，请重新读取。", "content_conflict", 409
                    )
                self.db.execute(
                    "INSERT OR REPLACE INTO versions VALUES (?,?,?,?)", prepared
                )
                self.db.execute(
                    "INSERT OR REPLACE INTO heads VALUES (?,?)", (course, version)
                )

    def migrate(self, body):
        source = body["sourceId"]
        if not re.fullmatch(r"[a-f0-9-]{36}", source):
            raise UserDataError("浏览器迁移来源无效。")
        payload = body["payload"]
        serialized = encoded(payload)
        digest = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
        with self.lock:
            backup = self.root / "backups" / f"browser-{source}-{digest}.json"
            if not backup.exists():
                atomic_write(backup, serialized.encode("utf-8"))
            if self.db.execute(
                "SELECT 1 FROM migrations WHERE source=? AND digest=?", (source, digest)
            ).fetchone():
                return self.state()
            value = payload.get("value")
            if value is not None:
                validate_data(value)
            current = self.state()
            if (
                value == current["value"]
                and not payload.get("versions")
                and not payload.get("heads")
            ):
                with self.db:
                    self.db.execute(
                        "INSERT INTO migrations VALUES (?,?)", (source, digest)
                    )
                return current
            existing = current["value"] is not None or bool(self.content()["versions"])
            if existing and body.get("decision") not in {"keep", "replace"}:
                raise UserDataError(
                    "本机和此浏览器中都有记录。浏览器记录已备份，请选择使用哪份记录。",
                    "migration_conflict",
                    409,
                )
            if body.get("expectedRevision") != current["revision"]:
                raise UserDataError(
                    "其他窗口已更新记录，请重新读取后再迁移。", "revision_conflict", 409
                )
            if body.get("decision") == "keep":
                with self.db:
                    self.db.execute(
                        "INSERT INTO migrations VALUES (?,?)", (source, digest)
                    )
                return current
            # 替换前用 SQLite 备份接口保存已有记录及课程索引。
            if existing:
                target = self.root / "backups" / f"before-import-{uuid.uuid4()}.sqlite3"
                with sqlite3.connect(target) as database:
                    self.db.backup(database)
            versions = [
                self.prepare_package(item) for item in payload.get("versions", [])
            ]
            available = {(row[0], row[1]) for row in versions}
            if any(
                (item["courseId"], item["version"]) not in available
                for item in payload.get("heads", [])
            ):
                raise UserDataError("浏览器课程记录缺少对应版本，原有记录已保留。")
            with self.db:
                self.db.execute("BEGIN IMMEDIATE")
                if self.state()["revision"] != current["revision"]:
                    raise UserDataError(
                        "其他窗口已更新记录，请重试迁移。", "revision_conflict", 409
                    )
                if value is not None:
                    self.db.execute(
                        "INSERT OR REPLACE INTO state VALUES (1,?,?)",
                        (encoded(value), current["revision"] + 1),
                    )
                for row in versions:
                    self.db.execute(
                        "INSERT OR REPLACE INTO versions VALUES (?,?,?,?)", row
                    )
                for head in payload.get("heads", []):
                    self.db.execute(
                        "INSERT OR REPLACE INTO heads VALUES (?,?)",
                        (head["courseId"], head["version"]),
                    )
                self.db.execute("INSERT INTO migrations VALUES (?,?)", (source, digest))
            return self.state()
