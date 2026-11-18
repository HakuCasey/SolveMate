import { test, expect } from "@playwright/test";

test("指定页码提问被正常提交并收到回复", async ({ page }) => {
  test.setTimeout(600_000);
  await page.goto("/");
  await page.getByRole("button", { name: "学科", exact: true }).click();
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "C 语言", exact: true }).click();
  await page.getByRole("button", { name: /C 语言示例教材/ }).click();
  await expect(page.getByText(/第 \d+ 页/).first()).toBeVisible({
    timeout: 15_000,
  });

  // 设置页码范围 5-8
  await page
    .getByRole("button", { name: /C 语言示例教材 · 第 \d+ 页/ })
    .click();
  await page.getByLabel("起始页").fill("5");
  await page.getByLabel("结束页").fill("8");
  await page.getByRole("button", { name: "确认", exact: true }).click();

  // 提问
  const input = page.getByRole("textbox", { name: "向阅读助手提问" });
  await input.click();
  await input.type("这几页一共有几个公式？");
  const messages = page.locator("[data-message-content]");
  const before = await messages.count();
  await page.getByRole("button", { name: "提问", exact: true }).click();

  // 问题被提交（出现用户消息），而不是被拒「关联内容尚未读取」
  await expect(messages).toHaveCount(before + 1, { timeout: 10_000 });
  // 收到回复
  await expect(messages).toHaveCount(before + 2, { timeout: 240_000 });
});
