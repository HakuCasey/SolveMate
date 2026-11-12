import "fake-indexeddb/auto";
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
afterEach(() => vi.unstubAllGlobals());

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
