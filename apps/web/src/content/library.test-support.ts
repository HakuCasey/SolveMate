import type { Course, Material } from "@solvemate/contracts";
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
    data: {
      ...createInitialData(),
      materials: materialFixtures(
        makeSnapshot(
          [saved],
          [{ courseId: course.id, version: course.version }],
        ).activeCourses,
      ),
    },
  };
}

export function materialFixtures(courses: Course[]): Material[] {
  return courses.flatMap((course) =>
    [
      ...course.textbooks.map((book) => ({
        id: `${course.id}:textbooks:${book.id}`,
        title: book.title,
        kind: "textbooks" as const,
      })),
      {
        id: `${course.id}:questions`,
        title: `${course.title}题目`,
        kind: "questions" as const,
      },
    ].map((entry) => ({
      ...entry,
      subjectId: course.id,
      source: "community" as const,
      currentVersion: course.version,
      revision: 1,
      createdAt: 100,
      updatedAt: 100,
      deletedAt: null,
      version: {
        contentVersion: course.version,
        mediaType: "application/pdf" as const,
        originalAssetId: "primer.pdf",
        readerAssetId: "primer.pdf",
        storagePath: "community/example/files",
        filename: "primer.pdf",
        sizeBytes: 1,
        sha256: "a".repeat(64),
        pageCount: 6,
        status: "ready" as const,
        error: null,
        processor: null,
        processorVersion: null,
      },
    })),
  );
}
