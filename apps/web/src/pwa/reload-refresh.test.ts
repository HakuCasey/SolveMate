import { describe, expect, it, vi } from "vitest";
import { refreshAfterApplicationUpdate } from "./reload-refresh";

describe("application update data refresh", () => {
  it("waits for the initial records read before refreshing the remaining data", async () => {
    const retryRead = vi.fn(async () => {});
    const refresh = vi.fn(async () => {});
    expect(
      await refreshAfterApplicationUpdate({
        loadState: "loading",
        retryRead,
        refresh,
      }),
    ).toBe(false);
    expect(retryRead).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("refreshes all registered data after records have loaded", async () => {
    const retryRead = vi.fn(async () => {});
    const refresh = vi.fn(async () => {});
    expect(
      await refreshAfterApplicationUpdate({
        loadState: "ready",
        retryRead,
        refresh,
      }),
    ).toBe(true);
    expect(retryRead).not.toHaveBeenCalled();
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("retries a transient records failure before refreshing other data", async () => {
    const order: string[] = [];
    await refreshAfterApplicationUpdate({
      loadState: "error",
      retryRead: async () => {
        order.push("records");
      },
      refresh: async () => {
        order.push("all");
      },
    });
    expect(order).toEqual(["records", "all"]);
  });

  it("does not hide a records failure when the automatic retry still fails", async () => {
    const refresh = vi.fn(async () => {});
    await expect(
      refreshAfterApplicationUpdate({
        loadState: "error",
        retryRead: async () => {
          throw new Error("invalid records");
        },
        refresh,
      }),
    ).rejects.toThrow("invalid records");
    expect(refresh).not.toHaveBeenCalled();
  });
});
