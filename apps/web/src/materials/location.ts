import type { ReadingSelection, MaterialLocation } from "@solvemate/contracts";
/** 发布目录中的课程位置转换为资料位置；运行中的引用不依赖课程归属。 */
export function materialLocation(
  selection: ReadingSelection,
): MaterialLocation {
  if (
    !selection.version ||
    (selection.kind === "textbooks" && !selection.pageNumber)
  )
    throw new Error("当前版本已不支持该引用方式");
  return selection.kind === "questions"
    ? {
        materialId: `${selection.courseId}:questions`,
        contentVersion: selection.version,
        questionId: selection.itemId,
      }
    : {
        materialId: `${selection.courseId}:textbooks:${selection.itemId}`,
        contentVersion: selection.version,
        pageNumber: selection.pageNumber,
      };
}
