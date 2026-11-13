import { describe, expect, it } from "vitest";
import type { SessionBinding } from "@solvemate/contracts";
import { createInitialData } from "../data/catalog";
import { assertAppData } from "../data/validation";
import { applyRobotAi, createConversation } from "../state/conversations";
import { mergeData } from "../refresh/merge";
import { aiSettings, aiTurn } from "./fixtures.test-support";
import { mergeAiTurn } from "./state";
import {
  activeSessionBinding,
  receiveSessionBinding,
  retainSessionBindings,
  sessionBindings,
  serviceSwitchKind,
} from "./session-bindings";

function fixture() {
  const data = createInitialData();
  const settings = aiSettings();
  const robot = data.robots[0];
  const conversation = createConversation(data, null, robot.id, settings);
  data.conversations = [conversation];
  const binding: SessionBinding = {
    conversationId: conversation.id,
    connectionId: "deepseek-local",
    externalSessionId: "native-a",
    protocol: "acp",
    state: "bound",
    revision: 2,
  };
  conversation.binding = binding;
  return { data, settings, robot, conversation, binding };
}

describe("service session associations", () => {
  it("switches an empty conversation without a restart confirmation or native association", () => {
    const { data, settings, conversation, robot } = fixture();
    conversation.binding = null;
    conversation.bindings = [];
    let current = data;
    for (const connectionId of ["hermes-local", "deepseek-local"]) {
      const before = current.conversations[0];
      expect(serviceSwitchKind(before, connectionId)).toBeNull();
      current = applyRobotAi(
        current,
        robot.id,
        { connectionId, modelId: "a" },
        settings,
        current.robots.find((item) => item.id === robot.id)!.revision,
        conversation.id,
      );
      expect(current.conversations).toHaveLength(1);
      expect(current.conversations[0].id).toBe(conversation.id);
      expect(sessionBindings(current.conversations[0])).toEqual([]);
      expect(current.conversations[0].messages).toEqual([]);
    }
    // 没有成功提交 AI 的问题仍属于已有讨论，不能被当成空对话。
    current.conversations[0].messages.push({
      id: "saved-question",
      role: "user",
      content: "为什么？",
    });
    expect(serviceSwitchKind(current.conversations[0], "hermes-local")).toBe(
      "service",
    );
    assertAppData(current);
  });

  it("switches services in the same conversation while retaining the original legacy association", () => {
    const { data, settings, robot, conversation, binding } = fixture();
    const switched = applyRobotAi(
      data,
      robot.id,
      { connectionId: "hermes-local", modelId: "a" },
      settings,
      robot.revision,
      conversation.id,
    );
    expect(switched.conversations).toHaveLength(1);
    const current = switched.conversations[0];
    expect(current.id).toBe(conversation.id);
    expect(current.messages).toEqual(conversation.messages);
    expect(current.binding).toBeNull();
    expect(sessionBindings(current)).toEqual([binding]);
    expect(activeSessionBinding(current)).toBeNull();
    const withHermes = receiveSessionBinding(current, {
      ...binding,
      connectionId: "hermes-local",
      externalSessionId: "native-b",
      revision: 1,
    });
    expect(activeSessionBinding(withHermes)?.externalSessionId).toBe(
      "native-b",
    );
    const back = { ...withHermes, aiConfig: conversation.aiConfig };
    expect(activeSessionBinding(back)?.externalSessionId).toBe("native-a");
    expect(serviceSwitchKind(conversation, "hermes-local")).toBe("service");
    expect(serviceSwitchKind(back, "deepseek-local")).toBe("service-resume");
    assertAppData({ ...switched, conversations: [back] });
    expect(data.conversations[0].binding).toEqual(binding);
  });

  it("does not let a late result replace the selected service or a newer session", () => {
    const { data, conversation, robot, binding } = fixture();
    let current = receiveSessionBinding(retainSessionBindings(conversation), {
      ...binding,
      externalSessionId: "replacement-a",
      revision: 5,
    });
    current = receiveSessionBinding(current, {
      ...binding,
      connectionId: "hermes-local",
      externalSessionId: "native-b",
      revision: 3,
    });
    current.aiConfig = { connectionId: "hermes-local", modelId: "a" };
    data.conversations = [current];
    const result = mergeAiTurn(
      data,
      aiTurn({
        conversationId: conversation.id,
        teacher: {
          id: robot.id,
          name: robot.name,
          prompt: robot.prompt,
          icon: robot.icon,
        },
        snapshot: {
          ...aiTurn().snapshot,
          teacher: {
            id: robot.id,
            name: robot.name,
            prompt: robot.prompt,
            icon: robot.icon,
          },
        },
        externalSessionId: "native-a",
        binding: { ...binding, revision: 2 },
        status: "completed",
        content: "old answer",
      }),
    );
    expect(result.conversations[0].aiConfig).toEqual(current.aiConfig);
    expect(
      activeSessionBinding(result.conversations[0])?.externalSessionId,
    ).toBe("native-b");
    expect(
      sessionBindings(result.conversations[0]).find(
        (item) => item.connectionId === "deepseek-local",
      )?.externalSessionId,
    ).toBe("replacement-a");
    expect(result.conversations[0].turns[0].externalSessionId).toBe("native-a");
    assertAppData(result);
  });

  it("merges independent service associations across windows using native revisions", () => {
    const { data, binding } = fixture();
    const local = structuredClone(data),
      remote = structuredClone(data);
    local.conversations[0] = receiveSessionBinding(local.conversations[0], {
      ...binding,
      revision: 3,
    });
    remote.conversations[0] = receiveSessionBinding(remote.conversations[0], {
      ...binding,
      connectionId: "hermes-local",
      externalSessionId: "native-b",
      revision: 1,
    });
    const result = mergeData(data, local, remote);
    expect(result.conflicts).toEqual([]);
    expect(sessionBindings(result.data.conversations[0])).toHaveLength(2);
    expect(activeSessionBinding(result.data.conversations[0])?.revision).toBe(
      3,
    );
    assertAppData(result.data);
  });

  it("rejects duplicate associations and two competing metadata sources", () => {
    const { data, conversation, binding } = fixture();
    conversation.bindings = [binding];
    expect(() => assertAppData(data)).toThrow();
    conversation.binding = null;
    conversation.bindings = [binding, binding];
    expect(() => assertAppData(data)).toThrow();
    conversation.bindings = [binding];
    expect(() => assertAppData(data)).not.toThrow();
    expect(() =>
      receiveSessionBinding(conversation, {
        ...binding,
        externalSessionId: "another",
      }),
    ).toThrow();
  });
});
