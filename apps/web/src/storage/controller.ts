import type { AppData } from "@solvemate/contracts";
import type { AppStorage } from "./index";
import { LocalDataConflictError } from "./index";
import { logError } from "../logger";

type Change = AppData | null | ((previous: AppData | null) => AppData | null);
interface Snapshot {
  data: AppData | null;
  loadFailed: boolean;
  saveState: "saving" | "saved" | "error";
  conflict: boolean;
}

/** 所有页面共用写入顺序；配置事务完成前，推送结果排队等待，避免互相覆盖。 */
export class LocalDataController {
  private state: Snapshot = {
    data: null,
    loadFailed: false,
    saveState: "saved",
    conflict: false,
  };
  private listeners = new Set<() => void>();
  private lastWrite: Promise<void> = Promise.resolve();
  private generation = 0;
  private locked = false;
  private deferred: Change[] = [];
  constructor(private readonly storage: AppStorage) {}
  snapshot = () => this.state;
  subscribe = (callback: () => void) => {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  };
  private publish(change: Partial<Snapshot>) {
    this.state = { ...this.state, ...change };
    for (const callback of this.listeners) callback();
  }
  initialize = (data: AppData) => this.publish({ data });
  failLoad = () => this.publish({ loadFailed: true });
  private persist(data: AppData) {
    const generation = ++this.generation;
    this.publish({ saveState: "saving" });
    const result = this.storage
      .save(data)
      .then(() => {
        if (generation === this.generation)
          this.publish({ saveState: "saved", conflict: false });
      })
      .catch((error: unknown) => {
        if (generation === this.generation)
          this.publish({
            saveState: "error",
            conflict: error instanceof LocalDataConflictError,
          });
        logError("Failed to save local learning data.", error);
        throw error;
      });
    this.lastWrite = result;
    return result;
  }
  update = (change: Change) => {
    if (this.locked) {
      this.deferred.push(change);
      return;
    }
    const next =
      typeof change === "function" ? change(this.state.data) : change;
    if (next === this.state.data) return;
    this.publish({ data: next });
    if (next) void this.persist(next).catch(() => undefined);
  };
  commit = async (change: (previous: AppData) => AppData): Promise<AppData> => {
    if (this.locked) throw new Error("正在保存另一项修改，请稍后重试。");
    this.locked = true;
    try {
      // 前次保存失败后允许用户明确重试；冲突仍由存储版本检查拒绝。
      await this.lastWrite.catch(() => undefined);
      if (!this.state.data) throw new Error("学习记录尚未读取完成。");
      const next = change(this.state.data);
      await this.persist(next);
      this.publish({ data: next });
      return next;
    } finally {
      this.locked = false;
      for (const change of this.deferred.splice(0)) this.update(change);
    }
  };
  retry = () => {
    if (this.state.data)
      void this.persist(this.state.data).catch(() => undefined);
  };
}
