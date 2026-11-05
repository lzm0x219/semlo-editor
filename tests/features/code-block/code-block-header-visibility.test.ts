import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    codeHeaderEditor?: EditorController;
  }
}

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'code-header-test'
      host.style.width = '800px'
      document.body.append(host)
      window.codeHeaderEditor = createEditor({
        element: host,
        outline: false,
        content: '<pre data-title="first" data-theme="dark"><code class="language-javascript">first</code></pre>' +
          '<pre data-title="second"><code class="language-python">second</code></pre>' +
          '<pre data-title="folded" data-collapsed="true"><code>folded</code></pre>',
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.codeHeaderEditor));
  return page.locator("#code-header-test");
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("hiding title bars skips folded blocks and a focused block can reveal its own header", async ({ page }) => {
  const host = await mount(page);
  const cards = host.locator(".semlo-editor-code-card");
  await cards.first().locator("code").click();
  await cards.first().hover();
  await cards.first().getByRole("button", { name: "代码块更多设置" }).click();
  const menu = page.getByRole("menu", { name: "代码块设置" });
  await menu.getByRole("menuitem", { name: "隐藏全文代码块标题栏" }).click();

  await expect(menu).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("成功");
  await expect(page.getByRole("status")).toHaveCSS("position", "fixed");
  await expect(page.getByRole("status")).toHaveCSS("top", "24px");
  await expect(cards.nth(0).locator(".semlo-editor-code-header")).toBeHidden();
  await expect(cards.nth(1).locator(".semlo-editor-code-header")).toBeHidden();
  await expect(cards.nth(2).locator(".semlo-editor-code-header")).toBeVisible();
  await expect(cards.nth(2)).toHaveClass(/is-collapsed/);
  const firstHandle = cards.nth(0).locator(".semlo-editor-code-header-reveal");
  const secondHandle = cards.nth(1).locator(".semlo-editor-code-header-reveal");
  await expect(firstHandle).toBeVisible();
  await expect(secondHandle).toBeHidden();
  const handleBounds = await firstHandle.boundingBox();
  expect(handleBounds?.width).toBe(48);
  expect(handleBounds?.height).toBe(13);
  const firstBody = await cards.first().locator(".semlo-editor-code-body").boundingBox();
  const firstCard = await cards.first().boundingBox();
  expect(firstBody!.y - firstCard!.y).toBeLessThan(3);

  await cards.nth(1).locator("code").click();
  await expect(firstHandle).toBeHidden();
  await expect(secondHandle).toBeVisible();
  await secondHandle.click();
  await expect(cards.nth(1).locator(".semlo-editor-code-header")).toBeVisible();
  await expect(cards.nth(0).locator(".semlo-editor-code-header")).toBeHidden();
  const blocks = await page.evaluate(() =>
    window
      .__semloRequireFixture("codeHeaderEditor")
      .getSnapshot()
      .json.content!.filter((node) => node.type === "codeBlock"),
  );
  expect(blocks.map((node) => node.attrs?.headerHidden)).toEqual([true, false, false]);
  expect(blocks.map((node) => node.attrs?.title)).toEqual(["first", "second", "folded"]);
  expect(blocks[0].attrs?.language).toBe("javascript");
  expect(blocks[1].attrs?.language).toBe("python");
});

test("hidden headers round-trip in HTML and JSON without hiding new blocks", async ({ page }) => {
  const host = await mount(page);
  const cards = host.locator(".semlo-editor-code-card");
  await cards.first().locator("code").click();
  await cards.first().hover();
  await cards.first().getByRole("button", { name: "代码块更多设置" }).click();
  await page.getByRole("menuitem", { name: "隐藏全文代码块标题栏" }).click();
  const saved = await page.evaluate(() => window.__semloRequireFixture("codeHeaderEditor").getSnapshot());
  expect(saved.html).toContain('data-code-header-hidden="true"');
  expect(
    saved.json.content!.filter((node) => node.type === "codeBlock").map((node) => node.attrs?.headerHidden),
  ).toEqual([true, true, false]);

  await page.evaluate((html) => window.__semloRequireFixture("codeHeaderEditor").setContent(html), saved.html);
  await expect(cards.first().locator(".semlo-editor-code-header")).toBeHidden();
  await expect(cards.nth(1).locator(".semlo-editor-code-header")).toBeHidden();
  await expect(cards.nth(2).locator(".semlo-editor-code-header")).toBeVisible();
  await page.evaluate((json) => window.__semloRequireFixture("codeHeaderEditor").setContent(json), saved.json);
  await expect(cards.first().locator(".semlo-editor-code-header")).toBeHidden();

  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("codeHeaderEditor").editor;
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: "paragraph" });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.toggleCodeBlock();
  });
  await expect(cards).toHaveCount(4);
  await expect(cards.nth(3).locator(".semlo-editor-code-header")).toBeVisible();
  const last = await page.evaluate(() =>
    window
      .__semloRequireFixture("codeHeaderEditor")
      .getSnapshot()
      .json.content!.filter((node) => node.type === "codeBlock")
      .at(-1),
  );
  expect(last?.attrs?.headerHidden).toBe(false);
});

test("hiding headers does not replace a text edit in the undo stack", async ({ page }) => {
  const host = await mount(page);
  const cards = host.locator(".semlo-editor-code-card");
  const code = cards.first().locator("code");
  await code.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" undo-test");
  await cards.first().hover();
  await cards.first().getByRole("button", { name: "代码块更多设置" }).click();
  await page.getByRole("menuitem", { name: "隐藏全文代码块标题栏" }).click();
  expect(await page.evaluate(() => window.__semloRequireFixture("codeHeaderEditor").editor.commands.undo())).toBe(true);
  await expect(code).toHaveText("first");
  await expect(cards.first().locator(".semlo-editor-code-header")).toBeHidden();
  expect(await page.evaluate(() => window.__semloRequireFixture("codeHeaderEditor").editor.commands.redo())).toBe(true);
  await expect(code).toHaveText("first undo-test");
  await expect(cards.first().locator(".semlo-editor-code-header")).toBeHidden();
});

test("revealing one header does not replace a text edit in the undo stack", async ({ page }) => {
  const host = await mount(page);
  const card = host.locator(".semlo-editor-code-card").first();
  const code = card.locator("code");
  await code.click();
  await page.keyboard.press("End");
  await page.keyboard.type(" undo-test");
  await card.hover();
  await card.getByRole("button", { name: "代码块更多设置" }).click();
  await page.getByRole("menuitem", { name: "隐藏全文代码块标题栏" }).click();
  await card.getByRole("button", { name: "显示代码块标题栏" }).click();
  await expect(card.locator(".semlo-editor-code-header")).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("codeHeaderEditor").editor.commands.undo())).toBe(true);
  await expect(code).toHaveText("first");
  await expect(card.locator(".semlo-editor-code-header")).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("codeHeaderEditor").editor.commands.redo())).toBe(true);
  await expect(code).toHaveText("first undo-test");
  await expect(card.locator(".semlo-editor-code-header")).toBeVisible();
});

test("the packaged stylesheet renders the hidden-header handle and feedback", async ({ page }) => {
  const host = await mount(page);
  await page.evaluate(() => {
    for (const element of document.querySelectorAll('style, link[rel="stylesheet"]')) element.remove();
  });
  await page.addStyleTag({ content: readFileSync("packages/core/dist/style.css", "utf8") });
  const card = host.locator(".semlo-editor-code-card").first();
  await card.locator("code").click();
  await card.hover();
  await card.getByRole("button", { name: "代码块更多设置" }).click();
  await page.getByRole("menuitem", { name: "隐藏全文代码块标题栏" }).click();
  await expect(card.locator(".semlo-editor-code-header")).toBeHidden();
  const handle = card.locator(".semlo-editor-code-header-reveal");
  await expect(handle).toBeVisible();
  await expect(handle).toHaveCSS("position", "absolute");
  expect((await handle.boundingBox())!.width).toBe(48);
  await expect(page.getByRole("status")).toHaveCSS("position", "fixed");
  await expect(page.getByRole("status")).toHaveCSS("top", "24px");
});
