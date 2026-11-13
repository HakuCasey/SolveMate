import { describe, expect, it } from "vitest";
import { createInitialData } from "../data/catalog";
import { createRobot } from "../state/robots";
import { createConversation, applyRobotAi } from "../state/conversations";
import { upgradeConversation, upgradeRobot } from "../data/migrate-ai-metadata";
import {
  resolveRobotAi,
  resolveConversationAi,
  robotAiConfig,
  isRobotAiModified,
  robotAiError,
  defaultsForConversation,
} from "./robot-config";
import { aiSettings } from "./fixtures.test-support";

describe("shared robot and conversation AI metadata", () => {
  it("follows connection default model without copying it into the teacher", () => {
    const robot = createRobot();
    expect(resolveRobotAi(robot, aiSettings()).label).toBe("DSH | GLM 5.3");
    expect(
      resolveRobotAi(robot, aiSettings("deepseek-harness", "b")).model,
    ).toBe("b");
    expect(robot.aiDefaults).toBeNull();
  });
  it("uses a scoped teacher override for display and submission", () => {
    const robot = createRobot();
    robot.aiDefaults = {
      connectionId: "deepseek-local",
      modelId: "b",
    };
    expect(resolveRobotAi(robot, aiSettings()).label).toBe(
      "DSH | DeepSeek-V4-Pro",
    );
    expect(robotAiError(robot.aiDefaults, aiSettings())).toBe("");
  });
  it("does not reuse stored catalogs when AI is disconnected", () => {
    const robot = createRobot();
    robot.aiDefaults = { connectionId: "deepseek-local", modelId: "a" };
    expect(
      resolveRobotAi(robot, {
        ...aiSettings(),
        connections: aiSettings().connections.map((item) => ({
          ...item,
          enabled: false,
        })),
      }).error,
    ).toContain("未连接");
  });
  it("retains a removed model and reports a useful error until the catalog recovers", () => {
    const robot = createRobot();
    robot.aiDefaults = {
      connectionId: "deepseek-local",
      modelId: "b",
    };
    const settings = aiSettings();
    settings.connections[0].detection.models.pop();
    expect(resolveRobotAi(robot, settings).error).toContain("不可用");
    expect(robotAiError(robot.aiDefaults, aiSettings())).toBe("");
  });
  it("refreshes available choices without removing historical session references", () => {
    const data = createInitialData();
    const robot = data.robots[0];
    robot.aiDefaults = { connectionId: "deepseek-local", modelId: "b" };
    const session = createConversation(data, null, robot.id, aiSettings());
    const settings = aiSettings();
    settings.connections = settings.connections.filter(
      (item) => item.id !== "deepseek-local",
    );
    settings.defaultConnectionId = null;
    settings.defaultModel = null;
    settings.deletedConnectionIds = ["deepseek-local"];
    for (const selection of [
      resolveRobotAi(robot, settings),
      resolveConversationAi(session, robot, settings),
    ]) {
      expect(selection.label).toBe("AI 配置");
      expect(selection.modelName).toBe("");
      expect(selection.error).toContain("已删除");
    }
    expect(robot.aiDefaults).toEqual({
      connectionId: "deepseek-local",
      modelId: "b",
    });
    expect(session.aiConfig).toEqual(robot.aiDefaults);
    expect(resolveConversationAi(session, robot, aiSettings()).label).toBe(
      "DSH | DeepSeek-V4-Pro",
    );
  });
  it("reads a new global default while keeping an existing session's explicit model", () => {
    const data = createInitialData();
    const robot = data.robots[0];
    robot.aiDefaults = null;
    const session = createConversation(data, null, robot.id, aiSettings());
    const settings = aiSettings();
    settings.defaultModel = { connectionId: "deepseek-local", modelId: "b" };
    expect(resolveRobotAi(robot, settings).label).toBe("DSH | DeepSeek-V4-Pro");
    expect(resolveConversationAi(undefined, robot, settings).model).toBe("b");
    expect(resolveConversationAi(session, robot, settings).model).toBe("a");
  });
  it("extracts AI values without publishing unsaved persona fields", () => {
    const robot = createRobot(),
      draft = {
        ...robot,
        name: "未保存",
        prompt: "未保存",
        aiDefaults: { connectionId: "deepseek-local", modelId: "b" },
      };
    const next = { ...robot, aiDefaults: robotAiConfig(draft) };
    expect(next.name).toBe(robot.name);
    expect(isRobotAiModified(robot, draft.aiDefaults)).toBe(true);
    expect(isRobotAiModified(next, draft.aiDefaults)).toBe(false);
  });
  it("converts a legacy binding once and keeps DSH when global service changes", () => {
    const data = createInitialData();
    const old = {
      id: "old",
      title: "旧对话",
      updatedAt: 1,
      messages: [],
      selection: null,
      robotId: data.robots[0].id,
      example: false,
      bindings: [
        {
          connectionId: "deepseek-local",
          protocol: "acp",
          externalSessionId: "native",
        },
      ],
    };
    const session = upgradeConversation(old, data.robots);
    expect(
      resolveConversationAi(session, data.robots[0], aiSettings("hermes"))
        .connectionId,
    ).toBe("deepseek-local");
    expect(session.binding?.externalSessionId).toBe("native");
  });
  it("migrates last recorded request model without claiming an actual returned model", () => {
    const session = upgradeConversation(
      {
        id: "old",
        title: "旧对话",
        updatedAt: 1,
        messages: [],
        selection: null,
        robotId: null,
        example: false,
        turns: [
          {
            id: "turn",
            connectionId: "deepseek-local",
            model: "b",
            status: "completed",
            startedAt: 1,
          },
        ],
      },
      [],
    );
    expect(session.aiConfig).toEqual({
      connectionId: "deepseek-local",
      modelId: "b",
    });
    expect(session.turns[0].reportedModelId).toBeNull();
  });
  it("reads a conversation choice independently of a changed teacher default", () => {
    const data = createInitialData(),
      session = createConversation(
        data,
        null,
        data.defaultRobotId,
        aiSettings(),
      );
    const robot = {
      ...data.robots[0],
      aiDefaults: { connectionId: "deepseek-local", modelId: "b" },
    };
    expect(resolveConversationAi(session, robot, aiSettings()).model).toBe("a");
    expect(defaultsForConversation(session, robot)).toEqual(session.aiConfig);
  });
  it("updates same-service conversations together but preserves another service and history", () => {
    const data = createInitialData(),
      robot = data.robots[0];
    const first = createConversation(data, null, robot.id, aiSettings()),
      second = createConversation(data, null, robot.id, aiSettings("hermes"));
    data.conversations = [first, second];
    const next = applyRobotAi(
      data,
      robot.id,
      {
        connectionId: "deepseek-local",
        modelId: "b",
      },
      aiSettings(),
      robot.revision,
    );
    expect(next.conversations[0].aiConfig).toMatchObject({
      modelId: "b",
    });
    expect(next.conversations[1]).toBe(second);
    expect(next.conversations[0].turns).toBe(first.turns);
  });
  it("does not match identical model IDs across different services", () => {
    const robot = createRobot();
    robot.aiDefaults = {
      connectionId: "deepseek-local",
      modelId: "a",
    };
    expect(resolveRobotAi(robot, aiSettings("hermes")).connectionId).toBe(
      "deepseek-local",
    );
  });
  it("retains unresolved legacy custom models until the user selects a connection", () => {
    const robot = upgradeRobot({
      id: "old",
      name: "教师",
      description: "",
      icon: "bot",
      prompt: "",
      modelSource: "custom",
      modelName: "a",
      temperature: 0.4,
      memoryEnabled: true,
      courseMemory: true,
      skills: [],
    });
    expect(robot.aiDefaults).toMatchObject({
      connectionId: null,
      modelId: "a",
    });
    expect(resolveRobotAi(robot, aiSettings("hermes")).error).toContain(
      "尚未确认",
    );
  });
  it("resolves Codex through the same service metadata", () => {
    expect(resolveRobotAi(createRobot(), aiSettings("codex")).label).toBe(
      "Codex | GLM 5.3",
    );
  });
  it("rejects stale teacher revisions and invalid model scopes", () => {
    const data = createInitialData();
    expect(() =>
      applyRobotAi(
        data,
        data.robots[0].id,
        data.robots[0].aiDefaults,
        aiSettings(),
        99,
      ),
    ).toThrow("已更新");
  });
});

// 连接管理与内部选择使用相同范围，支持接入的目录不能冒充已保存连接。
describe("external connections and internal AI selections", () => {
  it("includes only configured and enabled connections without failed checks", async () => {
    const { configuredConnections } = await import("./robot-config");
    const settings = aiSettings();
    settings.connections = settings.connections.filter(
      (item) => item.id !== "codex-local",
    );
    settings.connections[1].enabled = false;
    expect(settings.services.map((item) => item.id)).toContain("codex-local");
    expect(configuredConnections(settings).map((item) => item.id)).toEqual([
      "deepseek-local",
    ]);
    settings.connections[0].check = {
      status: "error",
      checkedAt: 100,
      error: "Program missing.",
    };
    expect(configuredConnections(settings)).toEqual([]);
  });
  it("keeps a private choice when the global default changes", () => {
    const robot = createRobot();
    robot.aiDefaults = { connectionId: "deepseek-local", modelId: "a" };
    const settings = aiSettings("hermes", "b");
    expect(resolveRobotAi(robot, settings).label).toBe("DSH | GLM 5.3");
    robot.aiDefaults = null;
    expect(resolveRobotAi(robot, settings).label).toBe(
      "Hermes | DeepSeek-V4-Pro",
    );
  });
  it("freezes a new conversation model independently from later global changes", () => {
    const data = createInitialData(),
      settings = aiSettings();
    const session = createConversation(
      data,
      null,
      data.defaultRobotId,
      settings,
    );
    expect(session.aiConfig).toEqual({
      connectionId: "deepseek-local",
      modelId: "a",
    });
    settings.connections[0].config.model = "b";
    expect(resolveRobotAi(data.robots[0], settings).model).toBe("b");
    expect(resolveConversationAi(session, data.robots[0], settings).model).toBe(
      "a",
    );
  });
  it("keeps disabled selected values and explains why they cannot be used", () => {
    const robot = createRobot();
    robot.aiDefaults = { connectionId: "hermes-local", modelId: "b" };
    const settings = aiSettings();
    settings.connections[1].enabled = false;
    const result = resolveRobotAi(robot, settings);
    expect(result.connectionId).toBe("hermes-local");
    expect(result.model).toBe("b");
    expect(result.error).toContain("未连接");
  });
});

it("retains a deleted connection and model instead of falling back to the global service", () => {
  const data = createInitialData(),
    settings = aiSettings("hermes"),
    robot = data.robots[0];
  robot.aiDefaults = { connectionId: "deepseek-local", modelId: "a" };
  const conversation = createConversation(data, null, robot.id, settings);
  settings.connections = settings.connections.filter(
    (item) => item.id !== "deepseek-local",
  );
  settings.deletedConnectionIds = ["deepseek-local"];
  expect(resolveRobotAi(robot, settings).error).toContain("已删除");
  const result = resolveConversationAi(conversation, robot, settings);
  expect(result.connectionId).toBe("deepseek-local");
  expect(result.model).toBe("a");
  expect(result.label).toBe("AI 配置");
  expect(result.deleted).toBe(true);
  expect(conversation.aiConfig).toEqual({
    connectionId: "deepseek-local",
    modelId: "a",
  });
});

it("orders connected services by the shared supported directory", async () => {
  const { configuredConnections, supportedServices } =
    await import("./robot-config");
  const settings = aiSettings("hermes");
  settings.connections.reverse();
  expect(configuredConnections(settings).map((item) => item.id)).toEqual(
    supportedServices(settings).map((item) => item.id),
  );
  settings.connections = settings.connections.filter(
    (item) => item.id !== "deepseek-local",
  );
  expect(supportedServices(settings)[0].provider).toBe("deepseek-harness");
  expect(configuredConnections(settings)[0].config.provider).toBe("hermes");
});
