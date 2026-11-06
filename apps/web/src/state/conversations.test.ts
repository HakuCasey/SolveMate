import { describe, expect, it } from "vitest";
import { createInitialData } from "../data/catalog";
import {
  createConversation,
  replaceRobots,
  sameContent,
  updateConversation,
  deleteConversation,
} from "./conversations";

describe("conversation and robot changes", () => {
  it("creates an ordinary session without inheriting the last reading selection", () => {
    const data = createInitialData();
    const session = createConversation(data, null, "calculus-teacher");
    expect(session.selection).toBeNull();
    expect(session.robotId).toBe("calculus-teacher");
    expect(createConversation(data).selection).toBeNull();
    expect(data.selection.itemId).toBe("M001");
    expect(sameContent(session.selection, data.selection)).toBe(false);
  });

  it("keeps a reading association only when it is explicitly supplied", () => {
    const data = createInitialData();
    const session = createConversation(data, data.selection);
    expect(session.selection).toEqual(data.selection);
    expect(session.selection).not.toBe(data.selection);
    data.selection.itemId = "M005";
    expect(session.selection?.itemId).toBe("M001");
  });
  it("archives and labels a session without changing its identity, binding or messages", () => {
    const data = createInitialData();
    const session = data.conversations[0];
    session.bindings = [
      {
        connectionId: "local-harness",
        protocol: "opencode",
        externalSessionId: "external-session",
      },
    ];
    const next = updateConversation(data, session.id, {
      label: "重要",
      archived: true,
    });
    const changed = next.conversations[0];
    expect(changed.id).toBe(session.id);
    expect(changed.messages).toBe(session.messages);
    expect(changed.bindings).toBe(session.bindings);
    expect(changed.archivedAt).toBeTypeOf("number");
    const restored = updateConversation(next, session.id, { archived: false });
    expect(restored.conversations[0].archivedAt).toBeUndefined();
    expect(restored.conversations[0].label).toBe("重要");
    expect(data.conversations[0].archived).toBeUndefined();
  });

  it("marks a deleted session without deleting its external binding or affecting other sessions", () => {
    const data = createInitialData();
    const next = deleteConversation(data, data.conversations[0].id);
    expect(next.conversations[0].deletedAt).toBeTypeOf("number");
    expect(next.conversations[0].messages).toEqual(
      data.conversations[0].messages,
    );
    expect(next.conversations[1]).toBe(data.conversations[1]);
    expect(
      updateConversation(next, next.conversations[0].id, { label: "一般" })
        .conversations[0],
    ).toBe(next.conversations[0]);
    expect(() =>
      updateConversation(data, data.conversations[0].id, { label: "  " }),
    ).toThrow();
  });
  it("uses the default robot for a new conversation without changing existing choices", () => {
    const data = createInitialData();
    const previousRobot = data.conversations[0].robotId;
    data.defaultRobotId = "c-language-teacher";
    expect(createConversation(data, data.selection).robotId).toBe(
      "c-language-teacher",
    );
    expect(data.conversations[0].robotId).toBe(previousRobot);
  });

  it("keeps historical authors after deleting every robot", () => {
    const data = createInitialData();
    const next = replaceRobots(data, [], null);
    expect(next.robots).toEqual([]);
    expect(next.defaultRobotId).toBeNull();
    expect(next.conversations.every((item) => item.robotId === null)).toBe(
      true,
    );
    expect(
      next.conversations[0].messages
        .filter((item) => item.role === "assistant")
        .every((item) => item.botName === "高数教师"),
    ).toBe(true);
    expect(data.robots).toHaveLength(3);
  });

  it("separates textbook chapters and courses when selecting a conversation", () => {
    const selection = createInitialData().selection;
    expect(
      sameContent(selection, { ...selection, courseId: "c-language" }),
    ).toBe(false);
    expect(
      sameContent(
        { ...selection, kind: "textbooks" },
        {
          ...selection,
          kind: "textbooks",
          chapterIndex: 1,
        },
      ),
    ).toBe(false);
  });
});
