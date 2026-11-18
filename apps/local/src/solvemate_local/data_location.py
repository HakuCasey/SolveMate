"""用户选择的目录在服务下次启动、打开数据库之前切换。"""

import json
import logging
import os
import shutil
import sqlite3
import tempfile
import time
from contextlib import closing
from pathlib import Path
from uuid import uuid4

from .user_data import UserDataError


def invalid(message):
    return UserDataError(message, "invalid_data_directory", 422)


def existing_store(path):
    database = path / "app.sqlite3"
    if not database.is_file():
        return False
    try:
        with closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as db:
            return bool(
                db.execute("SELECT value FROM metadata WHERE id='storeId'").fetchone()
            )
    except sqlite3.Error:
        return False


class DataLocation:
    def __init__(self, default, configurable=True):
        self.default = Path(default).resolve()
        self.file = self.default.parent / f".{self.default.name}-location.json"
        self.configurable = configurable
        self.current = self.default
        self.pending = None
        self.error = ""
        if configurable and self.file.is_file():
            config = json.loads(self.file.read_text(encoding="utf-8"))
            self.current = Path(config["current"])
            self.pending = config.get("pending")
            self.error = config.get("error", "")
            if not self.current.is_absolute() or not existing_store(self.current):
                self.error = f"无法读取 {self.current}。本次使用默认目录，请重新连接磁盘后重启，或另选目录。"
                self.current = self.default
                self.pending = None

    def info(self):
        return {
            "current": str(self.current),
            "default": str(self.default),
            "pending": self.pending,
            "error": self.error,
            "configurable": self.configurable,
        }

    def write(self, current, pending=None, error=""):
        config = {"current": str(current), "pending": pending, "error": error}
        fd, filename = tempfile.mkstemp(dir=self.file.parent)
        tmp = Path(filename)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as out:
                json.dump(config, out, ensure_ascii=False)
                out.flush()
                os.fsync(out.fileno())
            tmp.replace(self.file)
        finally:
            tmp.unlink(missing_ok=True)
        self.current, self.pending, self.error = current, pending, error

    def target(self, raw, migrate):
        path = Path(raw.strip()).expanduser()
        if not path.is_absolute():
            raise invalid("请输入完整的文件夹路径。")
        path = path.resolve()
        if path == self.current:
            return path
        if any(
            path != root and (path.is_relative_to(root) or root.is_relative_to(path))
            for root in (self.current, self.default)
        ):
            raise invalid("新旧数据目录不能相互包含。")
        if path.exists() and not path.is_dir():
            raise invalid("请选择文件夹。")
        if (
            path.exists()
            and any(path.iterdir())
            and (migrate or not existing_store(path))
        ):
            raise invalid(
                "迁移需要空文件夹。若要使用已有学习记录，请关闭迁移并选择其数据目录。"
            )
        return path

    def schedule(self, raw, migrate):
        if not self.configurable:
            raise invalid(
                "启动参数分别指定了数据目录，请先移除独立的 AI 或上传目录设置。"
            )
        path = self.target(raw, migrate)
        self.write(
            self.current,
            None if path == self.current else {"path": str(path), "migrate": migrate},
        )
        return self.info()

    def prepare(self, progress=None):
        target = self.target(self.pending["path"], self.pending["migrate"])
        if not self.pending["migrate"]:
            target.mkdir(parents=True, exist_ok=True)
            return target
        target.parent.mkdir(parents=True, exist_ok=True)
        # 成功复制后才将完整目录放到目标位置。旧目录及其备份始终保留。
        with tempfile.TemporaryDirectory(
            dir=target.parent, prefix=".data-migration-"
        ) as folder:
            staged = Path(folder) / "data"
            if not existing_store(self.current):
                raise invalid("无法读取原数据目录，迁移未执行。")
            for entry in self.current.rglob("*"):
                if entry.is_symlink() or not (entry.is_dir() or entry.is_file()):
                    raise invalid(
                        f"数据目录包含链接或特殊文件，请移出后重试：{entry.name}"
                    )
            # 大文件复制中仅在确实有进展时通知桌面端延长启动等待。
            last_report = 0.0

            def report(*_):
                nonlocal last_report
                if progress and time.monotonic() - last_report > 2:
                    progress()
                    last_report = time.monotonic()

            databases = {
                self.current / "app.sqlite3",
                self.current / "ai/state.sqlite3",
            }
            sidecars = {
                db.with_name(db.name + suffix)
                for db in databases
                for suffix in ("-shm", "-wal", "-journal")
            }

            def copy_file(source, destination):
                if Path(source) in databases:
                    with (
                        closing(
                            sqlite3.connect(
                                Path(source).as_uri() + "?mode=ro", uri=True
                            )
                        ) as original,
                        closing(sqlite3.connect(destination)) as db,
                    ):
                        original.backup(db, pages=256, progress=report)
                else:
                    with open(source, "rb") as src, open(destination, "xb") as dst:
                        while chunk := src.read(1024 * 1024):
                            dst.write(chunk)
                            report()
                    shutil.copystat(source, destination)

            shutil.copytree(
                self.current,
                staged,
                symlinks=True,
                copy_function=copy_file,
                ignore=lambda folder, names: [
                    n for n in names if Path(folder) / n in sidecars
                ],
            )
            # 副本独立接受后续修改；旧窗口不能凭原数据库编号写入副本。
            with closing(sqlite3.connect(staged / "app.sqlite3")) as db, db:
                db.execute(
                    "UPDATE metadata SET value=? WHERE id='storeId'", (str(uuid4()),)
                )
            if target.exists():
                target.rmdir()  # 目录在复制期间被写入时拒绝覆盖。
            staged.rename(target)
        return target

    def failed(self, error):
        logging.getLogger(__name__).warning("Data directory change failed: %s", error)
        detail = (
            str(error)
            if isinstance(error, UserDataError)
            else "请检查目录权限、磁盘空间及目标目录内容。"
        )
        self.write(self.current, error=f"切换失败，仍使用原目录。{detail}")
