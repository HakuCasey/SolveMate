import type { AppData, Course, ReadingSelection } from "@solvemate/contracts";
import { getCourse } from "../data/catalog";

/** 旧会话引用随应用提供的原版，不能在安装更新后悄悄改成新版。 */
export function pinLegacyVersions(data: AppData): AppData {
  let changed = false;
  const pin = (selection: ReadingSelection): ReadingSelection => {
    if (selection.version) return selection;
    changed = true;
    return { ...selection, version: "example-1" };
  };
  const selection = pin(data.selection);
  const conversations = data.conversations.map((session) =>
    session.selection
      ? { ...session, selection: pin(session.selection) }
      : session,
  );
  return changed ? { ...data, selection, conversations } : data;
}

export function updatedSelection(
  previous: ReadingSelection,
  next: Course,
  allCourses: Course[],
): ReadingSelection {
  if (previous.kind === "questions")
    return {
      ...previous,
      version: next.version,
      itemId: next.questions.some((item) => item.id === previous.itemId)
        ? previous.itemId
        : next.questions[0].id,
      chapterIndex: 0,
    };
  const old = getCourse(previous.courseId, previous.version, allCourses);
  const oldChapter = old.textbooks.find((book) => book.id === previous.itemId)
    ?.chapters[previous.chapterIndex]?.id;
  const book =
    next.textbooks.find((item) => item.id === previous.itemId) ??
    next.textbooks[0];
  const index = book.chapters.findIndex((chapter) => chapter.id === oldChapter);
  return {
    ...previous,
    version: next.version,
    itemId: book.id,
    chapterIndex: Math.max(index, 0),
  };
}
