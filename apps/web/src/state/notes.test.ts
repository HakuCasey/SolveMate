import { describe, expect, it } from "vitest";
import {
  courses,
  createInitialData,
  sampleNotebooks,
  sampleNotes,
} from "../data/catalog";
import {
  createSubjectDirectory,
  renameSubject,
  removeSubject,
  addSubject,
} from "./subjects";
import {
  applyNoteAction,
  createNote,
  editNote,
  availableNoteTags,
  assertNoteLibrary,
  deleteNote,
  deleteNotebook,
  initializeNotes,
  notePreview,
  noteTags,
  renameNote,
  renameNotebook,
  saveNoteTags,
  unclassifiedNotebookId,
} from "./notes";

describe("notebook and note metadata", () => {
  it("truncates generated, edited and renamed note titles to 24 Unicode characters without changing the body", () => {
    const original = "字".repeat(24) + "其余标题";
    let data = createNote(
      createInitialData(),
      {
        title: original,
        content: "完整正文不截断",
        notebookId: unclassifiedNotebookId,
      },
      null,
      null,
      "title-test",
    );
    expect(data.noteLibrary!.notes[0].title).toBe("字".repeat(24));
    data = editNote(
      data,
      "title-test",
      { title: "🙂".repeat(25), content: "编辑后的完整正文" },
      1,
    );
    expect(data.noteLibrary!.notes[0].title).toBe("🙂".repeat(24));
    data = renameNote(data, "title-test", "题".repeat(30), 2);
    expect(data.noteLibrary!.notes[0].title).toBe("题".repeat(24));
    expect(data.noteLibrary!.notes[0].content).toBe("编辑后的完整正文");
    assertNoteLibrary(data.noteLibrary);
  });

  it("initializes old records once and never repopulates deleted notes", () => {
    const old = createInitialData();
    delete old.noteLibrary;
    const data = initializeNotes(old, sampleNotebooks, sampleNotes);
    expect(data.noteLibrary?.notes).toHaveLength(4);
    expect(
      data.noteLibrary?.notebooks.find(
        (item) => item.id === unclassifiedNotebookId,
      )?.title,
    ).toBe("未分类");
    data.noteLibrary!.notes = [];
    expect(initializeNotes(data, sampleNotebooks, sampleNotes)).toBe(data);
    expect(data.noteLibrary?.notes).toEqual([]);
    expect(old.noteLibrary).toBeUndefined();
  });
  it("renames stable objects and rejects empty, duplicate, system and stale edits", () => {
    const initial = createInitialData();
    const renamed = renameNotebook(
      initial,
      "notebook-calculus",
      "我的高数笔记",
      1,
    );
    expect(renamed.noteLibrary?.notes).toEqual(initial.noteLibrary?.notes);
    const note = renameNote(renamed, "N001", "零点附近的极限", 1).noteLibrary!
      .notes[0];
    expect(note).toMatchObject({
      id: "N001",
      notebookId: "notebook-calculus",
      revision: 2,
      title: "零点附近的极限",
      content: initial.noteLibrary!.notes[0].content,
    });
    expect(() =>
      renameNotebook(renamed, "notebook-calculus", "过期编辑", 1),
    ).toThrow("已更新");
    expect(() =>
      renameNotebook(initial, "notebook-calculus", "C 语言笔记", 1),
    ).toThrow("同名");
    expect(() =>
      renameNotebook(initial, unclassifiedNotebookId, "其他", 1),
    ).toThrow("不能重命名");
    expect(() =>
      deleteNotebook(initial, unclassifiedNotebookId, true, 1),
    ).toThrow("不能删除");
    for (const name of [" ", "line\nbreak"])
      expect(() => renameNote(initial, "N001", name, 1)).toThrow("名称");
    expect(initial.noteLibrary!.notes[0].revision).toBe(1);
  });
  it("moves all notes to the system notebook in one immutable change", () => {
    const initial = createInitialData();
    const changed = deleteNotebook(initial, "notebook-calculus", false, 1);
    expect(
      changed.noteLibrary!.notebooks.some(
        (item) => item.id === "notebook-calculus",
      ),
    ).toBe(false);
    expect(
      changed.noteLibrary!.notes.slice(0, 2).map((item) => item.notebookId),
    ).toEqual([unclassifiedNotebookId, unclassifiedNotebookId]);
    expect(changed.noteLibrary!.notes[0]).toMatchObject({
      id: "N001",
      tagIds: ["subject:calculus"],
      content: initial.noteLibrary!.notes[0].content,
      revision: 2,
    });
    expect(changed.noteLibrary!.notes.slice(2)).toEqual(
      initial.noteLibrary!.notes.slice(2),
    );
    expect(initial.noteLibrary!.notes[0].notebookId).toBe("notebook-calculus");
    assertNoteLibrary(changed.noteLibrary);
  });
  it("deletes only the chosen notebook's notes and allows an empty library", () => {
    const initial = createInitialData();
    const changed = deleteNotebook(initial, "notebook-calculus", true, 1);
    expect(changed.noteLibrary!.notes.map((item) => item.id)).toEqual([
      "N003",
      "N004",
    ]);
    const empty = deleteNotebook(changed, "notebook-c-language", true, 1);
    expect(empty.noteLibrary!.notes).toEqual([]);
    assertNoteLibrary(empty.noteLibrary);
    expect(initializeNotes(empty, sampleNotebooks, sampleNotes)).toBe(empty);
  });
  it("uses subject identifiers so renaming updates labels and deleting preserves applied labels", () => {
    const data = renameSubject(
      createInitialData(),
      courses,
      "calculus",
      "微积分",
    );
    const directory = createSubjectDirectory(courses, data.subjects);
    expect(
      noteTags(data.noteLibrary!, directory).find(
        (item) => item.id === "subject:calculus",
      )?.title,
    ).toBe("微积分");
    const removed = removeSubject(data, courses, "calculus");
    const after = createSubjectDirectory(courses, removed.subjects);
    expect(
      availableNoteTags(removed.noteLibrary!, after, ["subject:calculus"]).some(
        (item) => item.id === "subject:calculus",
      ),
    ).toBe(true);
    expect(
      availableNoteTags(removed.noteLibrary!, after, []).some(
        (item) => item.id === "subject:calculus",
      ),
    ).toBe(false);
    const added = addSubject(removed, courses, "物理", "subject-physics");
    expect(
      noteTags(
        added.noteLibrary!,
        createSubjectDirectory(courses, added.subjects),
      ).some((item) => item.id === "subject:subject-physics"),
    ).toBe(true);
  });
  it("saves custom tag definitions and references together and reuses matching names", () => {
    const initial = createInitialData(),
      directory = createSubjectDirectory(courses);
    const changed = saveNoteTags(
      initial,
      directory,
      "N001",
      ["subject:calculus"],
      ["考前复习", "考前复习", "C 语言"],
      1,
      () => "note-tag-review",
    );
    expect(changed.noteLibrary!.customTags).toEqual([
      { id: "note-tag-review", title: "考前复习" },
    ]);
    expect(changed.noteLibrary!.notes[0].tagIds).toEqual([
      "subject:calculus",
      "note-tag-review",
      "subject:c-language",
    ]);
    const reused = saveNoteTags(
      changed,
      directory,
      "N003",
      [],
      ["考前复习"],
      1,
    );
    expect(reused.noteLibrary!.customTags).toHaveLength(1);
    expect(reused.noteLibrary!.notes[2].tagIds).toEqual(["note-tag-review"]);
    expect(initial.noteLibrary!.customTags).toEqual([]);
    assertNoteLibrary(reused.noteLibrary);
    expect(() => saveNoteTags(changed, directory, "N001", [], [], 1)).toThrow(
      "已更新",
    );
    expect(() =>
      saveNoteTags(initial, directory, "N001", ["missing"], [], 1),
    ).toThrow("不可用");
  });
  it("deletes one note, preserves unrelated metadata and rejects orphan references", () => {
    const initial = createInitialData();
    const changed = applyNoteAction(initial, createSubjectDirectory(courses), {
      kind: "deleteNote",
      id: "N001",
      revision: 1,
    });
    expect(changed.noteLibrary!.notes).toHaveLength(3);
    expect(changed.noteLibrary!.notebooks).toEqual(
      initial.noteLibrary!.notebooks,
    );
    expect(() => deleteNote(changed, "N001", 1)).toThrow("已删除");
    const broken = structuredClone(initial.noteLibrary!);
    broken.notes[0].notebookId = "missing";
    expect(() => assertNoteLibrary(broken)).toThrow();
    const invalid = structuredClone(initial.noteLibrary!);
    invalid.notes[0].tagIds = ["note-tag-missing"];
    expect(() => assertNoteLibrary(invalid)).toThrow();
  });
  it("previews the first actual line rather than a separate summary", () => {
    expect(
      notePreview("\r\n### **第一行** [资料](https://example.com)\r\n第二行"),
    ).toBe("第一行 资料");
    expect(notePreview("```c\nint main() { return 0; }\n```")).toBe(
      "int main() { return 0; }",
    );
    expect(notePreview("\n\n")).toBe("");
    expect(notePreview("```c\nint foo_bar = *ptr;\n```")).toBe(
      "int foo_bar = *ptr;",
    );
  });
});
