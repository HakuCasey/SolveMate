import { describe, expect, it } from "vitest";
import { createInitialData } from "../data/catalog";
import { locationKey } from "../materials/api";
import { readingKey } from "./reference";
import {
  emptyReadingPosition,
  readingDocumentKey,
  readingLocationForConversation,
  rememberReadingLocation,
  restoreReadingLocation,
  readingScrollFromElement,
  readingScrollToElement,
  updateReadingDocument,
  updateReadingReferences,
  updateReadingPosition,
  type ReadingState,
} from "./state";

const empty = (): ReadingState => ({
  positions: {},
  documents: {},
  references: {},
});

describe("reading state", () => {
  it("keeps answer visibility and scroll across reading positions", () => {
    const selected = createInitialData().selection;
    const first = readingKey(selected);
    const second = readingKey({ ...selected, itemId: "M002" });
    const before = empty();
    let state = updateReadingPosition(before, first, (position) => ({
      ...position,
      answerVisible: true,
      scroll: { top: 321, left: 15 },
    }));
    const saved = state.positions[first];
    state = updateReadingPosition(state, second, (position) => ({
      ...position,
      scroll: { top: 87, left: 0 },
    }));
    expect(state.positions[first]).toBe(saved);
    expect(saved.answerVisible).toBe(true);
    expect(saved.scroll).toEqual({ top: 321, left: 15 });
    expect(state.positions[second].answerVisible).toBe(false);
    expect(before.positions).toEqual({});
    expect(emptyReadingPosition().scroll.top).toBe(0);
  });

  it("shares PDF zoom across its pages while isolating page scroll and other versions", () => {
    const page = { materialId: "book", contentVersion: "v1", pageNumber: 14 };
    const next = { ...page, pageNumber: 15 };
    const document = readingDocumentKey(page);
    expect(readingDocumentKey(next)).toBe(document);
    expect(readingDocumentKey({ ...page, contentVersion: "v2" })).not.toBe(
      document,
    );
    let state = updateReadingDocument(empty(), document, { zoom: 1.5 });
    state = updateReadingPosition(state, locationKey(page), (position) => ({
      ...position,
      scroll: { top: 600, left: 40 },
    }));
    state = updateReadingPosition(state, locationKey(next), (position) => ({
      ...position,
      scroll: { top: 200, left: 0 },
    }));
    expect(state.documents[readingDocumentKey(next)].zoom).toBe(1.5);
    expect(state.positions[locationKey(page)].scroll).toEqual({
      top: 600,
      left: 40,
    });
    expect(state.positions[locationKey(next)].scroll.top).toBe(200);
    expect(
      state.documents[readingDocumentKey({ ...page, materialId: "another" })],
    ).toBeUndefined();
    for (const zoom of [0, NaN, Infinity, 3.25])
      expect(() => updateReadingDocument(state, document, { zoom })).toThrow(
        "缩放",
      );
    expect(state.documents[document].zoom).toBe(1.5);
  });

  it("restores each document's last location without mixing versions or changing original references", () => {
    const page = { materialId: "book", contentVersion: "v1", pageNumber: 14 };
    const requested = { ...page, pageNumber: 1 };
    let state = rememberReadingLocation(empty(), page);
    const selection = {
      ...createInitialData().selection,
      kind: "textbooks" as const,
      itemId: "textbook",
      chapterIndex: 3,
    };
    state = rememberReadingLocation(state, selection);
    expect(restoreReadingLocation(state, requested).pageNumber).toBe(14);
    expect(
      restoreReadingLocation(state, { ...selection, chapterIndex: 0 })
        .chapterIndex,
    ).toBe(3);
    expect(
      restoreReadingLocation(state, {
        ...page,
        contentVersion: "v2",
        pageNumber: 1,
      }).pageNumber,
    ).toBe(1);
    expect(rememberReadingLocation(state, { ...page })).toBe(state);
    state = updateReadingDocument(
      state,
      readingDocumentKey(page),
      (previous) => ({ ...previous, zoom: 2 }),
    );
    expect(restoreReadingLocation(state, requested).pageNumber).toBe(14);
    state = rememberReadingLocation(state, { ...page, pageNumber: 15 });
    expect(restoreReadingLocation(state, requested).pageNumber).toBe(15);
    expect(state.documents[readingDocumentKey(page)].zoom).toBe(2);
    expect(page.pageNumber).toBe(14);
  });

  it("keeps a conversation's exact builtin chapter while resuming the last PDF page", () => {
    const chapter = {
      ...createInitialData().selection,
      kind: "textbooks" as const,
      itemId: "book",
      chapterIndex: 0,
    };
    const page = { materialId: "pdf", contentVersion: "v1", pageNumber: 14 };
    let state = rememberReadingLocation(empty(), {
      ...chapter,
      chapterIndex: 3,
    });
    state = rememberReadingLocation(state, { ...page, pageNumber: 15 });
    const chapterConversation = { selection: chapter };
    const restoredChapter = readingLocationForConversation(
      state,
      chapterConversation,
    );
    expect(restoredChapter.selection).toBe(chapter);
    expect(restoredChapter.selection?.chapterIndex).toBe(0);
    const pdfConversation = { selection: null, material: page };
    expect(
      readingLocationForConversation(state, pdfConversation).material
        ?.pageNumber,
    ).toBe(15);
    expect(pdfConversation.material.pageNumber).toBe(14);
  });

  it("keeps added fragments across PDF pages without resetting zoom or scroll", () => {
    const page = { materialId: "book", contentVersion: "v1", pageNumber: 1 };
    const key = readingDocumentKey(page);
    const references = [
      {
        id: "quote",
        reference: {
          title: "page 1",
          content: "片段",
          selection: null,
          material: page,
        },
      },
    ];
    let state = updateReadingDocument(empty(), key, { zoom: 1.5 });
    state = updateReadingReferences(state, key, references);
    state = rememberReadingLocation(state, { ...page, pageNumber: 2 });
    expect(state.references[key]).toBe(references);
    expect(state.documents[key].zoom).toBe(1.5);
    state = updateReadingReferences(state, key, []);
    expect(state.references[key]).toEqual([]);
    expect((state.documents[key].location as typeof page)?.pageNumber).toBe(2);
    expect(state.documents[key].zoom).toBe(1.5);
  });

  it("restores normalized PDF offsets after zoom and clamps to available space", () => {
    const scroll = readingScrollFromElement(
      { scrollTop: 900, scrollLeft: 120 },
      1.5,
    );
    expect(scroll).toEqual({ top: 600, left: 80 });
    const size = {
      scrollHeight: 2400,
      clientHeight: 500,
      scrollWidth: 1000,
      clientWidth: 500,
    };
    expect(readingScrollToElement(scroll, 2, size)).toEqual({
      top: 1200,
      left: 160,
    });
    expect(
      readingScrollToElement({ top: 99999, left: 99999 }, 1, size),
    ).toEqual({ top: 1900, left: 500 });
    expect(readingScrollToElement({ top: -10, left: -5 }, 1, size)).toEqual({
      top: 0,
      left: 0,
    });
    expect(
      readingScrollToElement(scroll, 1, {
        scrollHeight: 10,
        clientHeight: 20,
        scrollWidth: 10,
        clientWidth: 20,
      }),
    ).toEqual({ top: 0, left: 0 });
  });
});
