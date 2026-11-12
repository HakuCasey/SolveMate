import { createSubjectDirectory } from "../state/subjects";
import { describe, expect, it } from "vitest";
import type { Material } from "@solvemate/contracts";
import { courses, createInitialData } from "../data/catalog";
import { materialCourse, materialsInCourse, scopeForMaterial } from "./library";
import {
  conversationForMaterial,
  createConversation,
} from "../state/conversations";
const directory = createSubjectDirectory(courses);
const file = (id: string, courseId: string | null) =>
  ({ id, courseId, currentVersion: "a".repeat(64) }) as Material;
describe("subject libraries", () => {
  it("hides deleted entries in every subject while retaining their history metadata", () => {
    const removed = {
      ...file("removed", "c-language"),
      title: "课堂讲义",
      deletedAt: 1,
    };
    const original = structuredClone(removed);
    const items = [file("active", "c-language"), removed];
    expect(
      materialsInCourse(items, "c-language", directory).map((item) => item.id),
    ).toEqual(["active"]);
    expect(materialsInCourse(items, null, directory)).toEqual([]);
    expect(items.find((item) => item.id === "removed")).toEqual(original);
    expect(
      scopeForMaterial(
        {
          materialId: removed.id,
          contentVersion: removed.currentVersion,
          pageNumber: 3,
        },
        items,
        directory,
      ).courseId,
    ).toBeNull();
  });
  it("shows only the selected course and preserves unclassified or missing courses", () => {
    const files = [
      file("math", "calculus"),
      file("c", "c-language"),
      file("old", null),
      file("missing", "old-course"),
    ];
    expect(
      materialsInCourse(files, "c-language", directory).map((item) => item.id),
    ).toEqual(["c"]);
    expect(
      materialsInCourse(files, null, directory).map((item) => item.id),
    ).toEqual(["old", "missing"]);
    expect(materialCourse(files[0], directory)).toBe("calculus");
  });
  it("resolves the return list from current material metadata without rewriting a reference", () => {
    const item = file("a", "c-language"),
      location = {
        materialId: "a",
        contentVersion: item.currentVersion,
        pageNumber: 14,
      };
    const before = structuredClone(location);
    expect(scopeForMaterial(location, [item], directory)).toEqual({
      courseId: "c-language",
      kind: "textbooks",
    });
    item.courseId = "calculus";
    expect(scopeForMaterial(location, [item], directory).courseId).toBe(
      "calculus",
    );
    expect(location).toEqual(before);
  });
  it("keeps the conversation association after changing a material's course", () => {
    const data = createInitialData(),
      item = file("a", null);
    const location = {
      materialId: item.id,
      contentVersion: item.currentVersion,
      pageNumber: 14,
    };
    const conversation = createConversation(
      data,
      null,
      data.defaultRobotId,
      null,
      "new",
      null,
      location,
    );
    item.courseId = "c-language";
    expect(conversationForMaterial([conversation], location)?.id).toBe(
      conversation.id,
    );
    expect(scopeForMaterial(location, [item], directory).courseId).toBe(
      "c-language",
    );
  });
});
