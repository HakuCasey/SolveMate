import { afterEach, expect, it, vi } from "vitest";
import { exportBackup, inspectBackup, restoreBackup } from "./client";

afterEach(() => vi.unstubAllGlobals());
it("saves a backup directly through the local service without uploading it twice", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      Response.json({ filename: "backup.zip", directory: "Downloads" }),
    );
  vi.stubGlobal("fetch", fetcher);
  expect(
    await exportBackup("backup.zip", null, new AbortController().signal),
  ).toEqual({ filename: "backup.zip", directory: "Downloads" });
  expect(fetcher).toHaveBeenCalledOnce();
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
    filename: "backup.zip",
    saveToDownloads: true,
  });
});
it("checks the archive before restoring and uses its returned token", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        token: "checked",
        createdAt: "2026-11-14T00:00:00Z",
        files: 3,
        bytes: 10,
      }),
    )
    .mockResolvedValueOnce(
      Response.json({ status: "restored", safetyBackup: "before.zip" }),
    );
  vi.stubGlobal("fetch", fetcher);
  const file = new File(["zip"], "backup.zip");
  const preview = await inspectBackup(file, new AbortController().signal);
  expect(fetcher.mock.calls[0][1].body).toBe(file);
  expect(fetcher.mock.calls[0][1].headers["Content-Type"]).toBe(
    "application/octet-stream",
  );
  expect(await restoreBackup(preview.token)).toEqual({
    status: "restored",
    safetyBackup: "before.zip",
  });
  expect(fetcher.mock.calls[1][0]).toMatch(/checked\/restore$/);
});
it("preserves the specific validation error and does not start a restore", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      Response.json({ detail: "备份文件已损坏。" }, { status: 422 }),
    );
  vi.stubGlobal("fetch", fetcher);
  await expect(
    inspectBackup(
      new File(["bad"], "backup.zip"),
      new AbortController().signal,
    ),
  ).rejects.toThrow("备份文件已损坏。");
  expect(fetcher).toHaveBeenCalledOnce();
});
it("does not repeat a restore when its result cannot be confirmed", async () => {
  const fetcher = vi.fn().mockRejectedValue(new TypeError("Network failed"));
  vi.stubGlobal("fetch", fetcher);
  await expect(restoreBackup("checked")).rejects.toThrow("恢复结果未能确认");
  expect(fetcher).toHaveBeenCalledOnce();
});
