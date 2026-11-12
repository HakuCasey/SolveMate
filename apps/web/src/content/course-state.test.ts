import { describe, expect, it } from "vitest";
import { courseState } from "./course-state";
import type { UpdateResponse } from "./contracts";
import { packageFixture } from "./fixtures.test-support";
import { readPackage } from "./package";
import { makeSnapshot, type InstalledCourse } from "./storage";

async function savedCourse(marker = "") {
  const fixture = await packageFixture(marker);
  const saved: InstalledCourse = {
    courseId: "calculus",
    version: fixture.manifest.version,
    manifest: fixture.manifest,
    archive: fixture.archive,
    installedAt: 1,
    course: await readPackage(fixture.manifest, fixture.archive),
  };
  return {
    saved,
    snapshot: makeSnapshot(
      [saved],
      [{ courseId: "calculus", version: saved.version }],
    ),
  };
}

describe("official course availability", () => {
  it("uses the download action until official content has a saved record", async () => {
    const fixture = await packageFixture();
    const state = courseState(makeSnapshot(), "calculus", {
      course_id: "calculus",
      current_version: null,
      status: "not_installed",
      update_available: true,
      latest: fixture.manifest,
    });
    expect(state.local).toBeDefined();
    expect(state.saved).toBeUndefined();
    expect(state.saved).toBeUndefined();
    expect(state.canDownload).toBe(true);
  });
  it("does not offer a duplicate download when a saved version matches the latest manifest", async () => {
    const { saved, snapshot } = await savedCourse();
    // 旧查询可能按未安装返回；本机最新指针已经证明该版本可读。
    const state = courseState(snapshot, "calculus", {
      course_id: "calculus",
      current_version: null,
      status: "not_installed",
      update_available: true,
      latest: saved.manifest,
    });
    expect(state.current).toBe(true);
    expect(state.saved).toBeDefined();
    expect(state.canDownload).toBe(false);
    expect(state.local?.version).toBe(saved.version);
  });
  it("offers updates only for the saved version that was actually checked", async () => {
    const first = await savedCourse("first");
    const second = await savedCourse("second");
    const latest = await packageFixture("third");
    const update: UpdateResponse = {
      course_id: "calculus",
      current_version: first.saved.version,
      status: "update_available",
      update_available: true,
      latest: latest.manifest,
    };
    expect(
      courseState(first.snapshot, "calculus", update).updateAvailable,
    ).toBe(true);
    const stale = courseState(second.snapshot, "calculus", update);
    expect(stale.saved).toBeDefined();
    expect(stale.updateAvailable).toBe(false);
    expect(stale.canDownload).toBe(false);
  });
  it("keeps local reading available while a version is unknown or no check has completed", async () => {
    const { saved, snapshot } = await savedCourse();
    const latest = await packageFixture("new");
    const unknown = courseState(snapshot, "calculus", {
      course_id: "calculus",
      current_version: saved.version,
      status: "unknown_version",
      update_available: false,
      latest: latest.manifest,
    });
    expect(unknown.unknown).toBe(true);
    expect(unknown.saved).toBeDefined();
    expect(unknown.canDownload).toBe(false);
    expect(unknown.local).toBeDefined();
    const unchecked = courseState(snapshot, "calculus");
    expect(unchecked.saved).toBeDefined();
    expect(unchecked.canDownload).toBe(false);
  });
  it("offers a download for a remote material that has no saved record", async () => {
    const { manifest } = await packageFixture();
    const update: UpdateResponse = {
      course_id: "new-course",
      current_version: null,
      status: "not_installed",
      update_available: true,
      latest: { ...manifest, course: { ...manifest.course, id: "new-course" } },
    };
    const state = courseState(makeSnapshot(), "new-course", update);
    expect(state.local).toBeUndefined();
    expect(state.saved).toBeUndefined();
    expect(state.canDownload).toBe(true);
  });
});

it("allows re-downloading the current stored version when its package is missing", async () => {
  const { manifest } = await packageFixture();
  const snapshot = makeSnapshot(
    [],
    [],
    [{ courseId: "calculus", version: manifest.version }],
  );
  const state = courseState(snapshot, "calculus", {
    course_id: "calculus",
    current_version: manifest.version,
    status: "up_to_date",
    update_available: false,
    latest: manifest,
  });
  expect(state.saved).toBeUndefined();
  expect(state.canDownload).toBe(true);
  expect(state.current).toBe(false);
});
