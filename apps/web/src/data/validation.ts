import type {
  AppData,
  Conversation,
  Message,
  ReadingSelection,
  Robot,
} from "@solvemate/contracts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRobotIcon(value: unknown): value is Robot["icon"] {
  return value === "graduation-cap" || value === "sparkles" || value === "bot";
}

function isSelection(value: unknown): value is ReadingSelection {
  return (
    isRecord(value) &&
    typeof value.courseId === "string" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.courseId) &&
    (value.version === undefined ||
      (typeof value.version === "string" && value.version.length > 0)) &&
    (value.kind === "questions" || value.kind === "textbooks") &&
    typeof value.itemId === "string" &&
    typeof value.chapterIndex === "number" &&
    Number.isInteger(value.chapterIndex) &&
    value.chapterIndex >= 0
  );
}

function isRobot(value: unknown): value is Robot {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.name === "string" &&
    value.name.trim().length > 0 &&
    (value.specialty === undefined || typeof value.specialty === "string") &&
    typeof value.description === "string" &&
    isRobotIcon(value.icon) &&
    typeof value.prompt === "string" &&
    (value.modelSource === "global" || value.modelSource === "custom") &&
    typeof value.modelName === "string" &&
    typeof value.temperature === "number" &&
    Number.isFinite(value.temperature) &&
    value.temperature >= 0 &&
    value.temperature <= 1.5 &&
    typeof value.memoryEnabled === "boolean" &&
    typeof value.courseMemory === "boolean" &&
    Array.isArray(value.skills) &&
    value.skills.every(
      (skill) =>
        skill === "questions" || skill === "textbooks" || skill === "notes",
    )
  );
}

function isMessage(value: unknown): value is Message {
  return (
    isRecord(value) &&
    isOptionalTime(value.createdAt) &&
    (value.turnId === undefined || typeof value.turnId === "string") &&
    (value.externalItemId === undefined ||
      typeof value.externalItemId === "string") &&
    typeof value.id === "string" &&
    (value.role === "user" || value.role === "assistant") &&
    typeof value.content === "string" &&
    (value.botId === undefined ||
      value.botId === null ||
      typeof value.botId === "string") &&
    (value.botName === undefined || typeof value.botName === "string") &&
    (value.botIcon === undefined || isRobotIcon(value.botIcon)) &&
    (value.example === undefined || typeof value.example === "boolean")
  );
}

function isOptionalTime(value: unknown): boolean {
  return (
    value === undefined ||
    (typeof value === "number" && Number.isFinite(value) && value >= 0)
  );
}

function isBinding(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.connectionId === "string" &&
    !!value.connectionId &&
    typeof value.externalSessionId === "string" &&
    !!value.externalSessionId &&
    typeof value.protocol === "string" &&
    ["codex-app-server", "opencode", "openclaw", "hermes", "api"].includes(
      value.protocol,
    )
  );
}

function isTurn(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.connectionId === "string" &&
    typeof value.startedAt === "number" &&
    isOptionalTime(value.startedAt) &&
    isOptionalTime(value.completedAt) &&
    (value.externalTurnId === undefined ||
      typeof value.externalTurnId === "string") &&
    typeof value.status === "string" &&
    ["running", "completed", "failed", "cancelled"].includes(value.status)
  );
}

function isConversation(value: unknown): value is Conversation {
  return (
    isRecord(value) &&
    isOptionalTime(value.createdAt) &&
    isOptionalTime(value.archivedAt) &&
    isOptionalTime(value.deletedAt) &&
    (value.bindings === undefined ||
      (Array.isArray(value.bindings) && value.bindings.every(isBinding))) &&
    (value.turns === undefined ||
      (Array.isArray(value.turns) && value.turns.every(isTurn))) &&
    (value.label === undefined ||
      (typeof value.label === "string" && value.label.length <= 24)) &&
    (value.archived === undefined || typeof value.archived === "boolean") &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.title === "string" &&
    (value.selection === null || isSelection(value.selection)) &&
    (value.robotId === null || typeof value.robotId === "string") &&
    Array.isArray(value.messages) &&
    value.messages.every(isMessage) &&
    typeof value.updatedAt === "number" &&
    Number.isFinite(value.updatedAt) &&
    typeof value.example === "boolean"
  );
}

/** 保存前与读取后都校验，损坏或新版数据不能被默认示例覆盖。 */
export function assertAppData(value: unknown): asserts value is AppData {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    (value.robotCatalogVersion !== undefined && value.robotCatalogVersion !== 1)
  ) {
    throw new Error("Local data has an unsupported schema version.");
  }

  const settings = value.settings;
  if (
    !Array.isArray(value.robots) ||
    !value.robots.every(isRobot) ||
    !Array.isArray(value.conversations) ||
    !value.conversations.every(isConversation) ||
    !isSelection(value.selection) ||
    !isRecord(settings) ||
    typeof settings.fontSize !== "number" ||
    !Number.isInteger(settings.fontSize) ||
    settings.fontSize < 12 ||
    settings.fontSize > 21 ||
    (settings.appearance !== "light" && settings.appearance !== "dark") ||
    typeof settings.globalModel !== "string"
  ) {
    throw new Error("Local data is incomplete or has invalid field values.");
  }

  const robotIds = value.robots.map((robot) => robot.id);
  const conversationIds = value.conversations.map(
    (conversation) => conversation.id,
  );
  if (
    new Set(robotIds).size !== robotIds.length ||
    new Set(conversationIds).size !== conversationIds.length ||
    !(
      value.defaultRobotId === null ||
      (typeof value.defaultRobotId === "string" &&
        robotIds.includes(value.defaultRobotId))
    )
  ) {
    throw new Error(
      "Local data has duplicate IDs or an invalid default robot.",
    );
  }
}
