"""本机用户记录接口；所有写入沿用本机来源与客户端标识检查。"""

from typing import Literal

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from pydantic import Field

from .models import RequestModel
from .user_data import UserDataError

router = APIRouter(prefix="/local-api/v1/user")


class StateWrite(RequestModel):
    value: dict
    expectedRevision: int = Field(ge=0)
    expectedStoreId: str | None = None


class PackageRecord(RequestModel):
    manifest: dict
    archive: str = Field(max_length=14 * 1024 * 1024)
    installedAt: float | int = Field(ge=0)


class ContentWrite(PackageRecord):
    expectedVersion: str | None


class MigrationPayload(RequestModel):
    legacyState: dict | None
    value: dict | None
    versions: list[PackageRecord] = Field(max_length=200)
    heads: list[dict] = Field(max_length=200)


class MigrationWrite(RequestModel):
    sourceId: str
    payload: MigrationPayload
    expectedRevision: int = Field(ge=0)
    decision: Literal["keep", "replace"] | None = None


@router.get("/state")
def state(request: Request):
    return request.app.state.user.state()


@router.put("/state")
def save(body: StateWrite, request: Request):
    if (
        body.expectedStoreId is not None
        and body.expectedStoreId != request.app.state.user.store_id
    ):
        raise UserDataError(
            "本机数据目录已变化，请重新读取。", "revision_conflict", 409
        )
    return request.app.state.user.save(body.value, body.expectedRevision)


@router.post("/migrate")
def migrate(body: MigrationWrite, request: Request):
    return request.app.state.user.migrate(body.model_dump())


@router.get("/content")
def content(request: Request):
    return request.app.state.user.content()


@router.put("/content")
def install(body: ContentWrite, request: Request):
    request.app.state.user.install(body.model_dump(), body.expectedVersion)
    return {"status": "saved"}


@router.get("/content/{course}/{version}")
def archive(course: str, version: str, request: Request):
    store = request.app.state.user
    with store.lock:
        if not store.db.execute(
            "SELECT 1 FROM versions WHERE course=? AND version=?", (course, version)
        ).fetchone():
            raise UserDataError("没有找到这份课程内容。", "content_missing", 404)
        path = store.package_path(course, version)
        if not path.is_file():
            raise UserDataError(
                "课程文件缺失，请恢复文件或重新下载。", "content_missing", 404
            )
        return FileResponse(path, media_type="application/zip")
