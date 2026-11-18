import { test, expect } from "@playwright/test";

test("应用加载并渲染侧边栏功能菜单", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("navigation", { name: "功能菜单" }),
  ).toBeVisible();
  for (const label of ["学科", "对话", "笔记", "教研室", "机器人"]) {
    await expect(
      page.getByRole("button", { name: label, exact: true }),
    ).toBeVisible();
  }
});

test("侧边栏可切换到对话页面", async ({ page }) => {
  await page.goto("/");
  const conversation = page.getByRole("button", {
    name: "对话",
    exact: true,
  });
  await conversation.click();
  await expect(conversation).toHaveAttribute("aria-pressed", "true");
});
