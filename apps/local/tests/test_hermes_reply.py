"""完整正文按完成事件替换，避免把经过修订的正文再次追加到流式内容。"""

import asyncio
from types import SimpleNamespace

import pytest

from solvemate_local.adapters.base import acp_update
from solvemate_local.adapters.hermes_acp import FinalReplyMixin


@pytest.mark.parametrize(
    ("streamed", "final", "segments"),
    [
        ("\n\n讲义正文", "讲义正文\n工具执行失败说明", []),
        ("已收到的部分", "已收到的部分和后续内容", ["此前的说明"]),
        ("原始计算结果", "修订后的计算结果", []),
    ],
)
def test_native_final_message_replaces_stream_without_text_deduplication(
    streamed, final, segments
):
    events = []
    output = streamed

    class Native:
        def __init__(self):
            self._segments = {"admission": segments}
            self.finished = False

        async def _finish_reply(self, sid, editor_id, aid, payload):
            # 模拟原生结束时仍有正文需要发送；是否追加由明确的事件含义决定。
            update = self._chunk(sid, payload["text"])
            acp_update(events.append)(
                {
                    "sessionId": sid,
                    "update": {
                        "sessionUpdate": "agent_message_chunk",
                        "content": {"type": "text", "text": update.text},
                        "_meta": update.field_meta,
                    },
                }
            )
            self.finished = True

        def _chunk(self, sid, text, *, thought=False):
            return SimpleNamespace(text=text, field_meta={})

    class Agent(FinalReplyMixin, Native):
        pass

    agent = Agent()
    asyncio.run(agent._finish_reply("session", "editor", "admission", {"text": final}))
    for event in events:
        output = event["text"] if event.get("replace") else output + event["text"]
    assert output == "\n\n".join([*segments, final])
    assert agent.finished
    assert agent._settled_replies == {}
    assert agent._chunk("session", "后续追问").text == "后续追问"


@pytest.mark.parametrize("metadata", [None, {}, {"solvemate": None}])
def test_standard_acp_chunks_remain_incremental(metadata):
    events = []
    acp_update(events.append)(
        {
            "sessionId": "session",
            "update": {
                "sessionUpdate": "agent_message_chunk",
                "content": {"type": "text", "text": "后续文字"},
                "_meta": metadata,
            },
        }
    )
    assert events == [{"sessionId": "session", "kind": "text", "text": "后续文字"}]


def test_concurrent_session_completions_keep_their_own_final_text():
    output = {}

    class Native:
        def __init__(self):
            self._segments = {}

        async def _finish_reply(self, sid, editor_id, aid, payload):
            await asyncio.sleep(0)
            output[sid] = self._chunk(sid, "原生剩余文字").text

        def _chunk(self, sid, text, *, thought=False):
            return SimpleNamespace(text=text, field_meta={})

    class Agent(FinalReplyMixin, Native):
        pass

    async def exercise():
        agent = Agent()
        await asyncio.gather(
            agent._finish_reply("one", "editor", "a", {"text": "第一条回复"}),
            agent._finish_reply("two", "editor", "b", {"text": "第二条回复"}),
        )
        assert agent._settled_replies == {}

    asyncio.run(exercise())
    assert output == {"one": "第一条回复", "two": "第二条回复"}


@pytest.mark.parametrize("failed", [False, True])
def test_native_suppression_and_failure_do_not_emit_or_leave_a_final_snapshot(failed):
    class Native:
        def __init__(self):
            self._segments = {}

        async def _finish_reply(self, *args):
            if failed:
                raise RuntimeError("Native completion failed")

        def _chunk(self, *args, **kwargs):
            raise AssertionError("Suppressed replies must not emit text")

    class Agent(FinalReplyMixin, Native):
        pass

    agent = Agent()
    if failed:
        with pytest.raises(RuntimeError):
            asyncio.run(agent._finish_reply("session", "editor", "a", {"text": "正文"}))
    else:
        asyncio.run(agent._finish_reply("session", "editor", "a", {"text": "正文"}))
    assert agent._settled_replies == {}
