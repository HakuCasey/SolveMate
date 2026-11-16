"""本机资料接口沿用本机浏览器访问限制，不经过社区内容服务。"""

import asyncio

from fastapi import APIRouter, Request, Response
from fastapi.responses import FileResponse
from pydantic import Field

from .models import MaterialCourseChange, MaterialDelete, MaterialRename, RequestModel

router = APIRouter(prefix="/local-api/v1/materials", tags=["materials"])


@router.get("")
async def list_materials(request: Request, response: Response):
    materials = request.app.state.materials
    items = materials.list()
    response.headers["X-SolveMate-Material-Errors"] = str(materials.read_errors)
    return items


@router.post(
    "",
    status_code=202,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {
                "application/octet-stream": {
                    "schema": {"type": "string", "format": "binary"}
                }
            },
        }
    },
)
async def import_material(request: Request, filename: str, courseId: str | None = None):
    return await request.app.state.materials.import_file(request, filename, courseId)


@router.post("/{ident}/retry", status_code=202)
async def retry_material(ident: str, request: Request):
    return request.app.state.materials.retry(ident)


@router.patch("/{ident}/subject")
async def assign_course(ident: str, body: MaterialCourseChange, request: Request):
    return request.app.state.materials.assign_course(
        ident, body.subjectId, body.expectedRevision
    )


@router.patch("/{ident}/title")
async def rename_material(ident: str, body: MaterialRename, request: Request):
    return request.app.state.materials.rename(ident, body.title, body.expectedRevision)


@router.delete("/{ident}")
async def delete_material(ident: str, body: MaterialDelete, request: Request):
    return request.app.state.materials.delete(ident, body.expectedRevision)


class VersionSelection(RequestModel):
    version: str
    expectedRevision: int = Field(ge=1)


@router.post("/{ident}/version")
def select_version(ident: str, body: VersionSelection, request: Request):
    return request.app.state.materials.activate(
        ident, body.version, body.expectedRevision
    )


@router.get("/{ident}/{version}/metadata")
def version_metadata(ident: str, version: str, request: Request):
    return request.app.state.materials.get(ident, version)


@router.get("/{ident}/{version}/questions")
def questions(ident: str, version: str, request: Request):
    return request.app.state.materials.questions(ident, version)


@router.get("/{ident}/{version}/reader")
async def reader(ident: str, version: str, request: Request):
    _, path = request.app.state.materials.reader_path(ident, version)
    return FileResponse(
        path, media_type="application/pdf", headers={"Cache-Control": "no-store"}
    )


@router.get("/{ident}/{version}/pages/{page_number}")
async def page(ident: str, version: str, page_number: int, request: Request):
    return await asyncio.to_thread(
        request.app.state.materials.page, ident, version, page_number
    )
