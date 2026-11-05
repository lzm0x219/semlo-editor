import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    outlineOverlayEditors?: EditorController[];
  }
}

async function mount(page: Page, width = 1200) {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      document.body.style.margin = '0'
      const host = document.createElement('div')
      host.id = 'outline-overlay-test'
      host.style.width = '${width}px'
      document.body.append(host)
      window.outlineOverlayEditors = [createEditor({
        element: host,
        content: '<h1>第一节</h1><p>第一段正文</p><h2>子标题</h2><p>第二段正文</p><h3>三级标题</h3><p>第三段正文</p><h1>第二节</h1><p>最后正文</p>',
      })]
    `,
  });
  await page.waitForFunction(() => Boolean(window.outlineOverlayEditors));
  return page.locator("#outline-overlay-test");
}

test("the outline rail expands on hover without reflowing the editor and closes on leaving", async ({ page }) => {
  const host = await mount(page);
  const nav = host.locator(".semlo-editor-outline");
  const compact = nav.getByRole("button", { name: "展开大纲" });
  const prose = host.locator(".semlo-editor-prose");
  const before = (await prose.boundingBox())!;
  const rail = (await nav.boundingBox())!;
  expect(rail.width).toBe(50);
  expect((await host.boundingBox())!.x + 1200 - (rail.x + rail.width)).toBe(8);
  const marks = await nav.locator(".semlo-editor-outline-mark").evaluateAll((lines) =>
    lines.map((line) => {
      const box = line.getBoundingClientRect();
      return { width: box.width, top: box.top, right: box.right };
    }),
  );
  expect(marks.map((line) => line.width)).toEqual([24, 16, 11, 24]);
  expect(marks.map((line) => line.right)).toEqual([marks[0].right, marks[0].right, marks[0].right, marks[0].right]);
  expect(marks.slice(1).map((line, index) => line.top - marks[index].top)).toEqual([28, 28, 28]);
  await expect(nav.getByRole("button", { name: "隐藏大纲" })).toBeHidden();

  await page.mouse.move(rail.x + rail.width / 2, rail.y + 60);
  await expect(nav.getByRole("button", { name: "隐藏大纲" })).toBeVisible();
  expect((await nav.boundingBox())!.width).toBe(305);
  expect(await prose.boundingBox()).toEqual(before);
  await nav.getByRole("button", { name: "折叠 第一节" }).click();
  await expect(nav.getByRole("button", { name: "子标题" })).toHaveCount(0);
  await page.mouse.move(200, 250);
  await expect(compact).toBeVisible();
  expect(await prose.boundingBox()).toEqual(before);

  // The reference also expands when a text-selection drag enters the outline.
  const bounds = (await compact.boundingBox())!;
  await page.mouse.move(200, 180);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(nav.getByRole("button", { name: "隐藏大纲" })).toBeVisible();
  await page.mouse.up();
});

test("keyboard access, live headings, read-only and disposal preserve document state", async ({ page }) => {
  const host = await mount(page);
  const nav = host.locator(".semlo-editor-outline");
  const compact = nav.getByRole("button", { name: "展开大纲" });
  const before = await page.evaluate(() => window.__semloRequireFixture("outlineOverlayEditors")[0].getSnapshot().json);
  await compact.focus();
  await page.keyboard.press("Enter");
  const close = nav.getByRole("button", { name: "隐藏大纲" });
  await expect(close).toBeFocused();
  await nav.getByRole("button", { name: "折叠 第一节" }).focus();
  await page.keyboard.press("Enter");
  await expect(nav.getByRole("button", { name: "展开 第一节" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(compact).toBeFocused();
  expect(
    await page.evaluate(() => window.__semloRequireFixture("outlineOverlayEditors")[0].getSnapshot().json),
  ).toEqual(before);

  const width = (await host.locator(".semlo-editor-prose").boundingBox())!.width;
  await page.evaluate(() => window.__semloRequireFixture("outlineOverlayEditors")[0].setContent("<p>无标题正文</p>"));
  await expect(nav).toBeHidden();
  expect((await host.locator(".semlo-editor-prose").boundingBox())!.width).toBe(width);
  await page.evaluate(() => {
    window.__semloRequireFixture("outlineOverlayEditors")[0].setContent("<h1>恢复标题</h1><p>正文</p>");
    window.__semloRequireFixture("outlineOverlayEditors")[0].setEditable(false);
  });
  await expect(compact).toBeVisible();
  await compact.focus();
  await page.keyboard.press("Enter");
  await expect(nav.getByRole("button", { name: "恢复标题" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.__semloRequireFixture("outlineOverlayEditors")[0].destroy());
  await expect(nav).toHaveCount(0);

  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      window.outlineOverlayEditors.push(
        createEditor({ element: document.querySelector('#outline-overlay-test'), outline: false, content: '<h1>关闭大纲</h1>' }),
      )
    `,
  });
  await expect(host.locator(".semlo-editor-outline")).toHaveCount(0);
});

test("a reduced right gutter moves the entry above the document and restores it when space returns", async ({
  page,
}) => {
  const host = await mount(page, 180);
  const nav = host.locator(".semlo-editor-outline");
  const compact = nav.getByRole("button", { name: "展开大纲" });
  const content = host.locator(".semlo-editor-content");
  const body = host.locator(".semlo-editor-editor-body");
  await expect(nav).not.toHaveClass(/is-inline/);
  expect((await nav.boundingBox())!.width).toBe(24);

  await page.evaluate(() => {
    window
      .__semloRequireFixture("outlineOverlayEditors")[0]
      .setContent("<h1>足够长的标题用于验证点击区域不会遮挡正文</h1><p>标题后的正文</p>");
    document.querySelector<HTMLElement>("#outline-overlay-test .semlo-editor-content")!.style.padding = "0 4px 32px";
  });
  await expect(nav).toHaveClass(/is-inline/);
  const [entry, documentBox] = await Promise.all([nav.boundingBox(), content.boundingBox()]);
  expect(entry!.y + entry!.height).toBeLessThanOrEqual(documentBox!.y);
  const heading = host.locator("h1");
  const title = (await heading.boundingBox())!;
  await heading.hover({ position: { x: title.width - 4, y: Math.min(8, title.height - 1) }, timeout: 3000 });
  await expect(compact).toBeVisible();
  const intersects = await heading.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return Boolean(
      document
        .elementFromPoint(rect.right - 4, rect.top + Math.min(8, rect.height - 1))
        ?.closest(".semlo-editor-outline"),
    );
  });
  expect(intersects).toBe(false);
  await compact.focus();
  await page.keyboard.press("Enter");
  await expect(nav.getByRole("button", { name: "隐藏大纲" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(compact).toBeFocused();

  await page.evaluate(() => window.__semloRequireFixture("outlineOverlayEditors")[0].setContent("<p>无标题的正文</p>"));
  await expect(nav).toBeHidden();
  const [noHeadingBody, noHeadingContent] = await Promise.all([body.boundingBox(), content.boundingBox()]);
  expect(noHeadingContent!.y).toBe(noHeadingBody!.y);

  await page.evaluate(() => {
    window.__semloRequireFixture("outlineOverlayEditors")[0].setContent("<h1>只读标题</h1><p>只读正文</p>");
    window.__semloRequireFixture("outlineOverlayEditors")[0].setEditable(false);
  });
  await expect(compact).toBeVisible();
  await expect(nav).toHaveClass(/is-inline/);
  await compact.focus();
  await page.keyboard.press("Enter");
  await expect(nav.getByRole("button", { name: "只读标题" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.mouse.move(20, 5);
  await content.evaluate((element) => (element.style.padding = ""));
  await expect(nav).not.toHaveClass(/is-inline/);
  await expect(compact).toBeVisible();
  expect((await nav.boundingBox())!.width).toBe(24);
  await host.evaluate((element) => (element.style.width = "1200px"));
  await expect.poll(async () => (await nav.boundingBox())!.width).toBe(50);
  await expect(nav).not.toHaveClass(/is-inline/);
  await content.evaluate((element) => (element.style.padding = "0 4px 32px"));
  await expect(nav).toHaveClass(/is-inline/);
});

test("touch can open and dismiss the outline without covering the compact document text", async ({ page }) => {
  const browser = page.context().browser()!;
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 320, height: 844 } });
  try {
    const touchPage = await context.newPage();
    const host = await mount(touchPage, 320);
    const nav = host.locator(".semlo-editor-outline");
    const compact = nav.getByRole("button", { name: "展开大纲" });
    const prose = host.locator(".semlo-editor-prose");
    const proseBounds = (await prose.boundingBox())!;
    expect((await nav.boundingBox())!.width).toBe(24);
    const blocked = await touchPage.evaluate(
      ({ x, y }) => {
        const element = document.elementFromPoint(x, y);
        return Boolean(element?.closest(".semlo-editor-outline"));
      },
      { x: proseBounds.x + proseBounds.width - 2, y: proseBounds.y + 60 },
    );
    expect(blocked).toBe(false);
    await compact.tap();
    await expect(nav.getByRole("button", { name: "隐藏大纲" })).toBeVisible();
    expect((await prose.boundingBox())!.width).toBe(proseBounds.width);
    await host
      .locator("h1")
      .first()
      .tap({ position: { x: 5, y: 5 } });
    await expect(compact).toBeVisible();
    await host.locator(".semlo-editor-content").evaluate((element) => (element.style.padding = "0 4px 32px"));
    await expect(nav).toHaveClass(/is-inline/);
    await compact.tap();
    await expect(nav.getByRole("button", { name: "隐藏大纲" })).toBeVisible();
    await host.locator(".semlo-editor-editor-body").tap({ position: { x: 2, y: 2 } });
    await expect(compact).toBeVisible();
  } finally {
    await context.close();
  }
});

test("the outline stays below a sticky toolbar while the document scrolls", async ({ page }) => {
  const host = await mount(page, 800);
  await page.evaluate(() => {
    window
      .__semloRequireFixture("outlineOverlayEditors")[0]
      .setContent(
        "<h1>标题</h1>" + Array.from({ length: 100 }, (_, index) => `<p>第 ${index + 1} 段正文</p>`).join(""),
      );
    document
      .querySelector<HTMLElement>("#outline-overlay-test")!
      .style.setProperty("--semlo-editor-toolbar-sticky-top", "52px");
    window.scrollTo(0, 500);
  });
  const toolbar = host.locator(".semlo-editor-toolbar");
  const nav = host.locator(".semlo-editor-outline");
  await expect.poll(async () => (await toolbar.boundingBox())!.y).toBeCloseTo(52, 0);
  await expect
    .poll(async () => {
      const [bar, outline] = await Promise.all([toolbar.boundingBox(), nav.boundingBox()]);
      return outline!.y - (bar!.y + bar!.height);
    })
    .toBeCloseTo(35, 0);
});

test("outline instances keep their own state and do not overlap adjacent editors", async ({ page }) => {
  const first = await mount(page, 600);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'outline-overlay-second'
      host.style.width = '600px'
      document.body.append(host)
      window.outlineOverlayEditors.push(createEditor({ element: host, content: '<h1>独立标题</h1><p>正文</p>' }))
    `,
  });
  const second = page.locator("#outline-overlay-second");
  const firstNav = first.locator(".semlo-editor-outline");
  const secondNav = second.locator(".semlo-editor-outline");
  const firstCompact = firstNav.getByRole("button", { name: "展开大纲" });
  const secondCompact = secondNav.getByRole("button", { name: "展开大纲" });
  await firstCompact.focus();
  await page.keyboard.press("Enter");
  await expect(firstNav.getByRole("button", { name: "第一节", exact: true })).toBeVisible();
  await secondCompact.focus();
  await page.keyboard.press("Enter");
  await expect(firstCompact).toBeVisible();
  await expect(secondNav.getByRole("button", { name: "独立标题" })).toBeVisible();
  await expect(secondNav.getByRole("button", { name: "第一节", exact: true })).toHaveCount(0);
  await page.evaluate(() => window.__semloRequireFixture("outlineOverlayEditors")[0].destroy());
  await expect(firstNav).toHaveCount(0);
  await expect(secondNav.getByRole("button", { name: "独立标题" })).toBeVisible();
});
