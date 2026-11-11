import type {
  AppData,
  Message,
  SessionBinding,
  SessionTurn,
  AiTurn,
} from "@solvemate/contracts";

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
      throw new Error("执行结果的教师与当前对话不一致，未改写教师身份。");
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
          },
      binding,
      messages,
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
