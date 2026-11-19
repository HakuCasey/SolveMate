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

test("显示设置可切换夜间模式", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "系统设置", exact: true }).click();
  await page.getByText("显示设置", { exact: true }).click();

  const dark = page.getByRole("button", { name: "夜间模式" });
  await dark.click();
  await expect(dark).toHaveAttribute("aria-pressed", "true");

  await expect(page.getByRole("slider", { name: "对话字号" })).toHaveCount(0);
});

test("聊天栏即时预览并保存对话字号，题目字号保持原值", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "学科", exact: true }).click();
  await page
    .locator('nav[aria-label="学科"]')
    .getByRole("button", { name: "高等数学", exact: true })
    .click();
  await page
    .locator('[aria-label="资料类型"]')
    .getByRole("button", { name: "题目", exact: true })
    .click();
  await page
    .locator('[aria-label="题目列表"] button[class*="courseItem"]')
    .first()
    .click();
  const question = page.locator(
    '[aria-label="题目阅读栏"] [class*="question"]',
  );
  const readingSize = await question
    .first()
    .evaluate((el) => getComputedStyle(el).fontSize);
  const chat = page.getByRole("region", { name: "聊天栏" });
  const input = chat.locator("textarea");
  await chat.getByRole("button", { name: "调整对话字号" }).click();
  const slider = page.getByRole("slider", { name: "对话字号" });
  await expect(slider).toHaveAttribute("aria-valuemin", "8");
  await expect(slider).toHaveAttribute("aria-valuemax", "21");
  await slider.press("End");
  await expect(input).toHaveCSS("font-size", "21px");
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith("/local-api/v1/user/state") &&
      response.request().method() === "PUT" &&
      response.request().postData()?.includes('"chatFontSize":8') === true &&
      response.ok(),
  );
  await slider.press("Home");
  await saved;
  await expect(input).toHaveCSS("font-size", "8px");
  await expect(question.first()).toHaveCSS("font-size", readingSize);
  await slider.press("Escape");
  await page.reload();
  await expect(input).toHaveCSS("font-size", "8px");
});
