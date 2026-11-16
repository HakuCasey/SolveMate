import type {
  Course,
  Material,
  Subject,
  ReadingSelection,
} from "@solvemate/contracts";
import {
  createSubjectDirectory,
  type SubjectDirectory,
} from "../state/subjects";
import { DataRequestError } from "../refresh/errors";
import { contentEntries, officialEntryId } from "./entries";
import { courseState } from "./course-state";
import { materialState } from "./material-state";
import { updatedSelection } from "./selection";
import type { CourseInfo, RemoteCourse, UpdateResponse } from "./contracts";
import type { ContentSnapshot } from "./storage";
import { isSupportedReadingLocation } from "../reading/reference";

type LibraryData = { subjects?: Subject[]; materials?: Material[] };
type Entry = ReturnType<typeof contentEntries>[number];

/** 社区目录展示发布信息，并引用本机资料记录；不保存或修改资料状态。 */
export class CommunityCatalogEntry {
  readonly metadata: Material | undefined;
  readonly subjectId: string | null;
  readonly packageState: ReturnType<typeof materialState>;
  constructor(
    readonly source: CourseInfo,
    readonly entry: Entry,
    readonly course: Course | undefined,
    snapshot: ContentSnapshot,
    data: LibraryData,
    private readonly directory: SubjectDirectory,
    update?: UpdateResponse,
  ) {
    this.metadata = data.materials?.find((item) => item.id === entry.id);
    this.subjectId = this.metadata ? this.metadata.subjectId : source.id;
    this.packageState = materialState(
      snapshot,
      source.id,
      entry.kind,
      this.version,
      update,
      this.metadata,
    );
  }
  get id() {
    return this.entry.id;
  }
  get version() {
    return this.metadata?.currentVersion !== undefined
      ? this.metadata.currentVersion
      : (this.course?.version ?? null);
  }
  get updatedAt() {
    const value =
      this.metadata?.updatedAt ?? this.packageState.saved?.installedAt;
    return value && value > 0 ? value : undefined;
  }
  get kind() {
    return this.entry.kind;
  }
  get title() {
    return this.metadata?.title ?? this.entry.title;
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
      (!!this.metadata &&
        this.metadata.currentVersion !== null &&
        this.subjectId !== null &&
        !this.subject)
    );
  }
  get membershipKey() {
    return JSON.stringify([
      this.subjectId,
      this.metadata?.deletedAt ?? null,
      this.subject?.deleted ?? false,
      this.version,
    ]);
  }
  get listed() {
    return !!this.metadata && !this.removed && !!this.entry.selection;
  }
  get downloaded() {
    return (
      !!this.metadata &&
      !this.removed &&
      this.metadata.version.status === "ready" &&
      this.metadata.availability?.readerAvailable !== false
    );
  }
  get canAcquire() {
    return (
      this.metadata?.availability?.readerAvailable === true ||
      !!this.packageState.saved ||
      this.packageState.canDownload
    );
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
      previous &&
      isSupportedReadingLocation(previous) &&
      previous.courseId === target.courseId &&
      previous.kind === target.kind &&
      (target.kind === "questions" || previous.itemId === target.itemId)
    )
      return updatedSelection(previous, this.course);
    return { ...target };
  }
}

/** 目录、学科列表和阅读入口使用同一批资料对象，旧记录按原分类解释。 */
export class OfficialLibrary {
  readonly directory: SubjectDirectory;
  readonly entries: CommunityCatalogEntry[];
  constructor(
    readonly snapshot: ContentSnapshot,
    private readonly data: LibraryData = {},
    private readonly remote: RemoteCourse[] = [],
    private readonly updates: Record<string, UpdateResponse> = {},
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
      ).map((entry) => {
        const metadata = data.materials?.find((item) => item.id === entry.id);
        const selected =
          metadata?.currentVersion !== undefined
            ? snapshot.allCourses.find(
                (item) =>
                  item.id === source.id &&
                  item.version === metadata.currentVersion,
              )
            : local;
        const selectedEntry = contentEntries(
          source,
          selected,
          updates[source.id]?.latest.files,
        ).find((item) => item.id === entry.id);
        return new CommunityCatalogEntry(
          source,
          selectedEntry ?? { ...entry, selection: undefined },
          selected,
          snapshot,
          data,
          this.directory,
          updates[source.id],
        );
      });
    });
  }
  withData(data: LibraryData) {
    return new OfficialLibrary(this.snapshot, data, this.remote, this.updates);
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
    const metadata = this.data.materials?.find((item) => item.id === id);
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
}
