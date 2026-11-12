import type {
  Material,
  MaterialLocation,
  ReadingSelection,
} from "@solvemate/contracts";
import type { SubjectDirectory } from "../state/subjects";

/** 列表范围独立于已打开的阅读位置；空科目用于未分类资料。 */
export interface LibraryScope {
  courseId: string | null;
  kind: ReadingSelection["kind"];
}
export type MaterialMembership =
  | { state: "classified"; subjectId: string }
  | { state: "unclassified"; subjectId: null }
  | { state: "removed"; subjectId: null };

/** 列表、返回导航和归类菜单统一在此区分删除条目与未分类条目。 */
export function materialMembership(
  material: Material | undefined,
  directory: SubjectDirectory,
): MaterialMembership {
  if (material?.deletedAt != null) return { state: "removed", subjectId: null };
  const subject = material?.courseId
    ? directory.byId.get(material.courseId)
    : undefined;
  if (subject?.deleted && subject.materialsDeleted)
    return { state: "removed", subjectId: null };
  if (subject && !subject.deleted)
    return { state: "classified", subjectId: subject.id };
  return { state: "unclassified", subjectId: null };
}
export function materialCourse(
  material: Material | undefined,
  directory: SubjectDirectory,
): string | null {
  return materialMembership(material, directory).subjectId;
}
export function materialsInCourse(
  items: Material[],
  courseId: string | null,
  directory: SubjectDirectory,
) {
  return items.filter((item) => {
    const membership = materialMembership(item, directory);
    return membership.state !== "removed" && membership.subjectId === courseId;
  });
}
export function scopeForMaterial(
  location: MaterialLocation,
  items: Material[],
  directory: SubjectDirectory,
): LibraryScope {
  return {
    courseId: materialCourse(
      items.find((item) => item.id === location.materialId),
      directory,
    ),
    kind: "textbooks",
  };
}
