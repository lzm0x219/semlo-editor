import { expect, test } from "@rstest/playwright";

test("insertion groups have distinct illustrations in consistently sized rows", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.getByRole("toolbar", { name: "文本格式" }).getByRole("button", { name: "插入内容" }).click();
  const menu = page.getByRole("dialog", { name: "插入内容" });
  await expect(menu).toBeVisible();
  const sections = await menu.locator(".semlo-editor-card-section").allTextContents();
  expect(sections).toEqual([
    "基础",
    "智能专区",
    "画板类",
    "数据表",
    "程序员专区",
    "布局和样式",
    "小工具",
    "嵌入本地文件",
    "嵌入第三方服务",
  ]);
  const ids = [
    "ai",
    "canvas",
    "mindmap",
    "flowchart",
    "database",
    "album",
    "kanban",
    "uml",
    "diagram",
    "gallery",
    "yuque",
    "vote",
    "checkin",
    "encrypted",
    "youku",
    "bilibili",
    "netease",
    "taobao",
    "amap",
    "modao",
    "figma",
    "processon",
    "canva",
    "juejin",
    "codepen",
    "yida",
    "jinshuju",
  ];
  const illustrations: string[] = [];
  for (const id of ids) {
    const row = menu.locator(`.semlo-editor-card-item[data-command="${id}"]`);
    await expect(row).toHaveCount(1);
    const icon = row.locator(".semlo-editor-card-icon");
    await expect(icon).toHaveAttribute("aria-hidden", "true");
    const svg = icon.locator("svg");
    await expect(svg).toHaveAttribute("viewBox", "0 0 32 32");
    illustrations.push((await svg.innerHTML()).trim());
  }
  expect(new Set(illustrations).size).toBe(ids.length);

  const canvas = menu.locator('.semlo-editor-card-item[data-command="canvas"]');
  await canvas.scrollIntoViewIfNeeded();
  const [panelBox, rowBox, iconBox, svgBox] = await Promise.all([
    menu.boundingBox(),
    canvas.boundingBox(),
    canvas.locator(".semlo-editor-card-icon").boundingBox(),
    canvas.locator("svg").boundingBox(),
  ]);
  if (!panelBox || !rowBox || !iconBox || !svgBox) throw new Error("Insertion panel has no visible geometry");
  expect(panelBox.width).toBe(290);
  expect(panelBox.height).toBe(596);
  expect(rowBox.height).toBeGreaterThanOrEqual(50);
  expect(iconBox.width).toBe(36);
  expect(iconBox.height).toBe(36);
  expect(svgBox.width).toBe(28);
  expect(svgBox.height).toBe(28);

  const last = menu.locator('.semlo-editor-card-item[data-command="jinshuju"]');
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeVisible();
  await expect(last).toContainText("金数据");
});
