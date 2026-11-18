import { test, expect } from "@playwright/test";

test("阅读位置在重新打开后恢复", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByRole("button", { name: "学科", exact: true }).click();
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "C 语言", exact: true }).click();
  await page.getByRole("button", { name: /C 语言示例教材/ }).click();

  const pageInput = page.getByLabel("资料页码");
  await expect(pageInput).toBeVisible({ timeout: 15_000 });

  // 翻到第 7 页
  await pageInput.fill("7");
  await pageInput.press("Enter");
  await expect(pageInput).toHaveValue("7");

  // 返回列表后重新打开，位置恢复
  await page.getByRole("button", { name: "返回学习资料列表" }).click();
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: /C 语言示例教材/ }).click();
  await expect(pageInput).toHaveValue("7", { timeout: 15_000 });
});
