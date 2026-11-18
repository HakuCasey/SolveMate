import hashlib
import json

from solvemate_server.publish import publish


def test_official_tools_catalog_download_and_updates(client, content_settings):
    catalog = client.get("/api/v1/tools").json()["tools"]
    assert [t["title"] for t in catalog] == ["讲义研发", "试题研发", "试题精讲"]
    entry = catalog[1]
    url = f"/api/v1/tools/{entry['id']}/versions/{entry['latest_version']}/download"
    response = client.get(url)
    assert response.status_code == 200
    assert hashlib.sha256(response.content).hexdigest() == entry["latest_version"]
    assert response.json()["skill"]["content"]
    assert response.json()["template"]["content"]
    source = content_settings.data_dir / "tools" / f"{entry['id']}.json"
    value = json.loads(source.read_text(encoding="utf-8"))
    value["template"]["content"] += "\n补充评分说明。"
    source.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")
    publish(content_settings.data_dir, content_settings.content_dir)
    updated = client.get("/api/v1/tools").json()["tools"]
    assert updated[0] == catalog[0]
    assert updated[2] == catalog[2]
    assert updated[1]["latest_version"] != entry["latest_version"]
    assert client.get(url).content == response.content
    assert (
        client.get("/api/v1/tools/not-installed/versions/latest/download").status_code
        == 404
    )


def test_corrupt_tool_is_rejected_without_changing_published_catalog(
    client, content_settings
):
    previous = client.get("/api/v1/tools").json()
    source = content_settings.data_dir / "tools" / "question-development.json"
    value = json.loads(source.read_text(encoding="utf-8"))
    value["skill"]["content"] = ""
    source.write_text(json.dumps(value), encoding="utf-8")
    import pytest

    with pytest.raises(ValueError):
        publish(content_settings.data_dir, content_settings.content_dir)
    assert client.get("/api/v1/tools").json() == previous
    entry = previous["tools"][1]
    payload = (
        content_settings.content_dir
        / "tools"
        / entry["id"]
        / f"{entry['latest_version']}.json"
    )
    payload.write_text("{}", encoding="utf-8")
    assert (
        client.get(f"/api/v1/tools/{entry['id']}/versions/latest/download").status_code
        == 503
    )
