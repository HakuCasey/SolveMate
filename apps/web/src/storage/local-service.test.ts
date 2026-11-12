import type { AppData } from "@solvemate/contracts";
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialData } from "../data/catalog";
import { DexieStorage } from "./index";
import { ContentStorage } from "../content/storage";
import { packageFixture } from "../content/fixtures.test-support";

let state = {
  storeId: "test-storage",
  revision: 0,
  value: null as ReturnType<typeof createInitialData> | null,
};
let available = true;
let migrations: Record<string, unknown>[] = [];
let imported = new Set<string>();
let receipts: Set<string> = new Set();
const reply = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function fetcher(input: string | URL | Request, init?: RequestInit) {
  if (!available) return Promise.reject(new TypeError("Network unavailable"));
  const path = String(input);
  if (path.endsWith("/state")) {
    if (init?.method === "PUT") {
      const body = JSON.parse(init.body as string);
      if (body.expectedRevision !== state.revision)
        return Promise.resolve(
          reply({ code: "revision_conflict", detail: "Conflict" }, 409),
        );
      state = { ...state, revision: state.revision + 1, value: body.value };
    }
    return Promise.resolve(reply(state));
  }
  if (path.endsWith("/migrate")) {
    const body = JSON.parse(init?.body as string);
    migrations.push(body);
    const key = JSON.stringify([body.sourceId, body.payload]);
    if (!receipts.has(key)) {
      if (state.value && !body.decision)
        return Promise.resolve(reply({ code: "migration_conflict" }, 409));
      if (body.decision !== "keep") {
        state = {
          ...state,
          revision: state.revision + 1,
          value: body.payload.value,
        };
        imported.add(key);
      }
      receipts.add(key);
    }
    return Promise.resolve(reply(state));
  }
  return Promise.resolve(reply({ detail: "Unknown test route" }, 404));
}
beforeEach(async () => {
  await Promise.all(
    ["solvemate-local", "solvemate-content", "solvemate-server-cache"].map(
      (name) => Dexie.delete(name),
    ),
  );
  vi.resetModules();
  state = { storeId: "test-storage", revision: 0, value: null };
  available = true;
  migrations = [];
  imported = new Set();
  receipts = new Set();
  vi.stubGlobal("fetch", vi.fn(fetcher));
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("local service storage and migration", () => {
  it("migrates the original envelope and course archives without modifying the old databases", async () => {
    const old = new DexieStorage();
    const original = createInitialData();
    original.conversations[0].title = "原对话";
    await old.save(original);
    const rawBefore = await old.rawRecord();
    old.close();
    const pack = await packageFixture("保留原课程");
    const courses = new ContentStorage();
    await courses.install(pack.manifest, pack.archive, null);
    courses.database.close();
    const service = await import("./local-service");
    await service.ensureUserStorage();
    expect(state.value).toEqual(original);
    const payload = migrations[0].payload as {
      legacyState: unknown;
      versions: { archive: string }[];
    };
    expect(payload.legacyState).toEqual(rawBefore);
    expect(service.fromBase64(payload.versions[0].archive)).toEqual(
      pack.archive,
    );
    const reopened = new DexieStorage();
    expect(await reopened.rawRecord()).toEqual(rawBefore);
    reopened.close();
    expect(imported.size).toBe(1);
    expect(await service.appStorage.load()).toEqual(original);
    service.userCache.close();
  });
  it("keeps another browser's records until the user explicitly chooses, then does not ask repeatedly", async () => {
    const old = new DexieStorage();
    const original = createInitialData();
    original.settings.fontSize = 20;
    await old.save(original);
    old.close();
    state = { ...state, revision: 4, value: createInitialData() };
    const service = await import("./local-service");
    let required!: InstanceType<typeof service.MigrationRequired>;
    try {
      await service.ensureUserStorage();
    } catch (error) {
      required = error as typeof required;
    }
    expect(required).toBeInstanceOf(service.MigrationRequired);
    expect(state.value?.settings.fontSize).toBe(14);
    await service.resolveMigration(required, "keep");
    await service.ensureUserStorage();
    expect(state.value?.settings.fontSize).toBe(14);
    expect(imported.size).toBe(0);
    expect(migrations).toHaveLength(2);
    service.userCache.close();
  });
  it("uses one server revision across clients and retains unsaved changes after a conflict", async () => {
    const service = await import("./local-service");
    const first = new service.LocalAppStorage(),
      second = new service.LocalAppStorage();
    expect(await first.load()).toBeNull();
    await first.save(createInitialData());
    const stale = (await second.load())!;
    const next = structuredClone(stale);
    next.settings.fontSize = 21;
    await first.save(next);
    stale.settings.appearance = "dark";
    await expect(second.save(stale)).rejects.toMatchObject({
      name: "LocalDataConflictError",
    });
    expect(state.value?.settings.fontSize).toBe(21);
    expect(state.value?.settings.appearance).toBe("light");
    expect(
      (await service.userCache.pending.toArray())[0].value.settings.appearance,
    ).toBe("dark");
    service.userCache.close();
  });
  it("reads cached data offline, fails writes visibly, and saves the retained change on retry", async () => {
    const service = await import("./local-service");
    const storage = new service.LocalAppStorage();
    await storage.load();
    await storage.save(createInitialData());
    available = false;
    expect((await storage.load())?.settings.fontSize).toBe(14);
    expect(service.userStorageStatus.snapshot().online).toBe(false);
    const next = createInitialData();
    next.settings.fontSize = 17;
    await expect(storage.save(next)).rejects.toThrow("无法连接本机服务");
    expect(state.value?.settings.fontSize).toBe(14);
    expect(
      (await service.userCache.pending.toArray())[0].value.settings.fontSize,
    ).toBe(17);
    available = true;
    await storage.save(next);
    expect(state.value?.settings.fontSize).toBe(17);
    expect(await service.userCache.pending.count()).toBe(0);
    service.userCache.close();
  });
  it("does not initialize examples on a broken response or unavailable empty service", async () => {
    const service = await import("./local-service");
    available = false;
    await expect(service.ensureUserStorage()).rejects.toThrow(
      "无法连接本机服务",
    );
    expect(state.value).toBeNull();
    available = true;
    vi.mocked(fetch).mockResolvedValueOnce(reply({ revision: 0, value: null }));
    await expect(service.ensureUserStorage()).rejects.toThrow(
      "本机服务返回的记录格式不正确",
    );
    expect(state.value).toBeNull();
    service.userCache.close();
  });
  it("blocks writes if a different user directory is attached while the page is open", async () => {
    const service = await import("./local-service");
    const storage = new service.LocalAppStorage();
    await storage.load();
    state = { ...state, storeId: "another-directory" };
    await expect(storage.save(createInitialData())).rejects.toMatchObject({
      name: "LocalDataConflictError",
    });
    expect(state.value).toBeNull();
    service.userCache.close();
  });
});

it("refreshes from the service without rerunning migration or treating a cache as the latest state", async () => {
  const service = await import("./local-service"),
    storage = new service.LocalAppStorage();
  await storage.load();
  await storage.save(createInitialData());
  const migrationCount = migrations.length;
  state = {
    ...state,
    revision: state.revision + 1,
    value: {
      ...state.value!,
      settings: { ...state.value!.settings, fontSize: 21 },
    },
  };
  expect((await storage.refresh())?.settings.fontSize).toBe(21);
  expect(migrations).toHaveLength(migrationCount);
  available = false;
  await expect(storage.refresh()).rejects.toThrow("无法连接本机服务");
  expect(
    (await service.userCache.get<{ value: AppData }>("state"))?.value.settings
      .fontSize,
  ).toBe(21);
  available = true;
  const record = {
    id: "backup",
    createdAt: 1,
    base: createInitialData(),
    value: createInitialData(),
  };
  await storage.preserve(record);
  expect(await storage.recoveries()).toEqual([record]);
  service.userCache.close();
});
