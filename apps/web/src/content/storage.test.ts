import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CourseDatabase,
  ContentStorage,
  ContentConflictError,
} from "./storage";
import { packageFixture } from "./fixtures.test-support";
import { getCurrentContent } from "../data/catalog";

const databases: CourseDatabase[] = [];
function store(name = `content-test-${crypto.randomUUID()}`) {
  const database = new CourseDatabase(name);
  databases.push(database);
  return new ContentStorage(database);
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const database of databases) database.close();
  for (const database of databases.splice(0)) await Dexie.delete(database.name);
});

describe("downloaded content transactions", () => {
  it("restores downloaded content offline while retaining old versions and bundled content", async () => {
    const first = await packageFixture("第一版"),
      second = await packageFixture("第二版");
    const storage = store();
    await storage.install(first.manifest, first.archive, null);
    await storage.install(
      second.manifest,
      second.archive,
      first.manifest.version,
    );
    const reopened = store(storage.database.name);
    const saved = await reopened.load();
    expect(
      saved.activeCourses.find((course) => course.id === "calculus")
        ?.questions[0].question,
    ).toContain("第二版");
    expect(
      saved.activeCourses.find((course) => course.id === "c-language"),
    ).toBeDefined();
    expect(saved.installed).toHaveLength(2);
    expect(
      getCurrentContent(
        {
          courseId: "calculus",
          version: first.manifest.version,
          kind: "questions",
          itemId: "M001",
          chapterIndex: 0,
        },
        saved.allCourses,
      ).content,
    ).toContain("第一版");
    expect(
      getCurrentContent(
        {
          courseId: "calculus",
          version: "example-1",
          kind: "questions",
          itemId: "M001",
          chapterIndex: 0,
        },
        saved.allCourses,
      ).content,
    ).not.toContain("第一版");
  });
  it("rolls back both the version record and head if saving the head fails", async () => {
    const first = await packageFixture("旧版"),
      second = await packageFixture("新版");
    const storage = store();
    await storage.install(first.manifest, first.archive, null);
    vi.spyOn(storage.database.heads, "put").mockRejectedValueOnce(
      new DOMException("Quota exceeded.", "QuotaExceededError"),
    );
    await expect(
      storage.install(second.manifest, second.archive, first.manifest.version),
    ).rejects.toThrow();
    const saved = await storage.load();
    expect(saved.heads[0].version).toBe(first.manifest.version);
    expect(saved.installed).toHaveLength(1);
  });
  it("rejects a stale window instead of replacing a newer installed course", async () => {
    const first = await packageFixture("旧版"),
      second = await packageFixture("新版");
    const storage = store(),
      other = store(storage.database.name);
    await storage.install(first.manifest, first.archive, null);
    await other.install(
      second.manifest,
      second.archive,
      first.manifest.version,
    );
    await expect(
      storage.install(first.manifest, first.archive, first.manifest.version),
    ).rejects.toBeInstanceOf(ContentConflictError);
    expect((await storage.load()).heads[0].version).toBe(
      second.manifest.version,
    );
  });
  it("leaves the old version intact when package verification or cancellation fails", async () => {
    const first = await packageFixture("旧版");
    const storage = store();
    await storage.install(first.manifest, first.archive, null);
    const corrupt = first.archive.slice();
    corrupt[10] ^= 1;
    await expect(
      storage.install(first.manifest, corrupt, first.manifest.version),
    ).rejects.toThrow("校验失败");
    const controller = new AbortController();
    controller.abort();
    await expect(
      storage.install(
        first.manifest,
        first.archive,
        first.manifest.version,
        controller.signal,
      ),
    ).rejects.toThrow();
    expect((await storage.load()).heads[0].version).toBe(
      first.manifest.version,
    );
  });
});
