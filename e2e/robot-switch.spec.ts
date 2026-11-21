import { test, expect } from "@playwright/test";

test("切换机器人触发确认并新建对话", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByRole("button", { name: "对话", exact: true }).click();
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "新建对话", exact: true }).click();
  await page.waitForTimeout(800);

  // 切换机器人
  const picker = page.getByRole("combobox", { name: "选择机器人" });
  const triggerBounds = await picker.boundingBox();
  await picker.click();
  const menu = page.getByRole("listbox");
  await expect(menu).toBeVisible();
  const menuBounds = await menu.boundingBox();
  expect(menuBounds!.y).toBeGreaterThanOrEqual(
    triggerBounds!.y + triggerBounds!.height,
  );
  await menu.getByRole("option", { name: "高数教师", exact: true }).click();
  await expect(page.getByText("确认切换")).toBeVisible();
  await expect(
    page.getByText("切换机器人后对话重新开始", { exact: false }),
  ).toBeVisible();

  // 确认切换，对话框关闭
  await page.getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.getByText("确认切换")).toBeHidden();
});
