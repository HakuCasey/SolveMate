"""用户原件、阅读文件与固定版本的存取；官方内容继续由内容服务管理。"""

import asyncio
import hashlib
import json
import logging
import os
import re
import shutil
import tempfile
import threading
import time
import uuid
import zipfile
from pathlib import Path

from pypdf import PdfReader
from pypdf import __version__ as pypdf_version

from .material_converter import MaterialError, convert_pptx
from .metadata import validate_metadata

log = logging.getLogger(__name__)
MAX_BYTES = 100 * 1024 * 1024
MEDIA_TYPES = {
    ".pdf": "application/pdf",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
}


def read_pdf(path):
    reader = PdfReader(path)
    if reader.is_encrypted:
        raise MaterialError(
            "此 PDF 已加密，请先解除密码保护后重新导入。", "pdf_encrypted"
        )
    count = len(reader.pages)
    if not count or count > 10000:
        raise MaterialError("PDF 页数为空或超过 10000 页，请拆分后重新导入。")
    return count


class Materials:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.tasks = {}
        self.runtime_errors = {}
        self.processing_slots = asyncio.Semaphore(2)
        # 服务退出时未完成的转换不能一直显示为处理中，也不能自动重复提交。
        for record in self.list():
            if record["version"]["status"] == "processing":
                record["version"].update(
                    status="failed",
                    error="上次处理因服务停止而中断，原件已保留，请重试处理。",
                )
                self.save(record)

    def save(self, record):
        with self.lock:
            record["revision"] += 1
            record["updatedAt"] = int(time.time() * 1000)
            validate_metadata("Material", record)
            path = self.directory / record["id"] / "record.json"
            temporary = path.with_suffix(".tmp")
            temporary.write_text(
                json.dumps(record, ensure_ascii=False), encoding="utf-8"
            )
            os.replace(temporary, path)

    def list(self):
        records = []
        self.read_errors = 0
        with self.lock:
            for path in self.directory.glob("*/record.json"):
                try:
                    record = json.loads(path.read_text(encoding="utf-8"))
                    validate_metadata("Material", record)
                    if path.parent.name != record["id"]:
                        raise ValueError(
                            "Material identifier does not match its directory."
                        )
                    records.append(self.with_runtime_error(record))
                except (ValueError, OSError):
                    # 一份损坏的记录不能阻止其他资料打开，保留原文件供恢复。
                    self.read_errors += 1
                    log.warning(
                        "Failed to read material metadata: %s", path.parent.name
                    )
        return sorted(records, key=lambda item: item["createdAt"], reverse=True)

    def get(self, ident):
        if not re.fullmatch(r"[a-f0-9-]{36}", ident):
            raise MaterialError("资料编号无效。", status=404)
        try:
            record = json.loads(
                (self.directory / ident / "record.json").read_text(encoding="utf-8")
            )
            validate_metadata("Material", record)
        except (OSError, ValueError) as error:
            raise MaterialError(
                "没有找到资料记录，请重新打开资料列表。", status=404
            ) from error
        if record["id"] != ident:
            raise MaterialError("资料记录与编号不一致，原文件未改动。", status=409)
        return self.with_runtime_error(record)

    def with_runtime_error(self, record):
        error = self.runtime_errors.get(record["id"])
        if error:
            record["version"].update(status="failed", error=error)
        return record

    def folder(self, record):
        return self.directory / record["id"] / record["currentVersion"]

    async def import_file(self, request, filename, course_id=None):
        # 文件名仅作显示，磁盘路径只使用生成的编号与经校验的扩展名。
        filename = filename.replace("\\", "/").split("/")[-1].strip()
        suffix = Path(filename).suffix.lower()
        if suffix not in MEDIA_TYPES:
            raise MaterialError(
                "当前支持 PDF 和 PPTX 文件，请选择对应格式。", "format_unsupported"
            )
        if not filename or len(filename) > 240 or any(ord(c) < 32 for c in filename):
            raise MaterialError("文件名为空、过长或包含控制字符，请修改后重试。")
        if course_id and not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", course_id):
            raise MaterialError("课程编号无效，请重新选择课程。")
        descriptor, temporary = tempfile.mkstemp(prefix="upload-", dir=self.directory)
        digest = hashlib.sha256()
        size = 0
        try:
            with os.fdopen(descriptor, "wb") as stream:
                async for block in request.stream():
                    size += len(block)
                    if size > MAX_BYTES:
                        raise MaterialError(
                            "文件超过 100 MiB，请拆分或压缩后重新导入。",
                            "file_too_large",
                            413,
                        )
                    digest.update(block)
                    stream.write(block)
            if not size:
                raise MaterialError("文件为空，请重新选择。")
            version = digest.hexdigest()
            with self.lock:
                for existing in self.list():
                    if (
                        existing.get("deletedAt") is None
                        and existing["currentVersion"] == version
                        and existing["courseId"] == (course_id or None)
                    ):
                        existing_folder = self.folder(existing)
                        existing_folder.mkdir(parents=True, exist_ok=True)
                        original_path = (
                            existing_folder / existing["version"]["originalAssetId"]
                        )
                        if not original_path.is_file():
                            os.replace(temporary, original_path)
                        reader_name = existing["version"]["readerAssetId"]
                        if existing["version"]["status"] == "failed" or (
                            reader_name
                            and not (existing_folder / reader_name).is_file()
                        ):
                            existing["version"].update(status="processing", error=None)
                            self.save(existing)
                            self.start(existing["id"])
                        return existing
                ident = str(uuid.uuid4())
                folder = self.directory / ident / version
                folder.mkdir(parents=True)
                original = folder / ("original" + suffix)
                os.replace(temporary, original)
                now = int(time.time() * 1000)
                record = {
                    "id": ident,
                    "title": Path(filename).stem,
                    "courseId": course_id or None,
                    "source": "personal",
                    "currentVersion": version,
                    "revision": 0,
                    "createdAt": now,
                    "updatedAt": now,
                    "version": {
                        "contentVersion": version,
                        "mediaType": MEDIA_TYPES[suffix],
                        "originalAssetId": "original" + suffix,
                        "readerAssetId": None,
                        "filename": filename,
                        "sizeBytes": size,
                        "sha256": version,
                        "pageCount": None,
                        "status": "processing",
                        "error": None,
                        "processor": None,
                        "processorVersion": None,
                    },
                }
                self.save(record)
            self.start(ident)
            return record
        except OSError as error:
            raise MaterialError(
                "本机未能保存资料，请检查磁盘空间和目录权限后重试。",
                "material_save_failed",
                507,
            ) from error
        finally:
            Path(temporary).unlink(missing_ok=True)

    def start(self, ident):
        if ident in self.tasks:
            return
        self.runtime_errors.pop(ident, None)

        async def work():
            async with self.processing_slots:
                await self.process(ident)

        task = asyncio.create_task(work())
        self.tasks[ident] = task

        def complete(result):
            self.tasks.pop(ident, None)
            if not result.cancelled() and result.exception():
                self.runtime_errors[ident] = (
                    "处理结果未能保存，原件仍保留。请检查磁盘空间和目录权限后重试。"
                )
                log.error("Failed to persist material processing result: %s", ident)

        task.add_done_callback(complete)

    def assign_course(self, ident, course_id, revision):
        if course_id is not None and not re.fullmatch(
            r"[a-z0-9]+(?:-[a-z0-9]+)*", course_id
        ):
            raise MaterialError("科目编号无效，请重新选择。")
        with self.lock:
            record = self.editable(ident, revision)
            if record["courseId"] != course_id:
                record["courseId"] = course_id
                self.save(record)
            return record

    def editable(self, ident, revision):
        record = self.get(ident)
        if record.get("deletedAt") is not None:
            raise MaterialError("资料已删除，请重新读取列表。", "material_deleted", 409)
        if record["revision"] != revision:
            raise MaterialError(
                "资料已更新，请重新读取列表后重试。", "material_conflict", 409
            )
        return record

    def rename(self, ident, title, revision):
        title = title.strip()
        if not title or len(title) > 240 or any(ord(char) < 32 for char in title):
            raise MaterialError("资料名称应为 1–240 个字符，不能包含控制字符。")
        with self.lock:
            record = self.editable(ident, revision)
            if record["title"] != title:
                record["title"] = title
                self.save(record)
            return record

    def delete(self, ident, revision):
        with self.lock:
            record = self.editable(ident, revision)
            # 只删除目录条目；稳定编号、原件和阅读文件供历史对话继续使用。
            record["deletedAt"] = int(time.time() * 1000)
            self.save(record)
            return record

    def save_processing(self, record):
        # 只提交处理结果，保留处理期间发生的改名、移动和删除。
        with self.lock:
            latest = self.get(record["id"])
            latest["version"] = record["version"]
            self.save(latest)

    async def process(self, ident):
        record = self.get(ident)
        folder = self.folder(record)
        temporary = Path(tempfile.mkdtemp(prefix="processing-", dir=folder))
        original = folder / record["version"]["originalAssetId"]
        try:
            if not original.is_file():
                raise MaterialError(
                    "找不到已保存的原件，请重新导入文件。", "original_missing"
                )
            if original.suffix == ".pptx":
                # 限制解压规模，避免损坏或异常 ZIP 交给办公转换程序。
                with zipfile.ZipFile(original) as archive:
                    if "ppt/presentation.xml" not in archive.namelist():
                        raise MaterialError(
                            "文件不是有效的 PPTX 课件，请检查后重新导入。"
                        )
                    if (
                        len(archive.infolist()) > 20000
                        or sum(i.file_size for i in archive.infolist()) > 1024**3
                    ):
                        raise MaterialError("课件解压后的内容过大，请拆分后重新导入。")
                reader_file = await convert_pptx(original, temporary)
                processor = "libreoffice+pypdf"
            else:
                reader_file = original
                processor = "pypdf"
            count = await asyncio.to_thread(read_pdf, reader_file)
            reader_name = "original.pdf"
            if original.suffix == ".pptx":
                reader_name = "reader.pdf"
                os.replace(reader_file, folder / reader_name)
            record["version"].update(
                readerAssetId=reader_name,
                pageCount=count,
                status="ready",
                error=None,
                processor=processor,
                processorVersion=pypdf_version if original.suffix == ".pdf" else None,
            )
        except asyncio.CancelledError:
            record["version"].update(
                status="failed", error="处理已中断，原件已保留，请重试处理。"
            )
            self.save_processing(record)
            raise
        except Exception as error:  # noqa: BLE001 -- 后台处理失败必须保存状态和原件。
            log.warning(
                "Material processing failed for %s: %s", ident, type(error).__name__
            )
            message = (
                str(error)
                if isinstance(error, MaterialError)
                else "无法读取此文件，原件已保留。请检查文件是否损坏，或导出为 PDF 后重新导入。"
            )
            record["version"].update(status="failed", error=message)
        finally:
            shutil.rmtree(temporary, ignore_errors=True)
        self.save_processing(record)

    def retry(self, ident):
        record = self.get(ident)
        if ident in self.tasks or record["version"]["status"] == "ready":
            return record
        self.runtime_errors.pop(ident, None)
        record["version"].update(status="processing", error=None)
        self.save(record)
        self.start(ident)
        return record

    def reader_path(self, ident, version):
        record = self.get(ident)
        if record["currentVersion"] != version:
            raise MaterialError(
                "资料版本不存在，未替换为其他版本。", "material_version_missing", 404
            )
        name = record["version"]["readerAssetId"]
        if record["version"]["status"] != "ready" or not name:
            raise MaterialError(
                record["version"]["error"] or "资料仍在处理中，请稍后重试。"
            )
        path = self.folder(record) / name
        if not path.is_file():
            raise MaterialError(
                "阅读文件已丢失，原件和记录仍保留，请重新导入或恢复文件。",
                "reader_missing",
                404,
            )
        return record, path

    def page(self, ident, version, page_number):
        record, path = self.reader_path(ident, version)
        if page_number < 1 or page_number > record["version"]["pageCount"]:
            raise MaterialError("页码超出资料范围。", "page_out_of_range")
        cache = self.folder(record) / "text" / f"{page_number}.json"
        if cache.is_file():
            try:
                saved = json.loads(cache.read_text(encoding="utf-8"))
                if (
                    saved.get("materialId") == ident
                    and saved.get("contentVersion") == version
                    and saved.get("pageNumber") == page_number
                    and isinstance(saved.get("text"), str)
                ):
                    return saved
            except (OSError, ValueError, AttributeError):
                pass
            log.warning("Rebuilding invalid page cache for material %s", ident)
        try:
            reader = PdfReader(path)
            text = reader.pages[page_number - 1].extract_text(extraction_mode="layout")
            text = "\n".join(line.rstrip() for line in text.splitlines()).strip()
        except Exception as error:
            raise MaterialError(
                "无法提取本页文字，仍可查看原页，请尝试其他页面。",
                "text_extraction_failed",
            ) from error
        result = {
            "materialId": ident,
            "contentVersion": version,
            "pageNumber": page_number,
            "text": text,
        }
        try:
            cache.parent.mkdir(exist_ok=True)
            with self.lock:
                temporary = cache.with_suffix(".tmp")
                temporary.write_text(
                    json.dumps(result, ensure_ascii=False), encoding="utf-8"
                )
                os.replace(temporary, cache)
        except OSError:
            log.warning("Failed to cache extracted page for material %s", ident)
        return result

    def validate_reference(self, reference):
        location = reference.material
        if location:
            record = self.get(location["materialId"])
            if record["currentVersion"] != location["contentVersion"]:
                raise MaterialError(
                    "引用的资料版本不存在，请重新选择。", "material_version_missing"
                )
            if record["version"]["status"] != "ready":
                raise MaterialError("资料尚未处理完成，请稍后引用。")
            if location["pageNumber"] > record["version"]["pageCount"]:
                raise MaterialError("引用页码超出资料范围，请重新选择。")
            if not reference.content.strip():
                raise MaterialError("引用中没有可供 AI 读取的文字，请重新选择内容。")

    async def close(self):
        tasks = list(self.tasks.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
