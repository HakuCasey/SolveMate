import "fake-indexeddb/auto";
import { dataRefresh } from "../refresh/coordinator";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Material } from "@solvemate/contracts";
import { materialApi } from "./api";

const original: Material = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "C 语言讲义",
  courseId: "c-language",
  source: "personal",
  currentVersion: "a".repeat(64),
  revision: 1,
  createdAt: 1,
  updatedAt: 1,
  version: {
    contentVersion: "a".repeat(64),
    mediaType: "application/pdf",
    originalAssetId: "original.pdf",
    readerAssetId: "original.pdf",
    filename: "course.pdf",
    sizeBytes: 100,
    sha256: "a".repeat(64),
    pageCount: 1,
    status: "ready",
    error: null,
    processor: "pypdf",
    processorVersion: "example",
  },
};
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("material mutations and cache", () => {
  it("sends the stable identifier and revision for rename, move and deletion", async () => {
    const fetch = vi.fn(async () => Response.json(original));
    vi.stubGlobal("fetch", fetch);
    await materialApi.rename(original, "指针课堂讲义");
    await materialApi.assignCourse(original, null);
    await materialApi.remove(original);
    const requests = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(
      requests.map(([path, options]) => [
        path,
        options.method,
        JSON.parse(options.body as string),
      ]),
    ).toEqual([
      [
        `/local-api/v1/materials/${original.id}/title`,
        "PATCH",
        { title: "指针课堂讲义", expectedRevision: 1 },
      ],
      [
        `/local-api/v1/materials/${original.id}/course`,
        "PATCH",
        { courseId: null, expectedRevision: 1 },
      ],
      [
        `/local-api/v1/materials/${original.id}`,
        "DELETE",
        { expectedRevision: 1 },
      ],
    ]);
  });
  it("keeps a saved deletion in cache when an older list request returns later", async () => {
    let release!: (value: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            release = resolve;
          }),
      ),
    );
    const reading = materialApi.list();
    const deleted = {
      ...original,
      title: "已修改的讲义",
      revision: 4,
      deletedAt: 5,
    };
    expect(await materialApi.remember(deleted)).toBe("");
    release(Response.json([original]));
    await reading;
    await materialApi.remember({ ...original, revision: 2 });
    expect(
      (await materialApi.cached()).find((item) => item.id === original.id),
    ).toEqual(deleted);
  });
  it("reports a conflict without replacing the saved metadata", async () => {
    await materialApi.remember({
      ...original,
      title: "已修改的讲义",
      revision: 8,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { detail: "资料已更新，请重新读取列表后重试。" },
          { status: 409 },
        ),
      ),
    );
    await expect(materialApi.rename(original, "不会保存")).rejects.toThrow(
      "资料已更新",
    );
    expect(
      (await materialApi.cached()).find((item) => item.id === original.id)
        ?.title,
    ).toBe("已修改的讲义");
  });
});

const location = {
  materialId: "test",
  contentVersion: "version",
  pageNumber: 1,
};
it("does not hide missing page text or a mismatched response behind cached text", async () => {
  vi.stubGlobal("fetch", vi.fn());
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ ...location, text: "正确文字" })),
  );
  expect(await materialApi.page(location)).toBe("正确文字");
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ detail: "文件缺失" }), { status: 404 }),
  );
  await expect(materialApi.page(location)).rejects.toMatchObject({
    status: 404,
  });
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(
      JSON.stringify({ ...location, pageNumber: 2, text: "错误位置" }),
    ),
  );
  await expect(materialApi.page(location)).rejects.toThrow("不一致");
  vi.mocked(fetch).mockRejectedValueOnce(new TypeError("Offline"));
  expect(await materialApi.page(location)).toBe("正确文字");
});
it("refreshes shared metadata on a conflicting write without replaying it", async () => {
  vi.stubGlobal("fetch", vi.fn());
  const read = vi.fn(async () => {}),
    dispose = dataRefresh.register("materials", read);
  vi.mocked(fetch).mockResolvedValueOnce(
    new Response(JSON.stringify({ detail: "版本已变化" }), { status: 409 }),
  );
  await expect(
    materialApi.remove({ id: "test", revision: 1 } as never),
  ).rejects.toMatchObject({ status: 409 });
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
  expect(fetch).toHaveBeenCalledOnce();
  dispose();
});

it("retains known records when part of the material list cannot be read", async () => {
  await materialApi.remember(original);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json([], { headers: { "X-SolveMate-Material-Errors": "1" } }),
    ),
  );
  const result = await materialApi.list();
  expect(
    result.items.find((x) => x.id === original.id)?.availability
      ?.readerAvailable,
  ).toBe(false);
  expect(result.warning).toContain("无法读取");
});
