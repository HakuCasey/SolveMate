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
  it("renames active and archived sessions without changing their history or external binding", () => {
    for (const archived of [false, true]) {
      const data = createInitialData();
      const original = data.conversations[0];
      original.status = archived ? "archived" : "active";
      original.binding = {
        conversationId: original.id,
        state: "bound",
        revision: 1,
        connectionId: "deepseek-local",
        protocol: "acp",
        externalSessionId: "existing-session",
      };
      const renamed = updateConversation(data, original.id, {
        title: "  指针与数组讨论  ",
      });
      const changed = renamed.conversations[0];
      expect(changed.title).toBe("指针与数组讨论");
      expect(changed.titleSource).toBe("manual");
      expect(changed.id).toBe(original.id);
      expect(changed.messages).toBe(original.messages);
      expect(changed.binding).toBe(original.binding);
      expect(changed.selection).toBe(original.selection);
      expect(changed.status).toBe(archived ? "archived" : "active");
      expect(changed.lastActivityAt).toBe(original.lastActivityAt);
      expect(changed.revision).toBe(original.revision + 1);
      expect(renamed.conversations[1]).toBe(data.conversations[1]);
      expect(original.titleSource).toBe("unknown");
    }
  });

  it("rejects empty or overlong names and leaves deleted sessions unchanged", () => {
    const data = createInitialData();
    const original = data.conversations[0];
    for (const title of ["", "  ", "x".repeat(101)])
      expect(() => updateConversation(data, original.id, { title })).toThrow();
    const deleted = deleteConversation(data, original.id);
    expect(() =>
      updateConversation(deleted, original.id, { title: "已改名" }),
    ).toThrow("已删除");
    expect(deleted.conversations[0].title).toBe(original.title);
    const manual = updateConversation(data, original.id, { title: "新对话" });
    expect(manual.conversations[0].titleSource).toBe("manual");
  });

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
    session.binding = {
      conversationId: session.id,
      state: "bound",
      revision: 1,
      connectionId: "local-harness",
      protocol: "opencode",
      externalSessionId: "external-session",
    };
    const next = updateConversation(data, session.id, {
      label: "重要",
      status: "archived",
    });
    const changed = next.conversations[0];
    expect(changed.id).toBe(session.id);
    expect(changed.messages).toBe(session.messages);
    expect(changed.binding).toBe(session.binding);
    expect(changed.archivedAt).toBeTypeOf("number");
    const restored = updateConversation(next, session.id, { status: "active" });
    expect(restored.conversations[0].archivedAt).toBeNull();
    expect(restored.conversations[0].label).toBe("重要");
    expect(data.conversations[0].status).toBe("active");
  });

  it("marks a deleted session without deleting its external binding or affecting other sessions", () => {
    const data = createInitialData();
    const original = data.conversations[0];
    original.aiConfig = { connectionId: "deepseek-local", modelId: "model-a" };
    original.binding = {
      conversationId: original.id,
      connectionId: "deepseek-local",
      protocol: "acp",
      externalSessionId: "preserved-native-session",
      state: "bound",
      revision: 1,
    };
    const next = deleteConversation(data, data.conversations[0].id);
    expect(next.conversations[0].status).toBe("deleted");
    expect(next.conversations[0].binding).toBe(original.binding);
    expect(next.conversations[0].aiConfig).toBe(original.aiConfig);
    expect(next.conversations[0].deletedAt).toBeTypeOf("number");
    expect(next.conversations[0].messages).toEqual(
      data.conversations[0].messages,
    );
    expect(next.conversations[1]).toBe(data.conversations[1]);
    expect(() =>
      updateConversation(next, next.conversations[0].id, { label: "一般" }),
    ).toThrow("已删除");
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
    expect(next.conversations.map((item) => item.robotId)).toEqual(
      data.conversations.map((item) => item.robotId),
    );
    expect(next.conversations[0].robotIdentity?.name).toBe("高数教师");
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
