import { describe, expect, it } from "vitest";
import type { Material } from "@solvemate/contracts";
import { courses, getCurrentContent } from "../data/catalog";
import { assertAppData } from "../data/validation";
import { removeSubject, renameSubject } from "../state/subjects";
import { materialMembership, materialsInCourse } from "../reading/library";
import { libraryFixture } from "./library.test-support";
import { OfficialLibrary } from "./library";

const bookId = "calculus:textbooks:B001";

describe("official material metadata", () => {
  it("reads legacy records without rewriting their implicit entries", async () => {
    const { data, snapshot } = await libraryFixture();
    const before = structuredClone(data);
    const library = new OfficialLibrary(snapshot, data);
    expect(library.entries).toHaveLength(4);
    expect(library.forSubject("calculus", "textbooks")).toHaveLength(1);
    expect(library.get(bookId).downloaded).toBe(true);
    expect(library.get("c-language:questions").listed).toBe(true);
    expect(data).toEqual(before);
    expect(data.officialMaterials).toBeUndefined();
  });
  it("removes one entry across both lists while retaining its history and package", async () => {
    const { data, snapshot, saved } = await libraryFixture();
    const removed = new OfficialLibrary(snapshot, data).remove(
      data,
      bookId,
      200,
    );
    assertAppData(removed);
    const library = new OfficialLibrary(snapshot, removed);
    expect(library.get(bookId).downloaded).toBe(false);
    expect(library.get(bookId).canAcquire).toBe(true);
    expect(library.forSubject("calculus", "textbooks")).toEqual([]);
    expect(library.get("calculus:questions").downloaded).toBe(true);
    expect(() => library.get(bookId).selection()).toThrow("已从资料库删除");
    expect(
      library.scopeForSelection({
        courseId: "calculus",
        kind: "textbooks",
        itemId: "B001",
        chapterIndex: 0,
      }),
    ).toBeNull();
    expect(removed.conversations).toBe(data.conversations);
    expect(snapshot.installed[0]).toBe(saved);
    expect(
      getCurrentContent(
        {
          courseId: "calculus",
          version: saved.version,
          kind: "textbooks",
          itemId: "B001",
          chapterIndex: 0,
        },
        snapshot.allCourses,
      ).content,
    ).toBeTruthy();
  });
  it("restores only the requested entry after subject deletion, without restoring uploads or sibling entries", async () => {
    const fixture = await libraryFixture();
    const data = removeSubject(fixture.data, courses, "calculus");
    let library = new OfficialLibrary(fixture.snapshot, data);
    expect(library.get(bookId).removed).toBe(true);
    expect(library.get("calculus:questions").downloaded).toBe(false);
    const restored = library.restore(data, bookId);
    assertAppData(restored);
    library = new OfficialLibrary(fixture.snapshot, restored);
    const item = library.get(bookId);
    expect(item.downloaded).toBe(true);
    expect(item.id).toBe(bookId);
    expect(item.subjectId).not.toBe("calculus");
    expect(library.forSubject(item.subjectId, "textbooks")).toHaveLength(1);
    expect(library.forSubject(item.subjectId, "questions")).toHaveLength(0);
    expect(library.get("calculus:questions").removed).toBe(true);
    expect(
      restored.subjects?.find((subject) => subject.id === "calculus")?.deleted,
    ).toBe(true);
    const upload = { id: "old-upload", courseId: "calculus" } as Material;
    expect(materialMembership(upload, library.directory).state).toBe("removed");
    expect(
      materialsInCourse([upload], item.subjectId, library.directory),
    ).toEqual([]);
    const renamed = renameSubject(restored, courses, item.subjectId!, "微积分");
    expect(
      new OfficialLibrary(fixture.snapshot, renamed).get(bookId).subjectTitle,
    ).toBe("微积分");
    expect(item.selection().courseId).toBe("calculus");
    expect(restored.conversations).toBe(fixture.data.conversations);
  });
  it("reuses an active same-named subject rather than reviving a removed subject", async () => {
    const { snapshot, data: initial } = await libraryFixture();
    const data = removeSubject(initial, courses, "calculus");
    data.subjects!.push({
      id: "my-calculus",
      title: "高等数学",
      deleted: false,
    });
    const next = new OfficialLibrary(snapshot, data).restore(data, bookId);
    const model = new OfficialLibrary(snapshot, next);
    expect(model.get(bookId).subjectId).toBe("my-calculus");
    expect(
      model.directory.active.filter((subject) => subject.title === "高等数学"),
    ).toHaveLength(1);
  });
  it("rejects duplicate metadata IDs while preserving valid deleted associations", async () => {
    const { snapshot, data } = await libraryFixture();
    const next = new OfficialLibrary(snapshot, data).remove(data, bookId, 200);
    next.officialMaterials!.push({ ...next.officialMaterials![0] });
    expect(() => assertAppData(next)).toThrow("duplicate IDs");
  });
});
