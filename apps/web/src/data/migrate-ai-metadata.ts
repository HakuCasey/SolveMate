import { migrateNoteMetadata } from "@solvemate/contracts";
import { assertLegacyMetadataV2 as assertV2 } from "@solvemate/contracts";
import legacySchema from "../../../../packages/contracts/legacy/ai-metadata-v2.schema.json";
import type {
  AppData,
  Robot,
  Conversation,
  SessionTurn,
} from "@solvemate/contracts";
import { assertAppData } from "./validation";
import { assertLegacyAppData } from "./legacy-validation";

type RecordValue = Record<string, unknown>;
const record = (value: unknown) => value as RecordValue;
function oldSelection(connection: string | null, model: RecordValue) {
  if (
    model.kind === "model" &&
    connection &&
    model.connectionId &&
    model.connectionId !== connection
  )
    throw new Error("Legacy model belongs to another connection.");
  return {
    connectionId:
      connection ??
      (typeof model.connectionId === "string" ? model.connectionId : null),
    modelId: model.kind === "model" ? String(model.modelId) : null,
  };
}

const unknownRuntime = () => ({
  appVersion: null,
  buildId: null,
  clientKind: null,
});
const numberOrNull = (value: unknown) =>
  typeof value === "number" ? value : null;

export function upgradeRobot(value: unknown): Robot {
  const old = record(value);
  if (old.schemaVersion === 3) return value as Robot;
  if (old.schemaVersion === 2) {
    assertV2("Robot", value);
    const defaults = record(old.aiDefaults),
      connection = record(defaults.connection),
      model = record(defaults.model);
    return {
      ...old,
      schemaVersion: 3,
      aiDefaults:
        connection.kind === "global-default" &&
        model.kind === "connection-default"
          ? null
          : oldSelection(
              connection.kind === "connection"
                ? String(connection.connectionId)
                : null,
              model,
            ),
    } as Robot;
  }
  const { connectionId, modelSource, modelName, ...fields } = old;
  const connection =
    typeof connectionId === "string" && connectionId ? connectionId : null;
  return {
    ...fields,
    schemaVersion: 3,
    revision: 1,
    aiDefaults:
      modelSource === "custom" && typeof modelName === "string" && modelName
        ? { connectionId: connection, modelId: modelName }
        : connection
          ? { connectionId: connection, modelId: null }
          : null,
  } as Robot;
}

export function upgradeConversation(
  value: unknown,
  robots: Robot[],
): Conversation {
  const old = record(value);
  if (old.schemaVersion === 3) return value as Conversation;
  if (old.schemaVersion === 2) {
    const metadata = Object.fromEntries(
      Object.keys(legacySchema.$defs.ConversationMetadata.properties).map(
        (key) => [key, old[key]],
      ),
    );
    assertV2("ConversationMetadata", metadata);
    const config = record(old.aiConfig);
    return {
      ...structuredClone(old),
      schemaVersion: 3,
      aiConfig: oldSelection(
        config.connectionId as string | null,
        record(config.model),
      ),
    } as unknown as Conversation;
  }
  const bindings = (old.bindings ?? []) as RecordValue[];
  const oldTurns = (old.turns ?? []) as RecordValue[];
  const candidates = [
    old.connectionId,
    ...bindings.map((item) => item.connectionId),
    ...oldTurns.map((item) => item.connectionId),
  ].filter((id): id is string => typeof id === "string" && !!id);
  const connections = new Set(candidates);
  const nativeIds = new Set(bindings.map((item) => item.externalSessionId));
  if (connections.size > 1 || nativeIds.size > 1)
    throw new Error(
      "Legacy conversation has conflicting Harness bindings. Existing records were not changed.",
    );
  const connectionId = candidates[0] ?? null;
  const lastModel = oldTurns
    .toSorted((a, b) => Number(a.startedAt) - Number(b.startedAt))
    .at(-1)?.model;
  const retained =
    typeof old.aiModel === "string" && old.aiModel
      ? old.aiModel
      : typeof lastModel === "string" && lastModel
        ? lastModel
        : null;
  const robot = robots.find((item) => item.id === old.robotId);
  const messages = structuredClone(old.messages) as Conversation["messages"];
  const teacherName =
    robot?.name ??
    [...messages]
      .reverse()
      .find((item) => item.botId === old.robotId && item.botName)?.botName ??
    null;
  const binding = bindings[0];
  return {
    schemaVersion: 3,
    revision: 1,
    id: String(old.id),
    title: String(old.title),
    titleSource:
      old.titleSource === "manual" || old.titleSource === "first-message"
        ? old.titleSource
        : "unknown",
    label:
      typeof old.label === "string" && old.label && old.label !== "无标签"
        ? old.label
        : null,
    status:
      old.deletedAt !== undefined
        ? "deleted"
        : old.archived
          ? "archived"
          : "active",
    createdAt: numberOrNull(old.createdAt),
    updatedAt: Number(old.updatedAt),
    lastActivityAt: oldTurns.length
      ? Math.max(
          ...oldTurns.map((item) => Number(item.completedAt ?? item.startedAt)),
        )
      : Number(old.updatedAt),
    archivedAt: numberOrNull(old.archivedAt),
    deletedAt: numberOrNull(old.deletedAt),
    origin: old.example ? "example" : "local",
    creationReason: "unknown",
    sourceConversationId: null,
    createdWith: unknownRuntime(),
    robotId: typeof old.robotId === "string" ? old.robotId : null,
    robotIdentity:
      typeof old.robotId === "string"
        ? { id: old.robotId, name: teacherName, icon: robot?.icon ?? null }
        : null,
    selection: structuredClone(old.selection) as Conversation["selection"],
    aiConfig: { connectionId, modelId: retained },
    binding: binding
      ? {
          conversationId: String(old.id),
          connectionId: connectionId!,
          protocol: binding.protocol as NonNullable<
            Conversation["binding"]
          >["protocol"],
          externalSessionId: String(binding.externalSessionId),
          state: "bound",
          revision: 1,
        }
      : null,
    messages,
    example: Boolean(old.example),
    turns: oldTurns.map((turn) => ({
      ...turn,
      revision: 1,
      submissionStatus: "accepted",
      snapshot: null,
      dispatch: null,
      reportedModelId: null,
    })) as SessionTurn[],
  };
}

/** 先完整迁移并校验，调用方在同一事务中备份旧值后保存；不原地修改输入。 */
export function migrateAiMetadata(value: unknown): AppData {
  const old = record(value);
  if (old.schemaVersion === 3) {
    const next = migrateNoteMetadata(value);
    assertAppData(next);
    return next;
  }
  if (old.schemaVersion !== 2) assertLegacyAppData(value);
  const robots = (old.robots as unknown[]).map(upgradeRobot);
  const next = {
    ...structuredClone(old),
    schemaVersion: 3,
    robots,
    conversations: (old.conversations as unknown[]).map((item) =>
      upgradeConversation(item, robots),
    ),
  };
  const upgraded = migrateNoteMetadata(next);
  assertAppData(upgraded);
  return upgraded;
}
