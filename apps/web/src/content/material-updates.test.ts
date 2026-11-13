import { describe, expect, it, vi } from "vitest";
import type { AppData } from "@solvemate/contracts";
import { createInitialData } from "../data/catalog";
import { packageFixture } from "./fixtures.test-support";
import { readPackage } from "./package";
import { makeSnapshot, type InstalledCourse } from "./storage";
import { OfficialLibrary } from "./library";
import { OfficialLibraryService } from "./library-service";
import type { UpdateResponse } from "./contracts";

const book = "calculus:textbooks:B001",
  questions = "calculus:questions";
async function saved(marker = "", pdf = false): Promise<InstalledCourse> {
  const fixture = await packageFixture(marker, { pdf });
  return {
    ...fixture,
    courseId: "calculus",
    version: fixture.manifest.version,
    course: await readPackage(fixture.manifest, fixture.archive),
    installedAt: 100,
  };
}
async function setup(firstDownload = false, changeQuestions = true) {
  const old = await saved(),
    next = await saved(changeQuestions ? "Changed question" : "", true);
  let data = createInitialData();
  let snapshot = firstDownload
    ? makeSnapshot()
    : makeSnapshot([old], [{ courseId: old.courseId, version: old.version }]);
  const update: UpdateResponse = {
    course_id: old.courseId,
    current_version: firstDownload ? null : old.version,
    latest: next.manifest,
    status: firstDownload ? "not_installed" : "update_available",
    update_available: true,
  };
  const read = () =>
    new OfficialLibrary(snapshot, data, [], { calculus: update });
  const install = vi.fn(async (): Promise<InstalledCourse | null> => {
    // 更新课程包时，其他条目必须已经保留其原版本。
    const expected = firstDownload ? "example-1" : old.version;
    expect(read().get(questions).version).toBe(expected);
    snapshot = makeSnapshot(firstDownload ? [next] : [old, next], [
      { courseId: old.courseId, version: next.version },
    ]);
    expect(read().get(questions).version).toBe(expected);
    return next;
  });
  const save = vi.fn(
    async (change: (data: AppData) => AppData) => (data = change(data)),
  );
  const service = new OfficialLibraryService({
    read,
    install,
    save,
    load: async () => snapshot,
    refresh: async () => undefined,
  });
  return { old, next, read, install, save, service, getData: () => data };
}

describe("independent official material updates", () => {
  it("updates only the chosen material and reuses cached files when updating its sibling", async () => {
    const test = await setup();
    const now = vi.spyOn(Date, "now").mockReturnValue(200);
    try {
      await test.service.acquire(book, true);
      expect(test.read().get(book).version).toBe(test.next.version);
      expect(test.read().get(book).updatedAt).toBe(200);
      expect(test.read().get(questions).version).toBe(test.old.version);
      expect(test.read().get(questions).selection().version).toBe(
        test.old.version,
      );
      expect(test.read().get(questions).updatedAt).toBe(100);
      expect(test.read().get(questions).packageState.updateAvailable).toBe(
        true,
      );
      now.mockReturnValue(300);
      await test.service.acquire(questions, true);
      expect(test.install).toHaveBeenCalledOnce();
      expect(test.read().get(questions).version).toBe(test.next.version);
      expect(test.read().get(questions).updatedAt).toBe(300);
      expect(test.read().get(book).updatedAt).toBe(200);
    } finally {
      now.mockRestore();
    }
  });
  it("does not offer a question update when only the PDF changed", async () => {
    const test = await setup(false, false);
    expect(test.read().get(book).packageState.updateAvailable).toBe(true);
    expect(test.read().get(questions).packageState.updateAvailable).toBe(false);
    await test.service.acquire(book, true);
    expect(test.read().get(questions).packageState.current).toBe(true);
    expect(test.read().get(questions).version).toBe(test.old.version);
    expect(test.read().get(questions).updatedAt).toBe(100);
  });
  it("does not mark sibling entries as downloaded on the first material download", async () => {
    const test = await setup(true);
    await test.service.acquire(book);
    expect(test.read().get(book).downloaded).toBe(true);
    expect(test.read().get(questions).downloaded).toBe(false);
    expect(test.read().get(questions).selection().version).toBe("example-1");
  });
  it("retains all chosen versions if downloading fails", async () => {
    const test = await setup();
    test.install.mockResolvedValueOnce(null);
    expect(await test.service.acquire(book, true)).toBe(false);
    expect(test.read().get(book).version).toBe(test.old.version);
    expect(test.read().get(questions).version).toBe(test.old.version);
    expect(test.read().get(book).updatedAt).toBe(100);
  });
  it("keeps the old material readable when saving the new choice fails after downloading", async () => {
    const test = await setup();
    // 第一次提交由真实保存函数固定旧版本，第二次提交失败。
    const original = test.save.getMockImplementation()!;
    test.save.mockReset();
    let calls = 0;
    test.save.mockImplementation(async (change) => {
      if (++calls === 2) throw new Error("Save failed");
      return original(change);
    });
    await expect(test.service.acquire(book, true)).rejects.toThrow(
      "Save failed",
    );
    expect(test.read().get(book).selection().version).toBe(test.old.version);
    expect(test.read().get(questions).version).toBe(test.old.version);
  });
});
