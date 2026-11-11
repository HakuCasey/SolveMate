import type { AiSettings, AiTurn, ProviderId } from "@solvemate/contracts";

export function aiSettings(
  provider: ProviderId = "deepseek-harness",
  model = "a",
): AiSettings {
  const services = [
    {
      id: "deepseek-local",
      provider: "deepseek-harness" as const,
      name: "DeepSeek Harness",
      shortName: "DSH",
    },
    {
      id: "hermes-local",
      provider: "hermes" as const,
      name: "Hermes",
      shortName: "Hermes",
    },
    {
      id: "codex-local",
      provider: "codex" as const,
      name: "Codex",
      shortName: "Codex",
    },
  ].map((item) => ({ ...item, defaultPath: "/default", detectedPath: "/app" }));
  return {
    schemaVersion: 3,
    preferencesRevision: 1,
    enabled: true,
    defaultConnectionId: services.find((item) => item.provider === provider)!
      .id,
    busy: false,
    services,
    connections: services.map((item) => ({
      id: item.id,
      revision: 1,
      enabled: true,
      check: { status: "ready", checkedAt: 1, error: null },
      config: {
        provider: item.provider,
        executablePath: "/app",
        model,
        reasoningEffort: "",
      },
      detection: {
        executablePath: "/app",
        version: "test",
        models: [
          { value: "a", name: "GLM 5.3", group: "vendor" },
          { value: "b", name: "DeepSeek-V4-Pro", group: "vendor" },
        ],
        currentModel: model,
        reasoningOptions: [],
        currentReasoning: "",
        capabilities: {
          models: "supported",
          resume: "supported",
          textUpdates: "supported",
          rawTextDeltas: "unknown",
          rename: "unknown",
          archive: "unknown",
          attachments: "unknown",
        },
      },
    })),
  };
}
export function aiTurn(overrides: Partial<AiTurn> = {}): AiTurn {
  const teacher = {
    id: "c-language-teacher",
    name: "C 语言教师",
    prompt: "认真解释。",
    icon: "bot" as const,
  };
  const base: AiTurn = {
    schemaVersion: 2,
    submissionStatus: "accepted",
    revision: 1,
    id: "turn-1",
    conversationId: "chat-1",
    connectionId: "deepseek-local",
    provider: "deepseek-harness",
    protocol: "acp",
    userMessageId: "user-1",
    assistantMessageId: "assistant-1",
    text: "为什么结果是 2.0？",
    teacher,
    reference: null,
    model: "a",
    reasoningEffort: "",
    status: "running",
    phase: "waiting",
    startedAt: 100,
    lastActivityAt: 100,
    content: "整数除法",
    error: "",
    tools: [],
    permissions: [],
    externalSessionId: "external-session",
    dispatch: null,
    reportedModelId: null,
    snapshot: {
      connectionId: "deepseek-local",
      connectionRevision: 1,
      conversationRevision: 1,
      robotRevision: 1,
      providerId: "deepseek-harness",
      serviceName: "DeepSeek Harness",
      modelSelection: {
        kind: "model",
        connectionId: "deepseek-local",
        modelId: "a",
      },
      requestedModelId: "a",
      requestedModelName: "GLM 5.3",
      reasoningEffort: "",
      teacher,
      client: { appVersion: null, buildId: null, clientKind: null },
      localServiceVersion: null,
    },
  };
  return { ...base, ...overrides };
}
