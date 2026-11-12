import Dexie, { type Table } from "dexie";
import type { AppData } from "@solvemate/contracts";
import { assertAppData } from "../data/validation";
import { logError } from "../logger";
import { DataRequestError } from "../refresh/errors";
import { dataRefresh } from "../refresh/coordinator";

interface CacheRecord {
  key: string;
  value: unknown;
}
export interface StateEnvelope {
  storeId: string;
  revision: number;
  value: AppData | null;
}
export class UserCache extends Dexie {
  records!: Table<CacheRecord, string>;
  pending!: Table<{ id: string; value: AppData; updatedAt?: number }, string>;
  constructor(name = "solvemate-server-cache") {
    super(name);
    this.version(1).stores({ records: "key", pending: "id" });
  }
  async get<T>(key: string): Promise<T | undefined> {
    return (await this.records.get(key))?.value as T | undefined;
  }
  async put(key: string, value: unknown) {
    await this.records.put({ key, value });
  }
}
export const userCache = new UserCache();
// sessionStorage 只保存窗口编号；未确认的数据本身保存在 IndexedDB 缓存中。
function windowWriterId() {
  try {
    const key = "solvemate:writer-id";
    const existing = sessionStorage.getItem(key);
    if (existing) return existing;
    const id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}
export const writerId = windowWriterId();
export class LocalServiceError extends DataRequestError {
  constructor(message: string, code: string, status = 0) {
    super(message, code, status);
  }
}
export type StorageStatus = { online: boolean; warning: string };
let status: StorageStatus = { online: true, warning: "" };
const listeners = new Set<() => void>();
export const userStorageStatus = {
  snapshot: () => status,
  subscribe(callback: () => void) {
    listeners.add(callback);
    return () => {
      listeners.delete(callback);
    };
  },
};
export function publishStorageStatus(change: Partial<StorageStatus>) {
  status = { ...status, ...change };
  for (const callback of listeners) callback();
}
export async function localRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`/local-api/v1/user${path}`, {
      ...init,
      cache: "no-store",
      signal: init.signal ?? AbortSignal.timeout(60000),
      headers: {
        "X-SolveMate-Client": "web",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch (error) {
    publishStorageStatus({ online: false });
    logError("Failed to connect to local storage.", error);
    throw new LocalServiceError(
      "无法连接本机服务，请使用 npm start 启动 SolveMate 后重试。",
      "unavailable",
    );
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      detail?: unknown;
      code?: string;
    };
    if (response.status >= 500) publishStorageStatus({ online: false });
    const failure = new LocalServiceError(
      typeof body.detail === "string"
        ? body.detail
        : "本机服务未能完成请求，原有数据已保留。",
      body.code ?? "request_failed",
      response.status,
    );
    if (init.method && init.method !== "GET") {
      if (path.startsWith("/content"))
        dataRefresh.recover(failure, ["content"]);
    }
    throw failure;
  }
  publishStorageStatus({ online: true });
  return response;
}
export function envelope(value: unknown): StateEnvelope {
  const item = value as StateEnvelope;
  if (
    !item ||
    typeof item.storeId !== "string" ||
    !Number.isSafeInteger(item.revision) ||
    item.revision < 0
  )
    throw new LocalServiceError(
      "本机服务返回的记录格式不正确，请确认网页与本机服务版本一致。",
      "invalid_response",
      422,
    );
  try {
    if (item.value !== null) assertAppData(item.value);
  } catch {
    throw new LocalServiceError(
      "本机学习记录未通过校验，原数据已保留，请检查备份或使用对应版本打开。",
      "invalid_response",
      422,
    );
  }
  return item;
}
export function toBase64(bytes: Uint8Array): string {
  let result = "";
  for (let i = 0; i < bytes.length; i += 16384)
    result += String.fromCharCode(...bytes.subarray(i, i + 16384));
  return btoa(result);
}
export function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}
export async function remember(key: string, value: unknown) {
  try {
    await userCache.put(key, value);
  } catch (error) {
    logError("Failed to cache local records.", error);
    publishStorageStatus({
      warning: "数据已保存在 user 目录，但浏览器缓存未能更新。",
    });
  }
}
