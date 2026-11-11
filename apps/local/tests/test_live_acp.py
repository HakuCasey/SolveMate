"""显式指定本机程序和模型后运行；普通测试不会调用付费模型。"""

import asyncio
import os
from uuid import uuid4

import pytest

from solvemate_local.acp import AcpProcess, describe_options

PROGRAM = os.environ.get("SOLVEMATE_LIVE_DSH")
MODEL = os.environ.get("SOLVEMATE_LIVE_MODEL")


@pytest.mark.skipif(
    not PROGRAM or not MODEL,
    reason="Live Harness program and model are not configured.",
)
def test_live_question_follow_up_and_process_restart(tmp_path):
    async def exercise():
        texts = []

        def update(params):
            value = params.get("update", {})
            if value.get("sessionUpdate") == "agent_message_chunk":
                texts.append(value.get("content", {}).get("text", ""))

        async def prompt(client, sid, text):
            texts.clear()
            result = await client.call(
                "session/prompt",
                {"sessionId": sid, "prompt": [{"type": "text", "text": text}]},
                timeout=180,
            )
            assert result["stopReason"] == "end_turn"
            return "".join(texts)

        client = AcpProcess(PROGRAM, str(tmp_path), update)
        try:
            await client.start()
            session = await client.call(
                "session/new", {"cwd": str(tmp_path), "mcpServers": []}
            )
            sid = session["sessionId"]
            assert MODEL in {m["value"] for m in describe_options(session)["models"]}
            await client.call(
                "session/set_config_option",
                {"sessionId": sid, "configId": "model", "value": MODEL},
            )
            nonce = "SM-" + uuid4().hex[:8]
            answer = await prompt(
                client,
                sid,
                f'本次练习代号是 {nonce}，请记住。不使用工具，用一句话回答：C 代码 int a=5; double b=a/2; printf("%.1f",b); 输出什么？',
            )
            assert "2.0" in answer
            assert "2.5" in await prompt(
                client, sid, "不用工具，用一句话回答：刚才改成 (double)a / 2 呢？"
            )
            await client.call("session/close", {"sessionId": sid})
            await client.close()
            client = AcpProcess(PROGRAM, str(tmp_path), update)
            await client.start()
            await client.call(
                "session/resume",
                {"sessionId": sid, "cwd": str(tmp_path), "mcpServers": []},
            )
            assert nonce in await prompt(
                client, sid, "不读文件、不使用工具，说出本次练习代号。"
            )
            await client.call("session/close", {"sessionId": sid})
        finally:
            await client.close()

    asyncio.run(exercise())
