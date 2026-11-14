import type {
  AppData,
  Note,
  Notebook,
  NoteLibrary,
  NoteTag,
  LearningLocation,
  ReadingReference,
} from "@solvemate/contracts";
import {
  assertMetadata,
  truncateNoteTitle,
  assertNoteMetadata,
  originsFromReading,
  uniqueNoteOrigins,
} from "@solvemate/contracts";
import type { SubjectDirectory } from "./subjects";
import { DataRequestError, requireCurrentRecord } from "../refresh/errors";

export const unclassifiedNotebookId = "notebook-unclassified";
const systemNotebook: Notebook = {
  id: unclassifiedNotebookId,
  title: "未分类",
  revision: 1,
};

export type NoteDestination =
  { kind: "existing"; notebookId: string } | { kind: "new"; title: string };

export type NoteAction =
  | {
      kind: "mergeNotes";
      notebookId: string;
      notes: Pick<Note, "id" | "revision">[];
    }
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
      kind: "moveNote";
      id: string;
      destination: NoteDestination;
      revision: number;
    }
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
    case "mergeNotes":
      return mergeNotes(data, action.notebookId, action.notes);
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
    case "moveNote":
      return moveNote(data, action.id, action.destination, action.revision);
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
/** 所有笔记修改统一推进修订号和时间，创建时间及未修改字段保持不变。 */
function updatedNote(note: Note, changes: Partial<Note>): Note {
  return {
    ...note,
    ...changes,
    revision: note.revision + 1,
    updatedAt: Math.max(Date.now(), note.createdAt ?? 0, note.updatedAt ?? 0),
  };
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
              ? updatedNote(note, { notebookId: unclassifiedNotebookId })
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
  const name = title(truncateNoteTitle(value.trim()), "笔记");
  return {
    ...data,
    noteLibrary: {
      ...library,
      notes: library.notes.map((note) =>
        note.id === id ? updatedNote(note, { title: name }) : note,
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

/** 按当前列表顺序合并；先核对全部修订号，再一次替换，失败不删除原笔记。 */
export function mergeNotes(
  data: AppData,
  notebookId: string,
  selected: Pick<Note, "id" | "revision">[],
): AppData {
  const library = libraryOf(data);
  requireNotebook(library, notebookId);
  const ids = new Set(selected.map((item) => item.id));
  if (ids.size < 2 || ids.size !== selected.length)
    throw new Error("请选择同一笔记本中的至少两篇笔记。");
  for (const item of selected) {
    const note = library.notes.find((note) => note.id === item.id);
    try {
      revision(note, item.revision);
    } catch (error) {
      if (error instanceof DataRequestError)
        throw new DataRequestError(
          note
            ? "所选笔记已更新，请取消合并，核对内容后重新选择。"
            : "所选笔记已删除，请取消合并后重新选择。",
          error.code,
          error.status,
        );
      throw error;
    }
    if (note.notebookId !== notebookId)
      throw new Error("所选笔记不在同一笔记本中，请重新选择。");
  }
  const ordered = library.notes.filter((note) => ids.has(note.id));
  const first = ordered[0];
  const content = ordered
    .map((note, index) =>
      index === 0 ? note.content : `## ${note.title}\n\n${note.content}`,
    )
    .join("\n\n---\n\n");
  const origins = ordered.flatMap((note) => note.origins);
  const uniqueOrigins = uniqueNoteOrigins(origins);
  if (content.length > 100000)
    throw new Error(
      "合并后的正文超过 100000 个字符，请减少所选笔记。原笔记未作修改。",
    );
  const merged = updatedNote(first, {
    ...validateContent({ title: first.title, content }),
    tagIds: [...new Set(ordered.flatMap((note) => note.tagIds))],
    origins: structuredClone(uniqueOrigins),
  });
  return {
    ...data,
    noteLibrary: {
      ...library,
      notes: library.notes.flatMap((note) =>
        note.id === first.id ? [merged] : ids.has(note.id) ? [] : [note],
      ),
    },
  };
}

/** 新建笔记本与转移笔记一次保存，失败时不留下空笔记本或改变原归属。 */
export function moveNote(
  data: AppData,
  id: string,
  destination: NoteDestination,
  expected: number,
  newId = () => `notebook-${crypto.randomUUID()}`,
): AppData {
  const library = libraryOf(data);
  const note = library.notes.find((item) => item.id === id);
  revision(note, expected);
  const { notebooks, notebookId } = resolveNoteDestination(
    library,
    destination,
    newId,
  );
  if (note.notebookId === notebookId) return data;
  return {
    ...data,
    noteLibrary: {
      ...library,
      notebooks,
      notes: library.notes.map((item) =>
        item.id === id ? updatedNote(item, { notebookId }) : item,
      ),
    },
  };
}

/** 创建与移动共用目标校验；只有整次保存成功后，调用方才提交返回的笔记本列表。 */
function resolveNoteDestination(
  library: NoteLibrary,
  destination: NoteDestination,
  newId = () => `notebook-${crypto.randomUUID()}`,
) {
  let notebooks = library.notebooks;
  let notebookId: string;
  if (destination.kind === "existing") {
    requireNotebook(library, destination.notebookId);
    notebookId = destination.notebookId;
  } else {
    const name = title(destination.title, "笔记本");
    if (
      notebooks.some((book) => book.title.toLowerCase() === name.toLowerCase())
    )
      throw new Error("已有同名笔记本，请从列表中选择。");
    notebookId = newId();
    if (notebooks.some((book) => book.id === notebookId))
      throw new Error("笔记本编号重复，请重试。");
    notebooks = [...notebooks, { id: notebookId, title: name, revision: 1 }];
  }
  return { notebooks, notebookId };
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
/** 列表、正文与导出只展示自定义标签，已有学科标签数据保持原样。 */
export function customNoteTagIds(note: Pick<Note, "tagIds">): string[] {
  return note.tagIds.filter((id) => !id.startsWith("subject:"));
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
        item.id === id ? updatedNote(item, { tagIds: [...tagIds] }) : item,
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
  destination?: NoteDestination;
  title: string;
  content: string;
  notebookId: string;
}
function requireNotebook(library: NoteLibrary, id: string) {
  if (!library.notebooks.some((item) => item.id === id))
    throw new Error("所选笔记本已删除，请重新选择。");
}
function validateContent(value: Pick<NoteContent, "title" | "content">) {
  const name = title(truncateNoteTitle(value.title.trim()), "笔记");
  if (!value.content.trim() || value.content.length > 100000)
    throw new Error("请输入笔记正文，最多支持 100000 个字符。");
  return {
    title: name,
    content: value.content,
  };
}

export function createNote(
  data: AppData,
  value: NoteContent,
  source: LearningLocation | null,
  subjectId: string | null,
  id = `note-${crypto.randomUUID()}`,
  excerpt?: ReadingReference,
): AppData {
  const library = libraryOf(data);
  const { notebooks, notebookId } = resolveNoteDestination(
    library,
    value.destination ?? { kind: "existing", notebookId: value.notebookId },
    () => `notebook-${id.replace(/^note-/, "")}`,
  );
  if (excerpt) assertMetadata("ReadingReference", excerpt);
  if (library.notes.some((item) => item.id === id))
    throw new Error("这篇笔记已存在，请刷新后查看。");
  if (source)
    assertMetadata(
      "materialId" in source ? "MaterialLocation" : "ReadingSelection",
      source,
    );
  const now = Date.now();
  const note: Note = {
    ...validateContent(value),
    notebookId,
    id,
    origins: originsFromReading(source, excerpt),
    createdAt: now,
    updatedAt: now,
    revision: 1,
    tagIds: [`subject:${subjectId ?? "unclassified"}`],
  };
  assertNoteMetadata(note);
  return {
    ...data,
    noteLibrary: { ...library, notebooks, notes: [note, ...library.notes] },
  };
}

export function editNote(
  data: AppData,
  id: string,
  value: Pick<NoteContent, "title" | "content">,
  expected: number,
): AppData {
  const library = libraryOf(data);
  revision(
    library.notes.find((item) => item.id === id),
    expected,
  );
  const validated = validateContent(value);
  return {
    ...data,
    noteLibrary: {
      ...library,
      notes: library.notes.map((item) =>
        item.id === id ? updatedNote(item, validated) : item,
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
        typeof note.content !== "string" ||
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
  for (const note of library.notes) assertNoteMetadata(note);
}
