import { describe, expect, it, vi } from "vitest";
import { readTurnEvents, type AiTurn } from "./local-api";

import { aiTurn } from "./fixtures.test-support";
const turn = aiTurn({
  id: "stream-1",
  conversationId: "conversation-1",
  content: "",
});
const encoder = new TextEncoder();
function frame(value: AiTurn) {
  return `event: turn\ndata: ${JSON.stringify(value)}\n\n`;
}
function response(parts: string[]) {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(encoder.encode(part));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}

describe("real-time reply snapshots", () => {
  it("delivers partial text before completion and replaces it with the final snapshot", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const stream = new ReadableStream<Uint8Array>({
      start(value) {
        controller = value;
      },
    });
    const received: AiTurn[] = [];
    const pending = readTurnEvents(
      new Response(stream, {
        headers: { "content-type": "text/event-stream" },
      }),
      turn.id,
      (value) => received.push(value),
    );
    controller.enqueue(encoder.encode(frame({ ...turn, content: "第一部分" })));
    await vi.waitFor(() =>
      expect(received.map((value) => value.content)).toEqual(["第一部分"]),
    );
    controller.enqueue(
      encoder.encode(
        frame({
          ...turn,
          content: "第一部分，第二部分。",
          status: "completed",
        }),
      ),
    );
    const result = await pending;
    expect(result.status).toBe("completed");
    expect(received.map((value) => value.content)).toEqual([
      "第一部分",
      "第一部分，第二部分。",
    ]);
  });
  it("handles split Chinese bytes, CRLF frames and heartbeats without manufacturing text", async () => {
    const bytes = encoder.encode(
      (
        ": heartbeat\n\n" +
        frame({ ...turn, content: "中文回复", status: "completed" })
      ).replaceAll("\n", "\r\n"),
    );
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    const accept = vi.fn();
    await readTurnEvents(
      new Response(stream, {
        headers: { "content-type": "text/event-stream" },
      }),
      turn.id,
      accept,
    );
    expect(accept).toHaveBeenCalledTimes(1);
    expect(accept.mock.calls[0]![0].content).toBe("中文回复");
  });
  it("reports an early disconnect while preserving the partial snapshot already delivered", async () => {
    const accept = vi.fn();
    await expect(
      readTurnEvents(
        response([frame({ ...turn, content: "已收到的部分" })]),
        turn.id,
        accept,
      ),
    ).rejects.toMatchObject({ code: "stream_closed" });
    expect(accept.mock.calls[0]![0].content).toBe("已收到的部分");
  });
  it("rejects another request's result and invalid JSON instead of merging them", async () => {
    const accept = vi.fn();
    await expect(
      readTurnEvents(
        response([frame({ ...turn, id: "other", status: "completed" })]),
        turn.id,
        accept,
      ),
    ).rejects.toMatchObject({ code: "stream_invalid" });
    await expect(
      readTurnEvents(
        response(["event: turn\ndata: {broken}\n\n"]),
        turn.id,
        accept,
      ),
    ).rejects.toMatchObject({ code: "stream_invalid" });
    expect(accept).not.toHaveBeenCalled();
  });
  it("keeps a stopped partial answer and accepts a terminal record without waiting for EOF", async () => {
    const result = await readTurnEvents(
      response([frame({ ...turn, content: "保留部分", status: "cancelled" })]),
      turn.id,
      vi.fn(),
    );
    expect(result).toMatchObject({ status: "cancelled", content: "保留部分" });
    await expect(
      readTurnEvents(new Response("<html>app</html>"), turn.id, vi.fn()),
    ).rejects.toMatchObject({ code: "stream_unsupported" });
  });
});
