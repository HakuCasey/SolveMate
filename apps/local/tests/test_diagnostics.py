import json
from datetime import date, timedelta

from fastapi.testclient import TestClient
from test_service import HEADERS

from solvemate_local import diagnostics
from solvemate_local.main import create_app


def test_report_is_on_demand_and_only_exports_safe_failure_fields(tmp_path):
    app = create_app(user_directory=tmp_path)
    endpoint = "/local-api/v1/user/diagnostics"
    with TestClient(app, headers=HEADERS) as client:
        assert client.get(endpoint).json() == {
            "learningDatabase": "ok",
            "aiDatabase": "ok",
            "logsAvailable": True,
            "errors": [],
        }
        with app.state.user.db:
            app.state.user.db.execute(
                "INSERT INTO study_days VALUES (?,?,?)", ("2026-11-01", "[]", 90000000)
            )
        assert client.get("/local-api/v1/user/study").status_code == 422
        report = client.get(endpoint).json()
        assert report["learningDatabase"] == "study_duration_exceeded"
        [event] = report["errors"]
        assert (event["action"], event["day"], event["milliseconds"]) == (
            "read_study",
            "2026-11-01",
            90000000,
        )
        assert (tmp_path / "logs" / f"error_{date.today()}.log").is_file()
        with app.state.user.db:
            app.state.user.db.execute("DELETE FROM study_days")
    with TestClient(create_app(user_directory=tmp_path), headers=HEADERS) as client:
        report = client.get(endpoint).json()
        assert report["learningDatabase"] == "ok"
        assert report["errors"] == [event]
    assert TestClient(app).get(endpoint).status_code == 403


def test_rotation_cleanup_and_write_failure(tmp_path, monkeypatch):
    log = diagnostics.DiagnosticLog(tmp_path)
    log.directory.mkdir()
    stale = log.directory / f"error_{date.today() - timedelta(days=14)}.log"
    stale.write_text("old")
    other = log.directory / "personal.log"
    other.write_text("keep")
    monkeypatch.setattr(diagnostics, "MAX_BYTES", 200)
    for i in range(40):
        log.record("generate_reply", "timeout", turnId=str(i))
    assert not stale.exists() and other.read_text() == "keep"
    assert len(list(log.directory.glob("error_*"))) == 2
    rows, available = log.recent()
    assert available and rows[0]["turnId"] == "39"
    assert [int(row["turnId"]) for row in rows] == sorted(
        (int(row["turnId"]) for row in rows), reverse=True
    )
    blocked = tmp_path / "blocked"
    blocked.write_text("file")
    other_log = diagnostics.DiagnosticLog(blocked)
    other_log.record("save", "local_storage_failed")
    assert other_log.recent() == ([], False)


def test_failed_storage_keeps_code_and_excludes_private_text(tmp_path, monkeypatch):
    app = create_app(user_directory=tmp_path)
    with TestClient(app, headers=HEADERS) as client:

        def fail():
            raise PermissionError(13, "PRIVATE exception text", "PRIVATE path")

        monkeypatch.setattr(app.state.user, "state", fail)
        assert client.get("/local-api/v1/user/state").status_code == 503
        rows = client.get("/local-api/v1/user/diagnostics").json()["errors"]
        assert len(rows) == 1 and rows[0]["errno"] == 13
        assert rows[0]["code"] == "local_storage_failed"
        assert "PRIVATE" not in json.dumps(rows)
