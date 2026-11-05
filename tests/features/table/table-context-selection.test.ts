import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    tableSelectionEditor?: EditorController;
  }
}

test("auto numbering is offered only for selections contained in the first column", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-selection-test'
      document.body.prepend(host)
      window.tableSelectionEditor = createEditor({ element: host, content: '<table><tbody><tr><td><p>A1</p></td><td><p>A2</p></td></tr><tr><td><p>B1</p></td><td><p>B2</p></td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableSelectionEditor));
  const prose = page.locator("#table-selection-test .semlo-editor-prose");
  const a1 = prose.getByRole("cell", { name: "A1", exact: true });
  const a2 = prose.getByRole("cell", { name: "A2", exact: true });
  const b1 = prose.getByRole("cell", { name: "B1", exact: true });
  const first = await a1.boundingBox();
  const right = await a2.boundingBox();
  const below = await b1.boundingBox();
  if (!first || !right || !below) throw new Error("Missing table cells");
  const select = async (target: typeof right) => {
    await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
    await page.mouse.down();
    await page.mouse.move(target.x + target.width - 15, target.y + target.height / 2, { steps: 5 });
    await page.mouse.up();
  };
  await select(right);
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  await a2.click({ button: "right" });
  let menu = page.getByRole("menu", { name: "表格操作" });
  await expect(menu.getByRole("menuitem", { name: "自动编号" })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: "插入序号列到最左侧" })).toBeVisible();
  await page.keyboard.press("Escape");
  await select(below);
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  await b1.click({ button: "right" });
  menu = page.getByRole("menu", { name: "表格操作" });
  await expect(menu.getByRole("menuitem", { name: "自动编号" })).toBeVisible();
});

test("clearing from the context menu keeps a partial cell selection", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'table-selection-test'
      document.body.prepend(host)
      window.tableSelectionEditor = createEditor({ element: host, content: '<table><tbody><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.tableSelectionEditor));
  const prose = page.locator("#table-selection-test .semlo-editor-prose");
  const before = await page.evaluate(() => window.__semloRequireFixture("tableSelectionEditor").getSnapshot());
  const first = await prose.getByRole("cell", { name: "A", exact: true }).boundingBox();
  const last = await prose.getByRole("cell", { name: "B", exact: true }).boundingBox();
  if (!first || !last) throw new Error("Missing table cells");
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(last.x + last.width - 15, last.y + last.height / 2, { steps: 5 });
  await page.mouse.up();
  await prose.getByRole("cell", { name: "B", exact: true }).click({ button: "right" });
  await page.getByRole("menu", { name: "表格操作" }).getByRole("menuitem", { name: "清除内容" }).click();
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["", ""]);
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  await page.keyboard.type("Z");
  await expect(prose.locator("tr").first().locator("td")).toHaveText(["Z", ""]);
  expect(await page.evaluate(() => window.__semloRequireFixture("tableSelectionEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("tableSelectionEditor").getSnapshot())).json).toEqual(
    before.json,
  );
});
