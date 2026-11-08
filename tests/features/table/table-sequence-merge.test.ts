import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    sequenceMergeEditor?: EditorController;
  }
}

test("merging untouched sequence cells treats them as one number; splitting leaves a blank", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'sequence-merge-test'
      document.body.prepend(host)
      window.sequenceMergeEditor = createEditor({ element: host, content: '<table><tbody><tr><td data-semlo-editor-sequence="2"><p>标题</p></td><td><p>A</p></td></tr><tr><td data-semlo-editor-sequence="2"><p style="text-align:center">1</p></td><td><p>B</p></td></tr><tr><td data-semlo-editor-sequence="2"><p style="text-align:center">2</p></td><td><p>C</p></td></tr><tr><td data-semlo-editor-sequence="2"><p style="text-align:center">3</p></td><td><p>D</p></td></tr><tr><td data-semlo-editor-sequence="2"><p style="text-align:center">4</p></td><td><p>E</p></td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.sequenceMergeEditor));
  const prose = page.locator("#sequence-merge-test .semlo-editor-prose");
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("sequenceMergeEditor").getSnapshot());
  const before = await snapshot();
  const first = await prose.getByRole("cell", { name: "1", exact: true }).boundingBox();
  const second = await prose.getByRole("cell", { name: "2", exact: true }).boundingBox();
  if (!first || !second) throw new Error("Missing numbered cells");
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(second.x + second.width - 15, second.y + second.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(prose.locator(".selectedCell")).toHaveCount(2);
  await prose.getByRole("cell", { name: "2", exact: true }).click({ button: "right" });
  await page.getByRole("menu", { name: "表格操作" }).getByRole("menuitem", { name: "合并单元格" }).click();
  const column = prose.locator("td[data-semlo-editor-sequence]");
  await expect(column).toHaveText(["标题", "1", "2", "3"]);
  await expect(prose.locator("td[rowspan='2']")).toHaveText("1");
  const merged = await snapshot();
  expect(await page.evaluate(() => window.__semloRequireFixture("sequenceMergeEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await snapshot()).json).toEqual(before.json);
  expect(await page.evaluate(() => window.__semloRequireFixture("sequenceMergeEditor").editor.commands.redo())).toBe(
    true,
  );
  expect((await snapshot()).json).toEqual(merged.json);
  await prose.getByRole("cell", { name: "C", exact: true }).click({ button: "right" });
  await page.getByRole("menu", { name: "表格操作" }).getByRole("menuitem", { name: "向下插入" }).click();
  await expect(column).toHaveText(["标题", "1", "2", "3", "4"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("sequenceMergeEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await snapshot()).json).toEqual(merged.json);
  await prose.getByRole("cell", { name: "B", exact: true }).click({ button: "right" });
  await page.getByRole("menu", { name: "表格操作" }).getByRole("menuitem", { name: "向下插入" }).click();
  await expect(prose.locator("td[rowspan='3']")).toHaveText("1");
  await expect(column).toHaveText(["标题", "1", "2", "3"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("sequenceMergeEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await snapshot()).json).toEqual(merged.json);
  await prose.locator("td[rowspan='2']").click({ button: "right" });
  await page.getByRole("menu", { name: "表格操作" }).getByRole("menuitem", { name: "拆分单元格" }).click();
  await expect(prose.locator("tr td:first-child")).toHaveText(["标题", "1", "", "2", "3"]);
  const split = await snapshot();
  await prose.getByRole("cell", { name: "E", exact: true }).click({ button: "right" });
  await page.getByRole("menu", { name: "表格操作" }).getByRole("menuitem", { name: "向下插入" }).click();
  await expect(prose.locator("tr td:first-child")).toHaveText(["标题", "1", "", "2", "3", ""]);
  expect(await page.evaluate(() => window.__semloRequireFixture("sequenceMergeEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await snapshot()).json).toEqual(split.json);
  expect(await page.evaluate(() => window.__semloRequireFixture("sequenceMergeEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await snapshot()).json).toEqual(merged.json);
  for (const content of [merged.html, merged.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("sequenceMergeEditor").setContent(value), content);
    expect((await snapshot()).json).toEqual(merged.json);
  }
});

test("merging an edited sequence never drops the edited text", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'sequence-merge-test'
      document.body.prepend(host)
      window.sequenceMergeEditor = createEditor({ element: host, content: '<table><tbody><tr><td data-semlo-editor-sequence="2"><p>标题</p></td><td><p>A</p></td></tr><tr><td data-semlo-editor-sequence="2"><p>1</p></td><td><p>B</p></td></tr><tr><td data-semlo-editor-sequence="2"><p>手改</p></td><td><p>C</p></td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.sequenceMergeEditor));
  const prose = page.locator("#sequence-merge-test .semlo-editor-prose");
  const before = await page.evaluate(() => window.__semloRequireFixture("sequenceMergeEditor").getSnapshot());
  const first = await prose.getByRole("cell", { name: "1", exact: true }).boundingBox();
  const second = await prose.getByRole("cell", { name: "手改", exact: true }).boundingBox();
  if (!first || !second) throw new Error("Missing numbered cells");
  await page.mouse.move(first.x + first.width - 15, first.y + first.height / 2);
  await page.mouse.down();
  await page.mouse.move(second.x + second.width - 15, second.y + second.height / 2, { steps: 5 });
  await page.mouse.up();
  await prose.getByRole("cell", { name: "手改", exact: true }).click({ button: "right" });
  await page.getByRole("menu", { name: "表格操作" }).getByRole("menuitem", { name: "合并单元格" }).click();
  const merged = prose.locator("td[rowspan='2']");
  await expect(merged).toContainText("1");
  await expect(merged).toContainText("手改");
  expect(await page.evaluate(() => window.__semloRequireFixture("sequenceMergeEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("sequenceMergeEditor").getSnapshot())).json).toEqual(
    before.json,
  );
});

test("starting numbering inside a rowspan preserves that cell and numbers the next cell", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div'); host.id = 'sequence-merge-test'; document.body.prepend(host)
      window.sequenceMergeEditor = createEditor({ element: host, content: '<table><tbody><tr><td>表头</td><td>内容</td></tr><tr><td rowspan="2">跨行原文</td><td>甲</td></tr><tr><td>乙</td></tr><tr><td>后格原文</td><td>丙</td></tr></tbody></table>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.sequenceMergeEditor));
  const prose = page.locator("#sequence-merge-test .semlo-editor-prose");
  const before = await page.evaluate(() => window.__semloRequireFixture("sequenceMergeEditor").getSnapshot().json);
  await prose.getByRole("cell", { name: "跨行原文", exact: true }).click({ button: "right" });
  const menu = page.getByRole("menu", { name: "表格操作" });
  await menu.getByRole("spinbutton", { name: "自动编号起始行" }).fill("3");
  await menu.getByRole("menuitem", { name: "自动编号", exact: true }).click();
  await expect(prose.locator("td[rowspan='2']")).toHaveText("跨行原文");
  await expect(prose.locator("tr").nth(3).locator("td").first()).toHaveText("1");
  expect(await page.evaluate(() => window.__semloRequireFixture("sequenceMergeEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("sequenceMergeEditor").getSnapshot().json)).toEqual(
    before,
  );
});
