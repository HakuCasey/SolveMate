import os
import threading
import time

from fastapi.testclient import TestClient

from solvemate_local.desktop import parent_is_running, stop_after_parent_exit
from solvemate_local.main import create_app


def test_desktop_service_serves_existing_web_and_protects_local_api(tmp_path):
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("<h1>SolveMate</h1>", encoding="utf-8")
    app = create_app(tmp_path / "user/ai", web_directory=web)

    with TestClient(app) as client:
        page = client.get("/")
        assert page.status_code == 200
        assert "SolveMate" in page.text
        assert page.headers["cache-control"] == "no-store"
        reloaded = client.get(
            "/index.html", headers={"If-None-Match": page.headers["etag"]}
        )
        assert reloaded.status_code == 200
        assert reloaded.headers["cache-control"] == "no-store"
        protected = client.get("/local-api/v1/settings")
        assert protected.status_code == 403
        assert protected.json()["code"] == "client_required"


def test_desktop_service_accepts_same_origin_web_requests(tmp_path):
    web = tmp_path / "web"
    web.mkdir()
    (web / "index.html").write_text("ok", encoding="utf-8")
    origin = "http://127.0.0.1:43127"
    app = create_app(tmp_path / "user/ai", web_directory=web, allowed_origins=[origin])

    with TestClient(
        app,
        headers={"origin": origin, "x-solvemate-client": "web"},
    ) as client:
        assert client.get("/local-api/v1/settings").status_code == 200


def test_desktop_parent_check_distinguishes_running_and_missing_process():
    assert parent_is_running(os.getpid()) is True
    assert parent_is_running(2_147_483_647) is False


def test_desktop_waits_for_server_start_before_stopping_after_parent_exit():
    class FakeServer:
        started = False
        should_exit = False

    server = FakeServer()
    watcher = threading.Thread(
        target=stop_after_parent_exit,
        args=(server, 2_147_483_647),
    )
    watcher.start()
    time.sleep(0.15)
    assert server.should_exit is False

    server.started = True
    watcher.join(timeout=2)
    assert watcher.is_alive() is False
    assert server.should_exit is True
