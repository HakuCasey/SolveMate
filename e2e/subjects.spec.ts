import { test, expect } from "@playwright/test";

test("学科切换、资料与题目列表、打开 PDF 阅读", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByRole("button", { name: "学科", exact: true }).click();
  await page.waitForTimeout(3000);

  // B1: 学科列表
  await expect(
    page.getByRole("button", { name: "高等数学", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "C 语言", exact: true }),
  ).toBeVisible();

  // 切到 C 语言，学习资料列表出现内置教材
  await page.getByRole("button", { name: "C 语言", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /C 语言示例教材/ }),
  ).toBeVisible({ timeout: 15_000 });

  // B2: 切到题目
  await page.getByRole("button", { name: "题目", exact: true }).click();
  await expect(page.getByText(/道$/).first()).toBeVisible({ timeout: 15_000 });

  // 切回学习资料
  await page.getByRole("button", { name: "学习资料", exact: true }).click();

  // C1: 打开 PDF 阅读
  await page.getByRole("button", { name: /C 语言示例教材/ }).click();
  await expect(page.getByText(/第 \d+ 页/).first()).toBeVisible({
    timeout: 15_000,
  });
});
