import { test, expect } from "@playwright/test";

test("会话归档与移回进行中", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByRole("button", { name: "对话", exact: true }).click();
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "新建对话", exact: true }).click();
  await page.waitForTimeout(800);

  // 归档
  await page.getByRole("button", { name: "对话管理" }).click();
  await page.getByRole("menuitem", { name: "归档" }).click();
  const archivedNotice = page.getByText("对话已归档。在上方");
  await expect(archivedNotice).toBeVisible();

  // 移回进行中
  await page.getByRole("button", { name: "对话管理" }).click();
  await page.getByRole("menuitem", { name: "移回进行中" }).click();
  await expect(archivedNotice).toBeHidden();
});
