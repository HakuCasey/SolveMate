import { describe, expect, it, vi, afterEach } from "vitest";
import {
  assertNoteMetadata,
  migrateNoteMetadata,
  locationForOrigin,
  originsFromReading,
  truncateNoteTitle,
} from "@solvemate/contracts";
import fixtures from "../../../../packages/contracts/fixtures/note-metadata.json";
import { createInitialData, courses } from "./catalog";
import { migrateAiMetadata } from "./migrate-ai-metadata";
import {
  createNote,
  editNote,
  renameNote,
  moveNote,
  deleteNotebook,
  saveNoteTags,
  mergeNotes,
  unclassifiedNotebookId,
} from "../state/notes";
import { createSubjectDirectory } from "../state/subjects";
import { LearningRelations } from "../reading/relations";
import { OfficialLibrary } from "../content/library";
import { makeSnapshot } from "../content/storage";

afterEach(() => vi.useRealTimers());
describe("unified note metadata", () => {
  for (const fixture of fixtures)
    it(`migrates ${fixture.name} without changing saved content or identity`, () => {
      const value = {
        ...createInitialData(),
        noteLibrary: {
          notebooks: createInitialData().noteLibrary!.notebooks,
          customTags: [],
          notes: [fixture.note],
        },
      };
      const before = structuredClone(value);
      const upgraded = migrateAiMetadata(value);
      const note = upgraded.noteLibrary!.notes[0];
      expect(note).toEqual({
        id: fixture.note.id,
        notebookId: fixture.note.notebookId,
        title: truncateNoteTitle(fixture.note.title),
        content: fixture.note.content,
        revision: fixture.note.revision,
        tagIds: fixture.note.tagIds,
        createdAt: null,
        updatedAt: null,
        origins: fixture.origins,
      });
      expect(value).toEqual(before);
      expect(migrateAiMetadata(upgraded)).toBe(upgraded);
      for (const origin of note.origins)
        if (origin.kind !== "conversation")
          expect(originsFromReading(locationForOrigin(origin))).toEqual([
            origin,
          ]);
    });
  it("preserves known times, and rejects invalid dates and old fields after migration", () => {
    const value = {
      ...createInitialData(),
      noteLibrary: {
        ...createInitialData().noteLibrary!,
        notes: [{ ...fixtures[0].note, createdAt: 100, updatedAt: 200 }],
      },
    };
    const note = migrateNoteMetadata(value).noteLibrary!.notes[0];
    expect(note).toMatchObject({ createdAt: 100, updatedAt: 200 });
    for (const broken of [
      { ...note, summary: "duplicate" },
      { ...note, courseId: "calculus" },
      { ...note, updatedAt: 99 },
      { ...note, createdAt: -1 },
      { ...note, origins: [{ ...note.origins[0], quote: "不得重复保存原文" }] },
      {
        ...note,
        origins: [{ ...note.origins[0], startOffset: 0, endOffset: 5 }],
      },
      {
        ...note,
        origins: [
          { kind: "conversation", conversationId: "C", messageIds: [] },
        ],
      },
    ])
      expect(() => assertNoteMetadata(broken)).toThrow();
  });
  it("records one creation time and updates all note changes through the same rule", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    let data = createNote(
      createInitialData(),
      { title: "自己的笔记", content: "正文", notebookId: "notebook-calculus" },
      null,
      null,
      "new-note",
    );
    expect(data.noteLibrary!.notes[0]).toMatchObject({
      createdAt: 1000,
      updatedAt: 1000,
      origins: [],
    });
    const directory = createSubjectDirectory(courses);
    const actions = [
      () => renameNote(data, "new-note", "改名", 1),
      () =>
        editNote(data, "new-note", { title: "改名", content: "修改正文" }, 2),
      () => saveNoteTags(data, directory, "new-note", [], ["复习"], 3),
      () =>
        moveNote(
          data,
          "new-note",
          { kind: "existing", notebookId: "notebook-c-language" },
          4,
        ),
      () => deleteNotebook(data, "notebook-c-language", false, 1),
    ];
    actions.forEach((action, index) => {
      vi.setSystemTime(2000 + index);
      data = action();
      expect(
        data.noteLibrary!.notes.find((note) => note.id === "new-note"),
      ).toMatchObject({
        createdAt: 1000,
        updatedAt: 2000 + index,
        revision: index + 2,
      });
    });
    vi.setSystemTime(3000);
    data = mergeNotes(
      data,
      unclassifiedNotebookId,
      data
        .noteLibrary!.notes.filter(
          (note) => note.notebookId === unclassifiedNotebookId,
        )
        .map(({ id, revision }) => ({ id, revision })),
    );
    expect(data.noteLibrary!.notes[0]).toMatchObject({
      createdAt: 1000,
      updatedAt: 3000,
    });
  });
  it("opens conversation sources by message ids without copying their contents", () => {
    const data = createInitialData();
    const conversation = data.conversations[0];
    const origin = {
      kind: "conversation" as const,
      conversationId: conversation.id,
      messageIds: [conversation.messages[0].id] as [string, ...string[]],
    };
    conversation.title = "新对话名";
    const describe = () =>
      new LearningRelations(
        data,
        courses,
        [],
        new OfficialLibrary(makeSnapshot(), data),
      ).describeOrigin(origin);
    expect(describe()).toMatchObject({
      label: "新对话名",
      available: true,
      message: {
        conversationId: conversation.id,
        messageIds: origin.messageIds,
      },
    });
    expect(describe()).not.toHaveProperty("reference");
    expect(describe().message).not.toHaveProperty("content");
    conversation.messages = [];
    expect(describe().available).toBe(false);
    data.conversations = [];
    expect(describe()).toMatchObject({
      label: "原对话不可用",
      available: false,
      message: {
        conversationId: conversation.id,
        messageIds: origin.messageIds,
      },
    });
  });
});
