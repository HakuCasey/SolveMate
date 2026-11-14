"""按原生序号合并持久化消息和生成增量，不展示思考正文。"""

from ..errors import ConnectionError


class StreamGap(Exception):
    """缺少增量时重新订阅快照，不重发问题。"""


def records(value):
    return [
        row.get("event", row) for row in value.get("records", value.get("events", []))
    ]


def compact_text(stream):
    pieces = []
    for item in stream:
        if item.get("type") == "text-chunks":
            pieces.extend(item.get("texts", []))
        elif (
            item.get("type") == "chunk"
            and item.get("chunk", {}).get("type") == "text-delta"
        ):
            pieces.append(item["chunk"].get("text", ""))
    return "".join(pieces)


def message_text(data):
    message = data.get("message", data)
    return "".join(
        block.get("text", "")
        for block in message.get("content", [])
        if block.get("type") == "text"
    )


class DshStream:
    def __init__(self, sid, emit):
        self.sid, self.emit = sid, emit
        self.cut = None
        self.cursor = -1
        self.revision = 0
        self.events = {}
        self.active = None
        self.content = ""
        self.reason = None
        self.turn = None
        self.abandoned_text = ""
        self.phase = None
        self.tools = {}
        self.committed = True

    def send(self, **event):
        if event["kind"] == "thinking" and self.phase == "thinking":
            return
        self.phase = event["kind"]
        self.emit({"sessionId": self.sid, **event})

    def snapshot(self, value):
        header = value.get("header", {})
        if header.get("id", header.get("sessionId")) != self.sid:
            raise ConnectionError(
                "DSH 返回的会话编号与原记录不同。", "binding_mismatch"
            )
        if self.cut is None:
            self.cut = value["cursor"]
        else:
            # 快照覆盖当前窗口；已经保存但不在该窗口中的早期步骤仍保留。
            for event in records(value):
                if event["seq"] > self.cut:
                    self.events[event["seq"]] = event
        self.cursor = value["cursor"]
        baseline = value.get("assistantStream")
        if not isinstance(baseline, dict):
            raise ConnectionError(
                "DSH 未提供实时正文接口，请更新 Harness。", "protocol_unsupported"
            )
        self.revision = baseline.get("revision", 0)
        active = baseline.get("activeAttempt")
        self.active = (
            {**active, "text": compact_text(active.get("stream", []))}
            if active and active.get("startedAfterSeq", -1) >= self.cut
            else None
        )
        self.render()

    def event(self, event):
        seq = event["seq"]
        if seq <= self.cursor:
            return
        if seq != self.cursor + 1:
            raise StreamGap
        self.cursor = seq
        if seq > self.cut:
            self.events[seq] = event
            self.render()

    def frame(self, frame):
        revision = frame["revision"]
        if frame.get("type") == "start" and revision == 1 and self.revision > 0:
            raise StreamGap
        if revision <= self.revision:
            return
        if revision != self.revision + 1:
            raise StreamGap
        self.revision = revision
        kind = frame["type"]
        if kind == "start":
            self.abandoned_text = ""
            self.active = {**frame, "nextIndex": 0, "text": ""}
        elif kind in {"chunk", "end"}:
            active = self.active
            if (
                not active
                or active["attemptId"] != frame["attemptId"]
                or frame["index"] != active["nextIndex"]
            ):
                raise StreamGap
            if kind == "chunk":
                active["nextIndex"] += 1
                chunk = frame["chunk"]
                if chunk["type"] == "text-delta":
                    active["text"] += chunk.get("text", "")
                elif "thinking" in chunk["type"] or "reasoning" in chunk["type"]:
                    self.send(kind="thinking")

            else:
                outcome = frame.get("outcome", {})
                if (
                    outcome.get("kind") == "committed"
                    and outcome.get("seq") not in self.events
                ):
                    raise StreamGap
                if outcome.get("kind") == "abandoned":
                    self.abandoned_text = active["text"]
                self.active = None
        self.render()

    def render(self):
        pieces, terminal = [], None
        tools = {}
        for seq in sorted(self.events):
            event = self.events[seq]
            data = event.get("data", {})
            kind = event["type"]
            if kind == "turn/start" and self.turn != data["turn"]:
                self.turn = data["turn"]
                self.send(kind="turn", externalTurnId=str(self.turn))
            elif kind == "assistant/message":
                pieces.append(message_text(data))
            elif kind == "tool/call":
                tools[data["callId"]] = {
                    "id": data["callId"],
                    "title": data["name"],
                    "status": "in_progress",
                }
            elif kind == "tool/result":
                message = data["message"]
                ident = message["toolCallId"]
                tools[ident] = {
                    **tools.get(ident, {"id": ident, "title": "工具执行"}),
                    "status": "failed"
                    if data.get("error") or message.get("isError")
                    else "completed",
                }
            elif kind == "assistant/attempt":
                key = (data.get("turn"), data.get("step"))
                replaced = any(
                    later_seq > seq
                    and later["type"] in {"assistant/message", "assistant/attempt"}
                    and (
                        later.get("data", {}).get("turn"),
                        later.get("data", {}).get("step"),
                    )
                    == key
                    for later_seq, later in self.events.items()
                )
                retrying = (
                    self.active
                    and (self.active.get("turn"), self.active.get("step")) == key
                    and self.active.get("startedAfterSeq", self.cut) >= seq
                )
                if not replaced and not retrying:
                    pieces.append(compact_text(data.get("stream", [])))
            elif kind == "turn/end":
                terminal = data.get("reason")
        active = self.active
        settled = False
        if active:
            # 对应持久化消息已经到达时，用最终正文替换临时正文，避免追加两遍。
            settled = any(
                e["type"] in {"assistant/message", "assistant/attempt"}
                and e.get("data", {}).get("turn") == active.get("turn")
                and e.get("data", {}).get("step") == active.get("step")
                and seq > active.get("startedAfterSeq", self.cut)
                for seq, e in self.events.items()
            )
            if not settled:
                pieces.append(active["text"])
        if not active and self.abandoned_text:
            pieces.append(self.abandoned_text)
        text = "\n\n".join(piece for piece in pieces if piece)
        committed = not (active and not settled) and not self.abandoned_text
        changed = text != self.content or committed != self.committed
        self.committed = bool(committed)
        if changed and (text or self.content):
            self.content = text
            self.send(kind="text", text=text, replace=True, committed=self.committed)
        for ident, tool in tools.items():
            if self.tools.get(ident) != tool:
                self.send(kind="tool", **tool)
        self.tools = tools
        self.reason = terminal

    @property
    def result(self):
        if not self.reason:
            return None
        kind = self.reason.get("kind")
        if kind not in {"completed", "max-tokens", "error", "aborted"}:
            raise ConnectionError(
                "DSH 返回了无法识别的结束原因，已保留正文。", "protocol_invalid"
            )
        return (
            "cancelled"
            if kind == "aborted" and self.reason.get("reason", {}).get("kind") == "user"
            else "failed"
            if kind in {"error", "aborted"}
            else "completed"
        )
