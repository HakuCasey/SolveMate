import type { Material } from "@solvemate/contracts";
import { requireActiveSubject, type SubjectDirectory } from "../state/subjects";

export interface MaterialImportResult {
  saved: Material[];
  failed: { file: File; message: string }[];
}
interface Dependencies {
  readSubjects: () => SubjectDirectory;
  importFile: (file: File, courseId: string) => Promise<Material>;
  assignCourse: (item: Material, courseId: string | null) => Promise<Material>;
}

/** 业务判断与请求顺序独立于 React，页面只提交文件和稳定的学科编号。 */
export function createMaterialOperations(dependencies: Dependencies) {
  function target(courseId: string | null) {
    requireActiveSubject(dependencies.readSubjects(), courseId);
  }
  return {
    async importFiles(
      files: File[],
      courseId: string | null,
      progress: (file: File) => void,
      saved: (item: Material) => void,
    ): Promise<MaterialImportResult> {
      const result: MaterialImportResult = { saved: [], failed: [] };
      for (const file of files) {
        progress(file);
        try {
          target(courseId);
          const record = await dependencies.importFile(file, courseId ?? "");
          result.saved.push(record);
          saved(record);
          // 文件已经保存后，目录仍可能变化；保留原件并明确告知，不能显示整批成功。
          try {
            target(courseId);
          } catch {
            throw new Error(
              "资料原文件已保存，但所属学科已删除，请重新选择学科后重试。",
            );
          }
        } catch (failure) {
          result.failed.push({
            file,
            message:
              failure instanceof Error
                ? failure.message
                : "资料未能上传，请重试。",
          });
        }
      }
      return result;
    },
    async assignCourse(
      item: Material,
      courseId: string | null,
      saved: (item: Material) => void,
    ) {
      target(courseId);
      const record = await dependencies.assignCourse(item, courseId);
      saved(record);
      try {
        target(courseId);
      } catch {
        throw new Error("资料已转移，但目标学科已删除，请重新选择学科。");
      }
      return record;
    },
  };
}
