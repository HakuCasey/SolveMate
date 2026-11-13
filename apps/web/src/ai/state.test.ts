import { describe, expect, it } from "vitest";
import { createInitialData } from "../data/catalog";
import { assertAppData } from "../data/validation";
import { createConversation } from "../state/conversations";
import type { AiTurn } from "./local-api";
import { aiSettings, aiTurn } from "./fixtures.test-support";
import { latestAiSettings, mergeAiTurn } from "./state";

describe("shared AI settings revisions", () => {
  it("does not let a late read replace the saved path, model, or reasoning level", () => {
    const before = aiSettings();
    before.connections[0].config.executablePath =
      "/Applications/DeepSeek Harness.app";
    const saved = structuredClone(before);
    saved.connections[0].revision++;
    saved.connections[0].config = {
      ...saved.connections[0].config,
      executablePath:
        "/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh",
      model: "b",
      reasoningEffort: "high",
    };
    expect(latestAiSettings(saved, before)).toBe(saved);
    expect(latestAiSettings(before, saved)).toBe(saved);
  });

  it("does not restore a deleted connection or clear one that has just been recreated", () => {
    const before = aiSettings();
    const deleted = structuredClone(before);
    deleted.preferencesRevision++;
    deleted.connections.shift();
    deleted.defaultModel = null;
    deleted.defaultConnectionId = null;
    deleted.deletedConnectionIds = ["deepseek-local"];
    expect(latestAiSettings(deleted, before)).toBe(deleted);
    const restored = structuredClone(deleted);
    restored.connections.push({ ...before.connections[0], revision: 3 });
    restored.deletedConnectionIds = [];
    expect(latestAiSettings(restored, deleted)).toBe(restored);
    expect(latestAiSettings(deleted, restored)).toBe(restored);
  });

  it("accepts a newer default model without changing connection revisions", () => {
    const before = aiSettings();
    const next = structuredClone(before);
    next.preferencesRevision++;
    next.defaultModel = { connectionId: "deepseek-local", modelId: "b" };
    expect(latestAiSettings(before, next)).toBe(next);
    expect(latestAiSettings(next, before)).toBe(next);
  });
});

function setup() {
  const data = createInitialData();
  const conversation = createConversation(data, null);
  data.conversations = [conversation];
  conversation.robotId = "c-language-teacher";
  const turn: AiTurn = aiTurn({ conversationId: conversation.id });
  return { data, conversation, turn };
}

describe("AI conversation results", () => {
  it("merges repeated snapshots without duplicating messages or bindings", () => {
    const { data, turn } = setup();
    const first = mergeAiTurn(data, turn);
    const second = mergeAiTurn(first, {
      ...turn,
      content: "整数除法先得到 2。",
      status: "completed",
      revision: 2,
      completedAt: 200,
    });
    const restored = mergeAiTurn(second, {
      ...turn,
      content: "整数除法先得到 2。",
      status: "completed",
      revision: 2,
      completedAt: 200,
    });
    expect(restored.conversations[0]?.messages).toHaveLength(2);
    expect(restored.conversations[0]?.messages[1]?.content).toBe(
      "整数除法先得到 2。",
    );
    expect(restored.conversations[0]?.binding).toMatchObject({
      connectionId: "deepseek-local",
      protocol: "acp",
      externalSessionId: "external-session",
    });
    expect(restored.conversations[0]?.turns).toHaveLength(1);
    assertAppData(restored);
  });

  it("keeps historical teacher and reference snapshots after active settings change", () => {
    const { data, turn } = setup();
    turn.reference = {
      title: "C 教材 · 类型转换",
      content: "double b = a / 2;",
      selection: { ...data.selection },
    };
    const result = mergeAiTurn(data, { ...turn, status: "completed" });
    result.conversations[0]!.robotId = "another-teacher";
    result.selection.itemId = "M002";
    expect(result.conversations[0]?.messages[0]?.reference?.content).toBe(
      "double b = a / 2;",
    );
    expect(result.conversations[0]?.messages[1]?.botName).toBe("C 语言教师");
    expect(result.conversations[0]?.messages[1]?.model).toBe("a");
  });

  it("restores multiple reference snapshots and validates the saved messages", () => {
    const { data, turn } = setup();
    turn.references = [
      {
        title: "第一段",
        content: "int a = 5 / 2;",
        selection: { ...data.selection },
      },
      {
        title: "第二段",
        content: "double b = 5.0 / 2;",
        selection: { ...data.selection },
      },
    ];
    const restored = mergeAiTurn(data, turn);
    expect(restored.conversations[0]?.messages[0]?.references).toEqual(
      turn.references,
    );
    assertAppData(restored);
    turn.references[0].content = "changed";
    expect(
      restored.conversations[0]?.messages[0]?.references?.[0].content,
    ).toBe("int a = 5 / 2;");
  });

  it("does not resurrect deleted conversations or move a completed run back to running", () => {
    const { data, turn } = setup();
    const finished = mergeAiTurn(data, {
      ...turn,
      status: "completed",
      content: "final",
    });
    expect(
      mergeAiTurn(finished, turn).conversations[0]?.messages[1]?.content,
    ).toBe("final");
    data.conversations[0]!.status = "deleted";
    expect(mergeAiTurn(data, turn).conversations[0]?.messages).toEqual([]);
  });

  it("keeps execution order when an older result arrives after a newer turn", () => {
    const { data, turn } = setup();
    const first = { ...turn, status: "completed" as const, completedAt: 200 };
    const second = {
      ...first,
      id: "turn-2",
      userMessageId: "user-2",
      assistantMessageId: "assistant-2",
      startedAt: 300,
      completedAt: 400,
    };
    const restored = mergeAiTurn(
      mergeAiTurn(mergeAiTurn(data, first), second),
      first,
    );
    expect(restored.conversations[0]?.turns?.map((item) => item.id)).toEqual([
      "turn-1",
      "turn-2",
    ]);
    expect(restored.conversations[0]?.messages.at(-1)?.id).toBe("assistant-2");
  });

  it("preserves partial replies and errors after interruption", () => {
    const { data, turn } = setup();
    const result = mergeAiTurn(data, {
      ...turn,
      status: "interrupted",
      error: "服务停止。",
    });
    expect(result.conversations[0]?.messages[1]?.content).toBe("整数除法");
    expect(result.conversations[0]?.turns?.[0]?.error).toBe("服务停止。");
    assertAppData(result);
  });

  it("keeps old example messages distinguishable from new real replies", () => {
    const { data, turn } = setup();
    data.conversations[0]!.example = true;
    data.conversations[0]!.messages = [
      { id: "example", role: "assistant", content: "示例内容" },
    ];
    const result = mergeAiTurn(data, turn).conversations[0]!;
    expect(result.example).toBe(false);
    expect(result.messages[0]?.example).toBe(true);
    expect(result.messages.at(-1)?.example).toBeUndefined();
  });
});

it("keeps native Codex protocol and turn identifiers when restoring snapshots", () => {
  const { data, turn } = setup();
  const result = mergeAiTurn(data, {
    ...turn,
    connectionId: "codex-local",
    provider: "codex",
    snapshot: {
      ...turn.snapshot,
      connectionId: "codex-local",
      providerId: "codex",
      modelSelection: {
        kind: "model",
        connectionId: "codex-local",
        modelId: "a",
      },
    },
    protocol: "codex-app-server",
    externalTurnId: "codex-turn",
    status: "completed",
  });
  expect(result.conversations[0].binding).toMatchObject({
    connectionId: "codex-local",
    protocol: "codex-app-server",
    externalSessionId: "external-session",
  });
  expect(result.conversations[0].turns?.[0].externalTurnId).toBe("codex-turn");
  assertAppData(result);
});
