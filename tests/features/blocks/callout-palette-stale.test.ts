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

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("palette color change survives synchronous controller destruction", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const host = await mount(page);
  await host.getByText("提示文字").click();
  const toolbar = page.locator(".semlo-editor-callout-palette:visible");
  await expect(toolbar).toBeVisible();
  await page.evaluate(() => {
    const c = window.__semloRequireFixture("calloutFidelityEditor");
    c.editor.on("update", () => c.destroy());
  });
  await toolbar.getByRole("button", { name: "粉红" }).click();
  await expect(toolbar).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("stale palette cannot recolor a replacement callout", async ({ page }) => {
  const host = await mount(page);
  await host.getByText("提示文字").click();
  const toolbar = page.locator(".semlo-editor-callout-palette:visible");
  await expect(toolbar).toBeVisible();
  const result = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("calloutFidelityEditor").editor;
    const old = editor.state.doc.firstChild!;
    const fresh = editor.schema.nodes.callout.create(
      { tone: "green" },
      editor.schema.nodes.paragraph.create(null, editor.schema.text("新块")),
    );
    editor.view.dispatch(editor.state.tr.replaceWith(0, old.nodeSize, fresh));
    document
      .querySelector<HTMLButtonElement>('.semlo-editor-callout-palette:not([hidden]) button[data-tone="pink"]')
      ?.click();
    return editor.state.doc.firstChild?.attrs.tone;
  });
  expect(result).toBe("green");
});

test("stale palette cannot recolor a formerly selected callout", async ({ page }) => {
  const host = await mount(page);
  await host.getByText("提示文字").click();
  await expect(page.locator(".semlo-editor-callout-palette:visible")).toBeVisible();
  const result = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("calloutFidelityEditor").editor;
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    document
      .querySelector<HTMLButtonElement>('.semlo-editor-callout-palette:not([hidden]) button[data-tone="pink"]')
      ?.click();
    return editor.state.doc.firstChild?.attrs.tone;
  });
  expect(result).toBe("info");
});
