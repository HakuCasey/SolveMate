import { describe, expect, it } from "vitest";
import { assertMetadata, assertUserData } from "@solvemate/contracts";
import { createInitialData, getCurrentContent } from "../data/catalog";
import {
  appendReference,
  REFERENCE_LIMIT_MESSAGE,
  validateReferenceCount,
  messageReferences,
  referencePreview,
  makeReadingReference,
  readingKey,
} from "./reference";

describe("reading quotes", () => {
  it("pins selected content and its official version without including an unselected answer", () => {
    const selection = createInitialData().selection,
      content = getCurrentContent(selection);
    const quote = makeReadingReference(
      selection,
      content,
      "这里只讨论约分",
      true,
    );
    assertMetadata("ReadingReference", quote);
    expect(quote.content).toBe("这里只讨论约分");
    expect(quote.quoteKind).toBe("selection");
    selection.itemId = "M002";
    expect(quote.selection?.itemId).toBe("M001");
    expect(makeReadingReference(quote.selection!, content).content).toBe(
      content.content,
    );
    expect(() => makeReadingReference(selection, content, " ", true)).toThrow(
      "没有可引用",
    );
    expect(() =>
      makeReadingReference(selection, content, "a".repeat(100001), true),
    ).toThrow("过长");
  });
  it("adds independent fragments, deduplicates exact references and enforces request limits", () => {
    const selection = createInitialData().selection;
    const first = makeReadingReference(
      selection,
      getCurrentContent(selection),
      "第一个片段",
      true,
    );
    const second = { ...first, content: "第二个片段" };
    const one = appendReference([], first, "a");
    const two = appendReference(one, second, "b");
    expect(two.map((item) => item.reference.content)).toEqual([
      "第一个片段",
      "第二个片段",
    ]);
    expect(appendReference(two, { ...first }, "c")).toBe(two);
    expect(two.filter((item) => item.id !== "a")[0].reference).toBe(second);
    expect(one).toHaveLength(1);
    expect(() =>
      appendReference(one, { ...first, content: "x".repeat(100000) }, "c"),
    ).toThrow("总长度");
    const four = Array.from({ length: 4 }, (_, index) => ({
      id: String(index),
      reference: { ...first, content: String(index) },
    }));
    expect(() => appendReference(four, first, "next")).toThrow(
      REFERENCE_LIMIT_MESSAGE,
    );
    expect(four).toHaveLength(4);
    expect(appendReference(four, four[0].reference, "duplicate")).toBe(four);
    const removed = four.filter((item) => item.id !== "0");
    expect(appendReference(removed, first, "replacement")).toHaveLength(4);
    expect(() => validateReferenceCount(four)).not.toThrow();
    expect(() => validateReferenceCount([...four, four[0]])).toThrow(
      REFERENCE_LIMIT_MESSAGE,
    );
  });
  it("previews 15 characters without splitting emoji and reads old single-reference messages", () => {
    expect(referencePreview("一二三四五六七八九十一二三四五六")).toBe(
      "一二三四五六七八九十一二三四五…",
    );
    expect(referencePreview("🐱".repeat(16))).toBe("🐱".repeat(15) + "…");
    expect(referencePreview("  a\nb  ")).toBe("a b");
    const reference = makeReadingReference(createInitialData().selection, {
      title: "题目",
      topic: "课程",
      content: "正文",
    });
    expect(messageReferences({ reference })).toEqual([reference]);
    expect(messageReferences({ reference, references: [] })).toEqual([
      reference,
    ]);
    expect(messageReferences({ references: [] })).toEqual([]);
    expect(messageReferences({ references: [reference] })).toEqual([reference]);
    expect(readingKey({ ...reference.selection!, version: "v2" })).not.toBe(
      readingKey(reference.selection!),
    );
  });
});

it("keeps historical messages with more than four references readable", () => {
  const data = createInitialData();
  const references = Array.from({ length: 5 }, (_, index) => ({
    title: "历史引用",
    content: String(index),
    selection: { ...data.selection },
  }));
  data.conversations[0].messages[0].references = references;
  expect(messageReferences(data.conversations[0].messages[0])).toEqual(
    references,
  );
  assertUserData(data);
});
