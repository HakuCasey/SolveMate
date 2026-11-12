import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FormDraftStore } from "./drafts";
import { userCache } from "../storage/local-client";
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release };
}
const draft = (id: string, value: string) => ({
  id,
  title: "保留输入",
  value,
  updatedAt: 1,
});
beforeEach(async () => {
  await userCache.records.clear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());
describe("unsaved form drafts", () => {
  it("retains orphaned form inputs across store instances", async () => {
    const first = new FormDraftStore();
    first.remember(draft("removed-note", "未保存名称"));
    await vi.waitFor(async () =>
      expect(await userCache.get("form-draft:removed-note")).toBeDefined(),
    );
    const reopened = new FormDraftStore();
    await reopened.restore();
    expect(reopened.snapshot().items[0].value).toBe("未保存名称");
  });
  it("serializes cancellation after a slow cache write", async () => {
    const pending = gate(),
      original = userCache.put.bind(userCache);
    vi.spyOn(userCache, "put").mockImplementationOnce(async (key, value) => {
      await pending.promise;
      await original(key, value);
    });
    const store = new FormDraftStore();
    store.remember(draft("rename", "暂存名称"));
    store.clear("rename");
    pending.release();
    await vi.waitFor(async () =>
      expect(await userCache.records.count()).toBe(0),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(await userCache.records.count()).toBe(0);
    expect(store.snapshot().items).toEqual([]);
  });
  it("does not overwrite active input with a late cache restore", async () => {
    await userCache.put("form-draft:edit", draft("edit", "旧值"));
    const pending = gate(),
      original = userCache.records.toArray.bind(userCache.records);
    // 缓存读取与用户输入交错，恢复后的旧值不能覆盖当前输入。
    const result = await original();
    vi.spyOn(userCache.records, "where").mockReturnValue({
      startsWith: () => ({
        toArray: async () => {
          await pending.promise;
          return result;
        },
      }),
    } as never);
    const store = new FormDraftStore(),
      restore = store.restore();
    store.remember(draft("edit", "新值"));
    pending.release();
    await restore;
    expect(store.snapshot().items).toEqual([draft("edit", "新值")]);
  });
  it("keeps the in-memory input and reports cache write failure", async () => {
    vi.spyOn(userCache, "put").mockRejectedValue(new Error("Quota"));
    const store = new FormDraftStore();
    store.remember(draft("edit", "重要内容"));
    await vi.waitFor(() =>
      expect(store.snapshot().error).toContain("草稿缓存未能写入"),
    );
    expect(store.snapshot().items[0].value).toBe("重要内容");
  });
});
