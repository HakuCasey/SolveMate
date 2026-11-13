import { describe, expect, it } from "vitest";
import { packageFixture } from "./fixtures.test-support";
import { readPackage } from "./package";
import { parseCatalog, parseManifest, parseUpdate } from "./contracts";
import { createInitialData, getCurrentContent } from "../data/catalog";
import { sameContent } from "../state/conversations";
import { updatedSelection } from "./selection";

describe("official course package validation", () => {
  it("reads both release formats with the matching PDF and preserves the original version references", async () => {
    const old = await packageFixture();
    const next = await packageFixture("", { pdf: true });
    const legacy = await readPackage(old.manifest, old.archive);
    const course = await readPackage(next.manifest, next.archive);
    expect(course.version).not.toBe(legacy.version);
    expect(legacy.textbooks[0].pdf?.pages).toEqual(
      course.textbooks[0].pdf?.pages,
    );
    expect(course.textbooks[0].pdf?.pages.length).toBeGreaterThan(1);
    const previous = {
      courseId: legacy.id,
      version: legacy.version,
      kind: "textbooks" as const,
      itemId: "B001",
      pageNumber: 3,
    };
    const selection = updatedSelection(previous, course);
    expect(selection.pageNumber).toBe(1);
    expect(getCurrentContent(selection, [legacy, course]).title).toBe(
      `第 ${selection.pageNumber} 页`,
    );
    expect(previous.version).toBe(legacy.version);
    expect(getCurrentContent(previous, [legacy, course]).title).toBe("第 3 页");
  });
  it("rejects an invalid PDF page index or a missing index before replacing any content", async () => {
    const invalid = await packageFixture("", { badPdfIndex: true });
    await expect(
      readPackage(invalid.manifest, invalid.archive),
    ).rejects.toThrow("页码");
    const valid = await packageFixture("", { pdf: true });
    expect(() =>
      parseManifest({
        ...valid.manifest,
        files: valid.manifest.files.filter(
          (file) => file.kind !== "textbook-pages",
        ),
      }),
    ).toThrow();
  });

  it("reads the real textbook, questions and both memory files without losing formulas", async () => {
    const fixture = await packageFixture();
    const course = await readPackage(fixture.manifest, fixture.archive);
    expect(course.questions).toHaveLength(24);
    expect(course.textbooks[0].chapters).toHaveLength(6);
    expect(course.memory.learningPoints).toHaveLength(12);
    expect(course.memory.discussionPoints).toHaveLength(6);
    expect(course.questions[0].question).toContain("\\lim");
  });
  it("rejects inconsistent package size, checksum and per-file checksum", async () => {
    const fixture = await packageFixture();
    await expect(
      readPackage(
        { ...fixture.manifest, size_bytes: fixture.archive.length + 1 },
        fixture.archive,
      ),
    ).rejects.toThrow("校验失败");
    const files = fixture.manifest.files.map((file, index) =>
      index ? file : { ...file, sha256: "0".repeat(64) },
    );
    await expect(
      readPackage({ ...fixture.manifest, files }, fixture.archive),
    ).rejects.toThrow("校验失败");
  });
  it.each([
    { extraFile: true },
    { badReference: true },
    { invalidQuestions: true },
  ])(
    "rejects unlisted files, broken references or invalid JSON structures: %o",
    async (options) => {
      const fixture = await packageFixture("", options);
      await expect(
        readPackage(fixture.manifest, fixture.archive),
      ).rejects.toThrow();
    },
  );
  it("rejects unsafe paths and incompatible manifests before installation", async () => {
    const { manifest } = await packageFixture();
    expect(() => parseManifest({ ...manifest, schema_version: 2 })).toThrow();
    expect(() =>
      parseManifest({
        ...manifest,
        download_url: "https://elsewhere.example/package.zip",
      }),
    ).toThrow();
    expect(() =>
      parseManifest({
        ...manifest,
        files: manifest.files.map((file, index) =>
          index ? file : { ...file, path: "../private" },
        ),
      }),
    ).toThrow();
    expect(() =>
      parseManifest({ ...manifest, size_bytes: 20 * 1024 * 1024 }),
    ).toThrow();
  });
  it("validates catalog identities and refuses inconsistent update decisions", async () => {
    const { manifest } = await packageFixture();
    const remote = {
      ...manifest.course,
      latest_version: manifest.version,
      manifest_url: manifest.download_url.replace(/\/download$/, ""),
      download_url: manifest.download_url,
    };
    expect(parseCatalog({ schema_version: 1, courses: [remote] })).toHaveLength(
      1,
    );
    expect(() =>
      parseCatalog({ schema_version: 1, courses: [remote, remote] }),
    ).toThrow();
    const unknown = {
      course_id: "calculus",
      current_version: "other",
      status: "unknown_version",
      update_available: false,
      latest: manifest,
    };
    expect(parseUpdate(unknown, "calculus", "other").status).toBe(
      "unknown_version",
    );
    expect(() =>
      parseUpdate({ ...unknown, update_available: true }, "calculus", "other"),
    ).toThrow();
    expect(() =>
      parseUpdate(
        {
          ...unknown,
          current_version: manifest.version,
          status: "update_available",
          update_available: true,
        },
        "calculus",
        manifest.version,
      ),
    ).toThrow();
  });
  it("rejects unspecified versions and keeps explicit selections valid when a newer course changes IDs", async () => {
    const data = createInitialData();
    const previous = { ...data.selection };
    delete data.selection.version;
    expect(() => getCurrentContent(data.selection)).toThrow(
      "当前版本已不支持该引用方式",
    );
    expect(data.selection.version).toBeUndefined();
    const fixture = await packageFixture("新版内容");
    const course = await readPackage(fixture.manifest, fixture.archive);
    const next = updatedSelection(previous, course);
    expect(next.version).toBe(course.version);
    expect(sameContent(previous, next)).toBe(false);
    expect(getCurrentContent(next, [course]).content).toContain("新版内容");
    const removed = { ...course, questions: course.questions.slice(1) };
    expect(updatedSelection(previous, removed).itemId).toBe("M002");
  });
});
