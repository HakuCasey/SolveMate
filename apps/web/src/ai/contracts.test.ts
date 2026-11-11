import { describe, expect, it } from "vitest";
import { assertMetadata, type AiTurn } from "@solvemate/contracts";
import fixtures from "../../../../packages/contracts/fixtures/ai-metadata.json";
import { aiTurn } from "./fixtures.test-support";
import { decodeAiTurn } from "./metadata";
import { createInitialData } from "../data/catalog";
import { createConversation } from "../state/conversations";
import { mergeAiTurn } from "./state";

describe("shared Python and TypeScript contract cases", () => {
  for (const [index, fixture] of fixtures.entries())
    it(`${index}: ${fixture.name} ${fixture.valid ? "accepted" : "rejected"}`, () => {
      const validate = () =>
        assertMetadata(
          fixture.name as Parameters<typeof assertMetadata>[0],
          fixture.value,
        );
      if (fixture.valid) expect(validate).not.toThrow();
      else expect(validate).toThrow();
    });
  it("rejects a future execution format", () => {
    expect(() => decodeAiTurn({ ...aiTurn(), schemaVersion: 99 })).toThrow(
      "不受支持",
    );
  });
  it("does not apply an older terminal snapshot after a newer text correction", () => {
    const data = createInitialData(),
      conversation = createConversation(data, null, "c-language-teacher");
    data.conversations = [conversation];
    const original = aiTurn({
      conversationId: conversation.id,
      revision: 3,
      status: "completed",
      content: "完整回复",
    });
    const latest = mergeAiTurn(data, original);
    const older: AiTurn = { ...original, revision: 2, content: "旧回复" };
    expect(mergeAiTurn(latest, older)).toBe(latest);
    expect(latest.conversations[0].messages.at(-1)?.content).toBe("完整回复");
  });
  it("does not let history restoration replace a current model selection", () => {
    const data = createInitialData(),
      conversation = createConversation(data, null, "c-language-teacher");
    conversation.aiConfig = {
      connectionId: "deepseek-local",
      modelId: "b",
    };
    data.conversations = [conversation];
    const result = mergeAiTurn(
      data,
      aiTurn({ conversationId: conversation.id, status: "completed" }),
    );
    expect(result.conversations[0].aiConfig).toEqual(conversation.aiConfig);
    expect(result.conversations[0].turns[0].snapshot?.requestedModelId).toBe(
      "a",
    );
  });
});
