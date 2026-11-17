import { describe, expect, it } from "vitest";
import {
  addPageRange,
  pageRanges,
  pageSelectionLabel,
  parsePageList,
  removePageRange,
} from "./page-selection";

describe("PDF reference page selection", () => {
  it("merges overlapping pages into ordered display ranges", () => {
    const pages = addPageRange([12, 20], 13, 15, 30);
    expect(addPageRange(pages, 15, 18, 30)).toEqual([
      12, 13, 14, 15, 16, 17, 18, 20,
    ]);
    expect(pageRanges([20, 12, 13, 14, 15])).toEqual([
      { start: 12, end: 15 },
      { start: 20, end: 20 },
    ]);
    expect(pageSelectionLabel([20, 12, 13, 14, 15])).toBe("第 12–15、20 页");
  });

  it("removes one displayed range and rejects invalid ranges", () => {
    expect(removePageRange([12, 13, 14, 20], { start: 12, end: 14 })).toEqual([
      20,
    ]);
    expect(() => addPageRange([], 0, 2, 20)).toThrow("1 到 20");
    expect(() => addPageRange([], 5, 4, 20)).toThrow("结束页");
    expect(() => addPageRange([], 19, 21, 20)).toThrow("1 到 20");
    expect(() => addPageRange([], 1, 201, 300)).toThrow("最多选择 200 页");
  });

  it("parses comma-separated page numbers without guessing other formats", () => {
    expect(parsePageList("17, 12,15,12", 20)).toEqual([12, 15, 17]);
    expect(() => parsePageList("12，15", 20)).toThrow("英文逗号");
    expect(() => parsePageList("12-15", 20)).toThrow("英文逗号");
    expect(() => parsePageList("12,21", 20)).toThrow("1 到 20");
  });
});
