import { test, expect } from "@playwright/test";

test("机器人页展示预置机器人", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "机器人", exact: true }).click();
  for (const name of ["全科教师", "高数教师", "C 语言教师"]) {
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
  }
});

test("笔记页渲染笔记本列表", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "笔记", exact: true }).click();
  await expect(page.getByRole("region", { name: "笔记列表" })).toBeVisible();
  await expect(page.getByText(/个笔记本 · \d+ 篇笔记/)).toBeVisible();
});

test("显示设置可切换夜间模式与字号", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "设置", exact: true }).click();
  await page.getByText("显示设置", { exact: true }).click();

  const dark = page.getByRole("button", { name: "夜间模式" });
  await dark.click();
  await expect(dark).toHaveAttribute("aria-pressed", "true");

  const fontSize = page.getByLabel("对话字号");
  await fontSize.fill("18");
  await expect(page.getByText("18px")).toBeVisible();
});
