import asyncio
import json
import os
from dataclasses import dataclass, field

from ..errors import ConnectionError
from ..transport import JsonRpcProcess, UnsupportedClientMethod, safe_error


@dataclass
class CodexExecution:
    future: asyncio.Future
    turn_id: str | None = None
    pending: list = field(default_factory=list)
    messages: dict = field(default_factory=dict)
    file_paths: dict = field(default_factory=dict)
    stop_requested: bool = False
    last_error: str = ""
    acknowledged: asyncio.Event = field(default_factory=asyncio.Event)


class CodexProcess(JsonRpcProcess):
    """将 app-server 的 thread、turn、item 转换为公共执行事件。"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.active = {}
        self.selections = {}
        self.catalog = []
        self.config = {}

    async def prepare_launch(self):
        return [
            self.executable,
            "app-server",
            "--listen",
            "stdio://",
        ], os.environ.copy()

    async def initialize(self):
        info = await self.call(
            "initialize",
            {
                "clientInfo": {
                    "name": "solvemate",
                    "title": "SolveMate",
                    "version": "0.1.0",
                }
            },
            timeout=30,
        )
        await self.notify("initialized", {})
        return info

    def emit(self, sid, **event):
        if self.on_update:
            self.on_update({"sessionId": sid, **event})

    def disconnected(self):
        for state in self.active.values():
            if not state.future.done():
                state.future.set_exception(
                    ConnectionError(
                        "Codex 连接已断开，已收到的内容仍保留。", "process_stopped"
                    )
                )

    async def prompt(self, sid, text):
        if sid in self.active:
            raise ConnectionError(
                "此 Codex 会话正在执行，请等待完成。", "conversation_busy"
            )
        state = CodexExecution(asyncio.get_running_loop().create_future())
        self.active[sid] = state
        model, effort = self.selections[sid]
        try:
            result = await self.call(
                "turn/start",
                {
                    "threadId": sid,
                    "input": [{"type": "text", "text": text}],
                    "model": model,
                    "effort": effort or None,
                },
            )
            turn_id = result.get("turn", {}).get("id")
            if not isinstance(turn_id, str) or not turn_id:
                raise ConnectionError(
                    "Codex 未返回有效的执行编号，已停止自动提交。", "turn_invalid"
                )
            state.turn_id = turn_id
            state.acknowledged.set()
            self.emit(sid, kind="turn", externalTurnId=turn_id)
            # 请求确认前的通知先暂存，只处理与返回 turnId 对应的执行。
            pending, state.pending = state.pending, []
            for method, params in pending:
                self.notification(method, params)
            if state.stop_requested and not state.future.done():
                await self.interrupt(sid)
            try:
                return await asyncio.wait_for(asyncio.shield(state.future), 300)
            except TimeoutError as error:
                raise ConnectionError(
                    "等待 Codex 完成超时，已收到的内容仍保留。请确认原会话状态后继续。",
                    "request_timeout",
                ) from error
        finally:
            state.acknowledged.set()
            self.active.pop(sid, None)
            if not state.future.done():
                state.future.cancel()
            elif not state.future.cancelled():
                state.future.exception()  # 连接先中断时也取走异常，避免遗留未读取的 Future。

    async def interrupt(self, sid):
        state = self.active.get(sid)
        if not state:
            return
        state.stop_requested = True
        if state.turn_id and not state.future.done():
            await self.call(
                "turn/interrupt", {"threadId": sid, "turnId": state.turn_id}
            )

    @staticmethod
    def turn_id(method, params):
        if method in {"turn/started", "turn/completed"}:
            return params.get("turn", {}).get("id")
        return params.get("turnId")

    def notification(self, method, params):
        sid = params.get("threadId")
        state = self.active.get(sid)
        if not state or state.future.done():
            return
        native_turn = self.turn_id(method, params)
        if not native_turn:
            return
        if not state.turn_id:
            if len(state.pending) >= 1000:
                state.future.set_exception(
                    ConnectionError(
                        "Codex 在确认执行前返回过多通知，请重新检测连接。",
                        "protocol_invalid",
                    )
                )
            else:
                state.pending.append((method, params))
            return
        if native_turn != state.turn_id:
            return
        if method == "item/agentMessage/delta":
            item_id = params.get("itemId")
            state.messages[item_id] = state.messages.get(item_id, "") + params.get(
                "delta", ""
            )
            self.message_snapshot(sid, state)
        elif method.startswith("item/reasoning/"):
            self.emit(sid, kind="thinking")
        elif method in {"item/started", "item/completed"}:
            self.item(sid, state, params.get("item", {}), method == "item/completed")
        elif method == "error":
            state.last_error = safe_error(
                params.get("error", {}).get("message", "Codex 执行失败。")
            )
        elif method == "turn/completed":
            turn = params.get("turn", {})
            for item in turn.get("items", []):
                self.item(sid, state, item, True)
            status = turn.get("status")
            if status == "failed":
                message = (
                    (turn.get("error") or {}).get("message")
                    or state.last_error
                    or "Codex 执行失败。"
                )
                state.future.set_exception(
                    ConnectionError(
                        "Codex 返回错误：" + safe_error(message), "harness_error"
                    )
                )
            elif status == "interrupted":
                state.future.set_result("cancelled")
            elif status == "completed":
                state.future.set_result("completed")
            else:
                state.future.set_exception(
                    ConnectionError(
                        "Codex 返回了未知的结束状态，已收到的内容仍保留。",
                        "protocol_invalid",
                    )
                )

    def message_snapshot(self, sid, state):
        self.emit(
            sid,
            kind="text",
            text="\n\n".join(value for value in state.messages.values() if value),
            replace=True,
        )

    def item(self, sid, state, item, completed):
        kind, ident = item.get("type"), item.get("id")
        if kind == "agentMessage":
            if completed or item.get("text"):
                state.messages[ident] = item.get("text", "")
                self.message_snapshot(sid, state)
        elif kind == "reasoning":
            self.emit(sid, kind="thinking")
        elif kind in {
            "commandExecution",
            "fileChange",
            "mcpToolCall",
            "dynamicToolCall",
            "webSearch",
            "imageView",
        }:
            if kind == "fileChange":
                state.file_paths[ident] = [
                    change.get("path", "") for change in item.get("changes", [])
                ]
            titles = {
                "commandExecution": "执行命令",
                "fileChange": "修改文件",
                "mcpToolCall": "调用 MCP 工具",
                "dynamicToolCall": "调用工具",
                "webSearch": "搜索网页",
                "imageView": "查看图片",
            }
            status = item.get("status") or ("completed" if completed else "in_progress")
            # 原生状态如 inProgress、declined 统一为现有工具记录的状态。
            status = {"inProgress": "in_progress", "declined": "failed"}.get(
                status, status
            )
            self.emit(sid, kind="tool", id=ident, title=titles[kind], status=status)

    async def handle_request(self, method, params):
        methods = {
            "item/commandExecution/requestApproval",
            "item/fileChange/requestApproval",
            "item/permissions/requestApproval",
        }
        if method not in methods:
            raise UnsupportedClientMethod
        sid, tid = params.get("threadId"), params.get("turnId")
        state = self.active.get(sid)
        if state and not state.turn_id and not state.stop_requested:
            try:
                await asyncio.wait_for(state.acknowledged.wait(), 40)
            except TimeoutError:
                state.stop_requested = True
        # 只批准 SolveMate 已确认归属的执行，不响应其他客户端的授权请求。
        if not state or state.turn_id != tid or state.stop_requested:
            return (
                {"permissions": {}, "scope": "turn"}
                if method.endswith("permissions/requestApproval")
                else {"decision": "cancel"}
            )
        reason = params.get("reason") or ""
        detail = params.get("command") or params.get("grantRoot") or ""
        permission_profile = method.endswith("permissions/requestApproval")
        if method == "item/fileChange/requestApproval":
            detail = "\n".join(state.file_paths.get(params.get("itemId"), [])) or detail
        if permission_profile:
            detail = json.dumps(params.get("permissions", {}), ensure_ascii=False)
        detail_text = "\n".join(filter(None, [reason, detail])) or "执行当前操作"
        truncated = len(detail_text) > 600
        title = (
            "Codex 请求本轮权限：" if permission_profile else "Codex 请求权限："
        ) + safe_error(detail_text)
        if truncated:
            title += "\n操作内容过长，本页仅支持拒绝。请在 Codex 中核对完整操作。"
        choice = None
        if self.on_permission:
            choice = await self.on_permission(
                {
                    "sessionId": sid,
                    "title": title,
                    "options": [
                        *(
                            []
                            if truncated
                            else [
                                {
                                    "optionId": "allow-once",
                                    "name": "本轮允许"
                                    if permission_profile
                                    else "本次允许",
                                    "kind": "allow_once",
                                }
                            ]
                        ),
                        {
                            "optionId": "reject-once",
                            "name": "本次拒绝",
                            "kind": "reject_once",
                        },
                    ],
                }
            )
        if truncated:
            choice = None
        if method.endswith("permissions/requestApproval"):
            return {
                "permissions": params.get("permissions", {})
                if choice == "allow-once"
                else {},
                "scope": "turn",
            }
        return {
            "decision": "accept"
            if choice == "allow-once"
            else "decline"
            if choice == "reject-once"
            else "cancel"
        }
