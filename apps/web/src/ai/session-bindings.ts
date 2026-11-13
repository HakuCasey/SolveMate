import type { Conversation, SessionBinding } from "@solvemate/contracts";

/** 旧单条关联只在读取处解释；当前服务由同一份 aiConfig 选择。 */
export function sessionBindings(
  conversation: Pick<Conversation, "binding" | "bindings">,
) {
  return (
    conversation.bindings ??
    (conversation.binding ? [conversation.binding] : [])
  );
}

export function activeSessionBinding(conversation: Conversation) {
  return (
    sessionBindings(conversation).find(
      (binding) => binding.connectionId === conversation.aiConfig.connectionId,
    ) ?? null
  );
}

export function retainSessionBindings(
  conversation: Conversation,
): Conversation {
  return conversation.bindings && conversation.binding === null
    ? conversation
    : {
        ...conversation,
        bindings: sessionBindings(conversation),
        binding: null,
      };
}

/** 服务自己的关联按修订号更新；旧结果不能覆盖用户已确认的新原生会话。 */
export function receiveSessionBinding(
  conversation: Conversation,
  incoming: SessionBinding,
): Conversation {
  if (incoming.conversationId !== conversation.id)
    throw new Error("原生会话关联属于另一条对话，未覆盖当前记录。");
  const previous = sessionBindings(conversation).find(
    (binding) => binding.connectionId === incoming.connectionId,
  );
  if (previous && previous.revision > incoming.revision) return conversation;
  if (previous && previous.revision === incoming.revision) {
    if (previous.externalSessionId !== incoming.externalSessionId)
      throw new Error("同一版本的原生会话编号不一致，未覆盖原关联。");
    if (
      previous.protocol === incoming.protocol &&
      previous.state === incoming.state
    )
      return conversation;
    throw new Error("同一版本的原生会话状态不一致，请重新读取。");
  }
  return {
    ...conversation,
    binding: null,
    bindings: [
      ...sessionBindings(conversation).filter(
        (binding) => binding.connectionId !== incoming.connectionId,
      ),
      structuredClone(incoming),
    ],
  };
}

/** 切回已有原生编号时说明继续原会话，不再提示用户新建。 */
export function serviceSwitchKind(
  conversation: Conversation,
  connectionId: string | null,
) {
  return sessionBindings(conversation).some(
    (binding) =>
      binding.connectionId === connectionId && !!binding.externalSessionId,
  )
    ? ("service-resume" as const)
    : ("service" as const);
}
