import { expect, it } from "vitest";
import { removeInvalidOperationDiagnostics } from "./diagnostics";
import { OperationStore } from "./store";

it("removes only unidentifiable operation history and preserves valid operations and learning records", async () => {
  const row = (operation: string, label: string, extra = {}) => ({
    id: operation,
    operation,
    label,
    startedAt: 1,
    ...extra,
  });
  const rename = row("materials:rename:1", "重命名资料", {
    targetName: "高数课本",
  });
  const refresh = row("refresh:data", "刷新数据", {
    failures: [{ label: "资料列表", errorCode: "unavailable" }],
  });
  const rows = [
    row("application:pending", "提交更改"),
    row("application:read", "重新读取本机数据"),
    row("refresh:data", "刷新数据"),
    row("refresh:data", "刷新数据", { failures: [null, {}] }),
    rename,
    refresh,
  ];
  const learning = {
    conversations: [{ id: "conversation" }],
    notes: [{ id: "note" }],
    config: { model: "selected" },
  };
  const cache = new Map<string, unknown>([
    ["state", learning],
    ["operation-diagnostics", rows],
    ["other", "kept"],
  ]);
  const writes: string[] = [];
  const adapter = {
    get: async <T>(key: string) => cache.get(key) as T | undefined,
    put: async (key: string, value: unknown) => {
      writes.push(key);
      cache.set(key, value);
    },
  };
  expect(await removeInvalidOperationDiagnostics(adapter)).toEqual([
    rename,
    refresh,
  ]);
  expect(writes).toEqual(["operation-diagnostics"]);
  expect(cache.get("state")).toBe(learning);
  expect(cache.get("other")).toBe("kept");
  await removeInvalidOperationDiagnostics(adapter);
  expect(writes).toHaveLength(1);
});

it("also removes invalid records already loaded in memory without removing a specific failed operation", () => {
  const store = new OperationStore();
  store.restoreDiagnostics([
    {
      id: "old",
      key: "application:pending",
      label: "提交更改",
      startedAt: 1,
      status: "failed",
    },
    {
      id: "valid",
      key: "ai:save:dsh",
      label: "保存 AI 配置",
      startedAt: 2,
      status: "failed",
    },
  ]);
  store.removeInvalidDiagnostics();
  expect(store.snapshot().diagnostics.map((item) => item.id)).toEqual([
    "valid",
  ]);
});

it("keeps a successful refresh status when cleaning failed history", () => {
  const store = new OperationStore();
  const operation = store.start({ key: "refresh:data", label: "刷新数据" });
  store.finish(operation);
  store.removeInvalidDiagnostics();
  expect(store.snapshot().latest?.status).toBe("success");
});
