import { test, expect } from "@playwright/test";

test("关联当前页提问被正常提交并收到回复", async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto("/");
  await page.getByRole("button", { name: "学科", exact: true }).click();
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "C 语言", exact: true }).click();
  await page.getByRole("button", { name: /C 语言示例教材/ }).click();
  await expect(page.getByLabel("资料页码")).toBeVisible({ timeout: 15_000 });

  const input = page.getByRole("textbox", { name: "向阅读助手提问" });
  const messages = page.locator("[data-message-content]");
  const before = await messages.count();
  await input.click();
  await input.type("这一页讲了什么？");
  await page.getByRole("button", { name: "提问", exact: true }).click();

  // 问题被提交并收到回复
  await expect(messages).toHaveCount(before + 1, { timeout: 10_000 });
  await expect(messages).toHaveCount(before + 2, { timeout: 240_000 });
});
