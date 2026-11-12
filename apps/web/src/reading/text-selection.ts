export interface SelectedText {
  text: string;
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
  const text = range.toString();
  return text.trim() ? { text } : null;
}
