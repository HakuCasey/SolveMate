"""学习时间段合并、保存与现有记录隔离。无需调用任何 Harness。"""

from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from test_service import HEADERS
from test_user_data import data

from solvemate_local.main import create_app


def span(start, end):
    return {
        "startMs": int(start.timestamp() * 1000),
        "endMs": int(end.timestamp() * 1000),
    }


def test_study_time_merges_windows_and_retries_and_preserves_app_state(tmp_path):
    directory = tmp_path / "ai"
    with TestClient(create_app(directory), headers=HEADERS) as client:
        snapshot = client.get("/local-api/v1/user/study").json()
        assert snapshot["days"] == []
        original = client.put(
            "/local-api/v1/user/state", json={"value": data(), "expectedRevision": 0}
        ).json()
        start = datetime(2026, 1, 1, 12)
        first = span(start, start + timedelta(minutes=1))
        second = span(start + timedelta(seconds=30), start + timedelta(seconds=90))
        for intervals in ([first], [second], [first, second]):
            response = client.post(
                "/local-api/v1/user/study",
                json={"expectedStoreId": snapshot["storeId"], "intervals": intervals},
            )
            assert response.status_code == 200, response.text
            assert response.json()["days"][0]["milliseconds"] <= 90_000
        assert response.json()["days"] == [
            {"date": "2026-01-01", "milliseconds": 90_000}
        ]
        assert client.get("/local-api/v1/user/state").json() == original
    with TestClient(create_app(directory), headers=HEADERS) as client:
        assert (
            client.get("/local-api/v1/user/study").json()["days"][0]["milliseconds"]
            == 90_000
        )


def test_midnight_splits_days_and_failed_batch_does_not_partly_save(tmp_path):
    with TestClient(create_app(tmp_path / "ai"), headers=HEADERS) as client:
        ident = client.get("/local-api/v1/user/study").json()["storeId"]
        start = datetime(2026, 1, 1, 23, 59, 30)
        valid = span(start, start + timedelta(minutes=1))
        body = {"expectedStoreId": ident, "intervals": [valid]}
        assert client.post("/local-api/v1/user/study", json=body).json()["days"] == [
            {"date": "2026-01-01", "milliseconds": 30_000},
            {"date": "2026-01-02", "milliseconds": 30_000},
        ]
        assert (
            client.post(
                "/local-api/v1/user/study",
                json={**body, "expectedStoreId": "another-store"},
            ).status_code
            == 409
        )
        invalid = {"startMs": valid["endMs"], "endMs": valid["startMs"]}
        assert (
            client.post(
                "/local-api/v1/user/study",
                json={
                    **body,
                    "intervals": [span(start - timedelta(minutes=1), start), invalid],
                },
            ).status_code
            == 422
        )
        assert (
            sum(
                day["milliseconds"]
                for day in client.get("/local-api/v1/user/study").json()["days"]
            )
            == 60_000
        )


@pytest.mark.parametrize(
    "intervals", [[], [{"startMs": True, "endMs": False}], [{"startMs": 1, "endMs": 2}]]
)
def test_invalid_study_payload_is_rejected(tmp_path, intervals):
    with TestClient(create_app(tmp_path / "ai"), headers=HEADERS) as client:
        ident = client.get("/local-api/v1/user/study").json()["storeId"]
        assert (
            client.post(
                "/local-api/v1/user/study",
                json={"expectedStoreId": ident, "intervals": intervals},
            ).status_code
            == 422
        )


def test_daily_limit_rejects_invalid_total_and_logs_error_without_overwriting(
    tmp_path, caplog
):
    """模拟损坏的既有时间段；异常应留日志，不把错误统计截断后当作成功。"""
    import json

    app = create_app(tmp_path / "ai")
    with TestClient(app, headers=HEADERS) as client:
        ident = client.get("/local-api/v1/user/study").json()["storeId"]
        start = datetime(2026, 1, 1)
        malformed = span(start, start + timedelta(hours=25))
        with app.state.user.db:
            app.state.user.db.execute(
                "INSERT INTO study_days VALUES (?,?,?)",
                (
                    "2026-01-01",
                    json.dumps([[malformed["startMs"], malformed["endMs"]]]),
                    90_000_000,
                ),
            )
        response = client.post(
            "/local-api/v1/user/study",
            json={
                "expectedStoreId": ident,
                "intervals": [span(start, start + timedelta(minutes=1))],
            },
        )
        assert response.status_code == 422
        assert response.json()["code"] == "study_duration_exceeded"
        assert "Study duration exceeds the daily limit" in caplog.text
        assert (
            app.state.user.db.execute("SELECT milliseconds FROM study_days").fetchone()[
                0
            ]
            == 90_000_000
        )
