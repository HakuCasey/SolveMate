import { assertMetadata } from "@solvemate/contracts";
import type { ReadingState } from "../reading/state";
import { logError } from "../logger";

export interface ReloadCheckpoint {
  schemaVersion: 1;
  conversationId: string | null;
  drafts: Record<string, string>;
  reading: ReadingState;
}
const storageKey = "solvemate:update-checkpoint:v1";
type CheckpointStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const offset = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

function validCheckpoint(value: unknown): value is ReloadCheckpoint {
  if (
    !record(value) ||
    value.schemaVersion !== 1 ||
    !(
      value.conversationId === null || typeof value.conversationId === "string"
    ) ||
    !record(value.drafts) ||
    !Object.values(value.drafts).every(
      (item) => typeof item === "string" && item.length <= 10000,
    ) ||
    !record(value.reading)
  )
    return false;
  const reading = value.reading;
  if (
    !record(reading.positions) ||
    !record(reading.documents) ||
    !record(reading.references)
  )
    return false;
  if (
    !Object.values(reading.positions).every(
      (item) =>
        record(item) &&
        typeof item.answerVisible === "boolean" &&
        record(item.scroll) &&
        offset(item.scroll.top) &&
        offset(item.scroll.left),
    )
  )
    return false;
  for (const item of Object.values(reading.documents)) {
    if (
      !record(item) ||
      typeof item.zoom !== "number" ||
      !Number.isFinite(item.zoom) ||
      item.zoom < 0.5 ||
      item.zoom > 3
    )
      return false;
    if (item.location !== undefined) {
      if (!record(item.location)) return false;
      assertMetadata(
        "materialId" in item.location ? "MaterialLocation" : "ReadingSelection",
        item.location,
      );
    }
  }
  for (const items of Object.values(reading.references)) {
    if (!Array.isArray(items) || items.length > 20) return false;
    let length = 0;
    const ids = new Set<string>();
    for (const item of items) {
      if (
        !record(item) ||
        typeof item.id !== "string" ||
        !item.id ||
        ids.has(item.id)
      )
        return false;
      ids.add(item.id);
      assertMetadata("ReadingReference", item.reference);
      length += (item.reference as { content: string }).content.length;
    }
    if (length > 100000) return false;
  }
  return true;
}

export function loadReloadCheckpoint(storage?: CheckpointStorage): {
  value: ReloadCheckpoint | null;
  error: string;
} {
  try {
    const saved = (storage ?? sessionStorage).getItem(storageKey);
    if (!saved) return { value: null, error: "" };
    const value: unknown = JSON.parse(saved);
    if (!validCheckpoint(value))
      throw new Error("Invalid application update checkpoint.");
    return { value, error: "" };
  } catch (failure) {
    logError(
      "Failed to restore application update drafts and reading state.",
      failure,
    );
    return {
      value: null,
      error: "更新前的草稿和阅读位置未能恢复，原临时记录已保留。",
    };
  }
}

export function saveReloadCheckpoint(
  value: ReloadCheckpoint,
  storage?: CheckpointStorage,
) {
  try {
    if (!validCheckpoint(value))
      throw new Error("Invalid application update checkpoint.");
    const target = storage ?? sessionStorage;
    const serialized = JSON.stringify(value);
    target.setItem(storageKey, serialized);
    if (target.getItem(storageKey) !== serialized)
      throw new Error("Application update checkpoint was not saved.");
  } catch (failure) {
    logError(
      "Failed to save application update drafts and reading state.",
      failure,
    );
    throw new Error(
      "无法保存更新前的草稿和阅读位置，请释放浏览器存储空间后重试。",
      { cause: failure },
    );
  }
}

export function clearReloadCheckpoint(storage?: CheckpointStorage) {
  try {
    (storage ?? sessionStorage).removeItem(storageKey);
  } catch (failure) {
    logError(
      "Failed to remove the restored application update checkpoint.",
      failure,
    );
  }
}
