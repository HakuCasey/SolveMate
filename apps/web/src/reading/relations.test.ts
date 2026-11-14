import { describe, expect, it } from "vitest";
import type { Material, ReadingSelection } from "@solvemate/contracts";
import { courses, createInitialData } from "../data/catalog";
import { OfficialLibrary } from "../content/library";
import { makeSnapshot } from "../content/storage";
import { createConversation } from "../state/conversations";
import { createNote, deleteNote, unclassifiedNotebookId } from "../state/notes";
import { removeSubject } from "../state/subjects";
import {
  LearningRelations,
  learningMaterialId,
  sourceForNote,
} from "./relations";

const page = {
  materialId: "11111111-1111-4111-8111-111111111111",
  contentVersion: "a".repeat(64),
  pageNumber: 3,
};
const book: ReadingSelection = {
  courseId: "calculus",
  version: "example-1",
  kind: "textbooks",
  itemId: "B001",
  pageNumber: 2,
};
const material = {
  id: page.materialId,
  title: "课堂课本",
  courseId: "c-language",
} as Material;
const values = {
  title: "理解指针",
  content: "指针保存对象的地址。",
  notebookId: unclassifiedNotebookId,
};
function relations(data = createInitialData(), materials: Material[] = []) {
  return new LearningRelations(
    data,
    courses,
    materials,
    new OfficialLibrary(makeSnapshot(), data),
  );
}

describe("learning material relations", () => {
  it("reads old note associations at their original version without modifying them", () => {
    const data = createInitialData(),
      before = structuredClone(data);
    const source = sourceForNote(data.noteLibrary!.notes[0])!;
    expect(source).toMatchObject({
      courseId: "calculus",
      itemId: "M001",
      version: "example-1",
    });
    expect(
      relations(data)
        .related(source)
        .notes.map((note) => note.id),
    ).toContain("N001");
    expect(relations(data).material(source).available).toBe(true);
    expect(data).toEqual(before);
    expect(
      sourceForNote({ ...data.noteLibrary!.notes[0], origins: [] }),
    ).toBeNull();
  });
  it("groups a book across chapters and versions but keeps each exact original location", () => {
    const data = createInitialData();
    const chapter2 = { ...book, chapterIndex: 1, version: "b".repeat(64) };
    const first = createConversation(data, book),
      second = createConversation(data, chapter2);
    data.conversations = [first, second];
    expect(learningMaterialId(book)).toBe(learningMaterialId(chapter2));
    expect(relations(data).related(book).conversations).toHaveLength(2);
    expect(second.selection).toEqual(chapter2);
    expect(
      relations(data).related({ ...book, itemId: "other-book" }).conversations,
    ).toEqual([]);
    expect(
      relations(data).related({ ...book, kind: "questions", itemId: "M001" })
        .conversations,
    ).toEqual([]);
  });
  it("indexes actual message citations, deduplicates a conversation and excludes deleted records", () => {
    const data = createInitialData();
    const conversation = createConversation(data, book);
    const quoted = {
      title: "课堂课本",
      content: "指针",
      material: page,
      selection: null,
    };
    conversation.messages = [
      { id: "u1", role: "user", content: "解释", references: [quoted, quoted] },
      { id: "u2", role: "user", content: "追问", reference: quoted },
    ];
    const archived = {
      ...conversation,
      id: "archived",
      status: "archived" as const,
      lastActivityAt: 100,
    };
    conversation.lastActivityAt = 200;
    data.conversations = [
      archived,
      conversation,
      { ...conversation, id: "deleted", status: "deleted" },
    ];
    expect(
      relations(data, [material])
        .related(page)
        .conversations.map((item) => item.id),
    ).toEqual([conversation.id, "archived"]);
    expect(relations(data).related(book).conversations).toHaveLength(2);
  });
  it("preserves source and relations after upload rename, move and deletion", () => {
    let data = createInitialData();
    data.conversations = [
      createConversation(
        data,
        null,
        data.defaultRobotId,
        null,
        "new",
        null,
        page,
      ),
    ];
    data = createNote(data, values, page, "c-language", "note-upload");
    const source = structuredClone(page);
    const moved = { ...material, title: "指针讲义", courseId: "calculus" };
    let index = relations(data, [moved]);
    expect(index.material(page)).toMatchObject({
      title: "指针讲义",
      subjectId: "calculus",
      position: "第 3 页",
    });
    expect(index.related({ ...page, pageNumber: 9 })).toMatchObject({
      conversations: [data.conversations[0]],
      notes: [data.noteLibrary!.notes[0]],
    });
    index = relations(data, [{ ...moved, deletedAt: 100 }]);
    expect(index.material(page)).toMatchObject({
      removed: true,
      available: true,
    });
    expect(index.related(page).notes).toHaveLength(1);
    expect(sourceForNote(data.noteLibrary!.notes[0])).toEqual(source);
  });
  it("keeps historical note sources after subject deletion, and does not associate a same-named upload", () => {
    let data = createNote(
      createInitialData(),
      values,
      book,
      "calculus",
      "note-book",
    );
    data = removeSubject(data, courses, "calculus");
    const index = relations(data, [{ ...material, title: "高等数学示例教材" }]);
    expect(index.material(book)).toMatchObject({
      removed: true,
      available: true,
    });
    expect(index.related(book).notes.map((item) => item.id)).toEqual([
      "note-book",
    ]);
    expect(index.related(page).notes).toEqual([]);
  });
  it("retains a missing source visibly and removes relations when their note is deleted", () => {
    const data = createNote(
      createInitialData(),
      values,
      page,
      null,
      "note-missing",
    );
    expect(relations(data).material(page)).toMatchObject({
      available: false,
      title: "原资料不可用",
    });
    expect(relations(data).related(page).notes).toHaveLength(1);
    expect(
      relations(deleteNote(data, "note-missing", 1)).related(page).notes,
    ).toEqual([]);
    expect(
      relations(data).related({
        ...page,
        materialId: "22222222-2222-4222-8222-222222222222",
      }).notes,
    ).toEqual([]);
  });
  it("does not assign unrelated ordinary conversations or independent notes to a material", () => {
    const data = createNote(
      createInitialData(),
      values,
      null,
      null,
      "note-independent",
    );
    data.conversations = [createConversation(data)];
    expect(relations(data).related(book)).toEqual({
      notes: [],
      conversations: [],
    });
    expect(sourceForNote(data.noteLibrary!.notes[0])).toBeNull();
  });
});

describe("linked reading context", () => {
  it("requires an explicit PDF page and does not infer a chapter's first page", async () => {
    const data = createInitialData();
    const library = new OfficialLibrary(makeSnapshot([], []), data);
    const index = new LearningRelations(data, courses, [], library);
    const legacySource = { ...book };
    delete legacySource.pageNumber;
    const legacy = index.material(legacySource);
    expect(legacy.readingLabel).toBe("当前版本已不支持该引用方式");
    await expect(legacy.readContext(async () => "Unexpected")).rejects.toThrow(
      "当前版本已不支持该引用方式",
    );
    expect(legacySource.pageNumber).toBeUndefined();
    const material = index.material({ ...book, pageNumber: 2 });
    const reference = await material.readContext(async () => {
      throw new Error("Unexpected upload request");
    });
    expect(reference.title).toBe(material.readingLabel);
    expect(reference.selection?.pageNumber).toBe(2);
    expect(reference.content).toBe(courses[0].textbooks[0].pdf!.pages[1]);
  });
  it("reads an upload by fixed identity, version and page, and refuses empty text", async () => {
    const data = createInitialData();
    const upload = {
      id: page.materialId,
      title: "C 语言课本",
      currentVersion: page.contentVersion,
      courseId: "c-language",
    } as Material;
    const material = new LearningRelations(
      data,
      courses,
      [upload],
      new OfficialLibrary(makeSnapshot([], []), data),
    ).material(page);
    const calls: unknown[] = [];
    const reference = await material.readContext(async (location) => {
      calls.push(location);
      return "int *p = &a;";
    });
    expect(calls).toEqual([page]);
    expect(reference).toMatchObject({
      title: "C 语言课本 · 第 3 页",
      material: page,
      quoteKind: "page",
      content: "int *p = &a;",
    });
    await expect(material.readContext(async () => "  ")).rejects.toThrow(
      "没有可读取的文字",
    );
    await expect(
      material.readContext(async () => {
        throw new Error("文件已删除");
      }),
    ).rejects.toThrow("文件已删除");
  });
});
