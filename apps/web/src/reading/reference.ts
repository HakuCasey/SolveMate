import type {
  CurrentContent,
  ReadingReference,
  ReadingSelection,
} from "@solvemate/contracts";
export function readingKey(selection: ReadingSelection) {
  return `content:${JSON.stringify([selection.courseId, selection.version, selection.kind, selection.itemId, selection.chapterIndex])}`;
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
  if (previous.length >= 20)
    throw new Error("一次最多引用 20 个片段，请先移除部分引用。");
  if (
    previous.reduce(
      (size, item) => size + item.reference.content.length,
      reference.content.length,
    ) > 100000
  )
    throw new Error("引用内容总长度过长，请先移除部分引用。");
  return [...previous, { id, reference }];
}
