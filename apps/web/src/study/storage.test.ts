import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { userCache } from "../storage/local-client";
import { StudyStore, mergeStudyIntervals } from "./storage";
import type { StudyInterval, StudySummary } from "@solvemate/contracts";
const span = { startMs: 1_700_000_000_000, endMs: 1_700_000_060_000 };
let failed = false,
  lostResponse = false,
  storeId = "test-store",
  requests: StudyInterval[][] = [],
  server: StudyInterval[] = [];
beforeEach(async () => {
  await userCache.records.clear();
  failed = false;
  lostResponse = false;
  storeId = "test-store";
  requests = [];
  server = [];
  await userCache.put("state", { storeId: "test-store" });
  vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
    if (failed) throw new Error("offline");
    if (init?.method === "POST") {
      const body = JSON.parse(String(init.body));
      requests.push(body.intervals);
      if (body.expectedStoreId !== storeId)
        return new Response(
          JSON.stringify({ detail: "changed", code: "store_changed" }),
          { status: 409 },
        );
      server = mergeStudyIntervals([...server, ...body.intervals]);
      if (lostResponse) {
        lostResponse = false;
        throw new Error("response lost");
      }
    }
    const summary: StudySummary = {
      storeId,
      today: "2026-11-13",
      days: server.length
        ? [
            {
              date: "2026-11-13",
              milliseconds: server.reduce(
                (sum, i) => sum + i.endMs - i.startMs,
                0,
              ),
            },
          ]
        : [],
    };
    return new Response(JSON.stringify(summary));
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  vi.restoreAllMocks();
  await userCache.records.clear();
});
describe("study persistence", () => {
  it("saves only the compact time intervals and keeps a retry idempotent after a lost response", async () => {
    const store = new StudyStore();
    await store.start();
    lostResponse = true;
    await store.enqueue([span]);
    expect(store.snapshot().error).not.toBe("");
    expect(
      await userCache.records
        .where("key")
        .startsWith("study:pending:")
        .toArray(),
    ).toHaveLength(1);
    await store.retry();
    expect(store.snapshot().summary?.days[0].milliseconds).toBe(60_000);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(requests[1]);
    expect(
      await userCache.records.where("key").startsWith("study:pending:").count(),
    ).toBe(0);
  });
  it("restores unconfirmed intervals after reopening without losing them while offline", async () => {
    const first = new StudyStore();
    await first.start();
    failed = true;
    await first.enqueue([span]);
    const second = new StudyStore();
    await second.start();
    expect(second.snapshot().error).not.toBe("");
    failed = false;
    await second.retry();
    expect(second.snapshot().summary?.days[0].milliseconds).toBe(60_000);
    expect(
      await userCache.records.where("key").startsWith("study:pending:").count(),
    ).toBe(0);
  });
  it("coalesces adjacent or overlapping windows and limits each submitted span to one day", () => {
    expect(
      mergeStudyIntervals([
        span,
        { startMs: span.startMs + 30_000, endMs: span.endMs + 30_000 },
      ]),
    ).toEqual([{ startMs: span.startMs, endMs: span.endMs + 30_000 }]);
    expect(
      mergeStudyIntervals([{ startMs: 0, endMs: 2 * 86_400_000 + 10 }]).map(
        (i) => i.endMs - i.startMs,
      ),
    ).toEqual([86_400_000, 86_400_000, 10]);
  });
  it("keeps old-directory backups without writing them into the currently opened directory", async () => {
    await userCache.put("study:pending:old", {
      storeId: "old-store",
      intervals: [span],
    });
    const store = new StudyStore();
    await store.start();
    expect(requests).toHaveLength(0);
    expect(await userCache.get("study:pending:old")).toBeDefined();
  });
  it("reads the live summary even when a previous directory is present in the cache", async () => {
    await userCache.put("state", { storeId: "previous-store" });
    const store = new StudyStore();
    await store.start();
    expect(store.snapshot().summary?.storeId).toBe("test-store");

    failed = true;
    await store.enqueue([span]);
    failed = false;
    storeId = "current-store";
    await store.refresh();
    expect(store.snapshot()).toMatchObject({
      summary: { storeId: "current-store" },
      error: "",
    });
    expect(requests).toEqual([]);
    expect(
      (
        await userCache.records
          .where("key")
          .startsWith("study:pending:")
          .toArray()
      ).map((row) => row.value),
    ).toEqual([{ storeId: "test-store", intervals: [span] }]);
    await store.enqueue([span]);
    expect(requests).toEqual([[span]]);
  });
  it("does not remove another window's newer pending data", async () => {
    const key = "study:pending:other";
    await userCache.put(key, { storeId: "test-store", intervals: [span] });
    const original = vi.mocked(globalThis.fetch).getMockImplementation()!;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
      if (init?.method === "POST")
        await userCache.put(key, {
          storeId: "test-store",
          intervals: [{ startMs: span.startMs, endMs: span.endMs + 60_000 }],
        });
      return original(url, init);
    });
    const store = new StudyStore();
    await store.start();
    expect(await userCache.get(key)).toMatchObject({
      intervals: [{ endMs: span.endMs + 60_000 }],
    });
  });
});
