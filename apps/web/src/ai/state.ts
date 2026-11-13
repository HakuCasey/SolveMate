import type {
  AppData,
  Message,
  SessionBinding,
  SessionTurn,
  AiTurn,
  AiSettings,
} from "@solvemate/contracts";

/** 保存结果和刷新结果共用版本判断，拒绝较早的配置快照。 */
export function latestAiSettings(
  current: AiSettings | null,
  incoming: AiSettings,
): AiSettings {
  if (!current) return incoming;
  if (incoming.preferencesRevision < current.preferencesRevision)
    return current;
  for (const connection of current.connections) {
    const next = incoming.connections.find((item) => item.id === connection.id);
    if (next && next.revision < connection.revision) return current;
    // 删除连接会推进偏好版本；同版本缺少记录只能是较早的读取。
    if (!next && incoming.preferencesRevision === current.preferencesRevision)
      return current;
  }
  return incoming;
}

/** 本机结果只更新执行和已确认绑定，不改写当前模型选择或复活已删除对话。 */
export function mergeAiTurn(data: AppData, turn: AiTurn): AppData {
  const conversations = data.conversations.map((conversation) => {
    if (
      conversation.id !== turn.conversationId ||
      conversation.status === "deleted"
    )
      return conversation;
    if (
      conversation.aiConfig.connectionId &&
      conversation.aiConfig.connectionId !== turn.connectionId
    )
      throw new Error("执行结果来自另一项服务，已保留当前对话配置。");
    if (conversation.robotId && conversation.robotId !== turn.teacher.id)
      throw new Error(
        "执行结果中的机器人与当前对话不一致，未更改对话的机器人。",
      );
    const previous = conversation.turns.find((item) => item.id === turn.id);
    if (
      previous &&
      ((previous.snapshot && previous.revision >= turn.revision) ||
        (previous.status !== "running" && turn.status === "running"))
    )
      return conversation;
    const existingBinding = conversation.binding;
    if (
      existingBinding?.externalSessionId &&
      turn.externalSessionId &&
      existingBinding.externalSessionId !== turn.externalSessionId
    )
      throw new Error("原生会话编号与本地绑定不一致，未替换原会话。");
    const messages = conversation.messages.map((item) =>
      conversation.example && !item.turnId ? { ...item, example: true } : item,
    );
    if (!messages.some((item) => item.id === turn.userMessageId))
      messages.push({
        id: turn.userMessageId,
        role: "user",
        content: turn.text,
        createdAt: turn.startedAt,
        turnId: turn.id,
        ...(turn.readingContext
          ? { readingContext: structuredClone(turn.readingContext) }
          : {}),
        ...(turn.references
          ? { references: structuredClone(turn.references) }
          : {}),
        ...(turn.reference
          ? { reference: structuredClone(turn.reference) }
          : {}),
      });
    if (turn.content) {
      const assistant: Message = {
        id: turn.assistantMessageId,
        role: "assistant",
        content: turn.content,
        createdAt: turn.completedAt ?? turn.startedAt,
        turnId: turn.id,
        botId: turn.teacher.id,
        botName: turn.teacher.name,
        botIcon: turn.teacher.icon,
        model: turn.model,
      };
      const index = messages.findIndex((item) => item.id === assistant.id);
      if (index < 0) messages.push(assistant);
      else messages[index] = assistant;
    }
    const result: SessionTurn = {
      id: turn.id,
      revision: turn.revision,
      submissionStatus: turn.submissionStatus,
      connectionId: turn.connectionId,
      status: turn.status,
      startedAt: turn.startedAt,
      ...(turn.completedAt !== undefined
        ? { completedAt: turn.completedAt }
        : {}),
      ...(turn.externalTurnId ? { externalTurnId: turn.externalTurnId } : {}),
      error: turn.error,
      model: turn.model,
      userMessageId: turn.userMessageId,
      phase: turn.phase,
      lastActivityAt: turn.lastActivityAt,
      snapshot: structuredClone(turn.snapshot),
      dispatch: turn.dispatch ? structuredClone(turn.dispatch) : null,
      reportedModelId: turn.reportedModelId,
    };
    const turns = [
      ...conversation.turns.filter((item) => item.id !== turn.id),
      result,
    ].toSorted((a, b) => a.startedAt - b.startedAt);
    messages.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    // 重试较早的问题时，回复仍紧随原问题；执行时间不能改变问题与回复的对应关系。
    const questionIds = new Set(
      messages.filter((item) => item.role === "user").map((item) => item.id),
    );
    const questionByTurn = new Map(
      turns.map((item) => [item.id, item.userMessageId]),
    );
    const replies = new Map<string, Message[]>();
    const linkedReplies = new Set<string>();
    for (const message of messages) {
      const questionId = message.turnId
        ? questionByTurn.get(message.turnId)
        : undefined;
      if (
        message.role === "assistant" &&
        questionId &&
        questionIds.has(questionId)
      ) {
        const group = replies.get(questionId) ?? [];
        group.push(message);
        replies.set(questionId, group);
        linkedReplies.add(message.id);
      }
    }
    const orderedMessages = messages.flatMap((message) =>
      linkedReplies.has(message.id)
        ? []
        : [message, ...(replies.get(message.id) ?? [])],
    );
    const binding: SessionBinding | null =
      turn.binding ??
      (turn.externalSessionId && turn.protocol
        ? {
            conversationId: conversation.id,
            connectionId: turn.connectionId,
            protocol: turn.protocol,
            externalSessionId: turn.externalSessionId,
            state: "bound",
            revision: existingBinding?.revision ?? 1,
          }
        : existingBinding);
    return {
      ...conversation,
      revision: conversation.revision + 1,
      example: false,
      aiConfig: conversation.aiConfig.connectionId
        ? conversation.aiConfig
        : {
            connectionId: turn.connectionId,
            modelId: turn.snapshot.requestedModelId,
            reasoningEffort: turn.snapshot.reasoningEffort,
          },
      binding,
      messages: orderedMessages,
      turns,
      updatedAt: Math.max(
        conversation.updatedAt,
        turn.completedAt ?? turn.lastActivityAt,
      ),
      lastActivityAt: Math.max(
        conversation.lastActivityAt ?? 0,
        turn.startedAt,
        turn.content ? (turn.completedAt ?? turn.lastActivityAt) : 0,
      ),
    };
  });
  return conversations.every(
    (item, index) => item === data.conversations[index],
  )
    ? data
    : { ...data, conversations };
}
