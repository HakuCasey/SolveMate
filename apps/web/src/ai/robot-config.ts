import type {
  Conversation,
  Robot,
  RobotAiDefaults,
  ConversationAiConfig,
} from "@solvemate/contracts";
import type { AiConnection, AiSettings, Detection } from "./local-api";

export const AI_PROVIDERS = [
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
];
export function providerInfo(provider: string, settings: AiSettings | null) {
  const info =
    settings?.services.find((item) => item.provider === provider) ??
    AI_PROVIDERS.find((item) => item.provider === provider);
  return {
    name: info?.name ?? provider,
    shortName: info?.shortName ?? info?.name ?? provider,
  };
}
export type RobotAiConfig = RobotAiDefaults;
export function robotAiConfig(robot: Robot): RobotAiConfig {
  return structuredClone(robot.aiDefaults);
}
export function isRobotAiModified(saved: Robot, draft: RobotAiDefaults) {
  return JSON.stringify(saved.aiDefaults) !== JSON.stringify(draft);
}
/** 连接状态统一解析；旧版本字段仅在此兼容，不再作为启停开关展示。 */
export function connectionIsConnected(connection?: AiConnection) {
  return (
    !!connection &&
    (connection.state
      ? connection.state === "connected"
      : connection.enabled && connection.check.status !== "error")
  );
}
/** 推理选项跟随具体模型；未返回选项时不借用其他模型的数据。 */
export function reasoningForModel(
  detection: Detection | null,
  modelId: string,
) {
  const model = detection?.models.find((item) => item.value === modelId);
  return {
    options:
      model?.reasoningOptions ??
      (modelId === detection?.currentModel ? detection.reasoningOptions : []),
    defaultValue:
      model?.defaultReasoning ??
      (modelId === detection?.currentModel ? detection.currentReasoning : ""),
  };
}
export function globalModel(settings: AiSettings | null) {
  if (settings?.defaultModel !== undefined) return settings.defaultModel;
  const connection = settings?.connections.find(
    (item) => item.id === settings.defaultConnectionId,
  );
  return connectionIsConnected(connection) && connection?.config.model
    ? { connectionId: connection.id, modelId: connection.config.model }
    : null;
}
export function configuredConnections(
  settings: AiSettings | null,
): AiConnection[] {
  return settings?.connections.filter(connectionIsConnected) ?? [];
}
/** 读取原选择时保留停用和检测失败的连接，供界面说明原因，不能退回其他服务。 */
export function connectionFor(settings: AiSettings | null, id?: string | null) {
  return settings?.connections.find(
    (item) =>
      item.id === (id === undefined ? globalModel(settings)?.connectionId : id),
  );
}
export function defaultConnection(settings: AiSettings | null) {
  return connectionFor(settings, globalModel(settings)?.connectionId ?? null);
}
export function conversationConnectionId(conversation?: Conversation) {
  return conversation?.aiConfig.connectionId ?? undefined;
}
export function defaultsForConversation(
  conversation: Conversation | undefined,
  robot: Robot | undefined,
): RobotAiDefaults {
  return conversation?.aiConfig.connectionId
    ? structuredClone(conversation.aiConfig)
    : (robot?.aiDefaults ?? null);
}
function resolveSelection(
  connectionId: string | null | undefined,
  modelId: string | null,
  settings: AiSettings | null,
) {
  const connection = connectionFor(settings, connectionId ?? null),
    config = connection?.config;
  // modelId 为空仅用于尚未确定选择或迁移中的旧默认模型，实际提问前保存明确编号。
  const model = modelId ?? config?.model ?? "";
  const option = connection?.detection.models.find(
    (item) => item.value === model,
  );
  const provider =
    config?.provider ??
    settings?.services.find((item) => item.id === connectionId)?.provider ??
    AI_PROVIDERS.find((item) => item.id === connectionId)?.provider ??
    "";
  const info = providerInfo(provider, settings);
  const deleted =
    !connection &&
    !!connectionId &&
    !!settings?.deletedConnectionIds?.includes(connectionId);
  const error = !connection
    ? deleted
      ? "所选 AI 连接已删除，请重新配置或选择其他服务。"
      : modelId
        ? "原模型所属连接尚未确认，请重新选择服务和模型。"
        : "请先在设置中配置 AI。"
    : !connectionIsConnected(connection)
      ? "所选 AI 服务未连接，请在设置中检测连接。"
      : !option
        ? "所选模型已不可用，请重新配置 AI 或选择其他模型。"
        : "";
  return {
    connectionId: connection?.id ?? connectionId ?? "",
    connectionRevision: connection?.revision ?? null,
    model,
    modelName: error ? "" : (option?.name ?? ""),
    harness: info.name,
    hasSelection: !!connectionId || !!modelId,
    deleted,
    label: !error && option ? `${info.shortName} | ${option.name}` : "AI 配置",
    configured: !!config,
    error,
  };
}
export function resolveDefaults(
  config: RobotAiDefaults,
  settings: AiSettings | null,
) {
  return config === null
    ? resolveSelection(
        globalModel(settings)?.connectionId,
        globalModel(settings)?.modelId ?? null,
        settings,
      )
    : resolveSelection(config.connectionId, config.modelId, settings);
}
export function resolveRobotAi(
  robot: Robot | undefined,
  settings: AiSettings | null,
) {
  return resolveDefaults(robot?.aiDefaults ?? null, settings);
}
export function resolveConversationAi(
  conversation: Conversation | undefined,
  robot: Robot | undefined,
  settings: AiSettings | null,
) {
  return conversation?.aiConfig.connectionId || conversation?.aiConfig.modelId
    ? resolveSelection(
        conversation.aiConfig.connectionId,
        conversation.aiConfig.modelId,
        settings,
      )
    : resolveRobotAi(robot, settings);
}
export function robotAiError(
  config: RobotAiDefaults,
  settings: AiSettings | null,
) {
  return resolveDefaults(config, settings).error;
}
export function initialConversationAi(
  robot: Robot | undefined,
  settings: AiSettings | null,
): ConversationAiConfig {
  const effective = resolveRobotAi(robot, settings);
  return {
    connectionId: effective.connectionId || null,
    modelId: effective.model || null,
  };
}
