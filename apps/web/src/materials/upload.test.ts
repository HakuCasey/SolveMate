import { describe, expect, it } from "vitest";
import { uploadFileError } from "./upload";

describe("upload file selection", () => {
  it("accepts the supported extensions and size boundary", () => {
    expect(uploadFileError({ name: "教材.PDF", size: 100 * 1024 * 1024 })).toBe(
      "",
    );
    expect(uploadFileError({ name: "Lecture.pptx", size: 1234 })).toBe("");
  });
  it("reports unsupported, empty and oversized files before upload", () => {
    expect(uploadFileError({ name: "课件.ppt", size: 1234 })).toContain(
      "PDF 和 PPTX",
    );
    expect(uploadFileError({ name: "empty.pdf", size: 0 })).toContain("为空");
    expect(
      uploadFileError({ name: "large.pdf", size: 100 * 1024 * 1024 + 1 }),
    ).toContain("100 MiB");
  });
});
