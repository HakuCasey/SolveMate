import { describe, expect, it, vi } from "vitest";
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
    expect(coordinator.snapshot().error).toContain("仍保留");
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
