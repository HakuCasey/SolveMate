import { test, expect } from "@playwright/test";

test("各主页面均可打开并导航", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.waitForTimeout(3000);
  for (const label of ["学科", "对话", "笔记", "教研室", "机器人"]) {
    const button = page.getByRole("button", { name: label, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(400);
  }
});

test("设置菜单可打开显示设置与 AI 配置", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await expect(page.getByText("社区内容")).toBeVisible();
  await expect(page.getByText("备份与恢复")).toBeVisible();
  await expect(page.getByText("显示设置")).toBeVisible();
  await expect(page.getByText("AI 配置")).toBeVisible();
});
