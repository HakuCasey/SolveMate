import Dexie, { type Table } from "dexie";
import type { AppData } from "@solvemate/contracts";
import { migrateAiMetadata } from "../data/migrate-ai-metadata";
import { assertAppData } from "../data/validation";
import { DataRequestError } from "../refresh/errors";

export interface UnsavedRecord {
  id: string;
  createdAt: number;
  base: AppData;
  value: AppData;
}

export interface AppStorage {
  load(): Promise<AppData | null>;
  save(data: AppData): Promise<void>;
  refresh?(): Promise<AppData | null>;
  preserve?(record: UnsavedRecord): Promise<void>;
  recoveries?(): Promise<UnsavedRecord[]>;
  forget?(id: string): Promise<void>;
}

export interface SavedState {
  id: "main";
  value: AppData;
  revision?: number;
  legacyBackup?: unknown;
  metadataBackups?: Record<string, unknown>;
}

export class LocalDataConflictError extends DataRequestError {
  constructor() {
    super(
      "其他窗口已更新记录，本页更改尚未保存，请刷新后核对。",
      "revision_conflict",
      409,
    );
    this.name = "LocalDataConflictError";
  }
}

function getRevision(saved: SavedState): number {
  // 早期记录没有 revision，首次成功保存时补上版本号。
  const revision = saved.revision ?? 0;
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("Local data has an invalid revision.");
  }
  return revision;
}

class LocalDatabase extends Dexie {
  state!: Table<SavedState, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({ state: "id" });
  }
}

/** 每次在一个事务内保存完整状态；写入失败时 IndexedDB 保留上一次成功的数据。 */
export class DexieStorage implements AppStorage {
  private readonly database: LocalDatabase;
  private writeQueue: Promise<void> = Promise.resolve();
  private loadedRevision: number | null | undefined;

  constructor(databaseName = "solvemate-local") {
    this.database = new LocalDatabase(databaseName);
  }

  async load(): Promise<AppData | null> {
    // 读取等待已提交的保存操作，失败的保存不妨碍读取旧数据。
    await this.writeQueue.catch(() => undefined);
    try {
      return await this.database.transaction(
        "rw",
        this.database.state,
        async () => {
          const saved = await this.database.state.get("main");
          if (!saved) {
            this.loadedRevision = null;
            return null;
          }
          const migrated = migrateAiMetadata(saved.value);
          const revision = getRevision(saved);
          if (migrated !== saved.value) {
            // 备份与升级在同一事务内，失败时保留原值，重复打开不会再次迁移。
            await this.database.state.put({
              ...saved,
              legacyBackup: saved.legacyBackup ?? saved.value,
              metadataBackups: {
                ...saved.metadataBackups,
                [saved.value.schemaVersion]: saved.value,
              },
              value: migrated,
              revision: revision + 1,
            });
            this.loadedRevision = revision + 1;
          } else this.loadedRevision = revision;
          return migrated;
        },
      );
    } catch (error) {
      console.error(
        "[storage] Failed to load local data.",
        error instanceof Error ? error.name : "UnknownError",
      );
      throw error;
    }
  }

  save(data: AppData): Promise<void> {
    assertAppData(data);
    // 立即复制本次值，避免等待写入期间页面修改同一个对象。
    const snapshot = structuredClone(data);
    const write = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        try {
          const revision = await this.database.transaction(
            "rw",
            this.database.state,
            async () => {
              const saved = await this.database.state.get("main");
              const currentRevision = saved ? getRevision(saved) : null;

              // 在同一事务中核对版本，防止另一个标签页的旧快照覆盖较新的会话。
              if (
                this.loadedRevision === undefined
                  ? saved !== undefined
                  : this.loadedRevision !== currentRevision
              ) {
                throw new LocalDataConflictError();
              }

              const nextRevision = (currentRevision ?? 0) + 1;
              await this.database.state.put({
                id: "main",
                value: snapshot,
                revision: nextRevision,
                ...(saved?.metadataBackups
                  ? { metadataBackups: saved.metadataBackups }
                  : {}),
                ...(saved?.legacyBackup
                  ? { legacyBackup: saved.legacyBackup }
                  : {}),
              });
              return nextRevision;
            },
          );
          this.loadedRevision = revision;
        } catch (error) {
          console.error(
            "[storage] Failed to save local data.",
            error instanceof Error ? error.name : "UnknownError",
          );
          throw error;
        }
      });
    this.writeQueue = write;
    return write;
  }

  close(): void {
    this.database.close();
  }

  /** 迁移读取原始信封，包含历次备份；不修改旧数据库。 */
  rawRecord(): Promise<SavedState | undefined> {
    return this.database.state.get("main");
  }
}
