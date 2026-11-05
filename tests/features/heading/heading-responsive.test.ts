import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    responsiveHeadingEditor?: EditorController;
  }
}

async function mount(page: Page, width: number, editable = true) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      document.body.style.margin = '0'
      const host = document.createElement('div')
      host.id = 'heading-responsive-test'
      host.style.width = '${width}px'
      host.style.overflow = 'auto'
      document.body.append(host)
      window.responsiveHeadingEditor = createEditor({
        element: host,
        outline: false,
        editable: ${editable},
        content: '<h1>标题展示测试</h1><p>标题下正文</p><blockquote><h2>嵌套标题</h2><p>嵌套正文</p></blockquote>',
      })
      host.querySelector('.semlo-editor-toolbar').style.display = 'none'
      if (${width} < 320) host.querySelector('.semlo-editor-content').style.padding = '0 4px 32px'
    `,
  });
  await page.waitForFunction(() => Boolean(window.responsiveHeadingEditor));
  return page.locator("#heading-responsive-test");
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("an editor initially mounted read-only keeps the same narrow heading layout when editing is enabled", async ({
  page,
}) => {
  const host = await mount(page, 320, false);
  const heading = host.locator("h1");
  await expect(heading).toHaveClass(/semlo-editor-block-handle-inset/);
  const measure = () =>
    heading.evaluate((element) => {
      const text = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode()!;
      const range = document.createRange();
      range.selectNodeContents(text);
      const box = range.getBoundingClientRect();
      return { left: box.left, width: box.width, height: box.height };
    });
  const initial = await measure();
  await page.evaluate(() => window.__semloRequireFixture("responsiveHeadingEditor").setEditable(true));
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  await expect.poll(measure).toEqual(initial);
  await heading.hover();
  await expect(page.getByRole("button", { name: "块操作" })).toBeVisible();
});

for (const width of [320, 180, 70]) {
  test(`heading layout remains stable while switching editability in a ${width}px container`, async ({ page }) => {
    const host = await mount(page, width);
    const heading = host.locator("h1");
    const fold = heading.getByRole("button", { name: /折叠标题/ });
    const handle = page.getByRole("button", { name: "块操作" });
    await expect(heading).toHaveClass(/semlo-editor-block-handle-inset/);
    await heading.hover();
    await expect(handle).toBeVisible();
    const before = await page.evaluate(
      () => window.__semloRequireFixture("responsiveHeadingEditor").getSnapshot().json,
    );
    const measure = () =>
      host.locator(".semlo-editor-prose").evaluate((root) =>
        ["h1", "blockquote h2"].map((selector) => {
          const element = root.querySelector(selector)!;
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          const text = walker.nextNode()!;
          const range = document.createRange();
          range.selectNodeContents(text);
          const box = range.getBoundingClientRect();
          return { left: box.left, width: box.width, height: box.height };
        }),
      );
    const editing = await measure();
    await handle.click();
    await expect(page.getByRole("menu", { name: "块操作" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.evaluate(() => window.__semloRequireFixture("responsiveHeadingEditor").setEditable(false));
    await expect(handle).toBeHidden();
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    await expect.poll(measure, { timeout: 2000 }).toEqual(editing);
    await fold.click();
    await expect(host.getByText("标题下正文", { exact: true })).toBeHidden();
    await heading.getByRole("button", { name: /展开标题/ }).click();
    await expect(host.getByText("标题下正文", { exact: true })).toBeVisible();
    const nested = host.locator("blockquote h2");
    await nested.getByRole("button", { name: /折叠标题/ }).click();
    await expect(host.getByText("嵌套正文", { exact: true })).toBeHidden();
    await nested.getByRole("button", { name: /展开标题/ }).click();
    await expect(host.getByText("嵌套正文", { exact: true })).toBeVisible();

    await page.evaluate(() => window.__semloRequireFixture("responsiveHeadingEditor").setEditable(true));
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    await expect.poll(measure, { timeout: 2000 }).toEqual(editing);
    await heading.hover();
    await expect(handle).toBeVisible();
    expect(
      await page.evaluate(() => window.__semloRequireFixture("responsiveHeadingEditor").getSnapshot().json),
    ).toEqual(before);
  });
}
