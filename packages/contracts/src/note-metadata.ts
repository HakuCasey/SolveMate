import {
  assertMetadata,
  maxNoteTitleLength,
  truncateNoteTitle,
} from "./metadata";
import type {
  AppData,
  LearningLocation,
  Note,
  NoteOrigin,
  ReadingReference,
} from "./index";

/** 资料位置与笔记来源互相转换；官方编号沿用现有内容目录规则。 */
export function originsFromReading(
  source: LearningLocation | null,
  excerpt?: ReadingReference,
): NoteOrigin[] {
  if (source)
    assertMetadata(
      "materialId" in source ? "MaterialLocation" : "ReadingSelection",
      source,
    );
  if (excerpt) assertMetadata("ReadingReference", excerpt);
  if (excerpt?.message)
    return [
      ...originsFromReading(source),
      { kind: "conversation", ...structuredClone(excerpt.message) },
    ];
  const cited = excerpt?.material ?? excerpt?.selection;
  if (
    source &&
    cited &&
    JSON.stringify(originsFromReading(source)) !==
      JSON.stringify(originsFromReading(cited))
  )
    return [
      ...originsFromReading(source),
      ...originsFromReading(cited, excerpt),
    ];
  const location = source ?? cited;
  if (!location) return [];
  if ("materialId" in location)
    return [
      {
        kind: "document",
        materialId: location.materialId,
        version: location.contentVersion,
        pageNumber: location.pageNumber,
      },
    ];
  const version = location.version ?? "example-1";
  return location.kind === "questions"
    ? [
        {
          kind: "question",
          materialId: `${location.courseId}:questions`,
          version,
          questionId: location.itemId,
        },
      ]
    : [
        {
          kind: "document",
          materialId: `${location.courseId}:textbooks:${location.itemId}`,
          version,
          pageNumber: location.pageNumber!,
        },
      ];
}

export function locationForOrigin(origin: NoteOrigin): LearningLocation | null {
  if (origin.kind === "conversation") return null;
  if (origin.kind === "question")
    return {
      courseId: origin.materialId.slice(0, -":questions".length),
      kind: "questions",
      version: origin.version,
      itemId: origin.questionId,
    };
  const split = origin.materialId.indexOf(":textbooks:");
  return split < 0
    ? {
        materialId: origin.materialId,
        contentVersion: origin.version,
        pageNumber: origin.pageNumber,
      }
    : {
        courseId: origin.materialId.slice(0, split),
        kind: "textbooks",
        itemId: origin.materialId.slice(split + ":textbooks:".length),
        version: origin.version,
        pageNumber: origin.pageNumber,
      };
}

export function uniqueNoteOrigins(origins: NoteOrigin[]): NoteOrigin[] {
  const seen = new Set<string>();
  return origins.filter((origin) => {
    // 固定字段顺序，旧 JSON 的键顺序不影响去重。
    const key = JSON.stringify(
      Object.fromEntries(
        Object.entries(origin).sort(([a], [b]) => a.localeCompare(b)),
      ),
    );
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** 只在读取旧记录时转换；调用方负责备份、完整校验与原子保存。 */
export function migrateNoteMetadata(value: unknown): AppData {
  const data = value as AppData;
  if (!data.noteLibrary) return data;
  let changed = false;
  const notes = data.noteLibrary.notes.map((value) => {
    const old = value as unknown as Record<string, unknown>;
    const legacyKeys = [
      "courseId",
      "questionId",
      "summary",
      "source",
      "excerpt",
    ];
    if (
      "createdAt" in old &&
      "updatedAt" in old &&
      Array.isArray(old.origins) &&
      old.origins.every(
        (item) =>
          item &&
          typeof item === "object" &&
          "kind" in item &&
          !("quote" in item),
      ) &&
      !legacyKeys.some((key) => key in old) &&
      typeof old.title === "string" &&
      Array.from(old.title).length <= maxNoteTitleLength
    )
      return value;
    changed = true;
    const collect = (source: unknown, excerpt: unknown) =>
      originsFromReading(
        source as LearningLocation | null,
        excerpt as ReadingReference | undefined,
      );
    const origins =
      (old.origins as Record<string, unknown>[] | undefined)?.flatMap((item) =>
        "kind" in item
          ? [
              Object.fromEntries(
                Object.entries(item).filter(([key]) => key !== "quote"),
              ) as unknown as NoteOrigin,
            ]
          : collect(item.source, item.excerpt),
      ) ?? [];
    if (old.source || old.excerpt)
      origins.push(...collect(old.source, old.excerpt));
    else if (old.source === undefined && old.courseId && old.questionId)
      origins.push(
        ...originsFromReading({
          courseId: String(old.courseId),
          kind: "questions",
          itemId: String(old.questionId),
          version: "example-1",
        }),
      );
    const next = {
      ...old,
      title:
        typeof old.title === "string"
          ? truncateNoteTitle(old.title)
          : old.title,
      origins: uniqueNoteOrigins(origins),
      createdAt: old.createdAt ?? null,
      updatedAt: old.updatedAt ?? null,
    };
    for (const key of legacyKeys) delete next[key as keyof typeof next];
    return next as unknown as Note;
  });
  return changed
    ? { ...data, noteLibrary: { ...data.noteLibrary, notes } }
    : data;
}
