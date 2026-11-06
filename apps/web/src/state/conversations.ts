import type {
  AppData,
  Conversation,
  ReadingSelection,
  Robot,
} from "@solvemate/contracts";

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

export function createConversation(
  data: AppData,
  selection: ReadingSelection | null = null,
  robotId = data.defaultRobotId,
): Conversation {
  return {
    id: crypto.randomUUID(),
    title: "新对话",
    label: "无标签",
    archived: false,
    createdAt: Date.now(),
    bindings: [],
    turns: [],
    selection: selection ? { ...selection } : null,
    robotId: data.robots.some((robot) => robot.id === robotId)
      ? robotId
      : data.defaultRobotId,
    messages: [],
    updatedAt: Date.now(),
    example: false,
  };
}

/** 管理操作只改变本地 session 的信息，不重建消息或外部 session。 */
export function updateConversation(
  data: AppData,
  id: string,
  change: Pick<Conversation, "label" | "archived">,
): AppData {
  const label = change.label?.trim();
  if (label !== undefined && (!label || label.length > 24))
    throw new Error("Conversation label must contain 1 to 24 characters.");
  return {
    ...data,
    conversations: data.conversations.map((item) => {
      if (item.id !== id || item.deletedAt !== undefined) return item;
      return {
        ...item,
        ...change,
        ...(label === undefined ? {} : { label }),
        ...(change.archived === undefined
          ? {}
          : { archivedAt: change.archived ? Date.now() : undefined }),
      };
    }),
  };
}

export function deleteConversation(data: AppData, id: string): AppData {
  // 保留删除时间，避免以后重新连接 harness 时把删除过的会话再次导入。
  return {
    ...data,
    conversations: data.conversations.map((item) =>
      item.id === id && item.deletedAt === undefined
        ? { ...item, deletedAt: Date.now() }
        : item,
    ),
  };
}

export function replaceRobots(
  data: AppData,
  robots: Robot[],
  defaultId: string | null,
): AppData {
  const ids = new Set(robots.map((robot) => robot.id));
  const defaultRobotId =
    defaultId && ids.has(defaultId) ? defaultId : (robots[0]?.id ?? null);
  return {
    ...data,
    robots,
    defaultRobotId,
    conversations: data.conversations.map((conversation) => ({
      ...conversation,
      robotId:
        conversation.robotId && ids.has(conversation.robotId)
          ? conversation.robotId
          : defaultRobotId,
      messages: conversation.messages.map((message) => {
        if (message.role !== "assistant") return message;
        // 删除或切换机器人后，历史回复继续显示实际作者。
        const author = data.robots.find(
          (robot) => robot.id === (message.botId ?? conversation.robotId),
        );
        return {
          ...message,
          botId: message.botId ?? author?.id,
          botName: message.botName ?? author?.name,
          botIcon: message.botIcon ?? author?.icon,
        };
      }),
    })),
  };
}
