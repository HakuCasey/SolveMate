import { describe, expect, it, vi } from "vitest";
import { operations } from "../operations/store";
import { DataRefreshCoordinator } from "./coordinator";
import { DataRequestError } from "./errors";
const gate = () => {
  let release!: () => void;
  const promise = new Promise<void>((r) => {
    release = r;
  });
  return { promise, release };
};
describe("shared data refresh", () => {
  it("shares concurrent reads and performs at most one requested trailing read", async () => {
    const coordinator = new DataRefreshCoordinator(),
      pending = gate();
    const read = vi
      .fn()
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValue(undefined);
    coordinator.register("records", read);
    const first = coordinator.refresh();
    await Promise.resolve();
    const second = coordinator.refresh(["records"], true);
    const third = coordinator.refresh(["records"], true);
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(1);
    pending.release();
    await Promise.all([first, second, third]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(coordinator.snapshot().refreshing).toBe(false);
  });
  it("allows other resources to finish when one read fails", async () => {
    const coordinator = new DataRefreshCoordinator(),
      read = vi.fn(async () => {});
    coordinator.register("records", async () => {
      throw new Error("Offline");
    });
    coordinator.register("materials", read);
    expect(await coordinator.refresh()).toBe(false);
    expect(read).toHaveBeenCalledTimes(1);
    expect(coordinator.snapshot().error).toContain(
      "对话、笔记和配置未能刷新：Offline",
    );
  });
  it("does not recursively refresh a missing resource or repeat a business mutation", async () => {
    const coordinator = new DataRefreshCoordinator();
    const error = new DataRequestError("Missing", "missing", 404);
    const read = vi.fn(async () => {
      coordinator.recover(error, ["records"]);
      throw error;
    });
    coordinator.register("records", read);
    await coordinator.refresh();
    expect(read).toHaveBeenCalledTimes(1);
    coordinator.recover(new Error("Validation"), ["records"]);
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("cleans up only the registered reader and gives manual refresh feedback", async () => {
    const coordinator = new DataRefreshCoordinator();
    const dispose = coordinator.register("records", async () => {}),
      read = vi.fn(async () => {});
    coordinator.register("records", read);
    dispose();
    await coordinator.refresh(undefined, false, true);
    expect(read).toHaveBeenCalledOnce();
    expect(coordinator.snapshot().notice).toContain("数据已刷新");
    coordinator.reportIssue("materials", "原文件缺失");
    await coordinator.refresh(undefined, false, true);
    expect(coordinator.snapshot().notice).toBe("原文件缺失");
  });
});

it("does not clear a resource failure when only an unrelated resource refreshes", async () => {
  const coordinator = new DataRefreshCoordinator();
  let unavailable = true;
  coordinator.register("records", async () => {
    if (unavailable) throw new Error("Offline");
  });
  coordinator.register("materials", async () => {});
  await coordinator.refresh(["records"]);
  await coordinator.refresh(["materials"]);
  expect(coordinator.snapshot().error).toContain("未能刷新");
  unavailable = false;
  await coordinator.refresh(["records"]);
  expect(coordinator.snapshot().error).toBe("");
});

it("records one failed automatic refresh for shared callers and keeps its specific error", async () => {
  const coordinator = new DataRefreshCoordinator(),
    pending = gate();
  const error = new DataRequestError(
    "记录版本无法识别",
    "invalid_response",
    422,
  );
  coordinator.register("records", async () => {
    await pending.promise;
    throw error;
  });
  const before = new Set(
    operations.snapshot().diagnostics.map((item) => item.id),
  );
  const first = coordinator.refresh(["records"]);
  const second = coordinator.refresh(["records"]);
  pending.release();
  await Promise.all([first, second]);
  const failures = operations
    .snapshot()
    .diagnostics.filter((item) => !before.has(item.id));
  expect(failures).toHaveLength(1);
  expect(failures[0]).toMatchObject({
    label: "自动刷新数据",
    errorCode: "refresh_failed",
    failures: [
      {
        label: "对话、笔记和配置",
        errorCode: "invalid_response",
        httpStatus: 422,
        message: error.message,
      },
    ],
  });
  coordinator.register("records", async () => {});
  await coordinator.refresh(["records"], false, true);
  expect(operations.snapshot().latest?.label).toBe("加载用户数据");
  expect(
    operations.snapshot().failures.some((item) => item.key === "refresh:data"),
  ).toBe(false);
});

it("groups multiple failed resources and concurrent calls into one refresh operation", async () => {
  const coordinator = new DataRefreshCoordinator(),
    pending = gate();
  for (const scope of ["records", "materials", "ai"] as const)
    coordinator.register(scope, async () => {
      await pending.promise;
      throw new DataRequestError("本机服务无法连接", "unavailable", 503);
    });
  coordinator.register("study", async () => {});
  const before = new Set(
    operations.snapshot().diagnostics.map((item) => item.id),
  );
  const first = coordinator.refresh(undefined, false, true);
  const second = coordinator.refresh(["materials"]);
  pending.release();
  await Promise.all([first, second]);
  const rows = operations
    .snapshot()
    .diagnostics.filter((item) => !before.has(item.id));
  expect(rows).toHaveLength(1);
  expect(rows[0].label).toBe("加载用户数据");
  expect(rows[0].failures?.map((item) => item.label)).toEqual([
    "对话、笔记和配置",
    "资料列表",
    "AI 配置",
  ]);
  const exported = operations
    .diagnosticData()
    .find((item) => item.id === rows[0].id);
  expect(exported?.failures).toHaveLength(3);
  expect(JSON.stringify(exported)).not.toContain("本机服务无法连接");
  coordinator.register("records", async () => {});
  coordinator.register("materials", async () => {});
  coordinator.register("ai", async () => {});
  await coordinator.refresh();
  expect(
    operations.snapshot().failures.some((item) => item.key === "refresh:data"),
  ).toBe(false);
});
