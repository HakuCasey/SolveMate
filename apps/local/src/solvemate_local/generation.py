"""统一按实际进展判断生成超时，协议适配器不限制整轮生成时长。"""

import asyncio
import logging

from .errors import ConnectionError

logger = logging.getLogger(__name__)
GENERATION_IDLE_TIMEOUT = 300
GENERATION_STOP_TIMEOUT = 15


class Generation:
    def __init__(self, adapter, process, session_id):
        self.adapter = adapter
        self.process = process
        self.session_id = session_id
        self.deadline = None

    def update(self, event):
        # 只接收本轮会话的正文、思考增量和工具等进展；连接心跳不延长等待。
        if (
            self.deadline is not None
            and not self.deadline.expired()
            and event.get("sessionId") == self.session_id
            and event.get("kind") in {"text", "thinking", "tool", "turn", "received"}
        ):
            if event.get("kind") == "text" and not event.get("text"):
                return
            self.deadline.reschedule(
                asyncio.get_running_loop().time() + GENERATION_IDLE_TIMEOUT
            )

    async def run(self, text, request_id):
        task = asyncio.create_task(
            self.adapter.prompt(
                self.process, self.session_id, text, request_id=request_id
            )
        )
        try:
            async with asyncio.timeout(GENERATION_IDLE_TIMEOUT) as deadline:
                self.deadline = deadline
                # 超时先停止原生任务，让适配器收到结束确认，再清理本地等待。
                return await asyncio.shield(task)
        except TimeoutError:
            if self.deadline is None or not self.deadline.expired():
                raise
            stop_confirmed = False
            try:
                async with asyncio.timeout(GENERATION_STOP_TIMEOUT):
                    await self.adapter.cancel(self.process, self.session_id)
                    await asyncio.shield(task)
                    stop_confirmed = True
            except asyncio.CancelledError:
                if not task.cancelled():
                    raise
                stop_confirmed = True
            except (ConnectionError, OSError, TimeoutError):
                logger.warning(
                    "Failed to confirm Harness stop after generation inactivity: adapter=%s",
                    self.adapter.id,
                )
            raise ConnectionError(
                "连续 5 分钟未收到 AI 回复或工具进展，本轮已中断，已收到的内容仍保留。"
                + (
                    "可恢复原会话后继续。"
                    if stop_confirmed
                    else "未能确认第三方任务已停止，请在原会话中检查后继续。"
                ),
                "execution_unconfirmed",
            ) from None
        finally:
            self.deadline = None
            if not task.done():
                task.cancel()
            # 无论结束、超时还是取消，都取走任务结果，避免遗留后台等待或异常。
            await asyncio.gather(task, return_exceptions=True)
