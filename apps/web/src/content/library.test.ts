import { describe, expect, it } from "vitest";
import { libraryFixture } from "./library.test-support";
import { OfficialLibrary } from "./library";
const id = "calculus:textbooks:B001";
describe("community catalog uses the shared material metadata", () => {
  it("reads the saved title, subject and version without modifying records", async () => {
    const { data, snapshot } = await libraryFixture();
    const item = data.materials.find((item) => item.id === id)!;
    item.title = "我的课本";
    item.subjectId = "c-language";
    const before = structuredClone(data);
    const entry = new OfficialLibrary(snapshot, data).get(id);
    expect(entry.metadata).toBe(item);
    expect(entry.title).toBe("我的课本");
    expect(entry.subjectId).toBe("c-language");
    expect(entry.selection().version).toBe(item.currentVersion);
    expect(data).toEqual(before);
  });
  it("removing the material changes the catalog action without removing its package or sibling", async () => {
    const { data, snapshot } = await libraryFixture();
    data.materials.find((item) => item.id === id)!.deletedAt = 200;
    const library = new OfficialLibrary(snapshot, data);
    expect(library.get(id).listed).toBe(false);
    expect(library.get(id).downloaded).toBe(false);
    expect(library.get(id).canAcquire).toBe(true);
    expect(library.get("calculus:questions").listed).toBe(true);
    expect(() => library.get(id).selection()).toThrow("已从资料库删除");
    expect(snapshot.installed).toHaveLength(1);
  });
  it("uses saved IDs when subjects or titles change", async () => {
    const { data, snapshot } = await libraryFixture();
    data.materials.find((item) => item.id === id)!.subjectId = null;
    const library = new OfficialLibrary(snapshot, data);
    expect(
      library.forSubject(null, "textbooks").map((item) => item.id),
    ).toEqual([id]);
    expect(library.get(id).selection().courseId).toBe("calculus");
  });
  it("shows locally registered files as readable without requiring a download package", async () => {
    const { data, snapshot } = await libraryFixture();
    snapshot.installed = [];
    const item = data.materials.find((item) => item.id === id)!;
    item.availability = {
      originalAvailable: true,
      readerAvailable: true,
      error: null,
    };
    expect(new OfficialLibrary(snapshot, data).get(id).downloaded).toBe(true);
    item.availability.readerAvailable = false;
    expect(new OfficialLibrary(snapshot, data).get(id).downloaded).toBe(false);
  });
});
