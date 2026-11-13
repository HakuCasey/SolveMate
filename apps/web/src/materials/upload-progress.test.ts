import { expect, it } from "vitest";
import type { Material } from "@solvemate/contracts";
import {
  updateUpload,
  uploadEntryState,
  type UploadEntry,
} from "./upload-progress";
const file = new File(["example"], "lesson.pptx");
const entry: UploadEntry = {
  file,
  loaded: 0,
  total: file.size,
  phase: "queued",
};
const record: Material = {
  id: "material",
  title: "课件",
  courseId: null,
  source: "personal",
  currentVersion: "a".repeat(64),
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
  version: {
    contentVersion: "a".repeat(64),
    mediaType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    originalAssetId: "original.pptx",
    readerAssetId: null,
    filename: file.name,
    sizeBytes: file.size,
    sha256: "a".repeat(64),
    pageCount: 0,
    status: "processing",
    error: null,
    processor: "libreoffice",
    processorVersion: "test",
  },
};
it("distinguishes sent bytes, acknowledged upload, conversion and completed reading files", () => {
  let entries = updateUpload([entry], {
    file,
    loaded: file.size,
    total: file.size,
    phase: "uploading",
  });
  expect(uploadEntryState(entries[0], []).label).toBe("正在确认保存…");
  entries = updateUpload(entries, {
    file,
    loaded: file.size,
    total: file.size,
    phase: "uploaded",
    record,
  });
  expect(uploadEntryState(entries[0], []).phase).toBe("processing");
  expect(
    uploadEntryState(entries[0], [
      { ...record, version: { ...record.version, status: "ready" } },
    ]).phase,
  ).toBe("ready");
  expect(entry.loaded).toBe(0);
});
it("shows conversion failures and a retry using the same material record", () => {
  const uploaded = { ...entry, phase: "uploaded" as const, record };
  const failed = {
    ...record,
    revision: 2,
    version: {
      ...record.version,
      status: "failed" as const,
      error: "转换器缺失",
    },
  };
  expect(uploadEntryState(uploaded, [failed])).toMatchObject({
    phase: "failed",
    error: "转换器缺失",
  });
  expect(uploadEntryState(uploaded, [record]).phase).toBe("processing");
  const missing = {
    ...failed,
    version: { ...failed.version, status: "ready" as const },
    availability: {
      originalAvailable: false,
      readerAvailable: false,
      error: "文件缺失",
    },
  };
  expect(uploadEntryState(uploaded, [missing])).toMatchObject({
    phase: "failed",
    error: "文件缺失",
  });
});
it("leaves successful files unchanged when a different file fails", () => {
  const other = new File(["x"], "other.pdf");
  const entries = updateUpload(
    [
      { ...entry, phase: "uploaded", record },
      { ...entry, file: other },
    ],
    { file: other, loaded: 0, total: 1, phase: "failed", error: "上传中断" },
  );
  expect(entries[0].record).toBe(record);
  expect(uploadEntryState(entries[1], [])).toMatchObject({
    phase: "failed",
    error: "上传中断",
  });
});
