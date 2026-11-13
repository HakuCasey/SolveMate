export interface SelectedText {
  text: string;
  messageIds?: string[];
  pageNumber?: number;
  endPageNumber?: number;
}

export function captureSelectedText(root: HTMLElement): SelectedText | null {
  const selection = root.ownerDocument.getSelection();
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed)
    return null;
  const range = selection.getRangeAt(0).cloneRange();
  if (!range.intersectsNode(root)) return null;
  // 三击段落或选到 PDF 行末时，浏览器可能把末端放到阅读器外；只截取正文交集。
  const content = root.ownerDocument.createRange();
  content.selectNodeContents(root);
  if (range.compareBoundaryPoints(Range.START_TO_START, content) < 0)
    range.setStart(content.startContainer, content.startOffset);
  if (range.compareBoundaryPoints(Range.END_TO_END, content) > 0)
    range.setEnd(content.endContainer, content.endOffset);
  // 对话只截取消息正文，排除机器人名称、引用卡片和生成状态。
  const messages = Array.from(
    root.querySelectorAll<HTMLElement>("[data-message-content]"),
  );
  if (messages.length) {
    const parts = messages.flatMap((node) => {
      if (!range.intersectsNode(node)) return [];
      const clipped = range.cloneRange(),
        bounds = root.ownerDocument.createRange();
      bounds.selectNodeContents(node);
      if (clipped.compareBoundaryPoints(Range.START_TO_START, bounds) < 0)
        clipped.setStart(bounds.startContainer, bounds.startOffset);
      if (clipped.compareBoundaryPoints(Range.END_TO_END, bounds) > 0)
        clipped.setEnd(bounds.endContainer, bounds.endOffset);
      const text = clipped.toString();
      return text.trim() ? [{ id: node.dataset.messageContent!, text }] : [];
    });
    return parts.length
      ? {
          text: parts.map((part) => part.text).join("\n\n"),
          messageIds: parts.map((part) => part.id),
        }
      : null;
  }
  const text = range.toString();
  if (!text.trim()) return null;
  const pages = Array.from(
    root.querySelectorAll<HTMLElement>(".page[data-page-number]"),
  ).filter((page) => {
    if (!range.intersectsNode(page)) return false;
    const clipped = range.cloneRange(),
      bounds = root.ownerDocument.createRange();
    bounds.selectNodeContents(page);
    if (clipped.compareBoundaryPoints(Range.START_TO_START, bounds) < 0)
      clipped.setStart(bounds.startContainer, bounds.startOffset);
    if (clipped.compareBoundaryPoints(Range.END_TO_END, bounds) > 0)
      clipped.setEnd(bounds.endContainer, bounds.endOffset);
    return !!clipped.toString().trim();
  });
  return pages.length
    ? {
        text,
        pageNumber: Number(pages[0].dataset.pageNumber),
        endPageNumber: Number(pages.at(-1)!.dataset.pageNumber),
      }
    : { text };
}

export function pdfPageLabel(pageNumber: number, endPageNumber = pageNumber) {
  return endPageNumber > pageNumber
    ? `第 ${pageNumber}–${endPageNumber} 页`
    : `第 ${pageNumber} 页`;
}
