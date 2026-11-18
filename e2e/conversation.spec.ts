import { test, expect } from "@playwright/test";

const replyTimeout = 240_000;

async function openNewConversation(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "对话", exact: true }).click();
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "新建对话", exact: true }).click();
  // 等待新建的「新对话」成为活动对话（会话列表中该条目 aria-pressed=true）
  const activeItem = page
    .getByRole("region", { name: "会话列表" })
    .locator('button[aria-pressed="true"]');
  await expect(activeItem).toContainText("新对话", { timeout: 10_000 });
  // 等待 ChatPanel 因会话切换而重挂载完成，避免输入在重挂载中被丢弃
  await page.waitForTimeout(800);
}

test("新建对话、发送、收到回复、上键回填、追问", async ({ page }) => {
  test.setTimeout(600_000);
  await openNewConversation(page);
  const input = page.getByRole("textbox", { name: "向阅读助手提问" });
  const send = page.getByRole("button", { name: "提问", exact: true });
  const messages = page.locator("[data-message-content]");

  const question = "用一句话解释什么是极限";
  await input.click();
  await input.type(question);
  await send.click();
  // 等待助手回复（1 用户 + 1 助手）
  await expect(messages).toHaveCount(2, { timeout: replyTimeout });
  // 等生成完全结束、输入框恢复可用
  await expect(input).toBeEnabled({ timeout: replyTimeout });

  // D9：空输入按 ↑ 回填上一次发送的内容
  await input.press("ArrowUp");
  await expect(input).toHaveValue(question);

  // 追问
  await input.click();
  await input.type("再详细一点");
  await send.click();
  await expect(messages).toHaveCount(4, { timeout: replyTimeout });
  await expect(input).toBeEnabled({ timeout: replyTimeout });
});
