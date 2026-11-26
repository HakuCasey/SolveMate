import type { StudyInterval, StudySummary } from "@solvemate/contracts";
import {
  LocalServiceError,
  localRequest,
  userCache,
} from "../storage/local-client";
import { logError } from "../logger";

const prefix = "study:pending:";
interface Pending {
  storeId: string;
  intervals: StudyInterval[];
}
export interface StudySnapshot {
  summary: StudySummary | null;
  error: string;
}
export function mergeStudyIntervals(intervals: StudyInterval[]) {
  const result: StudyInterval[] = [];
  for (const interval of intervals.toSorted((a, b) => a.startMs - b.startMs)) {
    const last = result.at(-1);
    if (last && interval.startMs <= last.endMs)
      last.endMs = Math.max(last.endMs, interval.endMs);
    else result.push({ ...interval });
  }
  // 离线时间段可能连续超过一天；请求按一天分段，保持校验和请求体都有上限。
  return result.flatMap((interval) => {
    const parts: StudyInterval[] = [];
    for (
      let start = interval.startMs;
      start < interval.endMs;
      start += 86_400_000
    )
      parts.push({
        startMs: start,
        endMs: Math.min(start + 86_400_000, interval.endMs),
      });
    return parts;
  });
}
function decode(value: unknown): StudySummary {
  const item = value as StudySummary;
  if (
    !item ||
    typeof item.storeId !== "string" ||
    !/^\d{4}-\d\d-\d\d$/.test(item.today) ||
    !Array.isArray(item.days) ||
    item.days.some(
      (day) =>
        !/^\d{4}-\d\d-\d\d$/.test(day.date) ||
        !Number.isSafeInteger(day.milliseconds) ||
        day.milliseconds < 0,
    )
  )
    throw new Error("学习统计格式不正确，请更新应用后重试。");
  return item;
}

/** 只写学习时间段；不提交 AppData，也不让计时更新触发整个工作区重绘。 */
export class StudyStore {
  private state: StudySnapshot = { summary: null, error: "" };
  private listeners = new Set<() => void>();
  private key = prefix + crypto.randomUUID();
  private queue: Promise<unknown> = Promise.resolve();
  private initialized?: Promise<void>;
  private storeId = "";
  private pending: StudyInterval[] = [];
  private recovered = new Map<string, Pending>();
  private refreshPromise?: Promise<unknown>;
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(change: Partial<StudySnapshot>) {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }
  start = () => (this.initialized ??= this.initialize());
  private async initialize() {
    try {
      await this.readCurrent();
      await this.flushPending();
    } catch (error) {
      if (!this.state.summary) {
        try {
          const cached = await userCache.get<StudySummary>("study:summary");
          if (cached) {
            const summary = decode(cached);
            await this.selectStore(summary.storeId);
            this.publish({ summary });
          }
        } catch (cacheError) {
          logError("Failed to read cached study time.", cacheError);
        }
      }
      this.failure(error);
    }
  }
  private async selectStore(storeId: string) {
    if (this.storeId === storeId) return;
    // 已记录的时间段留在原数据所属的缓存里。
    if (this.storeId) {
      this.key = prefix + crypto.randomUUID();
      this.pending = [];
    }
    this.storeId = storeId;
    this.recovered.clear();
    try {
      const rows = await userCache.records
        .where("key")
        .startsWith(prefix)
        .toArray();
      for (const row of rows) {
        const record = row.value as Pending;
        if (record?.storeId !== storeId) continue;
        if (
          !Array.isArray(record.intervals) ||
          record.intervals.some(
            (span) =>
              !Number.isSafeInteger(span.startMs) ||
              !Number.isSafeInteger(span.endMs) ||
              span.endMs <= span.startMs,
          )
        ) {
          logError(
            "Ignored invalid pending study intervals.",
            new TypeError("Invalid intervals"),
          );
          continue;
        }
        this.recovered.set(row.key, record);
      }
    } catch (error) {
      logError("Failed to read pending study intervals.", error);
    }
  }
  private failure(error: unknown) {
    logError("Failed to save or read study time.", error);
    this.publish({
      error:
        error instanceof Error ? error.message : "学习时长未能保存，请重试。",
    });
  }
  private async cachePending() {
    if (this.pending.length)
      await userCache.put(this.key, {
        storeId: this.storeId,
        intervals: this.pending,
      });
    else await userCache.records.delete(this.key);
  }
  private async acceptSummary(summary: StudySummary) {
    await this.selectStore(summary.storeId);
    this.publish({ summary, error: "" });
    await userCache
      .put("study:summary", summary)
      .catch((error: unknown) =>
        logError("Failed to cache the study summary.", error),
      );
  }
  private async readCurrent() {
    const summary = decode(await (await localRequest("/study")).json());
    await this.acceptSummary(summary);
    return summary;
  }
  private async flushPending() {
    if (!this.storeId) await this.readCurrent();
    const intervals = mergeStudyIntervals([
      ...this.pending,
      ...[...this.recovered.values()].flatMap((record) => record.intervals),
    ]);
    if (!intervals.length) return;
    const batch = intervals.slice(0, 128);
    let summary: StudySummary;
    try {
      summary = decode(
        await (
          await localRequest("/study", {
            method: "POST",
            keepalive: true,
            body: JSON.stringify({
              expectedStoreId: this.storeId,
              intervals: batch,
            }),
          })
        ).json(),
      );
    } catch (error) {
      if (
        !(error instanceof LocalServiceError) ||
        error.code !== "store_changed"
      )
        throw error;
      const previous = this.storeId;
      if ((await this.readCurrent()).storeId === previous) throw error;
      return;
    }
    if (summary.storeId === this.storeId) {
      // 只清理已确认的时间段；保留其他窗口刚更新的缓存。
      await userCache.transaction("rw", userCache.records, async () => {
        for (const [key, value] of this.recovered) {
          const current = await userCache.get<Pending>(key);
          if (JSON.stringify(current) === JSON.stringify(value))
            await userCache.records.delete(key);
        }
        this.recovered.clear();
        this.pending = intervals.slice(batch.length);
        await this.cachePending();
      });
    }
    await this.acceptSummary(summary);
  }
  private run(action: () => Promise<void>) {
    const task = this.queue
      .catch(() => undefined)
      .then(async () => {
        await this.start();
        await action();
      });
    this.queue = task.catch((error: unknown) => this.failure(error));
    return task;
  }
  enqueue = (intervals: StudyInterval[]) =>
    this.run(async () => {
      this.pending = mergeStudyIntervals([...this.pending, ...intervals]);
      await this.cachePending();
      await this.flushPending();
    }).catch(() => undefined);
  retry = () =>
    this.run(async () => {
      await this.readCurrent();
      await this.flushPending();
    });
  refresh = (): Promise<unknown> => {
    if (this.refreshPromise) return this.refreshPromise;
    const task = this.run(async () => {
      await this.readCurrent();
    }).finally(() => {
      if (this.refreshPromise === task) this.refreshPromise = undefined;
    });
    this.refreshPromise = task;
    return task;
  };
}
