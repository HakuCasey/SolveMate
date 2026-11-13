import type { StudyInterval, StudySummary } from "@solvemate/contracts";
import { localRequest, userCache } from "../storage/local-client";
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
  private lastRead = 0;
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
      this.storeId =
        (await userCache.get<{ storeId: string }>("state"))?.storeId ?? "";
      const cached = await userCache.get<StudySummary>("study:summary");
      if (cached && (!this.storeId || cached.storeId === this.storeId)) {
        try {
          const summary = decode(cached);
          this.storeId = summary.storeId;
          this.publish({ summary });
        } catch (error) {
          logError("Ignored invalid cached study summary.", error);
        }
      }
      const rows = await userCache.records
        .where("key")
        .startsWith(prefix)
        .toArray();
      for (const row of rows) {
        const record = row.value as Pending;
        if (
          !record ||
          typeof record.storeId !== "string" ||
          !Array.isArray(record.intervals) ||
          record.intervals.some(
            (span) =>
              !Number.isSafeInteger(span.startMs) ||
              !Number.isSafeInteger(span.endMs) ||
              span.endMs <= span.startMs,
          )
        ) {
          throw new Error(
            "未保存的学习时间段格式不正确，缓存仍保留，请核对后重试。",
          );
        }
        if (this.storeId && record.storeId !== this.storeId) continue;
        this.recovered.set(row.key, record);
      }
      await this.synchronize();
    } catch (error) {
      this.failure(error);
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
  private async synchronize() {
    let fetched: StudySummary | undefined;
    if (!this.storeId) {
      const summary = decode(await (await localRequest("/study")).json());
      fetched = summary;
      this.storeId = summary.storeId;
      this.publish({ summary });
    }
    const all = [...this.recovered.values()];
    if (all.some((record) => record.storeId !== this.storeId))
      throw new Error(
        "本机数据目录已变化，未提交的计时记录仍保留在浏览器，请核对数据目录。",
      );
    const intervals = mergeStudyIntervals([
      ...this.pending,
      ...all.flatMap((record) => record.intervals),
    ]);
    let summary: StudySummary;
    if (intervals.length) {
      const batch = intervals.slice(0, 128);
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
      if (summary.storeId !== this.storeId)
        throw new Error("本机数据目录已变化，请重新打开应用。");
      // 成功响应后才清缓存；其他窗口已更新的缓存不能被这次旧提交删除。
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
    } else
      summary = fetched ?? decode(await (await localRequest("/study")).json());
    if (summary.storeId !== this.storeId)
      throw new Error("本机数据目录已变化，请重新打开应用。");
    await userCache.put("study:summary", summary);
    this.lastRead = Date.now();
    this.publish({ summary, error: "" });
  }
  enqueue = (intervals: StudyInterval[]) => {
    const task = this.queue
      .catch(() => undefined)
      .then(async () => {
        await this.start();
        this.pending = mergeStudyIntervals([...this.pending, ...intervals]);
        await this.cachePending();
        await this.synchronize();
      })
      .catch((error) => this.failure(error));
    this.queue = task;
    return task;
  };
  refresh = (): Promise<unknown> => {
    if (this.refreshPromise) return this.refreshPromise;
    if (
      !this.state.error &&
      !this.pending.length &&
      !this.recovered.size &&
      Date.now() - this.lastRead < 5000
    )
      return this.queue;
    const task = this.enqueue([])
      .then(() => {
        if (this.state.error) throw new Error(this.state.error);
      })
      .finally(() => {
        if (this.refreshPromise === task) this.refreshPromise = undefined;
      });
    this.refreshPromise = task;
    return task;
  };
}
