import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    fitResizeEditor?: EditorController;
  }
}

test("resizing a fitted column transfers width to its neighbour and persists the result", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'fit-resize-test'
      host.style.width = '520px'
      document.body.prepend(host)
      window.fitResizeEditor = createEditor({ element: host, outline: false, content: {
        type: 'doc', content: [{ type: 'table', content: ['A', 'B'].map(prefix => ({
          type: 'tableRow', content: [120, 200, 280].map((width, index) => ({
            type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [width] },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: prefix + (index + 1) }] }]
          }))
        })) }, { type: 'paragraph' }]
      } })
    `,
  });
  await page.waitForFunction(() => Boolean(window.fitResizeEditor));
  const prose = page.locator("#fit-resize-test .semlo-editor-prose");
  await prose.getByRole("cell", { name: "A1" }).click();
  const fit = page.getByRole("toolbar", { name: "表格工具栏" }).getByRole("button", { name: "自适应宽度" });
  await fit.click();
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("fitResizeEditor").getSnapshot());
  const widths = () =>
    prose.locator("table col").evaluateAll((cols) => cols.map((col) => col.getBoundingClientRect().width));
  const before = await snapshot();
  const initial = await widths();
  const box = await prose.getByRole("cell", { name: "A1" }).boundingBox();
  if (!box) throw new Error("Missing table cell");
  const x = box.x + box.width - 1;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await expect(prose.locator(".column-resize-handle").first()).toBeVisible();
  await page.mouse.down();
  await page.mouse.up();
  expect((await snapshot()).json).toEqual(before.json);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y, { steps: 5 });
  await page.mouse.up();
  const after = await snapshot();
  const resized = await widths();
  expect(resized[0] - initial[0]).toBeCloseTo(40, 0);
  expect(resized[1] - initial[1]).toBeCloseTo(-40, 0);
  expect(resized[2]).toBeCloseTo(initial[2], 0);
  expect(await page.evaluate(() => window.__semloRequireFixture("fitResizeEditor").editor.commands.undo())).toBe(true);
  expect((await snapshot()).json).toEqual(before.json);
  expect(await page.evaluate(() => window.__semloRequireFixture("fitResizeEditor").editor.commands.redo())).toBe(true);
  expect((await snapshot()).json).toEqual(after.json);
  for (const content of [after.html, after.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("fitResizeEditor").setContent(value), content);
    expect((await snapshot()).json).toEqual(after.json);
  }
  await prose.getByRole("cell", { name: "A1" }).click();
  await fit.click();
  const restored = await widths();
  restored.forEach((width, index) => expect(width).toBeCloseTo(resized[index], 0));
  await fit.click();
  const last = await prose.getByRole("cell", { name: "A3" }).boundingBox();
  if (!last) throw new Error("Missing last table cell");
  const lastX = last.x + last.width - 1;
  const lastY = last.y + last.height / 2;
  await page.mouse.move(lastX, lastY);
  await expect(prose.locator(".column-resize-handle").first()).toBeVisible();
  await page.mouse.down();
  await page.mouse.move(lastX - 30, lastY, { steps: 5 });
  await page.mouse.up();
  await fit.click();
  const afterLast = await widths();
  expect(afterLast[0]).toBeCloseTo(restored[0], 0);
  expect(afterLast[1]).toBeCloseTo(restored[1], 0);
  expect(afterLast[2]).toBeCloseTo(restored[2] - 30, 0);
});

test("fitted resize handles merged cells and cancels when the editor becomes read-only", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'fit-resize-test'
      host.style.width = '520px'
      document.body.prepend(host)
      window.fitResizeEditor = createEditor({ element: host, outline: false, content: {
        type: 'doc', content: [{ type: 'table', content: [
          { type: 'tableRow', content: [
            { type: 'tableCell', attrs: { colspan: 2, rowspan: 1, colwidth: [120, 200] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '合并' }] }] },
            { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [280] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '末列' }] }] }
          ] },
          { type: 'tableRow', content: [120, 200, 280].map((width, index) => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [width] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' + index }] }] })) }
        ] }, { type: 'paragraph' }]
      } })
    `,
  });
  await page.waitForFunction(() => Boolean(window.fitResizeEditor));
  const prose = page.locator("#fit-resize-test .semlo-editor-prose");
  const merged = prose.getByRole("cell", { name: "合并" });
  await merged.click();
  await page.getByRole("toolbar", { name: "表格工具栏" }).getByRole("button", { name: "自适应宽度" }).click();
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("fitResizeEditor").getSnapshot());
  const widths = () =>
    prose.locator("table col").evaluateAll((cols) => cols.map((col) => col.getBoundingClientRect().width));
  const initial = await snapshot();
  const before = await widths();
  const box = await merged.boundingBox();
  if (!box) throw new Error("Missing merged cell");
  const x = box.x + box.width - 1;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await expect(prose.locator(".column-resize-handle").first()).toBeVisible();
  await page.mouse.down();
  await page.mouse.move(x + 30, y, { steps: 5 });
  await page.mouse.up();
  const after = await widths();
  expect(after[0]).toBeCloseTo(before[0], 0);
  expect(after[1] - before[1]).toBeCloseTo(30, 0);
  expect(after[2] - before[2]).toBeCloseTo(-30, 0);
  expect(await page.evaluate(() => window.__semloRequireFixture("fitResizeEditor").editor.commands.undo())).toBe(true);
  expect((await snapshot()).json).toEqual(initial.json);
  const restored = await merged.boundingBox();
  if (!restored) throw new Error("Missing restored cell");
  const restoredX = restored.x + restored.width - 1;
  const restoredY = restored.y + restored.height / 2;
  await page.mouse.move(restoredX, restoredY);
  await page.mouse.down();
  await page.mouse.move(restoredX + 35, restoredY, { steps: 5 });
  await page.evaluate(() => window.__semloRequireFixture("fitResizeEditor").setEditable(false));
  await page.mouse.up();
  expect((await snapshot()).json).toEqual(initial.json);
  const cancelled = await widths();
  cancelled.forEach((width, index) => expect(width).toBeCloseTo(before[index], 0));
});
