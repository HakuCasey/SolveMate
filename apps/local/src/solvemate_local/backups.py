"""完整备份只管理本应用的数据；原生 Harness 存储仍由对应软件管理。"""

import asyncio
import hashlib
import json
import logging
import os
import re
import shutil
import sqlite3
import stat
import tempfile
from contextlib import asynccontextmanager, closing
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from uuid import UUID, uuid4
from zipfile import ZIP_DEFLATED, BadZipFile, ZipFile

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field

from .file_exports import save_download_file, validate_filename
from .metadata import validate_metadata
from .note_metadata import migrate_note_metadata
from .user_data import UserDataError, validate_data

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/local-api/v1/user/backups")
MAX_ARCHIVE = 4 * 1024**3
MAX_EXPANDED = 8 * 1024**3
MAX_FILES = 200000


def invalid(message="备份文件无效或已损坏，请重新选择完整的 ZIP 备份。"):
    return UserDataError(message, "backup_invalid", 422)


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def remove(path):
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)


async def file_io(function, *args):
    # 取消请求时等待文件线程退出，再清理临时目录，避免线程继续写入已回退的数据。
    task = asyncio.create_task(asyncio.to_thread(function, *args))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        try:
            await task
        except Exception:
            logger.exception(
                "Backup file operation failed while the request was cancelled."
            )
        raise


class Maintenance:
    """维护时阻止新请求，并等待读写中的请求退出；正常请求不互相排队。"""

    def __init__(self):
        self.active = 0
        self.busy = False
        self.idle = asyncio.Event()
        self.idle.set()

    @asynccontextmanager
    async def exclusive(self):
        if self.busy:
            raise UserDataError(
                "正在备份或恢复数据，请稍后重试。", "data_maintenance", 409
            )
        self.busy = True
        try:
            try:
                await asyncio.wait_for(self.idle.wait(), 10)
            except TimeoutError as error:
                raise UserDataError(
                    "其他数据操作尚未结束，请稍后重试。", "data_busy", 409
                ) from error
            yield
        finally:
            self.busy = False


class MaintenanceMiddleware:
    def __init__(self, app, maintenance):
        self.app, self.maintenance = app, maintenance

    async def __call__(self, scope, receive, send):
        gate = self.maintenance
        if scope["type"] != "http" or scope["path"].startswith(
            ("/healthz", "/local-api/v1/user/backups")
        ):
            return await self.app(scope, receive, send)
        if gate.busy:
            return await JSONResponse(
                {
                    "detail": "正在备份或恢复数据，请稍后重试，未保存输入仍保留。",
                    "code": "data_maintenance",
                },
                status_code=503,
            )(scope, receive, send)
        gate.active += 1
        gate.idle.clear()
        try:
            await self.app(scope, receive, send)
        finally:
            gate.active -= 1
            if not gate.active:
                gate.idle.set()


class Backups:
    def __init__(self, root, ai_directory, uploads):
        self.root = Path(root)
        self.directory = self.root / "backups"
        self.directory.mkdir(parents=True, exist_ok=True)
        self.paths = {
            "app.sqlite3": self.root / "app.sqlite3",
            "ai/state.sqlite3": Path(ai_directory) / "state.sqlite3",
            "ai/workspace": Path(ai_directory) / "workspace",
            "uploads": Path(uploads),
            "community": self.root / "community",
        }
        # 目标必须彼此独立，防止错误的目录配置让替换覆盖另一个存储。
        targets = [p.resolve() for p in self.paths.values()]
        if len(set(targets)) != len(targets) or any(
            a in b.parents for a in targets for b in targets if a != b
        ):
            raise ValueError("Backup storage paths must not overlap.")
        self.journal = self.directory / "restore.json"
        self.tokens = {}
        self.working = set()
        self.recover()
        self.temporary = tempfile.TemporaryDirectory(
            prefix=".backup-", dir=self.directory
        )
        self.stage = Path(self.temporary.name)

    def close(self):
        self.temporary.cleanup()

    def new_token(self):
        # 淘汰较早的待确认文件，不删除正在读取或写入的文件。
        while len(self.tokens) >= 4:
            oldest = next((key for key in self.tokens if key not in self.working), None)
            if oldest is None:
                raise UserDataError(
                    "备份操作正在进行，请完成后重试。", "backup_busy", 409
                )
            self.discard(oldest)
        token = str(uuid4())
        folder = self.stage / token
        folder.mkdir()
        self.tokens[token] = folder
        self.working.add(token)
        return token, folder

    def token(self, ident):
        if ident not in self.tokens:
            raise UserDataError("该备份已失效，请重新选择文件。", "backup_expired", 410)
        return self.tokens[ident]

    def discard(self, ident):
        self.working.discard(ident)
        folder = self.tokens.pop(ident, None)
        if folder:
            remove(folder)

    def assert_idle(self, app):
        ai, materials = app.state.ai, app.state.materials
        if (
            ai.jobs
            or ai.configuring
            or ai.renaming
            or ai.disconnecting
            or ai.connections.probe_tasks
        ):
            raise UserDataError(
                "AI 正在处理请求，请等待结束后再备份或恢复。", "data_busy", 409
            )
        if materials.tasks or app.state.pdf_export_lock.locked():
            raise UserDataError(
                "资料或导出文件正在处理，请完成后再备份或恢复。", "data_busy", 409
            )

    async def snapshot(self, app, folder):
        for name, source in self.paths.items():
            target = folder / name
            if name.endswith(".sqlite3"):
                target.parent.mkdir(parents=True, exist_ok=True)
                database = (
                    app.state.user.db
                    if name == "app.sqlite3"
                    else app.state.ai.store.db
                )
                with closing(sqlite3.connect(target)) as copy:
                    database.backup(copy)
            elif source.exists():
                # 不跟随用户目录里的链接，避免把目录外的文件收入备份。
                for path in [source, *source.rglob("*")]:
                    if path.is_symlink() or not (path.is_dir() or path.is_file()):
                        raise invalid(
                            "数据目录包含符号链接，请移走链接后再备份；原数据未改动。"
                        )
                await file_io(shutil.copytree, source, target)
            else:
                target.mkdir(parents=True)

    def archive(self, folder, target):
        files = sorted(p for p in folder.rglob("*") if p.is_file())
        if (
            len(files) > MAX_FILES
            or sum(p.stat().st_size for p in files) > MAX_EXPANDED
        ):
            raise invalid("备份超过 8 GiB 或文件数量过多，请先整理数据。")
        manifest = {
            "format": "solvemate-backup",
            "version": 1,
            "createdAt": datetime.now(UTC).isoformat(),
            "files": {
                p.relative_to(folder).as_posix(): {
                    "size": p.stat().st_size,
                    "sha256": digest(p),
                }
                for p in files
            },
        }
        try:
            with ZipFile(target, "w", ZIP_DEFLATED, compresslevel=3) as archive:
                archive.writestr(
                    "manifest.json", json.dumps(manifest, ensure_ascii=False)
                )
                for path in files:
                    archive.write(path, path.relative_to(folder).as_posix())
            if target.stat().st_size > MAX_ARCHIVE:
                raise invalid("压缩后的备份超过 4 GiB，请先整理数据。")
        except BaseException:
            target.unlink(missing_ok=True)
            raise
        return manifest

    async def create(self, app, target, folder):
        async with app.state.maintenance.exclusive():
            self.assert_idle(app)
            await self.snapshot(app, folder)
            return await file_io(self.archive, folder, target)

    def unpack(self, archive_path, folder):
        try:
            with ZipFile(archive_path) as archive:
                entries = archive.infolist()
                names = [p.filename for p in entries]
                if (
                    len(names) > MAX_FILES + 1
                    or len(set(names)) != len(names)
                    or "manifest.json" not in names
                ):
                    raise invalid()
                if archive.getinfo("manifest.json").file_size > 32 * 1024**2:
                    raise invalid()
                manifest = json.loads(archive.read("manifest.json"))
                if (
                    not isinstance(manifest, dict)
                    or manifest.get("format") != "solvemate-backup"
                    or type(manifest.get("version")) is not int
                    or manifest.get("version") != 1
                ):
                    raise invalid("当前版本不支持该备份格式，请使用对应版本恢复。")
                if not isinstance(manifest.get("createdAt"), str):
                    raise invalid()
                datetime.fromisoformat(manifest["createdAt"])
                files = manifest.get("files")
                if not isinstance(files, dict) or set(files) != set(names) - {
                    "manifest.json"
                }:
                    raise invalid()
                if len({name.casefold() for name in names}) != len(names):
                    raise invalid()
                if not {"app.sqlite3", "ai/state.sqlite3"} <= set(files):
                    raise invalid()
                if sum(e.file_size for e in entries) > MAX_EXPANDED:
                    raise invalid("解压后的备份超过 8 GiB，无法恢复。")
                for entry in entries:
                    name = entry.filename
                    if name == "manifest.json":
                        continue
                    path = PurePosixPath(name)
                    if (
                        str(path) != name
                        or path.is_absolute()
                        or ".." in path.parts
                        or "\\" in name
                        or ":" in name
                        or any(part.endswith((".", " ")) for part in path.parts)
                        or any(
                            re.search(r'[<>"|?*\x00-\x1f]', part)
                            or re.fullmatch(
                                r"(?i)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?",
                                part,
                            )
                            for part in path.parts
                        )
                        or stat.S_ISLNK(entry.external_attr >> 16)
                        or not any(
                            name == key
                            if key.endswith(".sqlite3")
                            else name.startswith(key + "/")
                            for key in self.paths
                        )
                    ):
                        raise invalid()
                    metadata = files[name]
                    if (
                        not isinstance(metadata, dict)
                        or metadata.get("size") != entry.file_size
                    ):
                        raise invalid()
                    target = folder / name
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(entry) as source, target.open("xb") as output:
                        shutil.copyfileobj(source, output, 1024 * 1024)
                    if digest(target) != metadata.get("sha256"):
                        raise invalid()
                for key in self.paths:
                    if not key.endswith(".sqlite3"):
                        (folder / key).mkdir(parents=True, exist_ok=True)
            self.validate_databases(folder)
            for path in (folder / "uploads").glob("*/record.json"):
                value = json.loads(path.read_text(encoding="utf-8"))
                validate_metadata("Material", value)
                if value["id"] != path.parent.name:
                    raise invalid()
            return {
                "createdAt": manifest["createdAt"],
                "files": len(files),
                "bytes": sum(f["size"] for f in files.values()),
            }
        except (
            BadZipFile,
            ValueError,
            KeyError,
            TypeError,
            sqlite3.Error,
            RuntimeError,
        ) as error:
            raise invalid() from error

    def validate_databases(self, folder):
        for name, version in [("app.sqlite3", 1), ("ai/state.sqlite3", 4)]:
            with closing(
                sqlite3.connect(
                    (folder / name).resolve().as_uri() + "?mode=ro", uri=True
                )
            ) as db:
                if (
                    db.execute("PRAGMA quick_check").fetchone()[0] != "ok"
                    or db.execute("PRAGMA user_version").fetchone()[0] != version
                ):
                    raise invalid("备份数据库损坏或版本不受支持，请选择其他备份。")
                if name == "app.sqlite3":
                    row = db.execute("SELECT value FROM state WHERE id=1").fetchone()
                    if row:
                        validate_data(migrate_note_metadata(json.loads(row[0])))
                else:
                    # 检查全部 JSON，避免恢复后才发现配置或执行记录无法读取。
                    for table in ("config", "connections", "turns"):
                        for ident, raw in db.execute(f"SELECT id,value FROM {table}"):
                            value = json.loads(raw)
                            if not isinstance(value, dict):
                                raise invalid()
                            if table == "connections":
                                validate_metadata(
                                    "AiConnection", {"id": ident, **value}
                                )

    def write_journal(self, data):
        temporary = self.journal.with_suffix(".tmp")
        with temporary.open("w", encoding="utf-8") as stream:
            json.dump(data, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, self.journal)

    def siblings(self, key, ident):
        target = self.paths[key]
        return target.with_name(f".{target.name}.{ident}.new"), target.with_name(
            f".{target.name}.{ident}.old"
        )

    def recover(self):
        if not self.journal.exists():
            return
        record = json.loads(self.journal.read_text(encoding="utf-8"))
        ident = str(UUID(record["id"]))
        if set(record["existed"]) != set(self.paths) or record["phase"] not in {
            "preparing",
            "applying",
            "complete",
        }:
            raise ValueError("Invalid restore journal; data was retained.")
        for key, target in self.paths.items():
            new, old = self.siblings(key, ident)
            if record["phase"] == "applying":
                if old.exists():
                    remove(target)
                    self.remove_sidecars(target)
                    os.replace(old, target)
                elif not record["existed"][key]:
                    remove(target)
                    self.remove_sidecars(target)
            remove(new)
            remove(old)
        self.journal.unlink()
        logger.info("Recovered local data restore: phase=%s", record["phase"])

    @staticmethod
    def remove_sidecars(path):
        if path.suffix == ".sqlite3":
            for suffix in ("-wal", "-shm", "-journal"):
                Path(str(path) + suffix).unlink(missing_ok=True)

    def prepare_revisions(self, app, folder):
        # 存储身份表示当前目录；替换内容提高版本，阻止其他窗口覆盖恢复结果。
        try:
            current_state = app.state.user.state()
        except UserDataError:
            # 原 JSON 无法读取时仍可从有效备份恢复；替换前的完整备份由现有流程保存。
            row = app.state.user.db.execute(
                "SELECT revision FROM state WHERE id=1"
            ).fetchone()
            current_state = {"value": None, "revision": row[0] if row else 0}
        with closing(sqlite3.connect(folder / "app.sqlite3")) as db, db:
            row = db.execute("SELECT value FROM state WHERE id=1").fetchone()
            if row:
                value = migrate_note_metadata(json.loads(row[0]))
                if current_state["value"] and current_state["value"].get("drafts"):
                    value["drafts"] = {
                        **value.get("drafts", {}),
                        **current_state["value"]["drafts"],
                    }
                validate_data(value)
                db.execute(
                    "UPDATE state SET value=? WHERE id=1",
                    (json.dumps(value, ensure_ascii=False),),
                )
            db.execute(
                "UPDATE metadata SET value=? WHERE id='storeId'",
                (app.state.user.store_id,),
            )
            db.execute(
                "UPDATE state SET revision=MAX(revision,?)+1",
                (current_state["revision"],),
            )
        current = app.state.ai.store
        with closing(sqlite3.connect(folder / "ai/state.sqlite3")) as db, db:
            revisions = [v["revision"] for v in current.connections().values()]
            revisions.append(current.preferences()["revision"])
            base = max(revisions, default=0)
            for table in ("config", "connections"):
                for ident, raw in db.execute(
                    f"SELECT id,value FROM {table}"
                ).fetchall():
                    value = json.loads(raw)
                    value["revision"] = max(value.get("revision", 0), base) + 1
                    db.execute(
                        f"UPDATE {table} SET value=? WHERE id=?",
                        (json.dumps(value), ident),
                    )
            db.execute("DELETE FROM probes")
        records = {r["id"]: r["revision"] for r in app.state.materials.list()}
        for path in (folder / "uploads").glob("*/record.json"):
            value = json.loads(path.read_text(encoding="utf-8"))
            value["revision"] = max(value["revision"], records.get(value["id"], 0)) + 1
            path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")

    async def restore(self, app, token):
        folder = self.token(token) / "data"
        async with app.state.maintenance.exclusive():
            self.assert_idle(app)
            # 自动备份与待恢复文件分别保存；恢复失败时仍能手动使用这份备份。
            with tempfile.TemporaryDirectory(dir=self.stage) as temporary:
                safety = (
                    self.directory
                    / f"before-restore-{datetime.now().strftime('%Y%m%d-%H%M%S')}-{uuid4().hex[:8]}.zip"
                )
                await self.snapshot(app, Path(temporary))
                await file_io(self.archive, Path(temporary), safety)
            self.prepare_revisions(app, folder)
            ident = str(uuid4())
            record = {
                "id": ident,
                "phase": "preparing",
                "existed": {key: path.exists() for key, path in self.paths.items()},
            }
            self.write_journal(record)
            try:
                for key, target in self.paths.items():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    new, _ = self.siblings(key, ident)
                    source = folder / key
                    if source.is_dir():
                        await file_io(shutil.copytree, source, new)
                    else:
                        await file_io(shutil.copy2, source, new)
                await app.state.close_resources()
                record["phase"] = "applying"
                self.write_journal(record)
                for key, target in self.paths.items():
                    new, old = self.siblings(key, ident)
                    self.remove_sidecars(target)
                    if target.exists():
                        os.replace(target, old)
                    os.replace(new, target)
                app.state.open_resources()
                record["phase"] = "complete"
                self.write_journal(record)
            except BaseException:
                logger.exception(
                    "Local data restore failed; rolling back original data."
                )
                await app.state.close_resources()
                if self.journal.exists():
                    self.recover()
                else:
                    for key in self.paths:
                        remove(self.siblings(key, ident)[0])
                app.state.open_resources()
                raise
            self.recover()
            self.discard(token)
            return {"status": "restored", "safetyBackup": safety.name}


class BackupDownload(FileResponse):
    def __init__(self, path, cleanup):
        super().__init__(path, media_type="application/zip")
        self.cleanup = cleanup

    async def __call__(self, scope, receive, send):
        try:
            await super().__call__(scope, receive, send)
        finally:
            # 下载中断也释放临时文件；不依赖正常响应结束后才执行的后台任务。
            self.cleanup()


class ExportRequest(BaseModel):
    filename: str = Field(max_length=180)
    saveToDownloads: bool = True


@router.post("/export")
async def export_backup(body: ExportRequest, request: Request):
    validate_filename(body.filename, {".zip"})
    manager = request.app.state.backups
    token, folder = manager.new_token()
    try:
        await manager.create(request.app, folder / "backup.zip", folder / "data")
        if body.saveToDownloads:
            receipt = await file_io(
                save_download_file, body.filename, folder / "backup.zip"
            )
            manager.discard(token)
            return receipt
        return {"token": token}
    except BaseException:
        manager.discard(token)
        raise
    finally:
        manager.working.discard(token)


@router.get("/{token}/download")
async def download_backup(token: str, request: Request):
    manager = request.app.state.backups
    path = manager.token(token) / "backup.zip"
    if not path.is_file():
        raise invalid()
    if token in manager.working:
        raise UserDataError("备份文件正在使用，请稍后重试。", "backup_busy", 409)
    manager.working.add(token)
    return BackupDownload(path, lambda: manager.discard(token))


@router.post("/inspect")
async def inspect_backup(request: Request):
    manager = request.app.state.backups
    token, folder = manager.new_token()
    try:
        size = 0
        archive = folder / "backup.zip"
        with archive.open("xb") as output:
            async for chunk in request.stream():
                size += len(chunk)
                if size > MAX_ARCHIVE:
                    raise UserDataError(
                        "备份文件超过 4 GiB，无法恢复。", "backup_too_large", 413
                    )
                output.write(chunk)
        summary = await file_io(manager.unpack, archive, folder / "data")
        return {"token": token, **summary}
    except BaseException:
        manager.discard(token)
        raise
    finally:
        manager.working.discard(token)


@router.post("/{token}/restore")
async def restore_backup(token: str, request: Request):
    manager = request.app.state.backups
    if not (manager.token(token) / "data/app.sqlite3").is_file():
        raise invalid()
    if token in manager.working:
        raise UserDataError("备份文件正在使用，请稍后重试。", "backup_busy", 409)
    manager.working.add(token)
    try:
        return await manager.restore(request.app, token)
    finally:
        manager.working.discard(token)


@router.delete("/{token}")
async def discard_backup(token: str, request: Request):
    manager = request.app.state.backups
    if token in manager.working:
        raise UserDataError("备份文件正在使用，请稍后重试。", "backup_busy", 409)
    manager.discard(token)
    return {"status": "discarded"}
