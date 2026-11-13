import type { Material } from "@solvemate/contracts";
export interface UploadEntry {
  file: File;
  loaded: number;
  total: number;
  phase: "queued" | "uploading" | "uploaded" | "failed";
  record?: Material;
  error?: string;
}
export type UploadEvent = { file: File; loaded: number; total: number } & (
  | { phase: "uploading" }
  | { phase: "uploaded"; record: Material }
  | { phase: "failed"; error: string }
);
export function updateUpload(
  entries: UploadEntry[],
  event: UploadEvent,
): UploadEntry[] {
  return entries.map((entry) =>
    entry.file === event.file ? { ...entry, ...event } : entry,
  );
}
export function uploadEntryState(entry: UploadEntry, materials: Material[]) {
  const current =
    materials.find((item) => item.id === entry.record?.id) ?? entry.record;
  if (entry.phase === "failed")
    return {
      phase: "failed" as const,
      label: current ? "资料归类未完成" : "上传失败",
      error: entry.error,
      record: current,
    };
  if (!current)
    return {
      phase: entry.phase,
      label:
        entry.phase === "queued"
          ? "等待上传"
          : entry.loaded >= entry.total
            ? "正在确认保存…"
            : "正在上传…",
      record: current,
    };
  if (
    current.deletedAt ||
    (current.availability?.readerAvailable === false &&
      current.version.status === "ready")
  )
    return {
      phase: "failed" as const,
      label: "资料不可用",
      error: current.availability?.error || "资料条目已删除，原文件仍保留。",
      record: current,
    };
  if (current.version.status === "failed")
    return {
      phase: "failed" as const,
      label: "处理失败",
      error: current.version.error || "处理未能完成，请重试。",
      record: current,
    };
  if (current.version.status === "ready")
    return { phase: "ready" as const, label: "处理完成", record: current };
  return {
    phase: "processing" as const,
    label:
      current.version.mediaType === "application/pdf"
        ? "正在读取 PDF…"
        : "正在转换课件…",
    record: current,
  };
}
