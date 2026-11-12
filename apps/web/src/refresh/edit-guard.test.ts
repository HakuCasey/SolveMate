import { expect, it } from "vitest";
import { EditGuard } from "./useEditRevision";
it("requires confirmation before saving an externally updated value", () => {
  const guard = new EditGuard({ title: "原名称" });
  expect(() => guard.check({ title: "新名称" })).toThrow("已更新");
  expect(() => guard.check({ title: "新名称" })).not.toThrow();
  expect(() => guard.check({ title: "再次变化" })).toThrow("已更新");
  expect(() => guard.check(undefined)).toThrow("已删除");
});
it("allows a new configuration but never turns a removed existing record into a creation", () => {
  const guard = new EditGuard(undefined, true);
  expect(() => guard.check(undefined)).not.toThrow();
  expect(() => guard.check(1)).toThrow("已更新");
  expect(() => guard.check(1)).not.toThrow();
  expect(() => guard.check(undefined)).toThrow("已删除");
});
