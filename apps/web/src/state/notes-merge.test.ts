import { locationForOrigin } from "@solvemate/contracts";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createInitialData, courses } from "../data/catalog";
import { assertAppData } from "../data/validation";
import { createSubjectDirectory } from "./subjects";
import {
  applyNoteAction,
  createNote,
  editNote,
  mergeNotes,
  moveNote,
  renameNote,
  unclassifiedNotebookId,
} from "./notes";
import { sourceForNote } from "./note-origins";
import { makeMessageReference } from "../reading/reference";
import { LearningRelations } from "../reading/relations";
import { OfficialLibrary } from "../content/library";
import { makeSnapshot } from "../content/storage";
import { NotebookList } from "../components/NotebookList";
import { NotebookDocument } from "../components/NotebookDocument";

const selected = [
  { id: "N002", revision: 1 },
  { id: "N001", revision: 1 },
];
const notebookId = "notebook-calculus";

describe("merge notes in one notebook", () => {
  it("omits subject labels from the note list while retaining custom labels and saved ids", () => {
    const data = mergeNotes(createInitialData(), notebookId, selected);
    const note = data.noteLibrary!.notes[0];
    const directory = createSubjectDirectory(courses);
    const render = () =>
      renderToStaticMarkup(
        createElement(NotebookList, {
          library: data.noteLibrary!,
          directory,
          activeNoteId: note.id,
          relations: new LearningRelations(
            data,
            courses,
            [],
            new OfficialLibrary(makeSnapshot(), data),
          ),
          onSelect: () => undefined,
          onAction: async () => undefined,
          onLocation: () => undefined,
          onMessage: () => undefined,
        }),
      );
    const original = structuredClone(note);
    expect(render()).not.toContain(">高等数学</span>");
    expect(note).toEqual(original);
    data.noteLibrary!.customTags.push({
      id: "note-tag-own",
      title: "高等数学",
    });
    note.tagIds.push("note-tag-own");
    expect(render().match(/>高等数学<\/span>/g)).toHaveLength(1);
    expect(note.tagIds).toEqual(["subject:calculus", "note-tag-own"]);
  });

  it("uses list order instead of click order and replaces selected notes atomically", () => {
    const data = createInitialData();
    const before = structuredClone(data);
    data.noteLibrary!.notes[1].tagIds.push("subject:c-language");
    const changed = applyNoteAction(data, createSubjectDirectory(courses), {
      kind: "mergeNotes",
      notebookId,
      notes: selected,
    });
    const [first, second] = data.noteLibrary!.notes;
    const merged = changed.noteLibrary!.notes[0];
    expect(changed.noteLibrary!.notes.map((note) => note.id)).toEqual([
      "N001",
      "N003",
      "N004",
    ]);
    expect(merged).toMatchObject({
      id: first.id,
      notebookId,
      title: first.title,
      revision: 2,
      tagIds: ["subject:calculus", "subject:c-language"],
      content: `${first.content}\n\n---\n\n## ${second.title}\n\n${second.content}`,
    });
    expect(changed.noteLibrary!.notes[1]).toBe(data.noteLibrary!.notes[2]);
    expect(data.noteLibrary!.notes.map((note) => note.content)).toEqual(
      before.noteLibrary!.notes.map((note) => note.content),
    );
    expect(changed.noteLibrary!.notebooks).toBe(data.noteLibrary!.notebooks);
    assertAppData(changed);
  });
  it("keeps every material association, including when merging an already merged note", () => {
    const data = createInitialData();
    let changed = mergeNotes(data, notebookId, selected);
    const origins = changed.noteLibrary!.notes[0].origins;
    expect(origins.map(locationForOrigin)).toEqual(
      data.noteLibrary!.notes.slice(0, 2).map(sourceForNote),
    );
    const relations = new LearningRelations(
      changed,
      courses,
      [],
      new OfficialLibrary(makeSnapshot(), changed),
    );
    for (const origin of origins)
      expect(
        relations
          .related(locationForOrigin(origin)!)
          .notes.map((note) => note.id),
      ).toContain("N001");
    changed = moveNote(changed, "N003", { kind: "existing", notebookId }, 1);
    changed = mergeNotes(changed, notebookId, [
      { id: "N003", revision: 2 },
      { id: "N001", revision: 2 },
    ]);
    const merged = changed.noteLibrary!.notes[0];
    expect(merged.origins).toHaveLength(3);
    expect(
      editNote(
        changed,
        merged.id,
        { title: "合并后的理解", content: "补充正文" },
        merged.revision,
      ).noteLibrary!.notes[0].origins,
    ).toEqual(merged.origins);
    assertAppData(changed);
  });
  it("keeps message ids and PDF pages, and includes all sources in export", () => {
    let data = createInitialData();
    const conversation = data.conversations.find(
      (item) => item.messages.length,
    )!;
    const reference = makeMessageReference(
      conversation,
      [conversation.messages[0].id],
      "讨论选段",
    );
    const page = {
      materialId: "11111111-1111-4111-8111-111111111111",
      contentVersion: "a".repeat(64),
      pageNumber: 3,
    };
    const values = {
      title: "讨论摘录",
      content: "讨论选段",
      notebookId: unclassifiedNotebookId,
    };
    data = createNote(data, values, null, null, "note-chat", reference);
    data = createNote(
      data,
      { ...values, title: "课本摘录" },
      page,
      null,
      "note-page",
      {
        title: "C 语言课本 · 第 3 页",
        content: "课本选段",
        selection: null,
        material: page,
        quoteKind: "selection",
      },
    );
    const changed = mergeNotes(data, unclassifiedNotebookId, [
      { id: "note-chat", revision: 1 },
      { id: "note-page", revision: 1 },
    ]);
    const merged = changed.noteLibrary!.notes[0];
    expect(locationForOrigin(merged.origins[0])).toEqual(page);
    expect(merged.origins[1]).toEqual({
      kind: "conversation",
      ...reference.message,
    });
    expect(merged).not.toHaveProperty("excerpt");
    expect(merged).not.toHaveProperty("source");
    assertAppData(changed);
    const html = renderToStaticMarkup(
      NotebookDocument({
        notebook: changed.noteLibrary!.notebooks.find(
          (book) => book.id === unclassifiedNotebookId,
        )!,
        notes: [merged],
        tags: {},
      }),
    );
    expect(html).toContain("第 3 页");
    expect(html).toContain("来源：对话");
  });
  it("rejects missing, moved, changed or invalid selections and oversized content without deleting anything", () => {
    const data = createInitialData();
    const before = structuredClone(data);
    expect(() => mergeNotes(data, notebookId, selected.slice(0, 1))).toThrow(
      "至少两篇",
    );
    expect(() =>
      mergeNotes(data, notebookId, [selected[0], selected[0]]),
    ).toThrow("至少两篇");
    expect(() => mergeNotes(data, "deleted", selected)).toThrow("已删除");
    expect(() =>
      mergeNotes(data, notebookId, [
        selected[0],
        { id: "missing", revision: 1 },
      ]),
    ).toThrow("已删除");
    expect(() =>
      mergeNotes(data, notebookId, [selected[0], { id: "N003", revision: 1 }]),
    ).toThrow("同一笔记本");
    expect(() =>
      mergeNotes(renameNote(data, "N002", "改名", 1), notebookId, selected),
    ).toThrow("已更新");
    expect(data).toEqual(before);
    data.noteLibrary!.notes[0].content = "a".repeat(100000);
    expect(() => mergeNotes(data, notebookId, selected)).toThrow("超过 100000");
    expect(data.noteLibrary!.notes).toHaveLength(4);
  });
  it("deduplicates origins and supports notes without a source", () => {
    const data = createInitialData();
    data.noteLibrary!.notes[1].origins = structuredClone(
      data.noteLibrary!.notes[0].origins,
    );
    expect(
      mergeNotes(data, notebookId, selected).noteLibrary!.notes[0].origins,
    ).toHaveLength(1);
    for (const note of data.noteLibrary!.notes) note.origins = [];
    const merged = mergeNotes(data, notebookId, selected).noteLibrary!.notes[0];
    expect(merged.origins).toEqual([]);
    expect(sourceForNote(merged)).toBeNull();
  });
});
