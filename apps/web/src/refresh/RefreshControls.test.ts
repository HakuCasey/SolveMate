import { createElement, Fragment, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { RefreshControls } from "./RefreshControls";
import { operations } from "../operations/store";

// 这里只验证详情内容，Portal 在服务端渲染时改为原位输出。
vi.mock("radix-ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("radix-ui")>();
  return {
    ...actual,
    Dialog: {
      ...actual.Dialog,
      Portal: ({ children }: { children: ReactNode }) =>
        createElement(Fragment, null, children),
    },
  };
});

const render = () =>
  renderToStaticMarkup(
    createElement(RefreshControls, {
      data: null,
      conflicts: [],
      onResolve: () => {},
      saveState: "saved",
      onRetryRead: async () => {},
      onOpenBackup: () => {},
      conflict: false,
      online: true,
      onRetry: () => {},
      detailsOpen: false,
      onDetailsOpenChange: () => {},
      unsavedOpen: true,
      onUnsavedOpenChange: () => {},
    }),
  );

it("shows only unresolved failures in operation details while retaining historical failures for log export", () => {
  operations.restoreDiagnostics([
    {
      id: "historical",
      key: "material:old",
      label: "历史重命名操作",
      startedAt: 1,
      status: "failed",
    },
  ]);
  const failed = operations.start({
    key: "material:current",
    label: "当前移动资料操作",
    targetName: "高数课本",
  });
  operations.finish(failed, new Error("移动失败"));
  const html = render();
  expect(html).toContain("当前移动资料操作失败");
  expect(html).toContain("高数课本");
  expect(html).not.toContain("历史重命名操作");
  const retry = operations.start({ key: failed.key, label: failed.label });
  expect(render()).toContain("当前移动资料操作失败");
  operations.finish(retry);
  const resolved = render();
  expect(resolved).not.toContain("当前移动资料操作失败");
  expect(resolved).toContain("当前没有未解决的失败操作");
  expect(resolved).toContain("导出诊断日志");
  expect(
    operations.diagnosticData().some((item) => item.id === failed.id),
  ).toBe(true);
});
