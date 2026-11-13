import { describe, expect, it } from "vitest";
import { createInitialData } from "../data/catalog";
import { aiTurn } from "../ai/fixtures.test-support";
import { mergeAiTurn } from "../ai/state";
import {
  conversationForReading,
  latestConversation,
  createConversation,
} from "./conversations";

describe("reading conversation recovery", () => {
  it("uses learning activity rather than array order or management changes", () => {
    const data = createInitialData();
    const old = {
      ...data.conversations[0],
      id: "old",
      lastActivityAt: 10,
      updatedAt: 9999,
    };
    const latest = { ...old, id: "latest", lastActivityAt: 20, updatedAt: 20 };
    const archived = {
      ...latest,
      id: "archived",
      status: "archived" as const,
      lastActivityAt: 100,
    };
    const deleted = { ...archived, id: "deleted", status: "deleted" as const };
    expect(latestConversation([archived, old, deleted, latest])?.id).toBe(
      "latest",
    );
    expect(latestConversation([archived, deleted])).toBeUndefined();
    expect(latestConversation([])).toBeUndefined();
    const unknown = { ...old, createdAt: null, lastActivityAt: null };
    expect(latestConversation([unknown, { ...unknown, id: "other" }])?.id).toBe(
      "old",
    );
  });

  it("matches a fixed PDF version across pages and rejects unsupported positions", () => {
    const data = createInitialData();
    const selection = {
      ...data.selection,
      kind: "textbooks" as const,
      itemId: "B001",
      pageNumber: 1,
    };
    const right = {
      ...data.conversations[0],
      id: "right",
      selection,
      lastActivityAt: 1,
    };
    const wrong = [
      { ...selection, courseId: "other" },
      { ...selection, version: "other" },
      { ...selection, kind: "questions" as const },
      { ...selection, itemId: "other" },
      {
        courseId: "calculus",
        version: "example-1",
        kind: "textbooks" as const,
        itemId: "B001",
        chapterIndex: 2,
      },
      null,
    ].map((selection, index) => ({
      ...right,
      id: `wrong-${index}`,
      selection,
      lastActivityAt: 100,
    }));
    expect(conversationForReading([...wrong, right], selection)?.id).toBe(
      "right",
    );
    expect(conversationForReading(wrong, selection)).toBeUndefined();
    expect(
      conversationForReading([right], { ...selection, pageNumber: 2 })?.id,
    ).toBe("right");
  });

  it("returns an explicitly selected older conversation and skips unavailable ones", () => {
    const data = createInitialData();
    const selection = data.selection;
    const old = {
      ...data.conversations[0],
      id: "old",
      selection,
      lastActivityAt: 1,
    };
    const recent = { ...old, id: "recent", lastActivityAt: 2 };
    expect(conversationForReading([old, recent], selection)?.id).toBe("recent");
    expect(conversationForReading([old, recent], selection, "old")?.id).toBe(
      "old",
    );
    expect(
      conversationForReading(
        [{ ...old, status: "archived" }, recent],
        selection,
        "old",
      )?.id,
    ).toBe("recent");
    expect(
      conversationForReading(
        [old, recent],
        { ...selection, itemId: "missing" },
        "old",
      ),
    ).toBeUndefined();
  });

  it("keeps background replies attached to their original conversation and reading reference", () => {
    let data = createInitialData();
    const originalSelection = {
      courseId: "c-language",
      version: "example-1",
      kind: "questions" as const,
      itemId: "C001",
      chapterIndex: 0,
    };
    const conversation = createConversation(
      data,
      originalSelection,
      "c-language-teacher",
    );
    conversation.id = "chat-1";
    data = { ...data, conversations: [conversation, ...data.conversations] };
    const turn = aiTurn({
      reference: {
        title: "C 语言资料",
        content: "原题内容",
        selection: originalSelection,
      },
    });
    data = mergeAiTurn(data, turn);
    const nativeId = data.conversations[0].binding?.externalSessionId;
    const whileAway = data.selection;
    data = mergeAiTurn(
      data,
      aiTurn({
        ...turn,
        revision: 2,
        status: "completed",
        completedAt: 200,
        content: "切换页面后继续生成的完整回复。",
      }),
    );
    expect(data.selection).toEqual(whileAway);
    const recovered = conversationForReading(
      data.conversations,
      originalSelection,
    )!;
    expect(recovered.id).toBe("chat-1");
    expect(recovered.selection).toEqual(originalSelection);
    expect(recovered.robotId).toBe("c-language-teacher");
    expect(recovered.binding?.externalSessionId).toBe(nativeId);
    expect(
      recovered.messages.filter((item) => item.role === "user"),
    ).toHaveLength(1);
    expect(recovered.messages.at(-1)?.content).toBe(
      "切换页面后继续生成的完整回复。",
    );
    expect(recovered.turns[0].status).toBe("completed");
  });
});
