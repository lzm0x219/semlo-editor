import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    blockPanelEditor?: EditorController;
  }
}

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      localStorage.setItem('semlo-editor.recent-commands.v1', '["link"]')
      const host = document.createElement('div')
      host.id = 'block-panel-test'
      document.body.prepend(host)
      window.blockPanelEditor = createEditor({ element: host, content: '<p>第一段</p><p>第二段</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.blockPanelEditor));
  return page.locator("#block-panel-test");
}

async function openBelow(page: Page) {
  await page.locator("#block-panel-test .semlo-editor-prose p").first().hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "在下方添加" }).click();
  return page.getByRole("dialog", { name: "插入内容" });
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("block insertion has its own groups without search or recent items", async ({ page }) => {
  const host = await mount(page);
  const before = await page.evaluate(() => window.__semloRequireFixture("blockPanelEditor").getSnapshot().json);
  const panel = await openBelow(page);
  await expect(panel.getByLabel("搜索插入内容")).toHaveCount(0);
  await expect(panel.getByLabel("最近使用")).toHaveCount(0);
  await expect(panel.locator('[data-command="link"]')).toHaveCount(0);
  await expect(panel.locator(".semlo-editor-card-section")).toHaveText([
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
  await expect(panel.locator('[data-command="ai"]')).toBeDisabled();
  await expect(panel.locator('[data-command="canvas"]')).toBeEnabled();
  await expect(panel.locator('[data-command="database"]')).toBeEnabled();
  expect(await page.evaluate(() => window.__semloRequireFixture("blockPanelEditor").getSnapshot().json)).toEqual(
    before,
  );

  await page.keyboard.press("ArrowDown");
  await expect(panel.locator('[data-command="image"]')).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("blockPanelEditor").getSnapshot().json)).toEqual(
    before,
  );

  await host.getByRole("button", { name: "插入内容" }).click();
  const toolbarPanel = page.getByRole("dialog", { name: "插入内容" });
  await expect(toolbarPanel.getByLabel("搜索插入内容")).toBeVisible();
  await expect(toolbarPanel.getByLabel("最近使用").getByRole("button", { name: "链接" })).toBeVisible();
});

test("choosing a block below inserts at the target and undo restores the document", async ({ page }) => {
  const host = await mount(page);
  const before = await page.evaluate(() => window.__semloRequireFixture("blockPanelEditor").getSnapshot().json);
  const panel = await openBelow(page);
  await panel.locator('[data-command="quote"]').click();
  await expect(host.locator(".semlo-editor-prose > blockquote")).toHaveCount(1);
  expect(
    (await page.evaluate(() => window.__semloRequireFixture("blockPanelEditor").getSnapshot().json)).content?.map(
      (node) => node.type,
    ),
  ).toEqual(["paragraph", "blockquote", "paragraph"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("blockPanelEditor").editor.commands.undo())).toBe(true);
  expect(await page.evaluate(() => window.__semloRequireFixture("blockPanelEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("hover opens the adjacent insert panel and switches between block submenus", async ({ page }) => {
  const host = await mount(page);
  const before = await page.evaluate(() => window.__semloRequireFixture("blockPanelEditor").getSnapshot().json);
  await host.locator(".semlo-editor-prose p").first().hover();
  const handle = page.locator(".semlo-editor-block-handle:visible");
  await handle.click();
  const menu = page.getByRole("menu", { name: "块操作" });
  await expect(menu.locator(':scope > .semlo-editor-block-menu-item > svg[aria-hidden="true"]')).toHaveCount(6);
  await expect(menu.getByRole("separator")).toHaveCount(3);
  const handleBox = await handle.boundingBox(),
    menuBox = await menu.boundingBox();
  if (!handleBox || !menuBox) throw new Error("Missing block menu anchor geometry");
  expect(Math.abs(menuBox.x - handleBox.x)).toBeLessThan(2);
  expect(Math.abs(menuBox.y - (handleBox.y + handleBox.height + 4))).toBeLessThan(2);
  const trigger = menu.getByRole("menuitem", { name: "在下方添加" });
  await trigger.hover();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await expect(menu).toBeVisible();
  await expect(panel).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const parentBox = await menu.boundingBox(),
    childBox = await panel.boundingBox();
  if (!parentBox || !childBox) throw new Error("Missing block menu geometry");
  expect(Math.abs(childBox.x - (parentBox.x + parentBox.width + 6))).toBeLessThan(2);
  expect(Math.abs(childBox.y - parentBox.y)).toBeLessThan(2);
  await panel.locator('[data-command="image"]').hover();
  await expect(menu).toBeVisible();
  await expect(panel).toBeVisible();
  await menu.getByRole("menuitem", { name: "缩进" }).hover();
  await expect(panel).toHaveCount(0);
  await expect(menu.getByRole("menu", { name: "缩进" })).toBeVisible();
  await trigger.hover();
  await expect(menu.getByRole("menu", { name: "缩进" })).toHaveCount(0);
  await expect(panel).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("blockPanelEditor").getSnapshot().json)).toEqual(
    before,
  );
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(menu).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("blockPanelEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("the block insert panel flips at the viewport edge and follows scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 700 });
  const host = await mount(page);
  await page.evaluate(() => {
    const host = document.querySelector<HTMLElement>("#block-panel-test")!;
    host.style.width = "220px";
    host.style.marginLeft = "300px";
    host.style.marginTop = "280px";
    document.body.style.minHeight = "1800px";
  });
  await host.locator(".semlo-editor-prose p").first().hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  const menu = page.getByRole("menu", { name: "块操作" });
  await menu.getByRole("menuitem", { name: "在下方添加" }).hover();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  const beforeMenu = await menu.boundingBox(),
    beforePanel = await panel.boundingBox();
  if (!beforeMenu || !beforePanel) throw new Error("Missing block menu geometry");
  expect(beforePanel.x + beforePanel.width).toBeLessThanOrEqual(beforeMenu.x - 4);
  expect(beforePanel.x).toBeGreaterThanOrEqual(8);
  expect(beforePanel.y + beforePanel.height).toBeLessThanOrEqual(692);
  await page.evaluate(() => window.scrollBy(0, 100));
  await page.waitForFunction((originalTop) => {
    const menu = document.querySelector<HTMLElement>(".semlo-editor-block-menu");
    return Boolean(menu && menu.getBoundingClientRect().top < originalTop - 50);
  }, beforeMenu.y);
  const afterMenu = await menu.boundingBox(),
    afterPanel = await panel.boundingBox();
  if (!afterMenu || !afterPanel) throw new Error("Block menu closed while its target remained visible");
  expect(afterMenu.y).toBeLessThan(beforeMenu.y - 50);
  expect(afterPanel.x + afterPanel.width).toBeLessThanOrEqual(afterMenu.x - 4);
  await page.mouse.click(5, 5);
  await expect(menu).toHaveCount(0);
  await expect(panel).toHaveCount(0);
});

test("direct table insertion uses three rows and columns and supports undo", async ({ page }) => {
  const host = await mount(page);
  const prose = host.locator(".semlo-editor-prose");
  await prose.locator("p").first().click();
  const before = await page.evaluate(() => window.__semloRequireFixture("blockPanelEditor").getSnapshot().json);
  await host.getByRole("button", { name: "插入内容" }).click();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await panel.locator('[data-command="table"]').click();
  await expect(panel).toHaveCount(0);
  await expect(prose.locator("table tr")).toHaveCount(3);
  await expect(prose.locator("table tr").first().locator("td,th")).toHaveCount(3);
  await expect(page.locator(".semlo-editor-table-grid-popover")).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("blockPanelEditor").editor.commands.undo())).toBe(true);
  expect(await page.evaluate(() => window.__semloRequireFixture("blockPanelEditor").getSnapshot().json)).toEqual(
    before,
  );

  const below = await openBelow(page);
  await below.locator('[data-command="table"]').click();
  await expect(page.getByRole("menu", { name: "块操作" })).toHaveCount(0);
  await expect(prose.locator("table tr")).toHaveCount(3);
  await expect(prose.locator("table tr").first().locator("td,th")).toHaveCount(3);
  expect(await page.evaluate(() => window.__semloRequireFixture("blockPanelEditor").editor.commands.undo())).toBe(true);
  expect(await page.evaluate(() => window.__semloRequireFixture("blockPanelEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("read-only mode, document replacement and destruction clean up both panels", async ({ page }) => {
  const host = await mount(page);
  const menu = page.getByRole("menu", { name: "块操作" });
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await openBelow(page);
  await page.evaluate(() => window.__semloRequireFixture("blockPanelEditor").setEditable(false));
  await expect(menu).toHaveCount(0);
  await expect(panel).toHaveCount(0);
  await page.evaluate(() => window.__semloRequireFixture("blockPanelEditor").setEditable(true));
  await openBelow(page);
  await page.evaluate(() => window.__semloRequireFixture("blockPanelEditor").setContent("<p>替换内容</p>"));
  await expect(menu).toHaveCount(0);
  await expect(panel).toHaveCount(0);
  await expect(host.locator(".semlo-editor-prose")).toHaveText("替换内容");
  await openBelow(page);
  await page.evaluate(() => window.__semloRequireFixture("blockPanelEditor").destroy());
  await expect(menu).toHaveCount(0);
  await expect(panel).toHaveCount(0);
});
