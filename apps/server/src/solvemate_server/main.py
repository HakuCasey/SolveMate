"""官方内容的只读 HTTP API。"""

import hashlib
import logging
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, Path, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel

from .config import Settings
from .models import (
    CatalogEntry,
    CatalogResponse,
    CourseSummary,
    ReleaseManifest,
    UpdateResponse,
    VersionsResponse,
)
from .repository import ContentNotFound, ContentRepository, RepositoryError, json_bytes

logger = logging.getLogger(__name__)
CoursePath = Annotated[str, Path(pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$")]
VersionPath = Annotated[str, Path(pattern=r"^(latest|[a-f0-9]{64})$")]


def matches_etag(request: Request, etag: str) -> bool:
    return any(
        value.strip().removeprefix("W/") in (etag, "*")
        for value in request.headers.get("if-none-match", "").split(",")
    )


def cached_json(
    request: Request, value: BaseModel, immutable: bool = False
) -> Response:
    body = json_bytes(value)
    headers = {
        "ETag": f'"{hashlib.sha256(body).hexdigest()}"',
        "Cache-Control": "public, max-age=31536000, immutable"
        if immutable
        else "no-cache",
    }
    if matches_etag(request, headers["ETag"]):
        return Response(status_code=304, headers=headers)
    return Response(body, media_type="application/json", headers=headers)


def summary(entry: CatalogEntry) -> CourseSummary:
    return CourseSummary(
        **entry.course.model_dump(),
        latest_version=entry.latest_version,
        manifest_url=f"/api/v1/courses/{entry.course.id}/versions/{entry.latest_version}",
        download_url=f"/api/v1/courses/{entry.course.id}/versions/{entry.latest_version}/download",
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or Settings.from_env()
    repository = ContentRepository(settings.content_dir)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        try:
            catalog = repository.validate()
        except RepositoryError as error:
            logger.error("Content startup validation failed: %s", type(error).__name__)
            raise RuntimeError(
                "Publish content with solvemate-publish before starting the API."
            ) from error
        logger.info("Content service started: courses=%d", len(catalog.courses))
        yield

    app = FastAPI(title="SolveMate Content API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.cors_origins),
        allow_credentials=False,
        allow_methods=["GET", "HEAD"],
        allow_headers=["If-None-Match", "Range", "If-Range"],
        expose_headers=[
            "ETag",
            "Content-Length",
            "Content-Range",
            "Accept-Ranges",
            "Content-Disposition",
            "X-Content-SHA256",
        ],
    )

    @app.exception_handler(ContentNotFound)
    async def not_found(request: Request, error: ContentNotFound):
        return JSONResponse(
            status_code=404,
            content={"detail": str(error)},
            headers={"Cache-Control": "no-store"},
        )

    @app.exception_handler(RepositoryError)
    async def unavailable(request: Request, error: RepositoryError):
        logger.error("Published content is unavailable: %s", type(error).__name__)
        return JSONResponse(
            status_code=503,
            content={"detail": "Published content is temporarily unavailable."},
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/healthz")
    def health():
        repository.validate()
        return {"status": "ok"}

    @app.get("/api/v1/courses", response_model=CatalogResponse)
    def courses(request: Request):
        catalog = repository.catalog()
        return cached_json(
            request,
            CatalogResponse(courses=[summary(entry) for entry in catalog.courses]),
        )

    @app.get("/api/v1/courses/{course_id}", response_model=CourseSummary)
    def course(course_id: CoursePath, request: Request):
        entry = repository.course(repository.catalog(), course_id)
        return cached_json(request, summary(entry))

    @app.get("/api/v1/courses/{course_id}/versions", response_model=VersionsResponse)
    def versions(course_id: CoursePath, request: Request):
        entry = repository.course(repository.catalog(), course_id)
        ordered_versions = [entry.latest_version] + [
            version
            for version in reversed(entry.versions)
            if version != entry.latest_version
        ]
        releases = [
            repository.release(entry, version)[0] for version in ordered_versions
        ]
        return cached_json(
            request,
            VersionsResponse(
                course_id=course_id,
                latest_version=entry.latest_version,
                versions=releases,
            ),
        )

    @app.get("/api/v1/courses/{course_id}/updates", response_model=UpdateResponse)
    def updates(
        course_id: CoursePath,
        request: Request,
        current_version: Annotated[
            str | None, Query(min_length=1, max_length=128)
        ] = None,
    ):
        entry = repository.course(repository.catalog(), course_id)
        latest, _ = repository.release(entry, entry.latest_version)
        if current_version is None:
            status = "not_installed"
        elif current_version == entry.latest_version:
            status = "up_to_date"
        elif current_version in entry.versions:
            status = "update_available"
        else:
            # 哈希版本没有大小关系，未知版本不能被判断成旧版并自动覆盖。
            status = "unknown_version"
        return cached_json(
            request,
            UpdateResponse(
                course_id=course_id,
                current_version=current_version,
                status=status,
                update_available=status in ("not_installed", "update_available"),
                latest=latest,
            ),
        )

    @app.get(
        "/api/v1/courses/{course_id}/versions/{version}", response_model=ReleaseManifest
    )
    def manifest(course_id: CoursePath, version: VersionPath, request: Request):
        entry = repository.course(repository.catalog(), course_id)
        release, _ = repository.release(
            entry, entry.latest_version if version == "latest" else version
        )
        return cached_json(request, release, immutable=version != "latest")

    @app.head(
        "/api/v1/courses/{course_id}/versions/{version}/download",
        include_in_schema=False,
    )
    @app.get(
        "/api/v1/courses/{course_id}/versions/{version}/download",
        response_class=FileResponse,
        responses={
            200: {
                "content": {
                    "application/zip": {
                        "schema": {"type": "string", "format": "binary"}
                    }
                }
            }
        },
    )
    def download(course_id: CoursePath, version: VersionPath, request: Request):
        entry = repository.course(repository.catalog(), course_id)
        release, archive = repository.release(
            entry, entry.latest_version if version == "latest" else version
        )
        headers = {
            "ETag": f'"{release.sha256}"',
            "X-Content-SHA256": release.sha256,
            "Cache-Control": "no-cache"
            if version == "latest"
            else "public, max-age=31536000, immutable",
        }
        if matches_etag(request, headers["ETag"]):
            return Response(status_code=304, headers=headers)
        return FileResponse(
            archive,
            media_type="application/zip",
            filename=f"{course_id}-{release.version}.zip",
            headers=headers,
        )

    return app
