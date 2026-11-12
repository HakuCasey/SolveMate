import type {
  AppData,
  Note,
  Notebook,
  NoteLibrary,
  NoteTag,
  LearningLocation,
} from "@solvemate/contracts";
import { assertMetadata } from "@solvemate/contracts";
import type { SubjectDirectory } from "./subjects";
import { requireCurrentRecord } from "../refresh/errors";

export const unclassifiedNotebookId = "notebook-unclassified";
const systemNotebook: Notebook = {
  id: unclassifiedNotebookId,
  title: "未分类",
  revision: 1,
};

export type NoteAction =
  | {
      kind: "renameNotebook" | "renameNote";
      id: string;
      title: string;
      revision: number;
    }
  | {
      kind: "deleteNotebook";
      id: string;
      deleteNotes: boolean;
      revision: number;
    }
  | { kind: "deleteNote"; id: string; revision: number }
  | {
      kind: "tags";
      id: string;
      tagIds: string[];
      names: string[];
      revision: number;
    };

export function applyNoteAction(
  data: AppData,
  directory: SubjectDirectory,
  action: NoteAction,
): AppData {
  switch (action.kind) {
    case "renameNotebook":
      return renameNotebook(data, action.id, action.title, action.revision);
    case "renameNote":
      return renameNote(data, action.id, action.title, action.revision);
    case "deleteNotebook":
      return deleteNotebook(
        data,
        action.id,
        action.deleteNotes,
        action.revision,
      );
    case "deleteNote":
      return deleteNote(data, action.id, action.revision);
    case "tags":
      return saveNoteTags(
        data,
        directory,
        action.id,
        action.tagIds,
        action.names,
        action.revision,
      );
  }
}

/** 示例只用于初始化；空集合表示用户已经删除内容，不能重新填入示例。 */
export function initializeNotes(
  data: AppData,
  notebooks: Notebook[],
  notes: Note[],
): AppData {
  if (data.noteLibrary) return data;
  return {
    ...data,
    noteLibrary: structuredClone({
      notebooks: [...notebooks, systemNotebook],
      notes,
      customTags: [],
    }),
  };
}

function title(value: string, kind: string) {
  const text = value.trim();
  if (
    !text ||
    [...text].length > 80 ||
    [...text].some((char) => char.charCodeAt(0) < 32)
  )
    throw new Error(`${kind}名称须为 1–80 个字符，不能包含控制字符。`);
  return text;
}
function revision<T extends { revision: number }>(
  item: T | undefined,
  expected: number,
): asserts item is T {
  requireCurrentRecord(item, expected);
}
function libraryOf(data: AppData) {
  if (!data.noteLibrary) throw new Error("笔记尚未读取完成，请稍后重试。");
  return data.noteLibrary;
}
export function renameNotebook(
  data: AppData,
  id: string,
  value: string,
  expected: number,
): AppData {
  const library = libraryOf(data),
    item = library.notebooks.find((book) => book.id === id);
  revision(item, expected);
  if (id === unclassifiedNotebookId)
    throw new Error("“未分类”笔记本不能重命名。");
  const name = title(value, "笔记本");
  if (
    library.notebooks.some(
      (book) =>
        book.id !== id && book.title.toLowerCase() === name.toLowerCase(),
    )
  )
    throw new Error("已有同名笔记本，请使用其他名称。");
  return {
    ...data,
    noteLibrary: {
      ...library,
      notebooks: library.notebooks.map((book) =>
        book.id === id
          ? { ...book, title: name, revision: book.revision + 1 }
          : book,
      ),
    },
  };
}
export function deleteNotebook(
  data: AppData,
  id: string,
  deleteNotes: boolean,
  expected: number,
): AppData {
  const library = libraryOf(data);
  revision(
    library.notebooks.find((book) => book.id === id),
    expected,
  );
  if (id === unclassifiedNotebookId)
    throw new Error("“未分类”笔记本不能删除。");
  return {
    ...data,
    noteLibrary: {
      ...library,
      notebooks: library.notebooks.filter((book) => book.id !== id),
      notes: deleteNotes
        ? library.notes.filter((note) => note.notebookId !== id)
        : library.notes.map((note) =>
            note.notebookId === id
              ? {
                  ...note,
                  notebookId: unclassifiedNotebookId,
                  revision: note.revision + 1,
                }
              : note,
          ),
    },
  };
}
export function renameNote(
  data: AppData,
  id: string,
  value: string,
  expected: number,
): AppData {
  const library = libraryOf(data);
  revision(
    library.notes.find((note) => note.id === id),
    expected,
  );
  const name = title(value, "笔记");
  return {
    ...data,
    noteLibrary: {
      ...library,
      notes: library.notes.map((note) =>
        note.id === id
          ? { ...note, title: name, revision: note.revision + 1 }
          : note,
      ),
    },
  };
}
export function deleteNote(
  data: AppData,
  id: string,
  expected: number,
): AppData {
  const library = libraryOf(data);
  revision(
    library.notes.find((note) => note.id === id),
    expected,
  );
  return {
    ...data,
    noteLibrary: {
      ...library,
      notes: library.notes.filter((note) => note.id !== id),
    },
  };
}

/** 学科标签不复制名称；重命名学科后，选择框、条目和正文使用同一显示结果。 */
export function noteTags(
  library: NoteLibrary,
  directory: SubjectDirectory,
): NoteTag[] {
  return [
    { id: "subject:unclassified", title: "未分类" },
    ...directory.records.map((subject) => ({
      id: `subject:${subject.id}`,
      title: subject.title,
    })),
    ...library.customTags,
  ];
}
export function availableNoteTags(
  library: NoteLibrary,
  directory: SubjectDirectory,
  selected: string[],
): NoteTag[] {
  const deleted = new Set(
    directory.records
      .filter((subject) => subject.deleted)
      .map((subject) => `subject:${subject.id}`),
  );
  return noteTags(library, directory).filter(
    (tag) => !deleted.has(tag.id) || selected.includes(tag.id),
  );
}
export function saveNoteTags(
  data: AppData,
  directory: SubjectDirectory,
  id: string,
  selected: string[],
  names: string[],
  expected: number,
  newId = () => `note-tag-${crypto.randomUUID()}`,
): AppData {
  const library = libraryOf(data);
  const note = library.notes.find((item) => item.id === id);
  revision(note, expected);
  const tags = availableNoteTags(library, directory, note.tagIds);
  if (selected.some((tag) => !tags.some((item) => item.id === tag)))
    throw new Error("所选标签已不可用，请关闭窗口后重新选择。");
  const customTags = [...library.customTags];
  const tagIds = new Set(selected);
  for (const value of names) {
    const name = title(value, "标签");
    const existing = tags.find(
      (tag) => tag.title.toLowerCase() === name.toLowerCase(),
    );
    if (existing) tagIds.add(existing.id);
    else {
      const tag = { id: newId(), title: name };
      if (tags.some((item) => item.id === tag.id))
        throw new Error("标签编号重复，请重试。");
      customTags.push(tag);
      tags.push(tag);
      tagIds.add(tag.id);
    }
  }
  return {
    ...data,
    noteLibrary: {
      ...library,
      customTags,
      notes: library.notes.map((item) =>
        item.id === id
          ? { ...item, tagIds: [...tagIds], revision: item.revision + 1 }
          : item,
      ),
    },
  };
}
export function notePreview(content: string): string {
  return (
    content
      .split(/\r?\n/)
      .find((line) => line.trim() && !/^\s*```/.test(line)) ?? ""
  )
    .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|\d+\.\s+)/, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export interface NoteContent {
  title: string;
  content: string;
  notebookId: string;
}
function requireNotebook(library: NoteLibrary, id: string) {
  if (!library.notebooks.some((item) => item.id === id))
    throw new Error("所选笔记本已删除，请重新选择。");
}
function validateContent(value: NoteContent) {
  const name = title(value.title, "笔记");
  if (!value.content.trim() || value.content.length > 100000)
    throw new Error("请输入笔记正文，最多支持 100000 个字符。");
  return { ...value, title: name, summary: notePreview(value.content) };
}

export function createNote(
  data: AppData,
  value: NoteContent,
  source: LearningLocation | null,
  subjectId: string | null,
  id = `note-${crypto.randomUUID()}`,
): AppData {
  const library = libraryOf(data);
  requireNotebook(library, value.notebookId);
  if (library.notes.some((item) => item.id === id))
    throw new Error("这篇笔记已存在，请刷新后查看。");
  if (source)
    assertMetadata(
      "materialId" in source ? "MaterialLocation" : "ReadingSelection",
      source,
    );
  const note: Note = {
    ...validateContent(value),
    id,
    // 旧字段继续保留；新笔记的资料来源只从 source 读取。
    courseId: "",
    questionId: "",
    source: source ? structuredClone(source) : null,
    revision: 1,
    tagIds: [`subject:${subjectId ?? "unclassified"}`],
  };
  return {
    ...data,
    noteLibrary: { ...library, notes: [note, ...library.notes] },
  };
}

export function editNote(
  data: AppData,
  id: string,
  value: NoteContent,
  expected: number,
): AppData {
  const library = libraryOf(data);
  revision(
    library.notes.find((item) => item.id === id),
    expected,
  );
  requireNotebook(library, value.notebookId);
  const validated = validateContent(value);
  return {
    ...data,
    noteLibrary: {
      ...library,
      notes: library.notes.map((item) =>
        item.id === id
          ? { ...item, ...validated, revision: item.revision + 1 }
          : item,
      ),
    },
  };
}

export function assertNoteLibrary(
  value: unknown,
): asserts value is NoteLibrary {
  if (!value || typeof value !== "object")
    throw new Error("Invalid note library.");
  const library = value as NoteLibrary;
  if (
    ![library.notebooks, library.notes, library.customTags].every(Array.isArray)
  )
    throw new Error("Invalid note collections.");
  const unique = (items: { id: string }[]) =>
    items.every(
      (item) => item && typeof item.id === "string" && item.id.length > 0,
    ) && new Set(items.map((item) => item.id)).size === items.length;
  const validTitle = (value: unknown) =>
    typeof value === "string" &&
    value.trim().length > 0 &&
    [...value].length <= 80 &&
    ![...value].some((char) => char.charCodeAt(0) < 32);
  if (
    !unique(library.notebooks) ||
    !unique(library.notes) ||
    !unique(library.customTags) ||
    !library.notebooks.some(
      (book) => book.id === unclassifiedNotebookId && book.title === "未分类",
    ) ||
    library.notebooks.some(
      (book) =>
        !validTitle(book.title) ||
        !Number.isSafeInteger(book.revision) ||
        book.revision < 1,
    ) ||
    library.customTags.some(
      (tag) => !validTitle(tag.title) || !tag.id.startsWith("note-tag-"),
    ) ||
    library.notes.some(
      (note) =>
        !validTitle(note.title) ||
        !Number.isSafeInteger(note.revision) ||
        note.revision < 1 ||
        !library.notebooks.some((book) => book.id === note.notebookId) ||
        ![note.content, note.summary, note.courseId, note.questionId].every(
          (item) => typeof item === "string",
        ) ||
        !Array.isArray(note.tagIds) ||
        note.tagIds.some(
          (tag) =>
            typeof tag !== "string" ||
            (!tag.startsWith("subject:") &&
              !library.customTags.some((item) => item.id === tag)),
        ) ||
        new Set(note.tagIds).size !== note.tagIds.length,
    )
  )
    throw new Error("Invalid notebook, note or tag metadata.");
  for (const note of library.notes)
    if (note.source != null)
      assertMetadata(
        "materialId" in note.source ? "MaterialLocation" : "ReadingSelection",
        note.source,
      );
}
