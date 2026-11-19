import { test, expect } from "@playwright/test";

test("备份与恢复对话框展示导出/恢复与数据路径", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "系统设置", exact: true }).click();
  await page.getByRole("button", { name: "备份与恢复", exact: true }).click();

  await expect(page.getByText("导出备份")).toBeVisible();
  await expect(page.getByText("恢复备份")).toBeVisible();
  await expect(page.getByText(/用户数据/).first()).toBeVisible();
});

test("导出备份打开导出窗口", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "系统设置", exact: true }).click();
  await page.getByRole("button", { name: "备份与恢复", exact: true }).click();
  await page.getByText("导出备份", { exact: true }).click();

  await expect(page.getByText("保存位置")).toBeVisible();
  await expect(page.getByRole("button", { name: "确认", exact: true })).toBeVisible();
});
