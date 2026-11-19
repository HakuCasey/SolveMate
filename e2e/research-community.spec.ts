import { test, expect } from "@playwright/test";

test("教研室展示资料与工具选择", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "教研室", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /选择研发资料/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /选择教研工具/ }),
  ).toBeVisible();

  // 打开工具选择对话框，验证三个教研工具
  await page.getByRole("button", { name: /选择教研工具/ }).click();
  for (const name of ["讲义研发", "试题研发", "试题精讲"]) {
    await expect(page.getByText(name).first()).toBeVisible();
  }
});

test("社区内容展示内置资料与工具", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "系统设置", exact: true }).click();
  await page.getByText("社区内容", { exact: true }).click();
  await expect(page.getByText("高等数学示例教材").first()).toBeVisible();
  await expect(page.getByText("C 语言示例教材").first()).toBeVisible();
  await expect(page.getByText("学习资料与题目").first()).toBeVisible();
});
