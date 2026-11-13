import type {
  AppData,
  Conversation,
  Course,
  LearningLocation,
  Material,
  Note,
  MaterialLocation,
  ReadingReference,
} from "@solvemate/contracts";
import type { OfficialLibrary } from "../content/library";
import { materialMembership } from "./library";
import {
  messageReadingReferences,
  isSupportedReadingLocation,
  UNSUPPORTED_READING_REFERENCE,
} from "./reference";
import { officialEntryId } from "../content/entries";

/** 资料身份不含学科名称、页码或版本；位置与版本仍由原记录各自保留。 */
export function learningMaterialId(source: LearningLocation): string {
  return "materialId" in source
    ? source.materialId
    : source.kind === "questions"
      ? `${officialEntryId(source)}:${source.itemId}`
      : officialEntryId(source);
}

/** 旧笔记仅关联内置题目；缺少新字段时读取原关联，不按当前下载版本改写。 */
export function sourceForNote(note: Note): LearningLocation | null {
  if (note.source !== undefined) return note.source;
  return note.courseId && note.questionId
    ? {
        courseId: note.courseId,
        version: "example-1",
        kind: "questions",
        itemId: note.questionId,
        chapterIndex: 0,
      }
    : null;
}

function sourcesForConversation(conversation: Conversation) {
  const sources: LearningLocation[] = [];
  if (conversation.material) sources.push(conversation.material);
  if (conversation.selection) sources.push(conversation.selection);
  for (const message of conversation.messages) {
    for (const reference of messageReadingReferences(message)) {
      if (reference.material) sources.push(reference.material);
      if (reference.selection) sources.push(reference.selection);
    }
  }
  return sources;
}

export class LearningMaterial {
  readonly id: string;
  readonly title: string;
  readonly position: string;
  readonly subjectId: string | null;
  readonly subjectTitle: string;
  readonly available: boolean;
  readonly removed: boolean;
  private readonly pageText?: string;
  constructor(
    readonly source: LearningLocation,
    courses: Course[],
    materials: Material[],
    official: OfficialLibrary,
  ) {
    this.id = learningMaterialId(source);
    if ("materialId" in source) {
      const material = materials.find((item) => item.id === source.materialId);
      const membership = materialMembership(material, official.directory);
      this.title = material?.title ?? "原资料不可用";
      this.position = `第 ${source.pageNumber} 页`;
      this.subjectId = membership.subjectId;
      this.subjectTitle =
        official.directory.byId.get(material?.courseId ?? "")?.title ??
        "未分类";
      // 历史文件按固定版本请求，是否可读由现有阅读器在读取时核实。
      this.available = !!material;
      this.removed = !!material && membership.state === "removed";
    } else {
      const course = courses.find(
        (item) =>
          item.id === source.courseId && item.version === source.version,
      );
      const book =
        source.kind === "textbooks"
          ? course?.textbooks.find((item) => item.id === source.itemId)
          : undefined;
      const question =
        source.kind === "questions"
          ? course?.questions.find((item) => item.id === source.itemId)
          : undefined;
      this.title = book?.title ?? question?.title ?? "原资料不可用";
      this.position = !isSupportedReadingLocation(source)
        ? UNSUPPORTED_READING_REFERENCE
        : source.kind === "textbooks"
          ? `第 ${source.pageNumber} 页`
          : source.itemId;
      this.pageText =
        question?.question ??
        (book?.pdf && source.pageNumber
          ? book.pdf.pages[source.pageNumber - 1]
          : undefined);
      this.available = !!question || this.pageText !== undefined;
      const scope = official.scopeForSelection(source);
      this.subjectId = scope?.courseId ?? null;
      this.subjectTitle =
        official.entries.find((item) => item.id === officialEntryId(source))
          ?.subjectTitle ??
        course?.title ??
        "学科不可用";
      this.removed = scope === null;
    }
  }
  get readingLabel() {
    if (!isSupportedReadingLocation(this.source))
      return UNSUPPORTED_READING_REFERENCE;
    return `${this.title} · ${this.position}`;
  }
  /** 空正文仅用于保存读取失败的问题；提交 Harness 前必须读取成功。 */
  contextReference(content = ""): ReadingReference {
    return {
      title: this.readingLabel,
      content,
      selection: "materialId" in this.source ? null : { ...this.source },
      ...("materialId" in this.source
        ? { material: { ...this.source }, quoteKind: "page" as const }
        : this.source.kind === "textbooks"
          ? { quoteKind: "page" as const }
          : {}),
    };
  }
  async readContext(readPage: (location: MaterialLocation) => Promise<string>) {
    if (!isSupportedReadingLocation(this.source))
      throw new Error(UNSUPPORTED_READING_REFERENCE);
    if (!this.available)
      throw new Error(
        "关联资料或版本暂不可用，问题和原位置已保留，请刷新资料后重试。",
      );
    const text =
      "materialId" in this.source ? await readPage(this.source) : this.pageText;
    if (!text?.trim())
      throw new Error(
        "关联内容没有可读取的文字，当前暂不支持图片识别。问题已保留，请补充文字或在普通对话中继续。",
      );
    if (text.length > 100000)
      throw new Error(
        "关联页文字超过 100,000 字符，问题已保留，请换页或在普通对话中继续。",
      );
    return this.contextReference(text);
  }
  get context() {
    if (!isSupportedReadingLocation(this.source))
      return UNSUPPORTED_READING_REFERENCE;
    return "materialId" in this.source
      ? `${this.title} · ${this.position}`
      : `${this.subjectTitle} · ${this.source.kind === "textbooks" ? this.position : this.title}`;
  }
}

/** 关联从原记录生成，不另存计数或关联表，避免页面间出现第二套状态。 */
export class LearningRelations {
  private conversations = new Map<string, Conversation[]>();
  private notes = new Map<string, Note[]>();
  constructor(
    data: Pick<AppData, "conversations" | "noteLibrary">,
    private readonly courses: Course[],
    private readonly materials: Material[],
    private readonly official: OfficialLibrary,
  ) {
    for (const conversation of data.conversations) {
      if (conversation.status === "deleted") continue;
      const ids = new Set(
        sourcesForConversation(conversation).map(learningMaterialId),
      );
      for (const id of ids) {
        const list = this.conversations.get(id) ?? [];
        list.push(conversation);
        this.conversations.set(id, list);
      }
    }
    for (const list of this.conversations.values())
      list.sort(
        (a, b) =>
          (b.lastActivityAt ?? b.createdAt ?? 0) -
          (a.lastActivityAt ?? a.createdAt ?? 0),
      );
    for (const note of data.noteLibrary?.notes ?? []) {
      const source = sourceForNote(note);
      const origin = note.excerpt?.message;
      const conversation = origin
        ? data.conversations.find(
            (item) =>
              item.id === origin.conversationId && item.status !== "deleted",
          )
        : undefined;
      const sources = source
        ? [source]
        : conversation && origin
          ? sourcesForConversation({
              ...conversation,
              messages: conversation.messages.filter((item) =>
                origin.messageIds.includes(item.id),
              ),
            })
          : [];
      for (const id of new Set(sources.map(learningMaterialId))) {
        const list = this.notes.get(id) ?? [];
        list.push(note);
        this.notes.set(id, list);
      }
    }
  }
  material(source: LearningLocation) {
    return new LearningMaterial(
      source,
      this.courses,
      this.materials,
      this.official,
    );
  }
  related(source: LearningLocation) {
    const id = learningMaterialId(source);
    return {
      conversations: this.conversations.get(id) ?? [],
      notes: this.notes.get(id) ?? [],
    };
  }
}
