"""统一资料及版本记录。文件目录只存文件，SQLite 是元数据的唯一正式副本。"""

import copy
import json
import logging
import time
from contextlib import contextmanager

from .material_converter import MaterialError
from .metadata import validate_metadata
from .user_data import UserDataError, encoded


class MaterialRepository:
    def __init__(self, user):
        self.user = user
        self.db = user.db
        self.lock = user.lock
        if not self.db.execute(
            "SELECT 1 FROM sqlite_master WHERE name='materials'"
        ).fetchone():
            self.db.executescript("""
              CREATE TABLE IF NOT EXISTS materials (id TEXT PRIMARY KEY, value TEXT NOT NULL);
              CREATE TABLE IF NOT EXISTS material_versions (
                material TEXT NOT NULL, version TEXT NOT NULL, value TEXT NOT NULL,
                PRIMARY KEY(material,version));
            """)

    @contextmanager
    def transaction(self):
        with self.lock:
            nested = self.db.in_transaction
            if not nested:
                self.db.execute("BEGIN IMMEDIATE")
            try:
                yield
                if not nested:
                    self.db.commit()
            except BaseException:
                if not nested:
                    self.db.rollback()
                raise

    def list(self):
        with self.lock:
            result = []
            self.read_errors = 0
            for row in self.db.execute("SELECT id FROM materials ORDER BY id"):
                try:
                    result.append(self.get(row[0]))
                except MaterialError:
                    self.read_errors += 1
                    logging.getLogger(__name__).error(
                        "Failed to read material metadata: %s", row[0]
                    )
            return result

    def get(self, ident, version=None):
        with self.lock:
            row = self.db.execute(
                "SELECT value FROM materials WHERE id=?", (ident,)
            ).fetchone()
            if row is None:
                raise MaterialError(
                    "没有找到资料记录，请重新读取资料列表。", "material_missing", 404
                )
            try:
                record = json.loads(row[0])
                record["version"] = self.version(
                    ident, version or record["currentVersion"]
                )
                validate_metadata("Material", record)
                return record
            except (ValueError, KeyError, TypeError) as error:
                raise MaterialError(
                    "资料记录无法读取，原记录已保留，请恢复备份后重试。",
                    "material_invalid",
                    422,
                ) from error

    def version(self, ident, version):
        row = self.db.execute(
            "SELECT value FROM material_versions WHERE material=? AND version=?",
            (ident, version),
        ).fetchone()
        if row is None:
            raise MaterialError(
                "资料版本不存在，未替换为其他版本。", "material_version_missing", 404
            )
        return json.loads(row[0])

    def put(self, record):
        """调用方持有事务；版本内容与当前指针同时提交。"""
        value = copy.deepcopy(record)
        value.pop("availability", None)
        validate_metadata("Material", value)
        version = value.pop("version")
        self.db.execute(
            "INSERT OR REPLACE INTO material_versions VALUES (?,?,?)",
            (value["id"], version["contentVersion"], encoded(version)),
        )
        self.db.execute(
            "INSERT OR REPLACE INTO materials VALUES (?,?)",
            (value["id"], encoded(value)),
        )

    def save(self, record):
        with self.transaction():
            record["revision"] += 1
            record["updatedAt"] = int(time.time() * 1000)
            self.put(record)

    def edit(self, ident, revision, **changes):
        with self.transaction():
            record = self.get(ident)
            if record.get("deletedAt") is not None:
                raise MaterialError(
                    "资料已删除，请重新读取列表。", "material_deleted", 409
                )
            if record["revision"] != revision:
                raise MaterialError(
                    "资料已更新，请重新读取后再操作。", "material_conflict", 409
                )
            if "subjectId" in changes:
                self.user.require_subject(changes["subjectId"])
            if "title" in changes:
                title = changes["title"].strip()
                if (
                    not title
                    or len(title) > 240
                    or any(ord(char) < 32 for char in title)
                ):
                    raise MaterialError("资料名称应为 1–240 个字符，不能包含控制字符。")
                changes["title"] = title
            if any(record.get(key) != value for key, value in changes.items()):
                record.update(changes)
                self.save(record)
            return record

    def activate(self, ident, version, revision):
        with self.transaction():
            record = self.get(ident)
            if record["revision"] != revision:
                raise MaterialError(
                    "资料已变化，请重新读取后再更新。", "material_conflict", 409
                )
            record["version"] = self.version(ident, version)
            record["currentVersion"] = version
            record["deletedAt"] = None
            # 原学科已删除时归入未分类，不能依名称复活或改连另一个学科。
            try:
                self.user.require_subject(record["subjectId"])
            except UserDataError as error:
                if error.code != "subject_unavailable":
                    raise
                record["subjectId"] = None
            self.save(record)
            return record
