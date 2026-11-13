import type { AiTurn, Conversation } from "@solvemate/contracts";

/** 只有这些场景允许计时；新增功能时在这里明确登记，不按页面停留一概累计。 */
export const studyWhitelist = [
  "material-reading",
  "question-reading",
  "conversation-reading",
  "question-writing",
  "note-reading",
  "note-editing",
  "ai-generating",
] as const;
export type StudyActivity = (typeof studyWhitelist)[number];

export interface StudyContext {
  view: string;
  readingAvailable: boolean;
  readingKind: "questions" | "textbooks";
  materialAvailable: boolean;
  conversationAvailable: boolean;
  questionDraft: boolean;
  noteAvailable: boolean;
  noteEditing: boolean;
  generating: boolean;
}
export function studyActivities(context: StudyContext): StudyActivity[] {
  const activities: StudyActivity[] = [];
  if (context.view === "reading" && context.readingAvailable)
    activities.push(
      context.readingKind === "questions"
        ? "question-reading"
        : "material-reading",
    );
  if (context.view === "materials" && context.materialAvailable)
    activities.push("material-reading");
  if (["reading", "materials", "conversations"].includes(context.view)) {
    if (context.conversationAvailable) activities.push("conversation-reading");
    if (context.questionDraft) activities.push("question-writing");
  }
  if (context.view === "notes" && context.noteAvailable)
    activities.push("note-reading");
  if (context.noteEditing) activities.push("note-editing");
  if (context.generating) activities.push("ai-generating");
  return activities;
}

export function generatingReplyId(
  conversations: Conversation[],
  turns: Record<string, AiTurn>,
  errors: Record<string, string>,
) {
  for (const conversation of conversations) {
    if (conversation.status === "deleted") continue;
    for (const saved of conversation.turns) {
      const received = turns[saved.id];
      const turn =
        received && received.revision >= saved.revision ? received : saved;
      if (
        turn.status === "running" &&
        turn.submissionStatus === "accepted" &&
        !errors[turn.id] &&
        !turn.error &&
        !received?.permissions.length
      )
        return turn.id;
    }
  }
  return "";
}

/** 事件只取实际正文和结束状态；重复快照、心跳及累计用时不会续时。 */
export function aiStudyEvent(
  turns: Record<string, AiTurn>,
  timestamp: number,
): string {
  let latest: AiTurn | undefined;
  for (const turn of Object.values(turns)) {
    if (
      turn.submissionStatus !== "accepted" ||
      turn.permissions.length ||
      timestamp - turn.lastActivityAt > 5 * 60_000 ||
      turn.lastActivityAt > timestamp + 5000
    )
      continue;
    if (!latest || turn.lastActivityAt > latest.lastActivityAt) latest = turn;
  }
  return latest
    ? `${latest.id}:${latest.status}:${latest.content.length}:${latest.content.slice(-32)}`
    : "";
}

export const studyEventWhitelist = {
  pointerdown: "点击阅读内容、提问引用或笔记",
  pointerup: "完成文字选择",
  keydown: "输入、编辑或使用阅读快捷键",
  wheel: "滚动阅读内容",
  touchmove: "触摸滚动阅读内容",
} as const;
