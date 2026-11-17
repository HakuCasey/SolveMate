import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  localRequest,
  publishStorageStatus,
  userStorageStatus,
} from "./local-client";

afterEach(() => {
  vi.unstubAllGlobals();
  publishStorageStatus({ online: true, warning: "", loadFailure: null });
});

describe("local storage service availability", () => {
  it("explains an empty proxy failure and recovers after the service starts", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ revision: 1 })));
    vi.stubGlobal("fetch", fetcher);
    await expect(localRequest("/state")).rejects.toMatchObject({
      code: "unavailable",
      message: expect.stringContaining("npm start"),
    });
    expect(userStorageStatus.snapshot().online).toBe(false);
    expect(await (await localRequest("/state")).json()).toEqual({
      revision: 1,
    });
    expect(userStorageStatus.snapshot().online).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("preserves a reachable service's storage error instead of treating it as disconnected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            code: "local_storage_failed",
            detail: "磁盘空间不足，请清理后重新读取。",
          }),
          { status: 503 },
        ),
      ),
    );
    await expect(localRequest("/state")).rejects.toMatchObject({
      code: "local_storage_failed",
      message: "磁盘空间不足，请清理后重新读取。",
    });
    expect(userStorageStatus.snapshot().online).toBe(true);
  });
});
