import hashlib
import io
import json
import zipfile

import pytest
from fastapi.testclient import TestClient

from solvemate_server.config import Settings
from solvemate_server.main import create_app
from solvemate_server.publish import publish


def latest(client: TestClient, course_id="calculus") -> dict:
    response = client.get(f"/api/v1/courses/{course_id}/versions/latest")
    assert response.status_code == 200
    return response.json()


def test_real_course_catalog_and_openapi(client: TestClient):
    assert client.get("/healthz").json() == {"status": "ok"}
    response = client.get("/api/v1/courses")
    assert response.status_code == 200
    assert [(item["id"], item["title"]) for item in response.json()["courses"]] == [
        ("calculus", "高等数学"),
        ("c-language", "C 语言"),
    ]
    for item in response.json()["courses"]:
        assert client.get(f"/api/v1/courses/{item['id']}").json() == item
        assert (
            client.get(item["manifest_url"]).json()["version"] == item["latest_version"]
        )
    schema = client.get("/openapi.json").json()
    assert schema["info"]["title"] == "SolveMate Content API"
    assert "/api/v1/courses/{course_id}/updates" in schema["paths"]
    assert client.post("/api/v1/courses").status_code == 405


@pytest.mark.parametrize("course_id,count", [("calculus", 24), ("c-language", 12)])
def test_download_preserves_all_original_assets(
    client: TestClient, content_settings: Settings, course_id: str, count: int
):
    manifest = latest(client, course_id)
    response = client.get(manifest["download_url"])
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/zip"
    assert len(response.content) == manifest["size_bytes"]
    assert (
        hashlib.sha256(response.content).hexdigest()
        == manifest["sha256"]
        == manifest["version"]
    )
    assert response.headers["x-content-sha256"] == manifest["sha256"]
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert set(archive.namelist()) == {
            "course.json",
            *(item["path"] for item in manifest["files"]),
        }
        assert json.loads(archive.read("course.json"))["files"] == manifest["files"]
        for item in manifest["files"]:
            payload = archive.read(item["path"])
            assert (
                payload
                == (content_settings.data_dir / course_id / item["path"]).read_bytes()
            )
            assert len(payload) == item["size_bytes"]
            assert hashlib.sha256(payload).hexdigest() == item["sha256"]
        questions = json.loads(archive.read("questions/questions.json"))
        assert len(questions["questions"]) == count
        assert (
            len(json.loads(archive.read("memory/learning-points.json"))["points"]) == 12
        )


def test_etag_revalidation_latest_and_version_cache(client: TestClient):
    catalog = client.get("/api/v1/courses")
    unchanged = client.get(
        "/api/v1/courses",
        headers={"If-None-Match": f'"different", W/{catalog.headers["etag"]}'},
    )
    assert unchanged.status_code == 304 and unchanged.content == b""
    assert unchanged.headers["cache-control"] == "no-cache"
    current = client.get("/api/v1/courses/calculus/versions/latest")
    assert current.headers["cache-control"] == "no-cache"
    version = current.json()["version"]
    immutable = client.get(f"/api/v1/courses/calculus/versions/{version}")
    assert "immutable" in immutable.headers["cache-control"]
    assert (
        client.get(
            f"/api/v1/courses/calculus/versions/{version}",
            headers={"If-None-Match": immutable.headers["etag"]},
        ).status_code
        == 304
    )


def test_download_head_conditional_and_range_resume(client: TestClient):
    release = latest(client)
    url = release["download_url"]
    full = client.get(url)
    head = client.head(url)
    assert head.status_code == 200 and head.content == b""
    assert int(head.headers["content-length"]) == len(full.content)
    assert head.headers["etag"] == full.headers["etag"]
    assert (
        client.get(url, headers={"If-None-Match": full.headers["etag"]}).status_code
        == 304
    )
    first = client.get(url, headers={"Range": "bytes=0-99"})
    rest = client.get(
        url, headers={"Range": "bytes=100-", "If-Range": full.headers["etag"]}
    )
    assert first.status_code == rest.status_code == 206
    assert first.content + rest.content == full.content
    assert (
        client.get(
            url, headers={"Range": f"bytes={len(full.content) + 1}-"}
        ).status_code
        == 416
    )
    assert (
        client.get(
            url, headers={"Range": "bytes=100-", "If-Range": '"old-version"'}
        ).status_code
        == 200
    )


def test_updates_keep_previous_versions_available_without_restart(
    client: TestClient, content_settings: Settings
):
    original = latest(client)
    original_download = client.get(original["download_url"]).content
    initial_catalog_etag = client.get("/api/v1/courses").headers["etag"]
    endpoint = "/api/v1/courses/calculus/updates"
    assert client.get(endpoint).json()["status"] == "not_installed"
    assert (
        client.get(endpoint, params={"current_version": original["version"]}).json()[
            "status"
        ]
        == "up_to_date"
    )
    textbook = content_settings.data_dir / "calculus/textbooks/primer.md"
    textbook.write_text(
        textbook.read_text(encoding="utf-8") + "\n新增的课程说明。\n",
        encoding="utf-8",
    )
    publish(content_settings.data_dir, content_settings.content_dir)
    update = client.get(
        endpoint, params={"current_version": original["version"]}
    ).json()
    assert update["status"] == "update_available" and update["update_available"]
    assert update["latest"]["version"] != original["version"]
    assert client.get(original["download_url"]).content == original_download
    versions = client.get("/api/v1/courses/calculus/versions").json()
    assert len(versions["versions"]) == 2
    assert versions["versions"][0]["version"] == update["latest"]["version"]
    assert (
        client.get(
            "/api/v1/courses", headers={"If-None-Match": initial_catalog_etag}
        ).status_code
        == 200
    )
    with TestClient(create_app(content_settings)) as restarted:
        assert restarted.get(original["download_url"]).content == original_download
        assert latest(restarted)["version"] == update["latest"]["version"]


def test_unknown_client_version_is_not_automatically_downgraded(client: TestClient):
    response = client.get(
        "/api/v1/courses/calculus/updates",
        params={"current_version": "unrecognized-local-release"},
    )
    assert response.json()["status"] == "unknown_version"
    assert response.json()["update_available"] is False
    assert response.json()["latest"]["download_url"]


@pytest.mark.parametrize(
    "url",
    [
        "/api/v1/courses/not-a-course",
        "/api/v1/courses/calculus/versions/" + "0" * 64,
        "/api/v1/courses/calculus/versions/" + "0" * 64 + "/download",
        "/api/v1/courses/calculus/versions/not-a-hash",
        "/api/v1/courses/calculus/versions/%2e%2e%2f%2e%2e/download",
    ],
)
def test_unknown_or_unsafe_identifiers_never_return_files(client: TestClient, url: str):
    assert client.get(url).status_code in (404, 422)


def test_cors_only_allows_configured_origins(client: TestClient):
    headers = {"Origin": "http://127.0.0.1:5174"}
    allowed = client.get("/api/v1/courses", headers=headers)
    assert allowed.headers["access-control-allow-origin"] == headers["Origin"]
    assert "etag" in allowed.headers["access-control-expose-headers"].lower()
    denied = client.get(
        "/api/v1/courses", headers={"Origin": "https://unconfigured.example"}
    )
    assert "access-control-allow-origin" not in denied.headers
    preflight = client.options(
        "/api/v1/courses",
        headers={
            **headers,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "If-None-Match",
        },
    )
    assert preflight.status_code == 200


def test_corrupted_download_is_rejected_after_startup(
    client: TestClient, content_settings: Settings
):
    release = latest(client)
    path = (
        content_settings.content_dir
        / "courses/calculus"
        / release["version"]
        / "content.zip"
    )
    path.write_bytes(b"corrupted package")
    response = client.get(release["download_url"])
    assert response.status_code == 503
    assert response.headers["cache-control"] == "no-store"
    assert "corrupted package" not in response.text
    assert client.get("/healthz").status_code == 503


def test_missing_publication_fails_startup(tmp_path):
    settings = Settings(
        data_dir=tmp_path / "data", content_dir=tmp_path / "not-published"
    )
    with (
        pytest.raises(RuntimeError, match="solvemate-publish"),
        TestClient(create_app(settings)),
    ):
        pass
