import { test, expect } from "@playwright/test";

test("各主页面均可打开并导航", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.waitForTimeout(3000);
  for (const label of ["学科", "对话", "笔记", "教研室", "机器人"]) {
    const button = page.getByRole("button", { name: label, exact: true });
    await button.click();
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await page.waitForTimeout(400);
  }
});

test("系统设置菜单可打开帮助与反馈", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/");
  await page.waitForTimeout(3000);
  await page.getByRole("button", { name: "系统设置", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "系统设置选项" });
  await expect(menu.locator("button, a")).toHaveText([
    "AI 配置",
    "显示设置",
    "社区内容",
    "备份与恢复",
    "帮助与反馈",
  ]);
  await menu.getByRole("button", { name: "帮助与反馈" }).click();
  const help = page.getByRole("dialog", { name: "帮助与反馈" });
  await expect(help.getByRole("link", { name: "意见反馈" })).toHaveAttribute(
    "href",
    /\/issues\/new$/,
  );
  await expect(
    help.getByRole("link", { name: "使用指南", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "用户菜单" }).click();
  const account = page.getByRole("dialog", { name: "用户账户" });
  await expect(
    account.getByRole("button", { name: "账号设置", exact: true }),
  ).toBeVisible();
  await expect(account.getByRole("button", { name: "虚拟宠物" })).toBeEnabled();
  for (const name of ["邀请好友", "退出登录"]) {
    await expect(account.getByRole("button", { name })).toBeDisabled();
  }
  await expect(account.locator("img")).toHaveCount(0);
  const dividers = account.getByRole("separator");
  await expect(dividers).toHaveCount(2);
  await expect(dividers.first()).toBeVisible();
  await expect(dividers.last()).toBeVisible();
  await account.getByRole("button", { name: "账号设置" }).click();
  const dialog = page.getByRole("dialog", { name: "账号设置", exact: true });
  const name = dialog.getByRole("textbox", { name: "昵称" });
  await expect(name).toBeFocused();
  await expect(dialog.getByRole("button", { name: "保存" })).toBeDisabled();
  const initial = await name.inputValue();
  await name.fill("临时修改");
  await dialog.getByRole("button", { name: "取消" }).click();
  const avatar = page.getByRole("button", { name: "用户菜单" });
  await expect(avatar).toBeFocused();
  await avatar.click();
  await account.getByRole("button", { name: "账号设置" }).click();
  await expect(name).toHaveValue(initial);
  await name.press("Escape");
  await expect(avatar).toBeFocused();
  await expect(page.getByRole("button", { name: /帮助/ })).toHaveCount(0);
});

test("中间栏标题控制侧栏宽度", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "功能菜单" });
  const workspace = page.getByRole("region", { name: "学习工作区" });
  for (const label of ["学科", "对话", "笔记", "教研室", "机器人"]) {
    await nav.getByRole("button", { name: label, exact: true }).click();
    const toggle = workspace.getByRole("button", { name: "收起侧栏" });
    await expect(toggle).toHaveCount(1);
    await toggle.click();
    await expect(nav).toHaveAttribute("data-collapsed", "true");
    await workspace.getByRole("button", { name: "展开侧栏" }).click();
    await expect(nav).toHaveAttribute("data-collapsed", "false");
  }
});

test("并排工作区的标题栏底边对齐，长机器人名称收在栏内", async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 760 });
  await page.goto("/");
  const workspace = page.getByRole("region", { name: "学习工作区" });
  const nav = page.getByRole("navigation", { name: "功能菜单" });
  for (const name of ["对话", "笔记", "教研室", "机器人"]) {
    await nav.getByRole("button", { name, exact: true }).click();
    if (name === "机器人") {
      await workspace
        .getByRole("textbox", { name: "名称", exact: true })
        .fill("高等数学与计算机语言答疑".repeat(2));
    }
    const headers = workspace.locator("header:visible:not(article header)");
    const left = headers.nth(0);
    const right = headers.nth(1);
    await expect(right).toBeVisible();
    const [a, b] = await Promise.all([left.boundingBox(), right.boundingBox()]);
    expect(a!.x).toBeLessThan(b!.x);
    expect(a!.y + a!.height).toBe(b!.y + b!.height);
    if (name === "机器人") {
      const title = await right.getByRole("heading").boundingBox();
      expect(title!.y).toBeGreaterThanOrEqual(b!.y);
      expect(title!.y + title!.height).toBeLessThanOrEqual(b!.y + b!.height);
    }
  }
});

test("后台刷新失败沿系统设置提示，重试成功后清除标记", async ({ page }) => {
  await page.goto("/");
  const settings = page.getByRole("button", { name: "系统设置", exact: true });
  const status = page.locator('footer[aria-label="状态栏"]');
  await expect(status.getByRole("button")).toHaveCount(2);
  await page.evaluate(() =>
    window.dispatchEvent(
      new Event("beforeinstallprompt", { cancelable: true }),
    ),
  );
  await status.getByRole("button", { name: /^应用更新/ }).click();
  await expect(page.getByRole("button", { name: "安装应用" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "收起侧栏" }).click();
  const box = await page
    .getByRole("button", { name: "学科", exact: true })
    .boundingBox();
  const avatar = await page
    .getByRole("button", { name: "用户菜单" })
    .boundingBox();
  expect(box?.width).toBe(box?.height);
  expect(box?.width).toBe(avatar?.width);
  await page.getByRole("button", { name: "展开侧栏" }).click();

  const url = "**/local-api/v1/materials";
  await page.route(url, (route) =>
    route.fulfill({
      status: 503,
      json: { detail: "资料列表测试故障" },
    }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect(settings).toHaveAttribute("data-attention", "true");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await settings.click();
  await page
    .getByRole("button", { name: /备份与恢复.*有操作需要处理/ })
    .click();
  const backup = page.getByRole("dialog", { name: "备份与恢复" });
  await expect(
    backup.getByText("资料列表测试故障", { exact: false }),
  ).toBeVisible();
  await page.unroute(url);
  await backup.getByRole("button", { name: "重试刷新" }).click();
  await expect(
    backup.getByText("资料列表测试故障", { exact: false }),
  ).toHaveCount(0);
  await backup.getByRole("button", { name: "关闭备份与恢复" }).click();
  await expect(settings).not.toHaveAttribute("data-attention", "true");
  await settings.click();
  await expect(
    page.getByRole("button", { name: "备份与恢复", exact: true }),
  ).toBeVisible();
});

test("窄屏设置气泡按内容取宽，链接和表单都在视口内", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const widths: number[] = [];
  for (const title of ["帮助与反馈", "显示设置", "AI 配置"]) {
    await page.goto("/");
    await page.getByRole("button", { name: "系统设置", exact: true }).click();
    await page
      .getByRole("dialog", { name: "系统设置选项" })
      .getByRole("button", { name: title, exact: true })
      .click();
    const panel = page.getByRole("dialog", { name: title, exact: true });
    await expect(panel).toBeInViewport({ ratio: 1 });
    const rect = await panel.boundingBox();
    widths.push(rect!.width);
  }
  expect(widths[0]).toBeLessThan(widths[1]);
  expect(widths[1]).toBeLessThan(widths[2]);
});

test("窄屏切换学科、阅读和教研工具时保留有效内容空间", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "功能菜单" });
  await nav.getByRole("button", { name: "学科", exact: true }).click();
  const refresh = page.getByRole("button", { name: "刷新学习资料列表" });
  await expect(refresh).toBeInViewport({ ratio: 1 });
  await page
    .getByRole("button", { name: /高等数学示例教材/ })
    .first()
    .click();
  const pdf = page.getByLabel("资料第 1 页", { exact: true });
  await expect(pdf).toBeVisible();
  expect((await pdf.boundingBox())!.height).toBeGreaterThan(300);
  await nav.getByRole("button", { name: "教研室" }).click();
  for (const name of ["选择研发资料", "选择教研工具"]) {
    const text = page.getByRole("button", { name }).locator("span");
    expect((await text.boundingBox())!.width).toBeGreaterThan(40);
  }
  await page.getByRole("button", { name: "选择教研工具" }).click();
  const dialog = page.getByRole("dialog");
  const editor = await dialog.locator("textarea").first().boundingBox();
  expect(editor!.width).toBeGreaterThan(250);
  await page.keyboard.press("Escape");
  await nav.getByRole("button", { name: "机器人" }).click();
  const hint = page.getByText("记忆与能力选项目前仅保存配置。");
  await expect(hint).toBeHidden();
  await page.getByRole("tab", { name: "记忆与能力" }).click();
  await expect(hint).toBeVisible();
  await page.getByRole("tab", { name: "角色设定" }).click();
  await expect(hint).toBeHidden();
});

test("侧栏的宠物入口与账号菜单共用已保存的宠物名称", async ({ page }) => {
  await page.goto("/");
  const nav = page.getByRole("navigation", { name: "功能菜单" });
  await nav.getByRole("button", { name: "虚拟宠物" }).click();
  const pet = page.getByRole("dialog", { name: "虚拟宠物" });
  for (const action of ["显示宠物", "投喂", "玩耍"]) {
    await expect(pet.getByRole("button", { name: action })).toBeDisabled();
  }
  await pet.getByRole("button", { name: "修改宠物名称" }).click();
  const rename = page.getByRole("dialog", { name: "重命名" });
  const next = "小黑" + Date.now();
  await rename.getByLabel("名称").fill(next);
  await rename.getByRole("button", { name: "保存" }).click();
  await expect(pet.getByText(next)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "收起侧栏" }).click();
  await nav.getByRole("button", { name: "用户菜单" }).click();
  await page
    .getByRole("dialog", { name: "用户账户" })
    .getByRole("button", { name: "虚拟宠物" })
    .click();
  await expect(pet.getByText(next)).toBeVisible();
});
