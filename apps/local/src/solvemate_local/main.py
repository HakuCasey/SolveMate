import logging
import os
import sqlite3
from contextlib import asynccontextmanager
from copy import deepcopy
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from .acp import ConnectionError
from .material_converter import MaterialError
from .material_routes import router as material_router
from .materials import Materials
from .metadata import SCHEMA
from .models import (
    ConnectionConfig,
    ConnectionDelete,
    ConnectionState,
    DefaultConnection,
    DetectRequest,
    PermissionDecision,
    PreferenceChange,
    SessionRename,
    TurnRequest,
)
from .service import AiService
from .store import Store
from .user_data import UserData, UserDataError, migrate_uploads
from .user_routes import router as user_router

ROOT = Path(__file__).resolve().parents[4]


def create_app(
    directory=None,
    registry=None,
    allowed_origins=None,
    materials_directory=None,
    user_directory=None,
):
    configured_root = user_directory or os.environ.get("SOLVEMATE_USER_DIR")
    directory = Path(
        directory
        or os.environ.get(
            "SOLVEMATE_LOCAL_DATA", Path(configured_root or ROOT / "user") / "ai"
        )
    )
    origins = set(
        allowed_origins
        or os.environ.get(
            "SOLVEMATE_LOCAL_ORIGINS",
            "http://127.0.0.1:4173,http://localhost:4173,http://127.0.0.1:5173,http://localhost:5173",
        ).split(",")
    )

    @asynccontextmanager
    async def lifespan(app):
        store = Store(directory)
        app.state.ai = AiService(store, registry=registry)
        app.state.materials = None
        app.state.user = None
        try:
            user_root = Path(configured_root or directory.parent)
            app.state.user = UserData(user_root)
            uploads = materials_directory or os.environ.get("SOLVEMATE_MATERIALS_DIR")
            if not uploads:
                uploads = migrate_uploads(user_root)
            app.state.materials = Materials(
                uploads, subject_check=app.state.user.require_subject
            )
            yield
        finally:
            if app.state.materials is not None:
                await app.state.materials.close()
            await app.state.ai.close()
            store.close()
            if app.state.user is not None:
                app.state.user.close()

    app = FastAPI(title="SolveMate Local", lifespan=lifespan)

    app.include_router(material_router)
    app.include_router(user_router)

    @app.exception_handler(UserDataError)
    async def user_error(request, error):
        return JSONResponse(
            {"detail": str(error), "code": error.code}, status_code=error.status
        )

    async def storage_failure(request, error):
        logging.getLogger(__name__).error(
            "Local storage operation failed: %s", type(error).__name__
        )
        return JSONResponse(
            {
                "detail": "本机数据读写失败，请检查磁盘空间、目录权限或数据库占用后重试。原有记录和文件已保留。",
                "code": "local_storage_failed",
            },
            status_code=503,
        )

    app.add_exception_handler(OSError, storage_failure)
    app.add_exception_handler(sqlite3.Error, storage_failure)

    @app.exception_handler(MaterialError)
    async def material_error(request, error):
        return JSONResponse(
            {"detail": str(error), "code": error.code}, status_code=error.status
        )

    @app.middleware("http")
    async def local_browser_boundary(request: Request, call_next):
        # 同源代理保留网页 Origin；拒绝其他站点通过浏览器调用本机 AI。
        host = urlsplit("http://" + request.headers.get("host", "")).hostname
        if host not in {"127.0.0.1", "localhost", "testserver"}:
            return JSONResponse(
                {"detail": "不允许的本机服务地址。", "code": "host_denied"},
                status_code=403,
            )
        origin = request.headers.get("origin")
        if origin and origin not in origins:
            return JSONResponse(
                {"detail": "不允许该网页访问本机 AI 服务。", "code": "origin_denied"},
                status_code=403,
            )
        if request.method not in {"GET", "HEAD"}:
            if request.url.path.startswith("/local-api/v1/user/"):
                length = request.headers.get("content-length", "0")
                if not length.isdigit() or int(length) > 128 * 1024 * 1024:
                    return JSONResponse(
                        {
                            "detail": "单次保存或迁移超过 128 MiB，本次操作未执行，原有数据已保留。"
                        },
                        status_code=413,
                    )
            if (
                origin not in origins
                or request.headers.get("x-solvemate-client") != "web"
            ):
                return JSONResponse(
                    {"detail": "请求缺少本机网页访问凭据。", "code": "client_required"},
                    status_code=403,
                )
            upload = (
                request.method == "POST"
                and request.url.path == "/local-api/v1/materials"
            )
            expected_type = "application/octet-stream" if upload else "application/json"
            if request.headers.get("content-type", "").split(";")[0] != expected_type:
                return JSONResponse(
                    {"detail": "请求内容格式不符合接口要求。"}, status_code=415
                )
        elif (
            request.url.path != "/healthz"
            and request.headers.get("x-solvemate-client") != "web"
        ):
            return JSONResponse(
                {"detail": "请求缺少客户端标识。", "code": "client_required"},
                status_code=403,
            )
        return await call_next(request)

    @app.exception_handler(ConnectionError)
    async def connection_error(request, error):
        status = (
            409
            if error.code
            in {
                "connection_busy",
                "conversation_busy",
                "request_conflict",
                "configuration_conflict",
                "conversation_mismatch",
            }
            else 422
        )
        return JSONResponse(
            {"detail": str(error), "code": error.code}, status_code=status
        )

    @app.get("/healthz")
    async def health():
        return {"status": "ok", "service": "solvemate-local"}

    @app.get("/local-api/v1/settings")
    async def settings(request: Request):
        return request.app.state.ai.settings()

    @app.post("/local-api/v1/detect")
    async def detect(body: DetectRequest, request: Request):
        return await request.app.state.ai.probe(body)

    @app.put("/local-api/v1/settings")
    async def save_settings(body: ConnectionConfig, request: Request):
        return await request.app.state.ai.save_settings(body)

    @app.delete("/local-api/v1/settings")
    async def disable_settings(body: PreferenceChange, request: Request):
        return await request.app.state.ai.disable(body.expectedRevision)

    @app.patch("/local-api/v1/connections/{ident}")
    async def connection_state(ident: str, body: ConnectionState, request: Request):
        return await request.app.state.ai.set_connection_state(
            ident, body.enabled, body.expectedRevision
        )

    @app.put("/local-api/v1/default-connection")
    async def default_connection(body: DefaultConnection, request: Request):
        return await request.app.state.ai.set_default(
            body.connectionId, body.expectedRevision, body.modelId
        )

    @app.delete("/local-api/v1/connections/{ident}")
    async def delete_connection(ident: str, body: ConnectionDelete, request: Request):
        return await request.app.state.ai.delete_connection(
            ident, body.expectedRevision, body.expectedPreferencesRevision
        )

    @app.put("/local-api/v1/conversations/{ident}/native-title")
    async def rename_session(ident: str, body: SessionRename, request: Request):
        return await request.app.state.ai.rename_session(ident, body)

    @app.post("/local-api/v1/turns", status_code=202)
    async def start_turn(body: TurnRequest, request: Request):
        for reference in body.references or (
            [body.reference] if body.reference else []
        ):
            if reference.material:
                request.app.state.materials.validate_reference(reference)
        return request.app.state.ai.create_turn(body)

    @app.get("/local-api/v1/turns/{ident}")
    async def get_turn(ident: str, request: Request):
        turn = request.app.state.ai.store.turn(ident)
        if not turn:
            raise HTTPException(404, "没有找到这次提问。")
        return request.app.state.ai.public_turn(turn)

    @app.get("/local-api/v1/turns/{ident}/events")
    async def turn_events(ident: str, request: Request):
        service = request.app.state.ai
        if not service.store.turn(ident):
            raise HTTPException(404, "没有找到这次提问。")
        return StreamingResponse(
            service.stream(ident),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache, no-transform",
                "X-Accel-Buffering": "no",
            },
        )

    @app.get("/local-api/v1/conversations/{ident}/turns")
    async def get_conversation(ident: str, request: Request):
        return [
            request.app.state.ai.public_turn(turn)
            for turn in request.app.state.ai.store.conversation_turns(ident)
        ]

    @app.post("/local-api/v1/turns/{ident}/cancel")
    async def cancel(ident: str, request: Request):
        return await request.app.state.ai.cancel(ident)

    @app.post("/local-api/v1/turns/{ident}/permission")
    async def permission(ident: str, body: PermissionDecision, request: Request):
        request.app.state.ai.decide(ident, body.requestId, body.optionId)
        return {"status": "accepted"}

    original_openapi = app.openapi

    def metadata_openapi():
        document = original_openapi()

        def convert(value):
            if isinstance(value, dict):
                return {key: convert(item) for key, item in value.items()}
            if isinstance(value, list):
                return [convert(item) for item in value]
            return (
                value.replace("#/$defs/", "#/components/schemas/")
                if isinstance(value, str)
                else value
            )

        document.setdefault("components", {}).setdefault("schemas", {}).update(
            convert(deepcopy(SCHEMA["$defs"]))
        )
        model = document["components"]["schemas"].get("TurnRequest", {})
        for name, target in [
            ("conversationSnapshot", "ConversationMetadata"),
            ("client", "ClientRuntime"),
        ]:
            if name in model.get("properties", {}):
                model["properties"][name] = {
                    "anyOf": [
                        {"$ref": f"#/components/schemas/{target}"},
                        {"type": "null"},
                    ]
                }
        for path, operations in document.get("paths", {}).items():
            for method, operation in operations.items():
                if not isinstance(operation, dict) or "responses" not in operation:
                    continue
                target = (
                    "AiSettings"
                    if path.endswith(("/settings", "/default-connection"))
                    or "/connections/" in path
                    else "Detection"
                    if path.endswith("/detect")
                    else "AiTurn"
                    if "/turns" in path
                    and not path.endswith(("/events", "/permission"))
                    else None
                )
                if not target:
                    continue
                schema = {"$ref": f"#/components/schemas/{target}"}
                if path.endswith("/turns") and method == "get":
                    schema = {"type": "array", "items": schema}
                for code, response in operation["responses"].items():
                    if code.startswith("2"):
                        response.setdefault("content", {})["application/json"] = {
                            "schema": schema
                        }
        return document

    app.openapi = metadata_openapi
    return app
