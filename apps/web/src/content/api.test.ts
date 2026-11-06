import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentApi } from "./api";
import { packageFixture } from "./fixtures.test-support";
import { CourseDatabase, ContentStorage } from "./storage";
import Dexie from "dexie";

afterEach(() => vi.unstubAllGlobals());
describe("content requests", () => {
  it("queries official versions and downloads the exact verified package without credentials", async () => {
    const { manifest, archive } = await packageFixture();
    const requests: { url: string; options?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options?: RequestInit) => {
        requests.push({ url, options });
        if (url.endsWith("/download"))
          return new Response(new Uint8Array(archive).buffer);
        return Response.json({
          course_id: "calculus",
          current_version: null,
          status: "not_installed",
          update_available: true,
          latest: manifest,
        });
      }),
    );
    const api = new ContentApi("https://content.example/api/v1");
    const update = await api.update("calculus", null);
    expect(await api.download(update.latest)).toEqual(archive);
    expect(requests[1].url).toContain(manifest.version);
    expect(
      requests.every((request) => request.options?.credentials === "omit"),
    ).toBe(true);
  });
  it("rejects interrupted and oversized downloads rather than accepting partial bytes", async () => {
    const fixture = await packageFixture();
    const api = new ContentApi("/api/v1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(new Uint8Array([1, 2]).buffer)),
    );
    await expect(api.download(fixture.manifest)).rejects.toThrow("下载未完成");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(new Uint8Array(fixture.archive.length + 1).buffer),
      ),
    );
    await expect(api.download(fixture.manifest)).rejects.toThrow("不一致");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new TypeError("Network interrupted."));
              },
            }),
          ),
      ),
    );
    await expect(api.download(fixture.manifest)).rejects.toThrow(
      "Network interrupted",
    );
  });
  it("keeps the installed version usable after a network failure", async () => {
    const fixture = await packageFixture("可离线阅读");
    const database = new CourseDatabase(
      `content-network-test-${crypto.randomUUID()}`,
    );
    const storage = new ContentStorage(database);
    try {
      await storage.install(fixture.manifest, fixture.archive, null);
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new TypeError("Offline.");
        }),
      );
      await expect(new ContentApi("/api/v1").catalog()).rejects.toThrow(
        "Offline",
      );
      expect(
        (await storage.load()).activeCourses[0].questions[0].question,
      ).toContain("可离线阅读");
    } finally {
      database.close();
      await Dexie.delete(database.name);
    }
  });
});
