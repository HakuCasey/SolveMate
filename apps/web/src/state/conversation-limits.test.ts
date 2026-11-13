import { describe, expect, it } from "vitest";
import { conversationLimits, type Conversation } from "@solvemate/contracts";
import { createInitialData } from "../data/catalog";
import {
  createConversation,
  updateConversation,
  deleteConversation,
} from "./conversations";
import {
  conversationCounts,
  uniqueConversationTitle,
  requireConversationLimits,
} from "./conversation-limits";

function fixture(active: number, archived = 0, deleted = 0) {
  const data = createInitialData();
  const template = createConversation({ ...data, conversations: [] });
  data.conversations = Array.from(
    { length: active + archived + deleted },
    (_, i): Conversation => ({
      ...structuredClone(template),
      id: `session-${i}`,
      title: `对话 ${i}`,
      status:
        i < active ? "active" : i < active + archived ? "archived" : "deleted",
    }),
  );
  return data;
}

describe("conversation limits and generated titles", () => {
  it("numbers duplicate generated names across active and archived records, excluding deleted ones", () => {
    const data = fixture(1, 1, 1);
    data.conversations[0].title = "新对话";
    data.conversations[1].title = "新对话 1";
    data.conversations[2].title = "新对话 2";
    expect(createConversation(data).title).toBe("新对话 2");
    expect(
      uniqueConversationTitle(
        data.conversations,
        "新对话",
        data.conversations[0].id,
      ),
    ).toBe("新对话");
    data.conversations[0].title = "指针是什么？";
    expect(uniqueConversationTitle(data.conversations, "指针是什么？")).toBe(
      "指针是什么？ 1",
    );
  });
  it("allows exactly 12 active conversations and rejects the next one without changing data", () => {
    const data = fixture(conversationLimits.active - 1);
    const next = createConversation(data);
    data.conversations.push(next);
    expect(data.conversations).toHaveLength(conversationLimits.active);
    expect(() => createConversation(data)).toThrow(conversationLimits.message);
    expect(data.conversations).toHaveLength(conversationLimits.active);
  });
  it("checks archiving and restoring against their destination group", () => {
    const fullArchive = fixture(1, conversationLimits.archived);
    expect(() =>
      updateConversation(fullArchive, fullArchive.conversations[0].id, {
        status: "archived",
      }),
    ).toThrow(conversationLimits.message);
    const fullActive = fixture(conversationLimits.active, 1);
    expect(() =>
      updateConversation(fullActive, fullActive.conversations.at(-1)!.id, {
        status: "active",
      }),
    ).toThrow(conversationLimits.message);
    const room = fixture(1, conversationLimits.archived - 1);
    const saved = updateConversation(room, room.conversations[0].id, {
      status: "archived",
    });
    expect(conversationCounts(saved.conversations)).toEqual({
      active: 0,
      archived: conversationLimits.archived,
      total: conversationLimits.archived,
    });
  });
  it("does not count deleted records and releases capacity after deletion", () => {
    const data = fixture(conversationLimits.active, 0, 8);
    const saved = deleteConversation(data, data.conversations[0].id);
    expect(() => createConversation(saved)).not.toThrow();
    expect(conversationCounts(saved.conversations).total).toBe(
      conversationLimits.active - 1,
    );
  });
  it("keeps legacy excess records readable and editable but rejects additional excess", () => {
    const data = fixture(conversationLimits.active + 1);
    expect(() =>
      requireConversationLimits(data.conversations, data.conversations),
    ).not.toThrow();
    expect(() => createConversation(data)).toThrow(conversationLimits.message);
    expect(() =>
      updateConversation(data, data.conversations[0].id, {
        status: "archived",
      }),
    ).not.toThrow();
    const totalExcess = fixture(1, conversationLimits.total);
    expect(() => createConversation(totalExcess)).toThrow(
      conversationLimits.message,
    );
    expect(() =>
      updateConversation(totalExcess, totalExcess.conversations[0].id, {
        title: "重命名",
      }),
    ).not.toThrow();
  });
});
