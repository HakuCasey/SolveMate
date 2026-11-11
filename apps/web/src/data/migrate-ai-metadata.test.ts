import "fake-indexeddb/auto";
import Dexie from "dexie";
import { describe, expect, it, vi } from "vitest";
import seed from "./seed-data.json";
import { migrateAiMetadata } from "./migrate-ai-metadata";
import { DexieStorage } from "../storage";

function legacy() {
  return {
    schemaVersion: 1,
    robotCatalogVersion: 1,
    robots: structuredClone(seed.robots),
    conversations: structuredClone(seed.conversations),
    defaultRobotId: "scholar",
    settings: { fontSize: 14, appearance: "light", globalModel: "" },
    selection: {
      courseId: "calculus",
      kind: "questions",
      itemId: "M001",
      chapterIndex: 0,
    },
  };
}
describe("AI metadata migration", () => {
  it("preserves identifiers, custom instructions, message contents and unknown historical versions", () => {
    const source = legacy();
    source.robots[0].prompt = "用户自己的教师指令";
    const before = structuredClone(source);
    const result = migrateAiMetadata(source);
    expect(source).toEqual(before);
    expect(result.robots[0].id).toBe(source.robots[0].id);
    expect(result.robots[0].prompt).toBe("用户自己的教师指令");
    expect(result.conversations[0].messages).toEqual(
      source.conversations[0].messages,
    );
    expect(result.conversations[0].createdWith.appVersion).toBeNull();
    expect(migrateAiMetadata(result)).toBe(result);
  });
  it("rejects conflicting service bindings before modifying any record", () => {
    const source = legacy();
    Object.assign(source.conversations[0], {
      connectionId: "deepseek-local",
      bindings: [
        {
          connectionId: "hermes-local",
          protocol: "acp",
          externalSessionId: "native",
        },
      ],
    });
    const before = structuredClone(source);
    expect(() => migrateAiMetadata(source)).toThrow("conflicting");
    expect(source).toEqual(before);
  });
  it("migrates IndexedDB with a durable backup and does not repeat the migration", async () => {
    const name = `metadata-migrate-${crypto.randomUUID()}`,
      raw = new Dexie(name);
    raw.version(1).stores({ state: "id" });
    const source = legacy();
    await raw.table("state").put({ id: "main", value: source, revision: 7 });
    const storage = new DexieStorage(name);
    try {
      const migrated = await storage.load();
      expect(migrated?.schemaVersion).toBe(3);
      const saved = await raw.table("state").get("main");
      expect(saved.legacyBackup).toEqual(source);
      expect(saved.revision).toBe(8);
      await storage.load();
      expect((await raw.table("state").get("main")).revision).toBe(8);
      await storage.save(migrated!);
      expect((await raw.table("state").get("main")).legacyBackup).toEqual(
        source,
      );
    } finally {
      storage.close();
      raw.close();
      await Dexie.delete(name);
    }
  });
  it("leaves the original database intact if migration cannot confirm the binding", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const name = `metadata-conflict-${crypto.randomUUID()}`,
      raw = new Dexie(name);
    raw.version(1).stores({ state: "id" });
    const source = legacy();
    Object.assign(source.conversations[0], {
      bindings: [
        {
          connectionId: "deepseek-local",
          protocol: "acp",
          externalSessionId: "one",
        },
        {
          connectionId: "deepseek-local",
          protocol: "acp",
          externalSessionId: "two",
        },
      ],
    });
    await raw.table("state").put({ id: "main", value: source, revision: 2 });
    const storage = new DexieStorage(name);
    try {
      await expect(storage.load()).rejects.toThrow("conflicting");
      expect((await raw.table("state").get("main")).value).toEqual(source);
      expect((await raw.table("state").get("main")).revision).toBe(2);
    } finally {
      log.mockRestore();
      storage.close();
      raw.close();
      await Dexie.delete(name);
    }
  });
  it("rejects future formats instead of replacing them with initial examples", () => {
    expect(() => migrateAiMetadata({ ...legacy(), schemaVersion: 99 })).toThrow(
      "unsupported schema version",
    );
  });
});

function version2() {
  const current = migrateAiMetadata(legacy());
  return {
    ...current,
    schemaVersion: 2,
    robots: current.robots.map((item) => ({
      ...item,
      schemaVersion: 2,
      aiDefaults: {
        connection: { kind: "global-default" },
        model: { kind: "connection-default" },
      },
    })),
    conversations: current.conversations.map((item) => ({
      ...item,
      schemaVersion: 2,
      aiConfig: {
        connectionId: item.aiConfig.connectionId,
        model: { kind: "connection-default" },
      },
    })),
  };
}
describe("version 2 selection migration", () => {
  it("removes nested selection fields while preserving explicit connections, models and native sessions", () => {
    const source = version2();
    Object.assign(source.robots[0], {
      aiDefaults: {
        connection: { kind: "connection", connectionId: "hermes-local" },
        model: {
          kind: "model",
          connectionId: "hermes-local",
          modelId: "same-as-default",
        },
      },
    });
    Object.assign(source.conversations[0], {
      aiConfig: {
        connectionId: "hermes-local",
        model: {
          kind: "model",
          connectionId: "hermes-local",
          modelId: "original",
        },
      },
      binding: {
        conversationId: source.conversations[0].id,
        connectionId: "hermes-local",
        protocol: "acp",
        externalSessionId: "native-original",
        state: "bound",
        revision: 2,
      },
    });
    const migrated = migrateAiMetadata(source);
    expect(migrated.robots[0].aiDefaults).toEqual({
      connectionId: "hermes-local",
      modelId: "same-as-default",
    });
    expect(migrated.robots[1].aiDefaults).toBeNull();
    expect(migrated.conversations[0].aiConfig).toEqual({
      connectionId: "hermes-local",
      modelId: "original",
    });
    expect(migrated.conversations[0].binding?.externalSessionId).toBe(
      "native-original",
    );
    expect(migrated.conversations[0].messages).toEqual(
      source.conversations[0].messages,
    );
    expect(migrateAiMetadata(migrated)).toBe(migrated);
  });
  it("keeps a legacy connection default unresolved instead of inventing a historical model", () => {
    const source = version2();
    source.conversations[0].aiConfig.connectionId = "deepseek-local";
    const next = migrateAiMetadata(source);
    expect(next.conversations[0].aiConfig).toEqual({
      connectionId: "deepseek-local",
      modelId: null,
    });
    expect(next.conversations[0].turns).toEqual(source.conversations[0].turns);
  });
  it("rejects conflicting model scopes before changing legacy records", () => {
    const source = version2();
    Object.assign(source.conversations[0], {
      aiConfig: {
        connectionId: "hermes-local",
        model: { kind: "model", connectionId: "deepseek-local", modelId: "a" },
      },
    });
    expect(() => migrateAiMetadata(source)).toThrow("another connection");
  });
  it("keeps the original backup while adding a version 2 backup in IndexedDB", async () => {
    const name = `v2-migration-${crypto.randomUUID()}`,
      raw = new Dexie(name);
    raw.version(1).stores({ state: "id" });
    const source = version2(),
      original = legacy();
    await raw
      .table("state")
      .put({ id: "main", value: source, revision: 8, legacyBackup: original });
    const storage = new DexieStorage(name);
    try {
      const data = await storage.load();
      await storage.save(data!);
      const saved = await raw.table("state").get("main");
      expect(saved.value.schemaVersion).toBe(3);
      expect(saved.legacyBackup).toEqual(original);
      expect(saved.metadataBackups[2]).toEqual(source);
    } finally {
      storage.close();
      raw.close();
      await Dexie.delete(name);
    }
  });
});
