import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    calloutFidelityEditor?: EditorController;
  }
}

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'callout-fidelity-test'
      document.body.prepend(host)
      window.calloutFidelityEditor = createEditor({
        element: host,
        outline: false,
        content: {
          type: 'doc',
          content: [
            { type: 'callout', content: [{ type: 'paragraph', content: [{ type: 'text', text: '提示文字' }] }] },
            { type: 'paragraph', content: [{ type: 'text', text: '后文' }] },
          ],
        },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.calloutFidelityEditor));
  return page.locator("#callout-fidelity-test");
}

const snapshot = (page: Page) =>
  page.evaluate(() => window.__semloRequireFixture("calloutFidelityEditor").getSnapshot());

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("highlight blocks show the reference palette and preserve selection when changing color", async ({ page }) => {
  const host = await mount(page);
  const block = host.locator("aside[data-semlo-editor-callout]");
  await block.getByText("提示文字").click();
  const toolbar = page.locator(".semlo-editor-callout-palette:visible");
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole("button")).toHaveCount(10);
  await expect(toolbar.getByRole("button", { name: "浅蓝" })).toHaveAttribute("aria-pressed", "true");
  await expect(block).toHaveCSS("background-color", "rgba(192, 221, 252, 0.5)");
  await expect(block).toHaveCSS("border-top-color", "rgb(129, 187, 248)");
  const [blockBox, toolbarBox] = await Promise.all([block.boundingBox(), toolbar.boundingBox()]);
  if (!blockBox || !toolbarBox) throw new Error("Missing highlight block geometry");
  expect(toolbarBox.width).toBeCloseTo(298, 0);
  expect(toolbarBox.height).toBeCloseTo(36, 0);
  expect(blockBox.y - toolbarBox.y - toolbarBox.height).toBeCloseTo(4, 0);

  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("calloutFidelityEditor").editor;
    let textPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "提示文字") textPos = pos;
    });
    editor.commands.setTextSelection({ from: textPos, to: textPos + 2 });
  });
  const selection = await page.evaluate(() =>
    window.__semloRequireFixture("calloutFidelityEditor").editor.state.selection.toJSON(),
  );
  await toolbar.getByRole("button", { name: "粉红" }).click();
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "粉红" })).toHaveAttribute("aria-pressed", "true");
  await expect(block).toHaveCSS("background-color", "rgba(248, 206, 211, 0.5)");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("calloutFidelityEditor").editor.state.selection.toJSON()),
  ).toEqual(selection);
  expect((await snapshot(page)).html).toContain('data-tone="pink"');
  expect(await page.evaluate(() => window.__semloRequireFixture("calloutFidelityEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(block).toHaveCSS("background-color", "rgba(192, 221, 252, 0.5)");
  expect(await page.evaluate(() => window.__semloRequireFixture("calloutFidelityEditor").editor.commands.redo())).toBe(
    true,
  );
  await expect(block).toHaveCSS("background-color", "rgba(248, 206, 211, 0.5)");
});

test("highlight colors round trip through HTML and the palette follows focus and read-only state", async ({ page }) => {
  const host = await mount(page);
  const block = host.locator("aside[data-semlo-editor-callout]");
  await block.getByText("提示文字").click();
  const toolbar = page.locator(".semlo-editor-callout-palette:visible");
  await toolbar.getByRole("button", { name: "浅绿" }).click();
  const colored = await snapshot(page);
  await page.evaluate((html) => window.__semloRequireFixture("calloutFidelityEditor").setContent(html), colored.html);
  expect((await snapshot(page)).json).toEqual(colored.json);
  await expect(host.locator("aside[data-semlo-editor-callout]")).toHaveAttribute("data-tone", "green");
  await host.getByText("后文").click();
  await expect(page.locator(".semlo-editor-callout-palette:visible")).toHaveCount(0);
  await host.getByText("提示文字").click();
  await expect(page.locator(".semlo-editor-callout-palette:visible")).toHaveCount(1);
  await page.evaluate(() => window.__semloRequireFixture("calloutFidelityEditor").setEditable(false));
  await expect(page.locator(".semlo-editor-callout-palette:visible")).toHaveCount(0);
  await page.evaluate(() => window.__semloRequireFixture("calloutFidelityEditor").destroy());
  await expect(host.locator("aside[data-semlo-editor-callout]")).toHaveCount(0);
});

test("typing hides the palette until the highlight block is clicked again", async ({ page }) => {
  const host = await mount(page);
  const block = host.locator("aside[data-semlo-editor-callout]");
  await block.getByText("提示文字").click();
  await expect(page.locator(".semlo-editor-callout-palette:visible")).toHaveCount(1);
  await page.keyboard.type("新增");
  await expect(page.locator(".semlo-editor-callout-palette:visible")).toHaveCount(0);
  await block.click();
  await expect(page.locator(".semlo-editor-callout-palette:visible")).toHaveCount(1);
});
