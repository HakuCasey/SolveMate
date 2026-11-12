import { DataRequestError } from "../refresh/errors";
import type { AppData, Subject } from "@solvemate/contracts";

type OfficialSubject = { id: string; title: string };

/** 目录由同一份元数据生成；完整记录用于删除判断，可用项用于所有选择入口。 */
export interface SubjectDirectory {
  readonly records: Subject[];
  readonly active: Subject[];
  readonly byId: ReadonlyMap<string, Subject>;
}

export function createSubjectDirectory(
  official: OfficialSubject[],
  saved: Subject[] = [],
): SubjectDirectory {
  const records = subjectCatalog(official, saved);
  return {
    records,
    active: records.filter((item) => !item.deleted),
    byId: new Map(records.map((item) => [item.id, item])),
  };
}

export function requireActiveSubject(
  directory: SubjectDirectory,
  id: string | null,
): Subject | null {
  if (id === null) return null;
  const subject = directory.byId.get(id);
  if (!subject || subject.deleted)
    throw new DataRequestError(
      "所选学科已删除或不可用，输入仍保留，请刷新后重新选择。",
      "subject_unavailable",
      409,
    );
  return subject;
}

/** 未保存过学科设置的旧数据沿用官方分类；删除的分类不会因刷新或下载更新重新出现。 */
export function subjectCatalog(
  official: OfficialSubject[],
  saved: Subject[] = [],
): Subject[] {
  const catalog = new Map(
    official.map((item) => [
      item.id,
      { id: item.id, title: item.title, deleted: false },
    ]),
  );
  saved.forEach((item) => catalog.set(item.id, item));
  return [...catalog.values()];
}

function subjectTitle(value: string, catalog: Subject[], ownId?: string) {
  const title = value.trim().replace(/\s+/g, " ");
  if (!title || [...title].length > 40)
    throw new Error("学科名称须为 1–40 个字符。");
  if (title === "未分类")
    throw new Error("“未分类”是系统分类，请使用其他名称。");
  if (
    catalog.some(
      (item) =>
        !item.deleted &&
        item.id !== ownId &&
        item.title.toLowerCase() === title.toLowerCase(),
    )
  )
    throw new Error("已有同名学科，请使用其他名称。");
  return title;
}

export function addSubject(
  data: AppData,
  official: OfficialSubject[],
  value: string,
  id: string,
): AppData {
  const catalog = subjectCatalog(official, data.subjects);
  if (catalog.some((item) => item.id === id))
    throw new Error("学科编号重复，请重新创建。");
  const title = subjectTitle(value, catalog);
  return { ...data, subjects: [...catalog, { id, title, deleted: false }] };
}

export function renameSubject(
  data: AppData,
  official: OfficialSubject[],
  id: string,
  value: string,
): AppData {
  const directory = createSubjectDirectory(official, data.subjects);
  requireActiveSubject(directory, id);
  const catalog = directory.records;
  const title = subjectTitle(value, catalog, id);
  return {
    ...data,
    subjects: catalog.map((item) =>
      item.id === id ? { ...item, title } : item,
    ),
  };
}

export function removeSubject(
  data: AppData,
  official: OfficialSubject[],
  id: string,
): AppData {
  const directory = createSubjectDirectory(official, data.subjects);
  requireActiveSubject(directory, id);
  const catalog = directory.records;
  // 删除标记同时移除学科下的上传资料条目，原文件、原生会话绑定和历史引用均保留。
  return {
    ...data,
    subjects: catalog.map((item) =>
      item.id === id
        ? { ...item, deleted: true, materialsDeleted: true }
        : item,
    ),
  };
}
