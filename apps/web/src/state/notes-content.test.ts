import { describe, expect, it } from "vitest";
import { createInitialData } from "../data/catalog";
import { assertAppData } from "../data/validation";
import {
  createNote,
  editNote,
  deleteNote,
  deleteNotebook,
  unclassifiedNotebookId,
} from "./notes";

const source = {
  materialId: "11111111-1111-4111-8111-111111111111",
  contentVersion: "a".repeat(64),
  pageNumber: 3,
};
const values = {
  title: "  指针  ",
  content: "# 指针\n\n指针保存对象的地址。",
  notebookId: unclassifiedNotebookId,
};
describe("note content and source", () => {
  it("saves a copied fixed-version source and subject tag using the shared schema", () => {
    const initial = createInitialData(),
      data = createNote(initial, values, source, "c-language", "note-new");
    const note = data.noteLibrary!.notes[0];
    assertAppData(data);
    expect(note).toMatchObject({
      title: "指针",
      summary: "指针",
      source,
      revision: 1,
      tagIds: ["subject:c-language"],
      courseId: "",
      questionId: "",
    });
    expect(note.source).not.toBe(source);
    expect(initial.noteLibrary!.notes).toHaveLength(4);
    expect(
      JSON.parse(JSON.stringify(data)).noteLibrary.notes[0].source,
    ).toEqual(source);
  });
  it("edits content and notebook without changing source, identity or tags", () => {
    const initial = createNote(
      createInitialData(),
      values,
      source,
      "c-language",
      "note-new",
    );
    const changed = editNote(
      initial,
      "note-new",
      {
        ...values,
        title: "指针与地址",
        content: "- 新的理解",
        notebookId: "notebook-c-language",
      },
      1,
    );
    expect(changed.noteLibrary!.notes[0]).toMatchObject({
      id: "note-new",
      title: "指针与地址",
      content: "- 新的理解",
      summary: "新的理解",
      notebookId: "notebook-c-language",
      revision: 2,
      source,
      tagIds: ["subject:c-language"],
    });
    assertAppData(changed);
    expect(() => editNote(changed, "note-new", values, 1)).toThrow("已更新");
    expect(initial.noteLibrary!.notes[0].revision).toBe(1);
  });
  it("keeps failed or deleted edits from recreating a note or its notebook", () => {
    const initial = createNote(
      createInitialData(),
      { ...values, notebookId: "notebook-calculus" },
      source,
      null,
      "note-new",
    );
    expect(() =>
      editNote(deleteNote(initial, "note-new", 1), "note-new", values, 1),
    ).toThrow("已删除");
    const deleted = deleteNotebook(initial, "notebook-calculus", false, 1);
    expect(
      deleted.noteLibrary!.notes.find((note) => note.id === "note-new")?.source,
    ).toEqual(source);
    expect(() =>
      createNote(
        deleted,
        { ...values, notebookId: "notebook-calculus" },
        source,
        null,
      ),
    ).toThrow("笔记本已删除");
    expect(() => createNote(initial, values, source, null, "note-new")).toThrow(
      "已存在",
    );
  });
  it("rejects invalid source, blank content and oversized content without changing existing records", () => {
    const initial = createInitialData(),
      before = structuredClone(initial);
    expect(() =>
      createNote(initial, values, { ...source, pageNumber: 0 }, null),
    ).toThrow();
    for (const content of ["  ", "a".repeat(100001)])
      expect(() =>
        createNote(initial, { ...values, content }, source, null),
      ).toThrow("正文");
    expect(() =>
      createNote(initial, { ...values, title: " " }, source, null),
    ).toThrow("名称");
    expect(initial).toEqual(before);
  });
  it("edits a legacy note without rewriting its legacy source fields", () => {
    const initial = createInitialData(),
      note = initial.noteLibrary!.notes[0];
    const changed = editNote(
      initial,
      note.id,
      { ...values, notebookId: note.notebookId },
      note.revision,
    );
    expect(changed.noteLibrary!.notes[0]).toMatchObject({
      courseId: note.courseId,
      questionId: note.questionId,
    });
    expect(changed.noteLibrary!.notes[0].source).toBeUndefined();
    assertAppData(changed);
  });
});
