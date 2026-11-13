import { aiMetadataSchema, assertMetadata } from "@solvemate/contracts";
import type {
  CurrentContent,
  Conversation,
  ReadingReference,
  ReadingSelection,
  LearningLocation,
} from "@solvemate/contracts";
export const UNSUPPORTED_READING_REFERENCE = "当前版本已不支持该引用方式";

/** 当前定位必须明确，不按章节、默认课程版本或文件名推断位置。 */
export function isSupportedReadingReference(reference: ReadingReference) {
  try {
    assertMetadata("SupportedReadingReference", reference);
    return true;
  } catch {
    return false;
  }
}
export function isSupportedReadingLocation(location: LearningLocation) {
  return isSupportedReadingReference(
    "materialId" in location
      ? {
          title: "",
          content: "",
          selection: null,
          material: location,
          quoteKind: "page",
        }
      : { title: "", content: "", selection: location },
  );
}
export function requireReadingLocation(location: LearningLocation) {
  if (!isSupportedReadingLocation(location))
    throw new Error(UNSUPPORTED_READING_REFERENCE);
}

export function readingKey(selection: ReadingSelection) {
  return `content:${JSON.stringify([selection.courseId, selection.version, selection.kind, selection.itemId, ...(selection.pageNumber ? [selection.pageNumber] : [])])}`;
}
export function validateQuoteText(text: string) {
  if (!text.trim()) throw new Error("没有可引用的文字，请重新选择内容。");
  if (text.length > 100000)
    throw new Error("引用内容过长，请选择较短的段落后提问。");
}
export function makeReadingReference(
  selection: ReadingSelection,
  content: Pick<CurrentContent, "topic" | "title" | "content">,
  text = content.content,
  selected = false,
): ReadingReference {
  requireReadingLocation(selection);
  validateQuoteText(text);
  return {
    title: `${content.topic} · ${content.title}`,
    content: text,
    selection: { ...selection },
    ...(selected ? { quoteKind: "selection" as const } : {}),
  };
}

export interface DraftReference {
  id: string;
  reference: ReadingReference;
}
export function referencePreview(content: string) {
  const characters = Array.from(content.replace(/\s+/g, " ").trim());
  return characters.slice(0, 15).join("") + (characters.length > 15 ? "…" : "");
}
/** 兼容已保存的单条引用；新消息使用引用数组。 */
export function messageReferences(message: {
  references?: ReadingReference[];
  reference?: ReadingReference | null;
}) {
  return message.references?.length
    ? message.references
    : message.reference
      ? [message.reference]
      : [];
}

/** 自动关联页与手动片段分别保存，历史展示和资料索引合并读取。 */
export function messageReadingReferences(message: {
  readingContext?: ReadingReference;
  reference?: ReadingReference | null;
  references?: ReadingReference[];
}) {
  return [
    ...(message.readingContext ? [message.readingContext] : []),
    ...messageReferences(message),
  ];
}
export const MAX_READING_REFERENCES =
  aiMetadataSchema.$defs.TurnInput.properties.references.maxItems;
export const REFERENCE_LIMIT_MESSAGE = `为保证对话质量，当前最多支持 ${MAX_READING_REFERENCES} 条内容。`;
export function validateReferenceCount(references: { length: number }) {
  if (references.length > MAX_READING_REFERENCES)
    throw new Error(REFERENCE_LIMIT_MESSAGE);
}
export function appendReference(
  previous: DraftReference[],
  reference: ReadingReference,
  id: string,
): DraftReference[] {
  validateQuoteText(reference.content);
  if (
    previous.some(
      (item) => JSON.stringify(item.reference) === JSON.stringify(reference),
    )
  )
    return previous;
  validateReferenceCount({ length: previous.length + 1 });
  if (
    previous.reduce(
      (size, item) => size + item.reference.content.length,
      reference.content.length,
    ) > 100000
  )
    throw new Error("引用内容总长度过长，请先移除部分引用。");
  return [...previous, { id, reference }];
}

/** 引用对话保存原始消息编号与选段快照，不伪装为资料页。 */
export function makeMessageReference(
  conversation: Conversation,
  messageIds: string[],
  text: string,
): ReadingReference {
  validateQuoteText(text);
  if (
    !messageIds.length ||
    messageIds.some(
      (id) => !conversation.messages.some((message) => message.id === id),
    )
  )
    throw new Error("原消息已变化，请重新选择内容。");
  return {
    title: `对话：${conversation.title}`,
    content: text,
    selection: null,
    message: {
      conversationId: conversation.id,
      messageIds: [messageIds[0], ...messageIds.slice(1)],
    },
    quoteKind: "selection",
  };
}
