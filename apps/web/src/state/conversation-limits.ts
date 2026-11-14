import { conversationLimits, type Conversation } from "@solvemate/contracts";
import { DataRequestError } from "../refresh/errors";

type ConversationStatus = Pick<Conversation, "id" | "status">;

export function conversationCounts(conversations: ConversationStatus[]) {
  const active = conversations.filter(
    (item) => item.status === "active",
  ).length;
  const archived = conversations.filter(
    (item) => item.status === "archived",
  ).length;
  return { active, archived, total: active + archived };
}
/** 只限制进行中的数量；已有超限记录仍可读取和整理。 */
export function requireConversationLimits(
  before: ConversationStatus[],
  after: ConversationStatus[],
) {
  const previous = conversationCounts(before),
    next = conversationCounts(after);
  if (next.active > conversationLimits.active && next.active > previous.active)
    throw new DataRequestError(
      conversationLimits.message,
      "conversation_limit_reached",
      422,
    );
}
export function requireConversationCapacity(
  conversations: Conversation[],
  target: "active" | "archived",
  id?: string,
) {
  const current = conversations.find((item) => item.id === id);
  if (current?.status === target) return;
  const extra = { id: id ?? "", status: target };
  requireConversationLimits(conversations, [
    ...conversations.filter((item) => item.id !== id),
    extra,
  ]);
}
export function isConversationLimitError(error: unknown) {
  return (
    error instanceof Error &&
    "code" in error &&
    error.code === "conversation_limit_reached"
  );
}
/** 新对话和首次提问生成的标题按未删除对话去重，手动命名保留原规则。 */
export function uniqueConversationTitle(
  conversations: Conversation[],
  title: string,
  exceptId?: string,
) {
  const base = title.trim(),
    names = new Set(
      conversations
        .filter((item) => item.status !== "deleted" && item.id !== exceptId)
        .map((item) => item.title.trim()),
    );
  let candidate = base,
    number = 1;
  while (names.has(candidate)) {
    const suffix = ` ${number++}`;
    candidate = `${base.slice(0, 100 - suffix.length)}${suffix}`;
  }
  return candidate;
}
