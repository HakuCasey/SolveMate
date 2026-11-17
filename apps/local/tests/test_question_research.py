"""在独立存储和模拟 Harness 中验证研发任务、追问与原生恢复。"""

from test_prompting import context, research_context
from test_service import FakeAcp, client_for, connect, payload, settled


def test_research_uses_shared_turns_and_restores_the_same_native_session(
    tmp_path, monkeypatch
):
    monkeypatch.setenv("DSH_HOME", str(tmp_path / "fake-harness"))
    FakeAcp.calls, FakeAcp.sessions = [], set()
    body = payload("根据资料出三道选择题")
    body["research"] = research_context()
    body["readingContext"] = context()
    with client_for(tmp_path) as client:
        connect(client)
        response = client.post("/local-api/v1/turns", json=body)
        assert response.status_code == 202, response.text
        first = settled(client, body["id"])
        assert first["status"] == "completed", first
        assert first["research"] == body["research"]
        native_id = first["externalSessionId"]
        submitted = [
            params["prompt"][0]["text"]
            for method, params in FakeAcp.calls
            if method == "session/prompt"
        ]
        assert "# 题目\n# 答案与解析" in submitted[-1]
        assert "核对答案与解析" in submitted[-1]
        assert body["text"] == submitted[-1].splitlines()[0]
    with client_for(tmp_path) as client:
        follow = payload("将第二题改得简单一些", body["conversationId"])
        follow["research"] = body["research"]
        follow["readingContext"] = body["readingContext"]
        follow["externalSessionId"] = native_id
        response = client.post("/local-api/v1/turns", json=follow)
        assert response.status_code == 202, response.text
        resumed = settled(client, follow["id"])
        assert resumed["status"] == "completed", resumed
        assert resumed["externalSessionId"] == native_id
        assert sum(method == "session/new" for method, _ in FakeAcp.calls) == 1
