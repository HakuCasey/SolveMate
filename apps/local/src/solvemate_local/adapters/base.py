from ..errors import ConnectionError
from .types import HarnessSession


def acp_update(callback):
    """将 ACP 通知转换为统一事件，思考正文不离开适配器。"""

    if callback is None:
        return None

    def update(params):
        if not callback:
            return
        native = params.get("update", {})
        kind = native.get("sessionUpdate")
        event = {"sessionId": params.get("sessionId")}
        if kind == "agent_message_chunk":
            content = native.get("content", {})
            if content.get("type") != "text":
                return
            event.update(kind="text", text=content.get("text", ""))
        elif kind == "agent_thought_chunk":
            event["kind"] = "thinking"
        elif kind in {"tool_call", "tool_call_update"}:
            event.update(kind="tool", id=native.get("toolCallId"))
            event.update(
                {key: native[key] for key in ("title", "status") if key in native}
            )
        else:
            return
        callback(event)

    return update


def acp_permission(callback):
    if callback is None:
        return None

    async def request(params):
        choice = None
        if callback:
            choice = await callback(
                {
                    "sessionId": params.get("sessionId"),
                    "title": params.get("toolCall", {}).get(
                        "title", "Harness 请求执行工具"
                    ),
                    "options": params.get("options", []),
                }
            )
        return (
            {"outcome": {"outcome": "selected", "optionId": choice}}
            if choice
            else {"outcome": {"outcome": "cancelled"}}
        )

    return request


class HarnessAdapter:
    """实现原生操作；恢复只能返回指定会话，不能另建会话代替。

    未找到原会话时抛出 session_missing，其他恢复错误保留实际原因。
    绑定、执行状态与保存由公共服务管理。
    """

    requires_probe_session = True
    supports_rename = False

    def is_running(self, process):
        return process.is_running()

    def public_capabilities(self, raw):
        result = {
            key: "unknown"
            for key in [
                "models",
                "resume",
                "textUpdates",
                "rawTextDeltas",
                "rename",
                "archive",
                "attachments",
            ]
        }
        result["rename"] = "supported" if self.supports_rename else "unsupported"
        return result

    async def rename_session(self, executable, sid, title, workspace):
        """按原生编号改名，不创建会话、不向模型发送改名指令。"""
        raise ConnectionError("当前适配器不支持会话改名。", "rename_unsupported")

    async def prompt(self, process, sid, text):
        raise NotImplementedError

    async def cancel(self, process, sid):
        raise NotImplementedError

    async def inspect_session(self, process, session):
        return session

    async def label_probe(self, process, sid):
        pass

    async def release_session(self, process, sid):
        pass

    async def release_probe(self, process, sid):
        await self.release_session(process, sid)


class AcpAdapter(HarnessAdapter):
    protocol = "acp"

    def public_capabilities(self, raw):
        raw = raw if isinstance(raw, dict) else {}
        result = super().public_capabilities(raw)
        sessions = raw.get("sessionCapabilities", {})
        sessions = sessions if isinstance(sessions, dict) else {}
        result.update(
            models="supported",
            textUpdates="supported",
            resume="supported"
            if "resume" in sessions or raw.get("loadSession") is True
            else "unknown",
        )
        return result

    async def start(self, process):
        info = await process.start()
        return {
            "version": info.get("agentInfo", {}).get("version", "unknown"),
            "capabilities": info.get("agentCapabilities", {}),
        }

    async def new_session(self, process, workspace, model=""):
        result = await process.call("session/new", {"cwd": workspace, "mcpServers": []})
        if (
            not isinstance(result, dict)
            or not isinstance(result.get("sessionId"), str)
            or not result["sessionId"]
        ):
            raise ConnectionError(
                "Harness 未返回有效的原生会话编号，已停止继续提问。", "session_invalid"
            )
        return HarnessSession(result["sessionId"], self.describe(result))

    async def resume(self, process, sid, workspace):
        caps = process.capabilities
        if "resume" in caps.get("sessionCapabilities", {}):
            method = "session/resume"
        elif caps.get("loadSession"):
            method = "session/load"
        else:
            raise ConnectionError(
                "此 Harness 未声明会话恢复能力，原记录仍保留。", "resume_unsupported"
            )
        result = await process.call(
            method, {"sessionId": sid, "cwd": workspace, "mcpServers": []}
        )
        if not isinstance(result, dict) or result.get("sessionId", sid) != sid:
            raise ConnectionError(
                "Harness 返回的会话编号与原绑定不同，已停止提问。", "binding_mismatch"
            )
        return HarnessSession(sid, self.describe(result))

    async def prompt(self, process, sid, text):
        result = await process.call(
            "session/prompt",
            {"sessionId": sid, "prompt": [{"type": "text", "text": text}]},
            timeout=300,
        )
        reason = result.get("stopReason")
        return (
            "cancelled"
            if reason == "cancelled"
            else "failed"
            if reason in {"error", "refusal"}
            else "completed"
        )

    async def cancel(self, process, sid):
        await process.notify("session/cancel", {"sessionId": sid})
