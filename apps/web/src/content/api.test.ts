import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContentApi } from "./api";
import { packageFixture } from "./fixtures.test-support";
import { CourseDatabase, ContentStorage } from "./storage";
import { toolFixture } from "../research/tools.test-support";
import Dexie from "dexie";

afterEach(() => vi.unstubAllGlobals());
describe("content requests", () => {
  it("checks updates from the published catalog and installs the fixed version without credentials", async () => {
    const previous = await packageFixture("旧题目");
    const { manifest, archive } = await packageFixture("新题目");
    const base = "https://content.example/SolveMate/community";
    const release = `${base}/courses/calculus/${manifest.version}`;
    const requests: { url: string; options?: RequestInit }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, options?: RequestInit) => {
        requests.push({ url, options });
        if (url === `${release}/content.zip`)
          return new Response(new Uint8Array(archive).buffer);
        if (url === `${release}/manifest.json`) return Response.json(manifest);
        if (url === `${base}/catalog.json`)
          return Response.json({
            schema_version: 1,
            courses: [
              {
                course: manifest.course,
                latest_version: manifest.version,
                versions: [previous.manifest.version, manifest.version],
              },
            ],
            tools: [],
          });
        return new Response(null, { status: 404 });
      }),
    );
    const api = new ContentApi(base);
    const [course] = await api.catalog();
    const update = await api.update(course, previous.manifest.version);
    expect(update.status).toBe("update_available");
    const database = new CourseDatabase(
      `content-pages-test-${crypto.randomUUID()}`,
    );
    const storage = new ContentStorage(database);
    try {
      await storage.install(previous.manifest, previous.archive, null);
      const bytes = await api.download(update.latest);
      const damaged = bytes.slice();
      damaged[0] ^= 1;
      await expect(
        storage.install(update.latest, damaged, previous.manifest.version),
      ).rejects.toThrow("校验失败");
      expect((await storage.load()).heads[0].version).toBe(
        previous.manifest.version,
      );
      await storage.install(update.latest, bytes, previous.manifest.version);
      const saved = await storage.load();
      expect(saved.heads[0].version).toBe(manifest.version);
      expect(saved.installed.map((item) => item.version)).toContain(
        previous.manifest.version,
      );
    } finally {
      database.close();
      await Dexie.delete(database.name);
    }
    expect(requests.map(({ url }) => url)).toEqual([
      `${base}/catalog.json`,
      `${release}/manifest.json`,
      `${release}/content.zip`,
    ]);
    expect(
      requests.every(({ options }) => options?.credentials === "omit"),
    ).toBe(true);
  });
  it("loads tools from the published catalog and verifies the downloaded hash", async () => {
    const tool = { ...toolFixture(), source: "official" };
    const payload = JSON.stringify(tool);
    const hash = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(payload),
        ),
      ),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("");
    const fetchTool = vi.fn(async (url: string) => {
      if (url === `/community/tools/${tool.id}/${hash}.json`)
        return new Response(payload);
      if (url === "/community/catalog.json")
        return Response.json({ tools: [{ ...tool, latest_version: hash }] });
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchTool);
    const api = new ContentApi("/community");
    const [entry] = await api.tools();
    expect(await api.downloadTool(entry)).toMatchObject({
      id: tool.id,
      version: hash,
    });
    fetchTool.mockResolvedValueOnce(new Response("{}"));
    await expect(api.downloadTool(entry)).rejects.toThrow("工具校验失败");
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
