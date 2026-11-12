import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { packageFixture } from "./fixtures.test-support";
import { LocalContentStorage } from "./local-storage";
import { localRequest, LocalServiceError } from "../storage/local-service";
import { ContentConflictError } from "./storage";

const cache = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../storage/local-service", async (original) => ({
  ...(await original<typeof import("../storage/local-service")>()),
  ensureUserStorage: vi.fn(async () => undefined),
  localRequest: vi.fn(),
  userCache: { get: async (key: string) => cache.get(key) },
  remember: async (key: string, value: unknown) => {
    cache.set(key, value);
  },
}));
beforeEach(() => {
  cache.clear();
  vi.mocked(localRequest).mockReset();
});

describe("local course storage", () => {
  it("replaces a corrupt browser cache with the verified local package", async () => {
    const fixture = await packageFixture("本机正式副本");
    const record = {
      courseId: "calculus",
      version: fixture.manifest.version,
      manifest: fixture.manifest,
      installedAt: 1,
    };
    cache.set(`package:calculus:${record.version}`, {
      ...record,
      archive: new Uint8Array([0]),
    });
    vi.mocked(localRequest).mockImplementation(async (path) =>
      path === "/content"
        ? new Response(
            JSON.stringify({
              versions: [record],
              heads: [{ courseId: "calculus", version: record.version }],
            }),
          )
        : new Response(new Uint8Array(fixture.archive).buffer),
    );
    const result = await new LocalContentStorage().load();
    expect(result.installed[0].archive).toEqual(fixture.archive);
    expect(
      result.activeCourses.find((course) => course.id === "calculus")
        ?.questions[0].question,
    ).toContain("本机正式副本");
    expect(localRequest).toHaveBeenCalledWith(
      `/content/calculus/${record.version}`,
    );
  });
  it("does not report a committed package as unsaved when the following refresh fails", async () => {
    const fixture = await packageFixture();
    vi.mocked(localRequest).mockImplementation(async (_path, init) => {
      if (init?.method === "PUT") return new Response("{}");
      throw new LocalServiceError("Unavailable", "unavailable");
    });
    const result = await new LocalContentStorage().install(
      fixture.manifest,
      fixture.archive,
      null,
    );
    expect(result.version).toBe(fixture.manifest.version);
    expect(cache.get("content")).toMatchObject({
      heads: [{ courseId: "calculus", version: fixture.manifest.version }],
    });
  });
  it("confirms a committed version when the save response is lost", async () => {
    const fixture = await packageFixture();
    vi.mocked(localRequest).mockImplementation(async (_path, init) => {
      if (init?.method === "PUT")
        throw new LocalServiceError("Lost response", "unavailable");
      return new Response(
        JSON.stringify({
          versions: [
            {
              courseId: "calculus",
              version: fixture.manifest.version,
              manifest: fixture.manifest,
              installedAt: 1,
            },
          ],
          heads: [{ courseId: "calculus", version: fixture.manifest.version }],
        }),
      );
    });
    const result = await new LocalContentStorage().install(
      fixture.manifest,
      fixture.archive,
      null,
    );
    expect(result.version).toBe(fixture.manifest.version);
  });
  it("keeps the previous cache and head when the server rejects a stale update", async () => {
    const fixture = await packageFixture();
    const old = {
      records: [],
      heads: [{ courseId: "calculus", version: "previous" }],
    };
    cache.set("content", old);
    vi.mocked(localRequest).mockRejectedValue(
      new LocalServiceError("Conflict", "content_conflict", 409),
    );
    await expect(
      new LocalContentStorage().install(
        fixture.manifest,
        fixture.archive,
        "previous",
      ),
    ).rejects.toBeInstanceOf(ContentConflictError);
    expect(cache.get("content")).toEqual(old);
  });
});

it("keeps a verified cached course while reporting its missing local file", async () => {
  const fixture = await packageFixture();
  const record = {
    courseId: "calculus",
    version: fixture.manifest.version,
    manifest: fixture.manifest,
    installedAt: 1,
  };
  cache.set(`package:calculus:${record.version}`, {
    ...record,
    archive: fixture.archive,
  });
  vi.mocked(localRequest).mockResolvedValue(
    new Response(
      JSON.stringify({
        versions: [{ ...record, available: false }],
        heads: [{ courseId: "calculus", version: record.version }],
      }),
    ),
  );
  const result = await new LocalContentStorage().load();
  expect(result.installed[0].archive).toEqual(fixture.archive);
  expect(localRequest).toHaveBeenCalledTimes(1);
});
it("keeps other courses readable when one package is missing and has no cache", async () => {
  const fixture = await packageFixture();
  const record = {
    courseId: "calculus",
    version: fixture.manifest.version,
    manifest: fixture.manifest,
    installedAt: 1,
    available: false,
  };
  vi.mocked(localRequest).mockResolvedValue(
    new Response(
      JSON.stringify({
        versions: [record],
        heads: [{ courseId: "calculus", version: record.version }],
      }),
    ),
  );
  const result = await new LocalContentStorage().load();
  expect(result.installed).toHaveLength(0);
  expect(result.activeCourses.length).toBeGreaterThan(0);
  expect(localRequest).toHaveBeenCalledTimes(1);
});
