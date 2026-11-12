import type { Course, ReadingSelection } from "@solvemate/contracts";
import type { ContentFile, CourseInfo } from "./contracts";

interface ContentEntry {
  id: string;
  title: string;
  description: string;
  kind: ReadingSelection["kind"];
  selection?: ReadingSelection;
}

export function officialEntryId(
  selection: Pick<ReadingSelection, "courseId" | "kind" | "itemId">,
) {
  return selection.kind === "questions"
    ? `${selection.courseId}:questions`
    : `${selection.courseId}:textbooks:${selection.itemId}`;
}

/** 同一课程包中的学习资料和题目分别展示，阅读目标取当前本地版本。 */
export function contentEntries(
  info: CourseInfo,
  local?: Course,
  files: ContentFile[] = [],
): ContentEntry[] {
  const entries: ContentEntry[] = [];
  for (const book of local?.textbooks ?? []) {
    entries.push({
      id: officialEntryId({
        courseId: info.id,
        kind: "textbooks",
        itemId: book.id,
      }),
      title: book.title,
      description: book.description || info.description,
      kind: "textbooks",
      selection: {
        courseId: info.id,
        version: local!.version,
        kind: "textbooks",
        itemId: book.id,
        chapterIndex: 0,
      },
    });
  }
  if (!local) {
    for (const file of files.filter((file) => file.kind === "textbook"))
      entries.push({
        id: officialEntryId({
          courseId: info.id,
          kind: "textbooks",
          itemId: file.id,
        }),
        title: file.path.split("/").at(-1)!,
        description: info.description,
        kind: "textbooks",
      });
  }
  if (
    local?.questions.length ||
    files.some((file) => file.kind === "questions")
  ) {
    entries.push({
      id: officialEntryId({ courseId: info.id, kind: "questions", itemId: "" }),
      title: `${local?.title ?? info.title}题目`,
      description: local?.questions.length
        ? `${local.questions.length} 道题目，包含答案和讲解。`
        : "题目及配套答案与讲解。",
      kind: "questions",
      selection: local?.questions.length
        ? {
            courseId: info.id,
            version: local.version,
            kind: "questions",
            itemId: local.questions[0]!.id,
            chapterIndex: 0,
          }
        : undefined,
    });
  }
  return entries;
}
