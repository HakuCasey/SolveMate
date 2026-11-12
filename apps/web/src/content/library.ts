import type {
  AppData,
  Course,
  OfficialMaterialMetadata,
  ReadingSelection,
} from "@solvemate/contracts";
import {
  createSubjectDirectory,
  addSubject,
  type SubjectDirectory,
} from "../state/subjects";
import { DataRequestError } from "../refresh/errors";
import { contentEntries, officialEntryId } from "./entries";
import { courseState } from "./course-state";
import { updatedSelection } from "./selection";
import type { CourseInfo, RemoteCourse, UpdateResponse } from "./contracts";
import type { ContentSnapshot } from "./storage";

type LibraryData = Pick<AppData, "subjects" | "officialMaterials">;
type Entry = ReturnType<typeof contentEntries>[number];

/** 资料身份、归属和可用性集中在对象中；包文件存在不代表条目仍在资料库。 */
export class OfficialMaterial {
  readonly metadata: OfficialMaterialMetadata | undefined;
  readonly subjectId: string | null;
  readonly packageState: ReturnType<typeof courseState>;
  constructor(
    readonly source: CourseInfo,
    readonly entry: Entry,
    readonly course: Course | undefined,
    private readonly snapshot: ContentSnapshot,
    data: LibraryData,
    private readonly directory: SubjectDirectory,
    update?: UpdateResponse,
  ) {
    this.metadata = data.officialMaterials?.find(
      (item) => item.id === entry.id,
    );
    this.subjectId = this.metadata ? this.metadata.subjectId : source.id;
    this.packageState = courseState(snapshot, source.id, update);
  }
  get id() {
    return this.entry.id;
  }
  get kind() {
    return this.entry.kind;
  }
  get title() {
    return this.entry.title;
  }
  get description() {
    return this.entry.description;
  }
  get subject() {
    return this.subjectId === null
      ? undefined
      : this.directory.byId.get(this.subjectId);
  }
  get subjectTitle() {
    return (
      this.subject?.title ??
      (this.subjectId === null ? "未分类" : this.source.title)
    );
  }
  get removed() {
    return (
      this.metadata?.deletedAt != null ||
      !!this.subject?.deleted ||
      (!!this.metadata && this.subjectId !== null && !this.subject)
    );
  }
  get membershipKey() {
    return JSON.stringify([
      this.subjectId,
      this.metadata?.deletedAt ?? null,
      this.subject?.deleted ?? false,
    ]);
  }
  get listed() {
    return !this.removed && !!this.entry.selection;
  }
  get downloaded() {
    return !this.removed && !!this.packageState.saved;
  }
  get canAcquire() {
    return !!this.packageState.saved || this.packageState.canDownload;
  }
  selection(previous?: ReadingSelection): ReadingSelection {
    if (!this.listed || !this.entry.selection || !this.course)
      throw new DataRequestError(
        "该资料已从资料库删除或不可用，请重新添加后再阅读。",
        "official_material_removed",
        409,
      );
    const target = this.entry.selection;
    if (
      previous?.courseId === target.courseId &&
      previous.kind === target.kind &&
      (target.kind === "questions" || previous.itemId === target.itemId)
    )
      return updatedSelection(previous, this.course, this.snapshot.allCourses);
    return { ...target };
  }
}

/** 目录、学科列表和阅读入口使用同一批资料对象，旧记录按原分类解释。 */
export class OfficialLibrary {
  readonly directory: SubjectDirectory;
  readonly entries: OfficialMaterial[];
  constructor(
    readonly snapshot: ContentSnapshot,
    private readonly data: LibraryData = {},
    remote: RemoteCourse[] = [],
    updates: Record<string, UpdateResponse> = {},
  ) {
    this.directory = createSubjectDirectory(
      snapshot.activeCourses,
      data.subjects,
    );
    const sources: CourseInfo[] = [...remote];
    for (const course of snapshot.activeCourses)
      if (!sources.some((item) => item.id === course.id)) {
        const saved = courseState(snapshot, course.id).saved;
        sources.push(
          saved?.manifest.course ?? {
            id: course.id,
            title: course.title,
            description: "当前本地内容",
            release: course.version,
          },
        );
      }
    this.entries = sources.flatMap((source) => {
      const local = snapshot.activeCourses.find(
        (item) => item.id === source.id,
      );
      return contentEntries(
        source,
        local,
        updates[source.id]?.latest.files,
      ).map(
        (entry) =>
          new OfficialMaterial(
            source,
            entry,
            local,
            snapshot,
            data,
            this.directory,
            updates[source.id],
          ),
      );
    });
  }
  get(id: string) {
    const entry = this.entries.find((item) => item.id === id);
    if (!entry)
      throw new DataRequestError(
        "资料目录已变化，请刷新后重新选择。",
        "official_material_missing",
        409,
      );
    return entry;
  }
  forSubject(subjectId: string | null, kind: ReadingSelection["kind"]) {
    return this.entries.filter(
      (entry) =>
        entry.listed && entry.subjectId === subjectId && entry.kind === kind,
    );
  }
  scopeForSelection(selection: ReadingSelection) {
    const id = officialEntryId(selection);
    const metadata = this.data.officialMaterials?.find(
      (item) => item.id === id,
    );
    const subjectId = metadata ? metadata.subjectId : selection.courseId;
    const subject =
      subjectId === null ? undefined : this.directory.byId.get(subjectId);
    if (
      metadata?.deletedAt != null ||
      subject?.deleted ||
      (subjectId !== null && !subject)
    )
      return null;
    return { courseId: subjectId, kind: selection.kind };
  }
  remove(data: AppData, id: string, now = Date.now()): AppData {
    const item = this.get(id);
    if (item.removed) return data;
    return this.record(data, { id, subjectId: item.subjectId, deletedAt: now });
  }
  restore(data: AppData, id: string): AppData {
    const item = this.get(id);
    if (!item.packageState.saved)
      throw new Error("资料尚未下载并校验，不能添加到资料库。");
    let subjectId = item.subjectId;
    if (subjectId !== null && (!item.subject || item.subject.deleted)) {
      const title = item.subject?.title ?? item.source.title;
      const active = this.directory.active.find(
        (subject) => subject.title.toLowerCase() === title.toLowerCase(),
      );
      if (active) subjectId = active.id;
      else {
        // 保留旧学科的删除记录，避免旧上传资料随官方资料一起恢复。
        subjectId = `subject-${crypto.randomUUID()}`;
        data = addSubject(data, this.snapshot.activeCourses, title, subjectId);
      }
    }
    return this.record(data, { id, subjectId, deletedAt: null });
  }
  private record(data: AppData, metadata: OfficialMaterialMetadata): AppData {
    return {
      ...data,
      officialMaterials: [
        ...(data.officialMaterials ?? []).filter(
          (item) => item.id !== metadata.id,
        ),
        metadata,
      ],
    };
  }
}
