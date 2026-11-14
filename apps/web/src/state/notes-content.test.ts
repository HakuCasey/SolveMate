import { sourceForNote } from "./note-origins";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.restoreAllMocks());
import { createInitialData } from "../data/catalog";
import { assertAppData } from "../data/validation";
import {
  createNote,
  editNote,
  moveNote,
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
      origins: [
        {
          kind: "document",
          materialId: source.materialId,
          version: source.contentVersion,
          pageNumber: source.pageNumber,
        },
      ],
      revision: 1,
      tagIds: ["subject:c-language"],
    });
    expect(sourceForNote(note)).toEqual(source);
    expect(initial.noteLibrary!.notes).toHaveLength(4);
    expect(
      sourceForNote(JSON.parse(JSON.stringify(data)).noteLibrary.notes[0]),
    ).toEqual(source);
  });
  it("edits content without changing notebook, source, identity or tags", () => {
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
      },
      1,
    );
    expect(changed.noteLibrary!.notes[0]).toMatchObject({
      id: "note-new",
      title: "指针与地址",
      content: "- 新的理解",
      notebookId: unclassifiedNotebookId,
      revision: 2,
      origins: initial.noteLibrary!.notes[0].origins,
      tagIds: ["subject:c-language"],
    });
    assertAppData(changed);
    expect(() => editNote(changed, "note-new", values, 1)).toThrow("已更新");
    expect(initial.noteLibrary!.notes[0].revision).toBe(1);
  });
  it("moves to an existing or new notebook without changing content or source", () => {
    vi.spyOn(Date, "now").mockReturnValue(1000);
    const initial = createNote(
      createInitialData(),
      values,
      source,
      "c-language",
      "note-new",
    );
    const existing = moveNote(
      initial,
      "note-new",
      {
        kind: "existing",
        notebookId: "notebook-c-language",
      },
      1,
    );
    const created = moveNote(
      existing,
      "note-new",
      {
        kind: "new",
        title: "  复习笔记  ",
      },
      2,
      () => "notebook-review",
    );
    expect(created.noteLibrary!.notebooks.at(-1)).toEqual({
      id: "notebook-review",
      title: "复习笔记",
      revision: 1,
    });
    expect(created.noteLibrary!.notes[0]).toEqual({
      ...initial.noteLibrary!.notes[0],
      notebookId: "notebook-review",
      revision: 3,
    });
    assertAppData(created);
    // 编辑旧表单只保存正文，不能用其中残留的笔记本字段覆盖转移结果。
    const edited = editNote(created, "note-new", values, 3);
    expect(edited.noteLibrary!.notes[0].notebookId).toBe("notebook-review");
    expect(initial.noteLibrary!.notebooks).toHaveLength(3);
  });
  it("rejects missing destinations, duplicate names and stale moves before creating a notebook", () => {
    const initial = createNote(
      createInitialData(),
      values,
      source,
      null,
      "note-new",
    );
    const before = structuredClone(initial);
    expect(() =>
      moveNote(
        initial,
        "note-new",
        {
          kind: "existing",
          notebookId: "missing",
        },
        1,
      ),
    ).toThrow("笔记本已删除");
    expect(() =>
      moveNote(
        initial,
        "note-new",
        {
          kind: "new",
          title: "高等数学笔记",
        },
        1,
      ),
    ).toThrow("同名");
    expect(() =>
      moveNote(
        initial,
        "note-new",
        {
          kind: "new",
          title: "复习",
        },
        0,
      ),
    ).toThrow("已更新");
    expect(() =>
      moveNote(
        deleteNote(initial, "note-new", 1),
        "note-new",
        {
          kind: "new",
          title: "复习",
        },
        1,
      ),
    ).toThrow("已删除");
    expect(initial).toEqual(before);
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
      sourceForNote(
        deleted.noteLibrary!.notes.find((note) => note.id === "note-new")!,
      ),
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
  it("edits a note without rewriting its material origins", () => {
    const initial = createInitialData(),
      note = initial.noteLibrary!.notes[0];
    const changed = editNote(initial, note.id, values, note.revision);
    expect(changed.noteLibrary!.notes[0]).toMatchObject({
      origins: note.origins,
      createdAt: note.createdAt,
    });
    expect(changed.noteLibrary!.notes[0]).not.toHaveProperty("source");
    assertAppData(changed);
  });
});
