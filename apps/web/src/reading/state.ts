import type {
  Conversation,
  MaterialLocation,
  ReadingSelection,
} from "@solvemate/contracts";
import type { DraftReference } from "./reference";

export interface ReadingScroll {
  top: number;
  left: number;
}
export interface ReadingPositionState {
  scroll: ReadingScroll;
  answerVisible: boolean;
}
export interface ReadingDocumentState {
  zoom: number;
  continuous?: boolean;
  location?: ReadingSelection | MaterialLocation;
}
export interface ReadingState {
  positions: Record<string, ReadingPositionState>;
  documents: Record<string, ReadingDocumentState>;
  references: Record<string, DraftReference[]>;
}
export type ReadingChange<T> = T | ((previous: T) => T);

/** 资料版本决定缩放范围，章节、题目或页码继续使用已有的位置编号。 */
export function readingDocumentKey(
  location: ReadingSelection | MaterialLocation,
) {
  return "materialId" in location
    ? `material:${JSON.stringify([location.materialId, location.contentVersion])}`
    : `content:${JSON.stringify([location.courseId, location.version, location.kind, location.itemId])}`;
}
export function emptyReadingPosition(): ReadingPositionState {
  return {
    scroll: { top: 0, left: 0 },
    answerVisible: false,
  };
}
export function updateReadingPosition(
  state: ReadingState,
  key: string,
  change: ReadingChange<ReadingPositionState>,
): ReadingState {
  const previous = state.positions[key] ?? emptyReadingPosition();
  const next = typeof change === "function" ? change(previous) : change;
  return previous === next
    ? state
    : { ...state, positions: { ...state.positions, [key]: next } };
}
export function updateReadingDocument(
  state: ReadingState,
  key: string,
  change: ReadingChange<ReadingDocumentState>,
): ReadingState {
  const previous = state.documents[key] ?? { zoom: 1 };
  const next = typeof change === "function" ? change(previous) : change;
  if (!Number.isFinite(next.zoom) || next.zoom < 0.5 || next.zoom > 3)
    throw new Error("资料缩放比例应在 50% 到 300% 之间。");
  if (next.continuous !== undefined && typeof next.continuous !== "boolean")
    throw new Error("页面连续设置必须为布尔值。");
  return previous.zoom === next.zoom &&
    previous.continuous === next.continuous &&
    previous.location === next.location
    ? state
    : { ...state, documents: { ...state.documents, [key]: next } };
}

/** 引用按对话使用的阅读范围保存，不混入缩放或页内显示状态。 */
export function updateReadingReferences(
  state: ReadingState,
  key: string,
  change: ReadingChange<DraftReference[]>,
): ReadingState {
  const previous = state.references[key] ?? [];
  const references = typeof change === "function" ? change(previous) : change;
  return previous === references
    ? state
    : { ...state, references: { ...state.references, [key]: references } };
}

/** 打开资料与返回对话共用最后阅读位置；历史引用仍按消息中的明确位置打开。 */
export function restoreReadingLocation<
  T extends ReadingSelection | MaterialLocation,
>(state: ReadingState, requested: T): T {
  return (
    (state.documents[readingDocumentKey(requested)]?.location as
      T | undefined) ?? requested
  );
}
export function rememberReadingLocation(
  state: ReadingState,
  location: ReadingSelection | MaterialLocation,
): ReadingState {
  const key = readingDocumentKey(location);
  const previous = state.documents[key] ?? { zoom: 1 };
  const last = previous.location;
  if (
    last &&
    ("materialId" in last
      ? "materialId" in location && last.pageNumber === location.pageNumber
      : !("materialId" in location) && last.pageNumber === location.pageNumber)
  )
    return state;
  return updateReadingDocument(state, key, {
    ...previous,
    location: { ...location },
  });
}

/** 用户资料翻页仍属同一会话；内置题目和章节分别关联会话，不能被同书其他章节替换。 */
export function readingLocationForConversation(
  state: ReadingState,
  conversation: Pick<Conversation, "selection" | "material">,
) {
  const selection = conversation.selection;
  return {
    selection:
      selection?.kind === "textbooks" && selection.pageNumber !== undefined
        ? restoreReadingLocation(state, selection)
        : selection,
    material: conversation.material
      ? restoreReadingLocation(state, conversation.material)
      : conversation.material,
  };
}
/** PDF 滚动坐标以 100% 缩放记录，改变缩放后仍指向相近的页面区域。 */
export function readingScrollFromElement(
  element: Pick<HTMLElement, "scrollTop" | "scrollLeft">,
  scale: number,
): ReadingScroll {
  return { top: element.scrollTop / scale, left: element.scrollLeft / scale };
}
export function readingScrollToElement(
  saved: ReadingScroll,
  scale: number,
  element: Pick<
    HTMLElement,
    "scrollHeight" | "clientHeight" | "scrollWidth" | "clientWidth"
  >,
): ReadingScroll {
  return {
    top: Math.max(
      0,
      Math.min(saved.top * scale, element.scrollHeight - element.clientHeight),
    ),
    left: Math.max(
      0,
      Math.min(saved.left * scale, element.scrollWidth - element.clientWidth),
    ),
  };
}
