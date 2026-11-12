import Dexie, { type Table } from "dexie";
import type { Course } from "@solvemate/contracts";
import { courses as bundledCourses } from "../data/catalog";
import { parseManifest, ContentError, type ReleaseManifest } from "./contracts";
import { readPackage } from "./package";

export interface SavedCourse {
  courseId: string;
  version: string;
  manifest: ReleaseManifest;
  archive: Uint8Array;
  installedAt: number;
  available?: boolean;
}
export interface InstalledCourse extends SavedCourse {
  course: Course;
}
export interface CourseHead {
  courseId: string;
  version: string;
}
export interface ContentSnapshot {
  installed: InstalledCourse[];
  heads: CourseHead[];
  activeCourses: Course[];
  allCourses: Course[];
  missingHeads: CourseHead[];
}

export function makeSnapshot(
  installed: InstalledCourse[] = [],
  heads: CourseHead[] = [],
  missingHeads: CourseHead[] = [],
): ContentSnapshot {
  const downloaded = heads.map((head) => {
    const record = installed.find(
      (item) =>
        item.courseId === head.courseId && item.version === head.version,
    );
    if (!record)
      throw new ContentError("本地课程版本记录不完整，原有记录已保留。");
    return record.course;
  });
  const activeCourses = bundledCourses.map(
    (course) => downloaded.find((item) => item.id === course.id) ?? course,
  );
  activeCourses.push(
    ...downloaded.filter(
      (course) => !activeCourses.some((item) => item.id === course.id),
    ),
  );
  const allCourses = [...activeCourses];
  for (const course of [
    ...bundledCourses,
    ...installed.map((item) => item.course),
  ]) {
    if (
      !allCourses.some(
        (item) => item.id === course.id && item.version === course.version,
      )
    )
      allCourses.push(course);
  }
  return { installed, heads, activeCourses, allCourses, missingHeads };
}

/** 缺失文件仍保留服务端版本指针，用于安全地重新下载同一版本。 */
export function storedVersion(snapshot: ContentSnapshot, courseId: string) {
  return (
    [...snapshot.heads, ...snapshot.missingHeads].find(
      (head) => head.courseId === courseId,
    )?.version ?? null
  );
}

export class CourseDatabase extends Dexie {
  versions!: Table<SavedCourse, [string, string]>;
  heads!: Table<CourseHead, string>;
  constructor(name = "solvemate-content") {
    super(name);
    this.version(1).stores({
      versions: "[courseId+version], courseId",
      heads: "courseId",
    });
  }
}

export class ContentConflictError extends ContentError {
  constructor() {
    super("其他窗口已更新这门课程，请刷新后再试。");
  }
}
export class ContentStorage {
  constructor(readonly database = new CourseDatabase()) {}

  async load(): Promise<ContentSnapshot> {
    const [records, heads] = await this.database.transaction(
      "r",
      this.database.versions,
      this.database.heads,
      () =>
        Promise.all([
          this.database.versions.toArray(),
          this.database.heads.toArray(),
        ]),
    );
    const installed: InstalledCourse[] = [];
    for (const saved of records) {
      const manifest = parseManifest(saved.manifest);
      if (
        saved.courseId !== manifest.course.id ||
        saved.version !== manifest.version ||
        !(saved.archive instanceof Uint8Array) ||
        !Number.isFinite(saved.installedAt)
      )
        throw new ContentError("本地课程记录不正确，原有数据已保留。");
      installed.push({
        ...saved,
        manifest,
        course: await readPackage(manifest, saved.archive),
      });
    }
    return makeSnapshot(installed, heads);
  }

  async install(
    manifest: ReleaseManifest,
    archive: Uint8Array,
    expectedVersion: string | null,
    signal?: AbortSignal,
    onSaving?: () => void,
  ): Promise<InstalledCourse> {
    const verifiedManifest = parseManifest(manifest);
    const packageCopy = new Uint8Array(archive);
    const course = await readPackage(verifiedManifest, packageCopy, signal);
    const saved: SavedCourse = {
      courseId: course.id,
      version: course.version,
      manifest: verifiedManifest,
      archive: packageCopy,
      installedAt: Date.now(),
    };
    signal?.throwIfAborted();
    onSaving?.();
    // 网络、解压和哈希都在事务外完成；版本记录与当前版本指针一起提交。
    await this.database.transaction(
      "rw",
      this.database.versions,
      this.database.heads,
      async () => {
        const current = await this.database.heads.get(course.id);
        if ((current?.version ?? null) !== expectedVersion)
          throw new ContentConflictError();
        await this.database.versions.put(saved);
        await this.database.heads.put({
          courseId: course.id,
          version: course.version,
        });
      },
    );
    return { ...saved, course };
  }
}
export const contentStorage = new ContentStorage();
