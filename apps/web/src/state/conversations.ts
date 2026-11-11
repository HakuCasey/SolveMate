import type {
  AppData,
  Conversation,
  ReadingSelection,
  Robot,
  AiSettings,
  RobotAiDefaults,
} from "@solvemate/contracts";
import { clientRuntime } from "../version";
import { initialConversationAi, resolveDefaults } from "../ai/robot-config";
import { isRobotModified } from "./robots";

export function sameContent(
  a: ReadingSelection | null,
  b: ReadingSelection | null,
): boolean {
  if (!a || !b) return a === b;
  return (
    a.courseId === b.courseId &&
    (a.version ?? "example-1") === (b.version ?? "example-1") &&
    a.kind === b.kind &&
    a.itemId === b.itemId &&
    (a.kind === "questions" || a.chapterIndex === b.chapterIndex)
  );
}

/** 按学习活动找最近的未归档会话；改名或改标签不改变恢复顺序。 */
export function latestConversation(conversations: Conversation[]) {
  return conversations.reduce<Conversation | undefined>((latest, item) => {
    if (item.status !== "active") return latest;
    const activity = item.lastActivityAt ?? item.createdAt ?? 0;
    const previousActivity = latest
      ? (latest.lastActivityAt ?? latest.createdAt ?? 0)
      : -1;
    return !latest ||
      activity > previousActivity ||
      (activity === previousActivity &&
        (item.createdAt ?? 0) > (latest.createdAt ?? 0))
      ? item
      : latest;
  }, undefined);
}

export function conversationForReading(
  conversations: Conversation[],
  selection: ReadingSelection,
  preferredId: string | null = null,
) {
  const matching = conversations.filter(
    (item) =>
      item.status === "active" && sameContent(item.selection, selection),
  );
  // 用户从条目返回某个旧会话时保留该选择；科目入口则取最近一条。
  return (
    matching.find((item) => item.id === preferredId) ??
    latestConversation(matching)
  );
}

export function createConversation(
  data: AppData,
  selection: ReadingSelection | null = null,
  robotId = data.defaultRobotId,
  settings: AiSettings | null = null,
  reason: Conversation["creationReason"] = "new",
  sourceId: string | null = null,
): Conversation {
  const robot = data.robots.find((item) => item.id === robotId),
    now = Date.now();
  return {
    schemaVersion: 3,
    revision: 1,
    id: crypto.randomUUID(),
    title: "新对话",
    titleSource: "default",
    label: null,
    status: "active",
    createdAt: now,
    updatedAt: now,
    lastActivityAt: null,
    archivedAt: null,
    deletedAt: null,
    origin: "local",
    creationReason: reason,
    sourceConversationId: sourceId,
    createdWith: clientRuntime(),
    robotId: robot?.id ?? null,
    robotIdentity: robot
      ? { id: robot.id, name: robot.name, icon: robot.icon }
      : null,
    selection: selection ? structuredClone(selection) : null,
    aiConfig: initialConversationAi(robot, settings),
    binding: null,
    turns: [],
    messages: [],
    example: false,
  };
}
export type ConversationChange = Partial<
  Pick<Conversation, "title" | "label" | "status">
>;
export function updateConversation(
  data: AppData,
  id: string,
  change: ConversationChange,
  expectedRevision?: number,
): AppData {
  const title = change.title?.trim(),
    label = change.label?.trim();
  if (title !== undefined && (!title || title.length > 100))
    throw new Error("请输入 1–100 字的对话名称。");
  if (label !== undefined && (!label || label.length > 24))
    throw new Error("标签名称不能超过 24 字。");
  return {
    ...data,
    conversations: data.conversations.map((item) => {
      if (item.id !== id || item.status === "deleted") return item;
      if (expectedRevision !== undefined && item.revision !== expectedRevision)
        throw new Error("对话已更新，请重新打开后再修改。");
      if (change.status === "deleted") throw new Error("请使用删除对话操作。");
      return {
        ...item,
        ...change,
        revision: item.revision + 1,
        updatedAt: Date.now(),
        ...(title === undefined
          ? {}
          : { title, titleSource: "manual" as const }),
        ...(change.label === undefined
          ? {}
          : { label: label && label !== "无标签" ? label : null }),
        ...(change.status === undefined
          ? {}
          : { archivedAt: change.status === "archived" ? Date.now() : null }),
      };
    }),
  };
}
export function deleteConversation(data: AppData, id: string): AppData {
  return {
    ...data,
    conversations: data.conversations.map((item) =>
      item.id === id && item.status !== "deleted"
        ? {
            ...item,
            status: "deleted",
            deletedAt: Date.now(),
            updatedAt: Date.now(),
            revision: item.revision + 1,
          }
        : item,
    ),
  };
}

/** 教师默认与同一服务的会话模型在一次数据提交中更新，历史执行不变。 */
export function applyRobotAi(
  data: AppData,
  robotId: string,
  config: RobotAiDefaults,
  settings: AiSettings | null,
  expectedRevision?: number,
): AppData {
  const robot = data.robots.find((item) => item.id === robotId);
  if (!robot) throw new Error("此教师已删除，请重新选择。");
  if (expectedRevision !== undefined && robot.revision !== expectedRevision)
    throw new Error("教师配置已更新，请重新打开后再保存。");
  const effective = resolveDefaults(config, settings);
  if (effective.error) throw new Error(effective.error);
  return {
    ...data,
    robots: data.robots.map((item) =>
      item.id === robotId
        ? {
            ...item,
            revision: item.revision + 1,
            aiDefaults: structuredClone(config),
          }
        : item,
    ),
    conversations: data.conversations.map((item) =>
      item.robotId === robotId &&
      item.status !== "deleted" &&
      item.aiConfig.connectionId === effective.connectionId
        ? {
            ...item,
            revision: item.revision + 1,
            updatedAt: Date.now(),
            aiConfig: {
              connectionId: effective.connectionId,
              modelId: effective.model,
            },
          }
        : item,
    ),
  };
}

/** 删除教师仅影响可用列表，旧会话保留教师身份，不改成另一位教师。 */
export function replaceRobots(
  data: AppData,
  robots: Robot[],
  defaultId: string | null,
  settings?: AiSettings | null,
): AppData {
  let next = data;
  for (const robot of robots) {
    const saved = next.robots.find((item) => item.id === robot.id);
    if (
      saved &&
      JSON.stringify(saved.aiDefaults) !== JSON.stringify(robot.aiDefaults)
    )
      next = applyRobotAi(
        next,
        robot.id,
        robot.aiDefaults,
        settings ?? null,
        robot.revision,
      );
  }
  const ids = new Set(robots.map((item) => item.id));
  return {
    ...next,
    defaultRobotId:
      defaultId && ids.has(defaultId) ? defaultId : (robots[0]?.id ?? null),
    robots: robots.map((robot) => {
      const saved = data.robots.find((item) => item.id === robot.id);
      if (
        saved &&
        isRobotModified(saved, robot) &&
        saved.revision !== robot.revision
      )
        throw new Error("教师配置已更新，请重新读取后再保存。");
      return saved && isRobotModified(saved, robot)
        ? { ...robot, revision: saved.revision + 1 }
        : robot;
    }),
    conversations: next.conversations.map((conversation) => {
      const author = data.robots.find(
        (item) => item.id === conversation.robotId,
      );
      const identity =
        conversation.robotIdentity ??
        (author
          ? { id: author.id, name: author.name, icon: author.icon }
          : null);
      return {
        ...conversation,
        robotIdentity: identity,
        messages: conversation.messages.map((message) => {
          if (message.role !== "assistant") return message;
          const bot = data.robots.find(
            (item) => item.id === (message.botId ?? conversation.robotId),
          );
          return {
            ...message,
            botId: message.botId ?? bot?.id,
            botName: message.botName ?? bot?.name,
            botIcon: message.botIcon ?? bot?.icon,
          };
        }),
      };
    }),
  };
}
