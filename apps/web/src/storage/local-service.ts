import type { AppData } from "@solvemate/contracts";
import { assertAppData } from "../data/validation";
import { logError } from "../logger";
import {
  LocalDataConflictError,
  type AppStorage,
  type UnsavedRecord,
} from "./index";
import {
  userCache,
  writerId,
  userStorageStatus,
  publishStorageStatus,
  localRequest,
  LocalServiceError,
  envelope,
  remember,
  type StateEnvelope,
} from "./local-client";
import {
  ensureUserStorage,
  MigrationRequired,
  initialUserState,
} from "./migration";
export {
  userCache,
  UserCache,
  localRequest,
  LocalServiceError,
  userStorageStatus,
  remember,
  toBase64,
  fromBase64,
} from "./local-client";
export {
  ensureUserStorage,
  MigrationRequired,
  resolveMigration,
} from "./migration";

/** 页面保留现有存储接口；数据库版本由本机服务统一检查。 */
export class LocalAppStorage implements AppStorage {
  private revision = 0;
  private storeId = "";
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly pendingId: string = crypto.randomUUID()) {}
  async preserve(record: UnsavedRecord) {
    await userCache.put(`unsaved:${record.id}`, record);
  }
  async recoveries(): Promise<UnsavedRecord[]> {
    const rows = await userCache.records
      .where("key")
      .startsWith("unsaved:")
      .toArray();
    return rows.map((row) => row.value as UnsavedRecord);
  }
  async forget(id: string) {
    await userCache.records.delete(`unsaved:${id}`);
  }
  async refresh(): Promise<AppData | null> {
    await this.queue.catch(() => undefined);
    const saved = envelope(await (await localRequest("/state")).json());
    if (this.storeId && saved.storeId !== this.storeId)
      throw new LocalServiceError(
        "本机数据目录已变化，当前输入仍保留，请确认数据目录后再打开应用。",
        "store_changed",
        422,
      );
    this.revision = saved.revision;
    this.storeId = saved.storeId;
    await remember("state", saved);
    return saved.value;
  }
  async load(): Promise<AppData | null> {
    try {
      await ensureUserStorage(!userStorageStatus.snapshot().online);
    } catch (error) {
      if (error instanceof MigrationRequired)
        publishStorageStatus({
          warning: "发现尚未处理的浏览器记录，请重新打开页面选择要使用的数据。",
        });
      throw error;
    }
    await this.queue.catch(() => undefined);
    let saved: StateEnvelope;
    try {
      saved = envelope(await (await localRequest("/state")).json());
    } catch (error) {
      if (
        !(error instanceof LocalServiceError) ||
        (error.code !== "unavailable" && error.status < 500)
      )
        throw error;
      saved = envelope(
        (await userCache.get<StateEnvelope>("state")) ?? initialUserState(),
      );
      publishStorageStatus({ online: false });
    }
    this.revision = saved.revision;
    this.storeId = saved.storeId;
    await remember("state", saved);
    return saved.value;
  }
  save(value: AppData): Promise<void> {
    assertAppData(value);
    const copy = structuredClone(value);
    const task = this.queue
      .catch(() => undefined)
      .then(async () => {
        // 先保留未确认的修改。断网、冲突或刷新后仍可在下一次启动时恢复。
        await userCache.pending.put({
          id: this.pendingId,
          value: copy,
          updatedAt: Date.now(),
        });
        let saved: StateEnvelope;
        try {
          // 防止用户换了本机数据目录后，旧页面把另一套记录覆盖。
          const current = envelope(await (await localRequest("/state")).json());
          if (current.storeId !== this.storeId)
            throw new LocalDataConflictError();
          saved = envelope(
            await (
              await localRequest("/state", {
                method: "PUT",
                body: JSON.stringify({
                  value: copy,
                  expectedRevision: this.revision,
                  expectedStoreId: this.storeId,
                }),
              })
            ).json(),
          );
        } catch (error) {
          if (
            error instanceof LocalServiceError &&
            error.code === "revision_conflict"
          )
            throw new LocalDataConflictError();
          throw error;
        }
        this.revision = saved.revision;
        await remember("state", saved);
        await userCache.pending
          .delete(this.pendingId)
          .catch((error: unknown) =>
            logError("Failed to clear confirmed local changes.", error),
          );
      });
    this.queue = task;
    return task;
  }
}
export const appStorage = new LocalAppStorage(writerId);
