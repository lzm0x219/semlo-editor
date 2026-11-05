import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    fitColumnMoveEditor?: EditorController;
  }
}

test("moving fitted columns carries their saved widths through history and serialization", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'fit-column-move-test'
      host.style.width = '520px'
      document.body.prepend(host)
      window.fitColumnMoveEditor = createEditor({ element: host, outline: false, content: {
        type: 'doc', content: [{ type: 'table', content: ['A', 'B'].map(prefix => ({
          type: 'tableRow', content: [120, 200, 280].map((width, index) => ({
            type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: [width] },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: prefix + (index + 1) }] }]
          }))
        })) }, { type: 'paragraph' }]
      } })
    `,
  });
  await page.waitForFunction(() => Boolean(window.fitColumnMoveEditor));
  const prose = page.locator("#fit-column-move-test .semlo-editor-prose");
  await prose.getByRole("cell", { name: "A1" }).click();
  await page.getByRole("toolbar", { name: "表格工具栏" }).getByRole("button", { name: "自适应宽度" }).click();
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("fitColumnMoveEditor").getSnapshot());
  const before = await snapshot();
  const beforeWidths = before.json.content![0].attrs!.semloEditorFitWidths as number[];
  await prose.getByRole("cell", { name: "A1" }).hover();
  const first = page.getByRole("button", { name: "选择第 1 列" });
  const third = page.getByRole("button", { name: "选择第 3 列" });
  await expect(first).toBeVisible();
  const from = await first.boundingBox();
  const to = await third.boundingBox();
  if (!from || !to) throw new Error("Missing column handles");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width - 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["A2", "A3", "A1"]);
  const moved = await snapshot();
  expect(moved.json.content![0].attrs!.semloEditorFitWidths).toEqual([
    beforeWidths[1],
    beforeWidths[2],
    beforeWidths[0],
  ]);
  expect(await page.evaluate(() => window.__semloRequireFixture("fitColumnMoveEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await snapshot()).json).toEqual(before.json);
  expect(await page.evaluate(() => window.__semloRequireFixture("fitColumnMoveEditor").editor.commands.redo())).toBe(
    true,
  );
  expect((await snapshot()).json).toEqual(moved.json);
  for (const content of [moved.html, moved.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("fitColumnMoveEditor").setContent(value), content);
    expect((await snapshot()).json).toEqual(moved.json);
  }
});
