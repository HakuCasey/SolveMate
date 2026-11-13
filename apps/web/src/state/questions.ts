import type {
  AppData,
  AiSettings,
  Conversation,
  ReadingReference,
} from "@solvemate/contracts";
import { resolveConversationAi } from "../ai/robot-config";
import {
  messageReferences,
  isSupportedReadingReference,
  UNSUPPORTED_READING_REFERENCE,
} from "../reading/reference";
import { uniqueConversationTitle } from "./conversation-limits";

export interface QuestionInput {
  conversation: Conversation;
  robotId: string;
  messageId: string;
  turnId: string;
  text: string;
  references: ReadingReference[];
  createdAt: number;
  retry?: boolean;
  create?: boolean;
  readingContext?: ReadingReference;
  contextError?: string;
}

/** 消息与本次执行准备一次保存；AI 不可用只记录未提交原因，不阻止保存问题。 */
export function recordQuestion(
  data: AppData,
  input: QuestionInput,
  settings: AiSettings | null,
): AppData {
  const saved = data.conversations.find(
    (item) => item.id === input.conversation.id,
  );
  if (!saved && !input.create) throw new Error("原对话已删除，请重新打开。");
  const conversation = saved ?? input.conversation;
  if (conversation.status !== "active")
    throw new Error("此对话已归档或删除，请重新打开。");
  const robot = data.robots.find((item) => item.id === input.robotId);
  if (!robot) throw new Error("此机器人已删除，请重新选择。");
  if (conversation.robotId && conversation.robotId !== robot.id)
    throw new Error("对话使用的机器人已改变，请重新打开。");
  const recorded = conversation.messages.find(
    (item) => item.id === input.messageId,
  );
  if (recorded && !input.retry) {
    if (
      recorded.role === "user" &&
      recorded.content === input.text &&
      recorded.turnId === input.turnId
    )
      return data;
    throw new Error("此消息编号已被使用，请重新打开对话后再发送。");
  }
  if (conversation.turns.some((turn) => turn.status === "running"))
    throw new Error("此对话正在生成，请稍后提问。");
  const original = input.retry
    ? conversation.messages.find(
        (item) => item.id === input.messageId && item.role === "user",
      )
    : undefined;
  if (input.retry && !original) throw new Error("原消息已删除，无法重试。");
  const previous = original?.turnId
    ? conversation.turns.find((turn) => turn.id === original.turnId)
    : undefined;
  if (
    previous?.status === "completed" ||
    (original &&
      conversation.turns.some(
        (turn) =>
          turn.userMessageId === original.id && turn.status === "completed",
      ))
  )
    throw new Error("此消息已有回复，请查看对话记录。");
  if (previous?.submissionStatus === "uncertain")
    throw new Error("上次请求的结果尚未确认，请先重新查询。");
  const effective = resolveConversationAi(conversation, robot, settings);
  const text = original?.content ?? input.text;
  if (!text.trim()) throw new Error("请输入消息内容。");
  const references = original ? messageReferences(original) : input.references;
  const readingContext = original?.readingContext?.content.trim()
    ? original.readingContext
    : (input.readingContext ?? original?.readingContext);
  const contextError =
    input.contextError ||
    ((readingContext && !isSupportedReadingReference(readingContext)) ||
    references.some((reference) => !isSupportedReadingReference(reference))
      ? UNSUPPORTED_READING_REFERENCE
      : "") ||
    (readingContext && !readingContext.content.trim()
      ? "关联内容尚未读取，请重试。"
      : "");
  const ready =
    !contextError &&
    !effective.error &&
    !!effective.connectionId &&
    !!effective.model;
  const error = ready
    ? ""
    : contextError || effective.error || "请先在设置中配置 AI。";
  const message = original
    ? {
        ...original,
        turnId: input.turnId,
        ...(readingContext
          ? { readingContext: structuredClone(readingContext) }
          : {}),
      }
    : {
        id: input.messageId,
        turnId: input.turnId,
        role: "user" as const,
        content: text,
        createdAt: input.createdAt,
        ...(readingContext
          ? { readingContext: structuredClone(readingContext) }
          : {}),
        ...(references.length
          ? { references: structuredClone(references) }
          : {}),
      };
  const messages = conversation.messages.map((item) =>
    conversation.example && !item.turnId ? { ...item, example: true } : item,
  );
  const changed: Conversation = {
    ...conversation,
    example: false,
    revision: conversation.revision + 1,
    ...(!input.retry && readingContext?.material
      ? { material: { ...readingContext.material }, selection: null }
      : {}),
    ...(!input.retry && readingContext?.selection
      ? { selection: { ...readingContext.selection }, material: null }
      : {}),
    title:
      conversation.titleSource === "default"
        ? uniqueConversationTitle(
            data.conversations,
            text.slice(0, 24),
            conversation.id,
          )
        : conversation.title,
    titleSource:
      conversation.titleSource === "default"
        ? "first-message"
        : conversation.titleSource,
    // 无法提交时保留原选择与绑定；不能用空值或另一项全局配置替换原服务。
    aiConfig: ready
      ? {
          connectionId: effective.connectionId,
          modelId: effective.model,
          reasoningEffort: effective.reasoningEffort,
        }
      : conversation.aiConfig,
    messages: original
      ? messages.map((item) => (item.id === original.id ? message : item))
      : [...messages, message],
    turns: [
      ...conversation.turns,
      {
        id: input.turnId,
        revision: 1,
        connectionId: effective.connectionId || null,
        status: ready ? "running" : "failed",
        submissionStatus: ready ? "pending" : "rejected",
        phase: ready ? "queued" : "finished",
        startedAt: input.createdAt,
        ...(ready ? {} : { completedAt: input.createdAt, error }),
        userMessageId: message.id,
        model: effective.model,
        snapshot: null,
        dispatch: null,
        reportedModelId: null,
      },
    ],
    updatedAt: input.createdAt,
    lastActivityAt: input.createdAt,
  };
  return {
    ...data,
    conversations: [
      changed,
      ...data.conversations.filter((item) => item.id !== changed.id),
    ],
  };
}
