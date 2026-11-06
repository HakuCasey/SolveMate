import { describe, expect, it } from "vitest";
import { packageFixture } from "./fixtures.test-support";
import { readPackage } from "./package";
import { parseCatalog, parseManifest, parseUpdate } from "./contracts";
import { createInitialData, getCurrentContent } from "../data/catalog";
import { sameContent } from "../state/conversations";
import { pinLegacyVersions, updatedSelection } from "./selection";

describe("official course package validation", () => {
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
  it("pins legacy history and keeps selection valid when a newer course changes IDs", async () => {
    const data = createInitialData();
    delete data.selection.version;
    data.conversations.forEach((session) => {
      if (session.selection) delete session.selection.version;
    });
    const pinned = pinLegacyVersions(data);
    expect(pinned.conversations[0].selection?.version).toBe("example-1");
    expect(data.conversations[0].selection?.version).toBeUndefined();
    expect(pinLegacyVersions(pinned)).toBe(pinned);
    const fixture = await packageFixture("新版内容");
    const course = await readPackage(fixture.manifest, fixture.archive);
    const next = updatedSelection(pinned.selection, course, [course]);
    expect(next.version).toBe(course.version);
    expect(sameContent(pinned.selection, next)).toBe(false);
    expect(getCurrentContent(next, [course]).content).toContain("新版内容");
    const removed = { ...course, questions: course.questions.slice(1) };
    expect(updatedSelection(pinned.selection, removed, [course]).itemId).toBe(
      "M002",
    );
  });
});
