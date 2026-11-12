import { describe, expect, it } from "vitest";
import type { Material } from "@solvemate/contracts";
import { courses, createInitialData } from "../data/catalog";
import { assertAppData } from "../data/validation";
import {
  materialCourse,
  materialsInCourse,
  scopeForMaterial,
} from "../reading/library";
import {
  addSubject,
  renameSubject,
  removeSubject,
  subjectCatalog,
  createSubjectDirectory,
} from "./subjects";

describe("subject metadata", () => {
  it("opens older data and adds newly downloaded official subjects without resurrecting deleted ones", () => {
    const data = createInitialData();
    expect(data.subjects).toBeUndefined();
    expect(
      subjectCatalog(courses, data.subjects).filter((item) => !item.deleted),
    ).toHaveLength(2);
    const saved = removeSubject(data, courses, "calculus");
    const next = subjectCatalog(
      [...courses, { id: "physics", title: "物理" }],
      saved.subjects,
    );
    expect(next.find((item) => item.id === "calculus")?.deleted).toBe(true);
    expect(next.find((item) => item.id === "physics")?.deleted).toBe(false);
    assertAppData(saved);
  });
  it("renames a subject without changing files, reading positions or conversation references", () => {
    const data = createInitialData();
    const snapshot = structuredClone(data);
    const added = addSubject(data, courses, "  大学  物理 ", "subject-test");
    const renamed = renameSubject(added, courses, "subject-test", "普通物理");
    expect(
      renamed.subjects?.find((item) => item.id === "subject-test")?.title,
    ).toBe("普通物理");
    expect(renamed.conversations).toBe(data.conversations);
    expect(renamed.selection).toBe(data.selection);
    expect(data).toEqual(snapshot);
    assertAppData(renamed);
  });
  it("removes deleted subject material entries while preserving files and history", () => {
    let data = addSubject(
      createInitialData(),
      courses,
      "物理",
      "subject-physics",
    );
    const file = {
      id: "file",
      courseId: "subject-physics",
      currentVersion: "a".repeat(64),
    } as Material;
    const location = {
      materialId: "file",
      contentVersion: file.currentVersion,
      pageNumber: 14,
    };
    const fileBefore = structuredClone(file),
      history = data.conversations;
    data = removeSubject(data, courses, "subject-physics");
    const catalog = createSubjectDirectory(courses, data.subjects);
    expect(materialCourse(file, catalog)).toBeNull();
    expect(materialsInCourse([file], null, catalog)).toEqual([]);
    expect(scopeForMaterial(location, [file], catalog).courseId).toBeNull();
    expect(file).toEqual(fileBefore);
    expect(data.conversations).toBe(history);
    expect(location.pageNumber).toBe(14);
    const moved = { ...file, id: "moved", courseId: "c-language" };
    const unclassified = { ...file, id: "unclassified", courseId: null };
    expect(
      materialsInCourse([file, moved, unclassified], "c-language", catalog),
    ).toEqual([moved]);
    expect(
      materialsInCourse([file, moved, unclassified], null, catalog),
    ).toEqual([unclassified]);
    expect(materialsInCourse([file], "subject-physics", catalog)).toEqual([]);
    const recreated = addSubject(data, courses, "物理", "subject-another");
    expect(
      recreated.subjects?.find((item) => item.id === "subject-another")
        ?.deleted,
    ).toBe(false);
    expect(
      materialCourse(file, createSubjectDirectory(courses, recreated.subjects)),
    ).toBeNull();
    expect(
      materialsInCourse(
        [file],
        null,
        createSubjectDirectory(courses, recreated.subjects),
      ),
    ).toEqual([]);
  });
  it("preserves the meaning of older classification-only deletions", () => {
    const catalog = [{ id: "old", title: "旧学科", deleted: true }];
    const file = { id: "old-file", courseId: "old" } as Material;
    expect(
      materialsInCourse([file], null, createSubjectDirectory([], catalog)),
    ).toEqual([file]);
    expect(
      materialsInCourse(
        [file],
        null,
        createSubjectDirectory([], [{ ...catalog[0], materialsDeleted: true }]),
      ),
    ).toEqual([]);
  });
  it("rejects empty, duplicate, reserved and long names, and changes to a deleted subject", () => {
    const data = createInitialData();
    for (const name of [" ", "C 语言", "未分类", "学".repeat(41)])
      expect(() => addSubject(data, courses, name, "subject-new")).toThrow();
    const added = addSubject(data, courses, "Physics", "subject-new");
    expect(() =>
      addSubject(added, courses, "physics", "subject-other"),
    ).toThrow("同名");
    expect(() => renameSubject(added, courses, "calculus", "Physics")).toThrow(
      "同名",
    );
    expect(
      renameSubject(added, courses, "subject-new", "Physics"),
    ).toBeTruthy();
    const deleted = removeSubject(added, courses, "subject-new");
    expect(() => renameSubject(deleted, courses, "subject-new", "X")).toThrow(
      "已删除",
    );
    expect(() => removeSubject(deleted, courses, "subject-new")).toThrow(
      "已删除",
    );
  });
  it("rejects invalid saved metadata without accepting duplicate IDs", () => {
    const data = addSubject(
      createInitialData(),
      courses,
      "物理",
      "subject-physics",
    );
    data.subjects!.push({ ...data.subjects![0] });
    expect(() => assertAppData(data)).toThrow("subject metadata");
    data.subjects = [{ id: "../physics", title: "物理", deleted: false }];
    expect(() => assertAppData(data)).toThrow("subject metadata");
  });
});
