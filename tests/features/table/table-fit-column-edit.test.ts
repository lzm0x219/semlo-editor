import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    fitColumnEditEditor?: EditorController;
  }
}

test("fitted widths remain attached to their columns across insertion and deletion", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'fit-column-edit-test'
      host.style.width = '520px'
      document.body.prepend(host)
      window.fitColumnEditEditor = createEditor({ element: host, outline: false, content: {
        type: 'doc', content: [{ type: 'table', content: ['A', 'B'].map(prefix => ({
          type: 'tableRow', content: [120, 200, 280].map((width, index) => ({
            type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [width] },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: prefix + (index + 1) }] }]
          }))
        })) }, { type: 'paragraph' }]
      } })
    `,
  });
  await page.waitForFunction(() => Boolean(window.fitColumnEditEditor));
  const prose = page.locator("#fit-column-edit-test .semlo-editor-prose");
  await prose.getByRole("cell", { name: "A1" }).click();
  await page.getByRole("toolbar", { name: "表格工具栏" }).getByRole("button", { name: "自适应宽度" }).click();
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("fitColumnEditEditor").getSnapshot());
  const before = await snapshot();
  const widths = before.json.content![0].attrs!.semloEditorFitWidths as number[];
  await prose.getByRole("cell", { name: "A2" }).click({ button: "right" });
  await page.getByRole("menu", { name: "表格操作" }).getByRole("menuitem", { name: "向左插入" }).click();
  const inserted = await snapshot();
  const nextWidths = inserted.json.content![0].attrs!.semloEditorFitWidths as number[];
  expect(nextWidths).toHaveLength(4);
  expect([nextWidths[0], nextWidths[2], nextWidths[3]]).toEqual(widths);
  expect(nextWidths[1]).toBe(widths[1]);
  expect(inserted.json.content![0].content![0].content![1].attrs!.colwidth).toEqual([200]);
  expect(await page.evaluate(() => window.__semloRequireFixture("fitColumnEditEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await snapshot()).json).toEqual(before.json);
  expect(await page.evaluate(() => window.__semloRequireFixture("fitColumnEditEditor").editor.commands.redo())).toBe(
    true,
  );
  expect((await snapshot()).json).toEqual(inserted.json);
  for (const content of [inserted.html, inserted.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("fitColumnEditEditor").setContent(value), content);
    expect((await snapshot()).json).toEqual(inserted.json);
  }
  await prose.getByRole("cell", { name: "A2" }).click({ button: "right" });
  await page.getByRole("menu", { name: "表格操作" }).getByRole("menuitem", { name: "删除所选列" }).click();
  const deleted = await snapshot();
  expect(deleted.json.content![0].attrs!.semloEditorFitWidths).toEqual([nextWidths[0], nextWidths[1], nextWidths[3]]);
  expect(await page.evaluate(() => window.__semloRequireFixture("fitColumnEditEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await snapshot()).json).toEqual(inserted.json);
  await prose.getByRole("cell", { name: "A1" }).click({ button: "right" });
  await page.getByRole("menu", { name: "表格操作" }).getByRole("menuitem", { name: "向右插入" }).click();
  const rightInserted = await snapshot();
  const rightWidths = rightInserted.json.content![0].attrs!.semloEditorFitWidths as number[];
  expect(rightWidths).toEqual([nextWidths[0], nextWidths[0], nextWidths[1], nextWidths[2], nextWidths[3]]);
  expect(rightInserted.json.content![0].content![0].content![1].attrs!.colwidth).toEqual([120]);
  expect(await page.evaluate(() => window.__semloRequireFixture("fitColumnEditEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await snapshot()).json).toEqual(inserted.json);
  await prose.getByRole("cell", { name: "A2" }).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "表格操作" });
  await menu.getByLabel("向左插入列数").fill("2");
  await menu.getByRole("menuitem", { name: "向左插入" }).click();
  const batch = await snapshot();
  expect(batch.json.content![0].attrs!.semloEditorFitWidths).toEqual([
    nextWidths[0],
    nextWidths[1],
    nextWidths[2],
    nextWidths[2],
    nextWidths[2],
    nextWidths[3],
  ]);
  expect(await page.evaluate(() => window.__semloRequireFixture("fitColumnEditEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await snapshot()).json).toEqual(inserted.json);
});

test("inserting beside a merged column preserves its fitted widths", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'fit-merged-column-test'
      document.body.prepend(host)
      window.fitColumnEditEditor = createEditor({ element: host, content: {
        type: 'doc', content: [{ type: 'table', attrs: { semloEditorFitWidth: true, semloEditorFitWidths: [120, 200, 280] }, content: [
          { type: 'tableRow', content: [
            { type: 'tableCell', attrs: { colspan: 2, rowspan: 1, colwidth: [120, 200] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '合并' }] }] },
            { type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [280] }, content: [{ type: 'paragraph', content: [{ type: 'text', text: '末列' }] }] }
          ] }
        ] }, { type: 'paragraph' }]
      } })
    `,
  });
  await page.waitForFunction(() => Boolean(window.fitColumnEditEditor));
  const prose = page.locator("#fit-merged-column-test .semlo-editor-prose");
  const before = await page.evaluate(() => window.__semloRequireFixture("fitColumnEditEditor").getSnapshot());
  await prose.getByRole("cell", { name: "末列" }).click({ button: "right" });
  await page.getByRole("menu", { name: "表格操作" }).getByRole("menuitem", { name: "向右插入" }).click();
  const after = await page.evaluate(() => window.__semloRequireFixture("fitColumnEditEditor").getSnapshot());
  const widths = after.json.content![0].attrs!.semloEditorFitWidths as number[];
  expect(widths.slice(0, 3)).toEqual([120, 200, 280]);
  expect(widths).toHaveLength(4);
  expect(await page.evaluate(() => window.__semloRequireFixture("fitColumnEditEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("fitColumnEditEditor").getSnapshot())).json).toEqual(
    before.json,
  );
});

test("a new fitted column inherits an automatic source width when fit is disabled", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'fit-column-edit-test'
      host.style.width = '520px'
      document.body.prepend(host)
      window.fitColumnEditEditor = createEditor({ element: host, outline: false, content: '<table><tbody><tr><td><p>A1</p></td><td><p>A2</p></td><td><p>A3</p></td></tr><tr><td><p>B1</p></td><td><p>B2</p></td><td><p>B3</p></td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.fitColumnEditEditor));
  const prose = page.locator("#fit-column-edit-test .semlo-editor-prose");
  await prose.getByRole("cell", { name: "A2" }).click();
  const fit = page.getByRole("toolbar", { name: "表格工具栏" }).getByRole("button", { name: "自适应宽度" });
  await fit.click();
  const before = await page.evaluate(() => window.__semloRequireFixture("fitColumnEditEditor").getSnapshot());
  const source = before.json.content![0].attrs!.semloEditorFitWidths as number[];
  await prose.getByRole("cell", { name: "A2" }).click({ button: "right" });
  await page.getByRole("menu", { name: "表格操作" }).getByRole("menuitem", { name: "向左插入" }).click();
  const inserted = await page.evaluate(() => window.__semloRequireFixture("fitColumnEditEditor").getSnapshot());
  expect(inserted.json.content![0].content![0].content![1].attrs!.colwidth).toEqual([Math.round(source[1])]);
  expect(await page.evaluate(() => window.__semloRequireFixture("fitColumnEditEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("fitColumnEditEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("fitColumnEditEditor").editor.commands.redo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("fitColumnEditEditor").getSnapshot())).json).toEqual(
    inserted.json,
  );
  await prose.getByRole("cell", { name: "A2" }).click();
  await fit.click();
  const widths = await prose
    .locator("table col")
    .evaluateAll((cols) => cols.map((col) => col.getBoundingClientRect().width));
  expect(widths[1]).toBeCloseTo(widths[2], 0);
});
