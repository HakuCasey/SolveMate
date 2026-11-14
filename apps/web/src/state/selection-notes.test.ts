import { describe, expect, it, vi, afterEach } from "vitest";
import { assertMetadata } from "@solvemate/contracts";
import { createInitialData } from "../data/catalog";
import { assertAppData } from "../data/validation";
import { makeMessageReference, appendReference } from "../reading/reference";
import { createNote, editNote, unclassifiedNotebookId } from "./notes";

afterEach(() => vi.restoreAllMocks());

function fixture() {
  const data = createInitialData();
  const conversation = data.conversations.find((item) => item.messages.length)!;
  const message = conversation.messages[0];
  const reference = makeMessageReference(
    conversation,
    [message.id],
    "保存这段讨论。",
  );
  return { data, reference };
}
describe("selection notes and destinations", () => {
  it("creates the notebook and note atomically with stable ids and the original message", () => {
    vi.spyOn(Date, "now").mockReturnValue(1794600000000);
    const { data, reference } = fixture();
    const value = {
      title: "讨论摘录",
      content: reference.content,
      notebookId: unclassifiedNotebookId,
      destination: { kind: "new" as const, title: "课堂讨论" },
    };
    const first = createNote(
      data,
      value,
      null,
      null,
      "note-excerpt",
      reference,
    );
    const retry = createNote(
      data,
      value,
      null,
      null,
      "note-excerpt",
      reference,
    );
    expect(first).toEqual(retry);
    expect(
      data.noteLibrary!.notes.some((item) => item.id === "note-excerpt"),
    ).toBe(false);
    const note = first.noteLibrary!.notes[0];
    expect(note.content).toBe(reference.content);
    expect(note.origins).toEqual([
      { kind: "conversation", ...reference.message },
    ]);
    expect(
      first.noteLibrary!.notebooks.find((book) => book.id === note.notebookId)
        ?.title,
    ).toBe("课堂讨论");
    const changed = editNote(
      first,
      note.id,
      { title: "自己的理解", content: "补充正文。" },
      note.revision,
    );
    expect(changed.noteLibrary!.notes[0].origins).toEqual(note.origins);
    assertAppData(changed);
  });
  it("refuses invalid content, duplicate names and stale destinations without changing the original library", () => {
    const { data, reference } = fixture();
    const original = structuredClone(data);
    expect(() =>
      createNote(
        data,
        {
          title: "摘录",
          content: " ",
          notebookId: unclassifiedNotebookId,
          destination: { kind: "new", title: "新本" },
        },
        null,
        null,
        "bad",
        reference,
      ),
    ).toThrow();
    expect(data).toEqual(original);
    expect(() =>
      createNote(
        data,
        { title: "摘录", content: "正文", notebookId: "deleted" },
        null,
        null,
      ),
    ).toThrow("已删除");
    expect(() =>
      createNote(
        data,
        {
          title: "摘录",
          content: "正文",
          notebookId: unclassifiedNotebookId,
          destination: { kind: "new", title: "未分类" },
        },
        null,
        null,
      ),
    ).toThrow("同名");
  });
  it("shares the reference limit and rejects ambiguous or missing message origins", () => {
    const { data, reference } = fixture();
    assertMetadata("ReadingReference", reference);
    const conversation = data.conversations.find(
      (item) => item.messages.length,
    )!;
    expect(() =>
      makeMessageReference(conversation, ["missing"], "正文"),
    ).toThrow("原消息");
    expect(() =>
      assertMetadata("ReadingReference", {
        ...reference,
        material: {
          materialId: "11111111-1111-4111-8111-111111111111",
          contentVersion: "a".repeat(64),
          pageNumber: 1,
        },
      }),
    ).toThrow();
    let items: Parameters<typeof appendReference>[0] = [];
    for (let i = 0; i < 4; i++)
      items = appendReference(
        items,
        { ...reference, content: `选段 ${i}` },
        String(i),
      );
    expect(() =>
      appendReference(items, { ...reference, content: "第五条" }, "fifth"),
    ).toThrow("最多支持 4 条");
  });
});
