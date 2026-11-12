import { describe, expect, it } from "vitest";
import { courses } from "../data/catalog";
import { contentEntries } from "./entries";
import { packageFixture } from "./fixtures.test-support";
import { readPackage } from "./package";

const info = {
  id: "calculus",
  title: "高等数学",
  description: "课程介绍",
  release: "test-release",
};

describe("readable entries in official course packages", () => {
  it("lists textbooks and question collections separately with distinct targets", () => {
    const entries = courses.flatMap((course) =>
      contentEntries({ ...info, id: course.id, title: course.title }, course),
    );
    expect(entries.map((entry) => entry.title)).toEqual([
      "高等数学示例教材",
      "高等数学题目",
      "C 语言示例教材",
      "C 语言题目",
    ]);
    expect(new Set(entries.map((entry) => entry.id)).size).toBe(4);
    expect(entries[1].selection).toMatchObject({
      courseId: "calculus",
      kind: "questions",
      itemId: "M001",
    });
    expect(entries[3].selection).toMatchObject({
      courseId: "c-language",
      kind: "questions",
      itemId: "C001",
    });
  });
  it("uses the saved version for reading while a different release is available", async () => {
    const old = await packageFixture("old");
    const latest = await packageFixture("latest");
    const course = await readPackage(old.manifest, old.archive);
    const entries = contentEntries(info, course, latest.manifest.files);
    expect(entries).toHaveLength(2);
    expect(
      entries.every(
        (entry) => entry.selection?.version === old.manifest.version,
      ),
    ).toBe(true);
    expect(entries[1].description).toContain("24 道题目");
  });
  it("lists remotely declared readable files without inventing a reading target", async () => {
    const { manifest } = await packageFixture();
    const entries = contentEntries(info, undefined, manifest.files);
    expect(entries.map((entry) => entry.kind)).toEqual([
      "textbooks",
      "questions",
    ]);
    expect(entries.every((entry) => entry.selection === undefined)).toBe(true);
    expect(entries[1].description).not.toMatch(/\d/);
  });
});
