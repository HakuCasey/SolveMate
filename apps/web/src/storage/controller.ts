import { migrateNoteMetadata } from "@solvemate/contracts";
import type { AppData } from "@solvemate/contracts";
import type { AppStorage, UnsavedRecord } from "./index";
import { logError } from "../logger";
import { dataRefresh } from "../refresh/coordinator";
import { isStaleData } from "../refresh/errors";
import {
  dataEqual,
  mergeData,
  resolveDataConflict,
  pendingConflicts,
  type DataConflict,
} from "../refresh/merge";

type Change = AppData | null | ((previous: AppData | null) => AppData | null);
interface Snapshot {
  data: AppData | null;
  loadState: "loading" | "ready" | "error";
  loadFailure: unknown | null;
  saveState: "saving" | "saved" | "error";
  conflict: boolean;
  refreshError: string;
  saveError: string;
  conflicts: DataConflict[];
  recoveries: UnsavedRecord[];
}

/** 保存与刷新共用顺序；刷新基线与工作副本分开，未确认的内容另外保留。 */
export class LocalDataController {
  private state: Snapshot = {
    data: null,
    loadState: "loading",
    loadFailure: null,
    saveState: "saved",
    conflict: false,
    refreshError: "",
    saveError: "",
    conflicts: [],
    recoveries: [],
  };
  private base: AppData | null = null;
  private listeners = new Set<() => void>();
  private lastWrite: Promise<void> = Promise.resolve();
  private generation = 0;
  private locked = false;
  private deferred: Change[] = [];
  private refreshPromise?: Promise<void>;
  private refreshWanted = false;
  private recoveryId = crypto.randomUUID();
  private restoringRecoveryId: string | null = null;
  private temporaryBase: AppData | null = null;
  constructor(
    private readonly storage: AppStorage,
    fallback?: AppData,
  ) {
    if (fallback) {
      this.state.data = fallback;
      this.temporaryBase = structuredClone(fallback);
    }
  }
  snapshot = () => this.state;
  readData = () => this.state.data;
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
  initialize = (data: AppData) => {
    this.base = structuredClone(data);
    this.publish({
      data,
      loadState: "ready",
      loadFailure: null,
      refreshError: "",
    });
  };
  restoreRecoveries = async () => {
    if (this.storage.recoveries)
      this.publish({ recoveries: await this.storage.recoveries() });
  };
  failLoad = (error: unknown) =>
    this.publish({ loadState: "error", loadFailure: error });
  private async retain(value: AppData, id = this.recoveryId) {
    const base = this.base ?? this.temporaryBase;
    if (!base) return;
    const record: UnsavedRecord = {
      id,
      createdAt: Date.now(),
      base: structuredClone(base),
      value: structuredClone(value),
    };
    // 本窗口持续收到的回复更新同一份保留记录，不为每个文本片段增加一份备份。
    this.publish({
      recoveries: [
        record,
        ...this.state.recoveries.filter((item) => item.id !== record.id),
      ],
    });
    try {
      await this.storage.preserve?.(record);
    } catch (error) {
      this.publish({
        refreshError:
          "未保存内容仍在当前窗口，但浏览器未能备份；请保留页面并导出内容。",
      });
      throw error;
    }
  }
  private requestRefresh(error: unknown) {
    if (!isStaleData(error)) return;
    if (this.locked) this.refreshWanted = true;
    else dataRefresh.recover(error, ["records"]);
  }
  private persist(data: AppData, transactional = false) {
    if (!this.base)
      return Promise.reject(
        new Error("原记录尚未读取成功，输入已保留。请在“记录保存”中重新读取。"),
      );
    const generation = ++this.generation;
    // 未发布的配置提交独立保留，后续回复或阅读进度不能覆盖这份候选内容。
    const backupId = transactional ? crypto.randomUUID() : this.recoveryId;
    this.publish({ saveState: "saving" });
    const result = Promise.resolve()
      .then(() => this.storage.save(data))
      .then(() => {
        this.base = structuredClone(data);
        if (this.restoringRecoveryId && !this.state.conflicts.length) {
          const restored = this.restoringRecoveryId;
          this.restoringRecoveryId = null;
          this.publish({
            recoveries: this.state.recoveries.filter(
              (item) => item.id !== restored,
            ),
          });
          void this.storage
            .forget?.(restored)
            .catch((error) =>
              logError("Failed to remove a saved recovery snapshot.", error),
            );
        }
        if (this.state.recoveries.some((item) => item.id === this.recoveryId))
          this.recoveryId = crypto.randomUUID();
        if (generation === this.generation)
          this.publish({ saveState: "saved", conflict: false, saveError: "" });
      })
      .catch(async (error: unknown) => {
        try {
          await this.retain(data, backupId);
        } catch (failure) {
          logError("Failed to retain unconfirmed local changes.", failure);
          this.publish({
            refreshError:
              "未保存内容仍在当前窗口，但浏览器未能备份；请保留页面并导出内容。",
          });
        }
        if (generation === this.generation)
          this.publish({
            saveState: "error",
            conflict: isStaleData(error),
            saveError:
              error instanceof Error
                ? error.message
                : "本次更改尚未保存，请重试。",
          });
        this.requestRefresh(error);
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
    if (!next) return;
    if (!this.base) {
      void this.retain(next).catch((error: unknown) =>
        logError("Failed to retain changes before records loaded.", error),
      );
      return;
    }
    if (this.state.conflict || this.state.conflicts.length) {
      void this.retain(next).catch((error: unknown) =>
        logError("Failed to retain pending changes.", error),
      );
      return;
    }
    void this.persist(next).catch(() => undefined);
  };
  commit = async (change: (previous: AppData) => AppData): Promise<AppData> => {
    if (this.refreshPromise) await this.refreshPromise;
    if (this.locked) throw new Error("正在保存另一项修改，请稍后重试。");
    if (this.state.conflicts.length)
      throw new Error("有尚未确认的修改冲突，请先在“未保存内容”中核对。");
    this.locked = true;
    try {
      await this.lastWrite.catch(() => undefined);
      if (!this.state.data) throw new Error("学习记录尚未读取完成。");
      const next = change(this.state.data);
      if (!this.base) {
        await this.retain(next);
        throw new Error(
          "原记录尚未读取成功，输入已保留。请在“记录保存”中重新读取。",
        );
      }
      await this.persist(next, true);
      this.publish({ data: next });
      return next;
    } catch (error) {
      this.requestRefresh(error);
      throw error;
    } finally {
      this.unlock();
    }
  };
  private unlock() {
    this.locked = false;
    for (const change of this.deferred.splice(0)) this.update(change);
    if (this.refreshWanted) {
      this.refreshWanted = false;
      void dataRefresh.refresh(["records"], true);
    }
  }
  /** 只恢复失败记录相对原基线的修改；与当前记录冲突时交给现有核对流程。 */
  restoreRecovery = async (id: string): Promise<boolean> => {
    if (this.locked) throw new Error("正在保存其他修改，请稍后重试。");
    if (this.state.conflicts.length) throw new Error("请先处理当前修改冲突。");
    await this.refresh();
    if (this.locked || this.state.conflicts.length)
      throw new Error("记录已变化，请先处理当前修改冲突。");
    const record = this.state.recoveries.find((item) => item.id === id);
    if (!record || !this.state.data)
      throw new Error("未找到这份记录，请重新打开后查看。");
    this.locked = true;
    try {
      const current = this.state.data;
      const result = mergeData(
        migrateNoteMetadata(record.base),
        migrateNoteMetadata(record.value),
        current,
      );
      const restored = {
        ...result.data,
        selection: current.selection,
        materialSelection: current.materialSelection,
      };
      this.restoringRecoveryId = id;
      if (result.conflicts.length) {
        this.publish({
          data: restored,
          conflicts: result.conflicts,
          conflict: true,
          saveState: "error",
          saveError: "备份与当前记录存在修改冲突，请选择要保留的内容。",
        });
        return false;
      }
      await this.persist(restored, true);
      this.publish({ data: restored });
      return true;
    } catch (error) {
      // 恢复未成功时，后续无关保存不能把这份备份误当作已恢复而移除。
      this.restoringRecoveryId = null;
      this.requestRefresh(error);
      throw error;
    } finally {
      this.unlock();
    }
  };
  retry = () => {
    if (!this.state.data || this.state.conflicts.length)
      return Promise.resolve();
    if (this.state.conflict) {
      return dataRefresh.refresh(["records"]).then(() => undefined);
    }
    return this.persist(this.state.data).catch(() => undefined);
  };
  resolve = (index: number, choice: "local" | "remote") => {
    const conflict = this.state.conflicts[index];
    if (
      !conflict ||
      !this.state.data ||
      (conflict.deleted && choice === "local")
    )
      return;
    const data = resolveDataConflict(this.state.data, conflict, choice);
    const conflicts = this.state.conflicts.filter(
      (_, current) => current !== index,
    );
    if (
      data.defaultRobotId &&
      !data.robots.some((robot) => robot.id === data.defaultRobotId)
    )
      data.defaultRobotId =
        this.base?.defaultRobotId &&
        data.robots.some((robot) => robot.id === this.base?.defaultRobotId)
          ? this.base.defaultRobotId
          : (data.robots[0]?.id ?? null);
    this.publish({
      data,
      conflicts,
      conflict: !!conflicts.length,
      saveState: dataEqual(data, this.base) ? "saved" : "error",
      saveError: conflicts.length
        ? "请核对剩余的修改冲突。"
        : dataEqual(data, this.base)
          ? ""
          : "本页修改已保留，确认后可点击“重试保存”。",
    });
  };
  refresh = (): Promise<void> => {
    if (this.refreshPromise) return this.refreshPromise;
    const task = (async () => {
      await this.lastWrite.catch(() => undefined);
      if (this.locked) {
        this.refreshWanted = true;
        return;
      }
      if (!this.state.data || !this.base) return;
      this.locked = true;
      try {
        const working = this.state.data;
        const dirty = !dataEqual(working, this.base);
        if (dirty) await this.retain(working);
        const latest = await (this.storage.refresh?.() ?? this.storage.load());
        if (!latest) throw new Error("本机记录暂不可读，当前内容仍保留。");
        const result = mergeData(this.base, working, latest);
        // 保留尚未解决的字段冲突；一次普通刷新不能把冲突解释成用户已确认。
        const conflicts = pendingConflicts(
          this.state.conflicts,
          result.conflicts,
          result.data,
          latest,
        );
        this.base = structuredClone(latest);
        const data = {
          ...result.data,
          selection: working.selection,
          materialSelection: working.materialSelection,
        };
        this.publish({
          data,
          conflicts,
          conflict: !!conflicts.length,
          refreshError: "",
          saveState: dataEqual(data, latest)
            ? "saved"
            : dirty
              ? "error"
              : "saved",
          saveError: conflicts.length
            ? "内容存在修改冲突，输入已保留，请在“未保存内容”中核对。"
            : dirty
              ? "最新记录已读取，本页修改已保留，请确认后重试保存。"
              : "",
        });
      } catch (error) {
        this.publish({
          refreshError:
            "无法读取最新记录，当前内容与未保存输入仍保留，请点击“刷新数据”重试。",
        });
        logError("Failed to refresh local records.", error);
        throw error;
      } finally {
        this.unlock();
      }
    })().finally(() => {
      if (this.refreshPromise === task) this.refreshPromise = undefined;
    });
    this.refreshPromise = task;
    return task;
  };
}
