import { test, expect } from "@playwright/test";

test("打开有残留 running turn 的对话后被纠正", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.getByRole("button", { name: "对话", exact: true }).click();
  await page.waitForTimeout(3000);

  // 打开含残留 running turn 的对话
  const list = page.getByRole("region", { name: "会话列表" });
  const conv = list
    .locator("button")
    .filter({ hasText: "用一句话解释什么是极限" })
    .first();
  await conv.click();

  // 恢复后输入框应可用（不再 busy），且不显示「正在保存回复」
  await expect(page.getByRole("textbox", { name: "向阅读助手提问" })).toBeEnabled(
    { timeout: 15_000 },
  );
  await expect(page.getByText("正在保存回复")).toBeHidden();
});
