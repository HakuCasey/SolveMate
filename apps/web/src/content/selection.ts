import type { Course, ReadingSelection } from "@solvemate/contracts";
import { requireReadingLocation } from "../reading/reference";

export function updatedSelection(
  previous: ReadingSelection,
  next: Course,
): ReadingSelection {
  requireReadingLocation(previous);
  if (previous.kind === "questions")
    return {
      courseId: next.id,
      kind: "questions",
      version: next.version,
      itemId: next.questions.some((item) => item.id === previous.itemId)
        ? previous.itemId
        : next.questions[0].id,
    };
  const book =
    next.textbooks.find((item) => item.id === previous.itemId) ??
    next.textbooks[0];
  return {
    courseId: next.id,
    kind: "textbooks",
    version: next.version,
    itemId: book.id,
    pageNumber:
      previous.version === next.version && previous.itemId === book.id
        ? Math.min(previous.pageNumber!, book.pdf?.pages.length ?? 1)
        : 1,
  };
}
