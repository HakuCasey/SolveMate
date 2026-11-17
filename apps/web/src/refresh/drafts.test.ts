import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UnsavedFormStore, removeStoredFormDrafts } from "./drafts";
import { userCache } from "../storage/local-client";

beforeEach(async () => {
  vi.restoreAllMocks();
  await userCache.records.clear();
});

describe("unsaved form tracking", () => {
  it("counts open edits without storing their content", async () => {
    const store = new UnsavedFormStore();
    store.set("ai-settings:one", true);
    store.set("ai-settings:one", true);
    store.set("note-editor:two", true);
    expect(store.snapshot().activeCount).toBe(2);
    store.clear("ai-settings:one");
    expect(store.snapshot().activeCount).toBe(1);
    store.set("note-editor:two", false);
    expect(store.snapshot().activeCount).toBe(0);
    expect(await userCache.records.count()).toBe(0);
  });

  it("removes only obsolete form copies and can run repeatedly", async () => {
    await userCache.put("form-draft:ai-settings:dsh:old", { model: "old" });
    await userCache.put("form-draft:ai-settings:dsh:another", { model: "old" });
    await userCache.put("form-draft:note:old", { title: "old" });
    await userCache.put("state", { drafts: { conversation: "待提问内容" } });
    await userCache.put("recovery:failed-save", { title: "未完成的提交" });
    expect(await removeStoredFormDrafts()).toBe(3);
    expect(await removeStoredFormDrafts()).toBe(0);
    expect(await userCache.records.toArray()).toEqual([
      { key: "recovery:failed-save", value: { title: "未完成的提交" } },
      { key: "state", value: { drafts: { conversation: "待提问内容" } } },
    ]);
  });

  it("allows another cleanup attempt after a storage failure", async () => {
    await userCache.put("form-draft:old", { model: "old" });
    vi.spyOn(userCache.records, "where").mockImplementationOnce(() => {
      throw new Error("Storage unavailable");
    });
    await expect(removeStoredFormDrafts()).rejects.toThrow(
      "Storage unavailable",
    );
    expect(await removeStoredFormDrafts()).toBe(1);
  });
});
