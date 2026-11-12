import { createInitialData } from "../data/catalog";
import { packageFixture } from "./fixtures.test-support";
import { readPackage } from "./package";
import { makeSnapshot } from "./storage";

export async function libraryFixture() {
  const { manifest, archive } = await packageFixture();
  const course = await readPackage(manifest, archive);
  const saved = {
    courseId: course.id,
    version: course.version,
    course,
    manifest,
    archive,
    installedAt: 100,
    available: true,
  };
  return {
    snapshot: makeSnapshot(
      [saved],
      [{ courseId: course.id, version: course.version }],
    ),
    saved,
    data: createInitialData(),
  };
}
