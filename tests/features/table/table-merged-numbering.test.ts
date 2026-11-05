import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    mergedNumberingEditor?: EditorController;
  }
}

test("numbering counts distinct first-column cells when a cell spans rows", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'merged-numbering-test'
      document.body.prepend(host)
      window.mergedNumberingEditor = createEditor({ element: host, content: '<table><tbody><tr><td><p>甲</p></td><td><p>A</p></td></tr><tr><td rowspan="2"><p>乙</p></td><td><p>B</p></td></tr><tr><td><p>C</p></td></tr><tr><td><p>丙</p></td><td><p>D</p></td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.mergedNumberingEditor));
  const prose = page.locator("#merged-numbering-test .semlo-editor-prose");
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("mergedNumberingEditor").getSnapshot());
  const original = await snapshot();
  await prose.getByRole("cell", { name: "甲" }).click({ button: "right" });
  let menu = page.getByRole("menu", { name: "表格操作" });
  await menu.getByRole("menuitem", { name: "自动编号" }).click();
  await expect(prose.locator("td:first-child").filter({ hasText: /^(1|2|3)$/ })).toHaveText(["1", "2", "3"]);
  const numbered = await snapshot();
  expect(await page.evaluate(() => window.__semloRequireFixture("mergedNumberingEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await snapshot()).json).toEqual(original.json);
  expect(await page.evaluate(() => window.__semloRequireFixture("mergedNumberingEditor").editor.commands.redo())).toBe(
    true,
  );
  expect((await snapshot()).json).toEqual(numbered.json);
  await prose.getByRole("cell", { name: "2", exact: true }).click({ button: "right" });
  menu = page.getByRole("menu", { name: "表格操作" });
  await menu.getByLabel("自动编号起始行").fill("3");
  await menu.getByRole("menuitem", { name: "自动编号" }).click();
  await expect(prose.locator("tr").nth(3).locator("td").first()).toHaveText("1");
  await expect(prose.locator("td[rowspan='2']")).toHaveText("2");
  const saved = await snapshot();
  for (const content of [saved.html, saved.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("mergedNumberingEditor").setContent(value), content);
    expect((await snapshot()).json).toEqual(saved.json);
  }
});

test("untouched numbering follows row edits around and inside a vertical merge", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'merged-numbering-test'
      document.body.prepend(host)
      window.mergedNumberingEditor = createEditor({ element: host, content: '<table><tbody><tr><td data-semlo-editor-sequence="2"><p></p></td><td><p>A</p></td></tr><tr><td rowspan="2" data-semlo-editor-sequence="2"><p>1</p></td><td><p>B</p></td></tr><tr><td><p>C</p></td></tr><tr><td data-semlo-editor-sequence="2"><p>2</p></td><td><p>D</p></td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.mergedNumberingEditor));
  const prose = page.locator("#merged-numbering-test .semlo-editor-prose");
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("mergedNumberingEditor").getSnapshot());
  const before = await snapshot();
  const select = async (label: string, action: string) => {
    await prose.getByRole("cell", { name: label, exact: true }).click({ button: "right" });
    await page.getByRole("menu", { name: "表格操作" }).getByRole("menuitem", { name: action }).click();
  };
  await select("D", "向下插入");
  await expect(prose.locator("tr").last().locator("td").first()).toHaveText("3");
  const expanded = await snapshot();
  await select("D", "删除所选行");
  await expect(prose.locator("tr").last().locator("td").first()).toHaveText("2");
  expect(await page.evaluate(() => window.__semloRequireFixture("mergedNumberingEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await snapshot()).json).toEqual(expanded.json);
  expect(await page.evaluate(() => window.__semloRequireFixture("mergedNumberingEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await snapshot()).json).toEqual(before.json);
  await select("B", "向下插入");
  await expect(prose.locator("td[rowspan='3']")).toHaveText("1");
  await expect(prose.getByRole("cell", { name: "2", exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("mergedNumberingEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await snapshot()).json).toEqual(before.json);
  await select("A", "向下插入");
  await expect(prose.locator("tr").nth(1).locator("td").first()).toHaveText("");
  await expect(prose.locator("td[rowspan='2']")).toHaveText("1");
  const inserted = await snapshot();
  await select("D", "删除所选行");
  expect(await page.evaluate(() => window.__semloRequireFixture("mergedNumberingEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await snapshot()).json).toEqual(inserted.json);
  for (const content of [inserted.html, inserted.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("mergedNumberingEditor").setContent(value), content);
    expect((await snapshot()).json).toEqual(inserted.json);
    await select("D", "向下插入");
    await expect(prose.locator("tr").last().locator("td").first()).toHaveText("3");
  }
  await prose.locator("td[rowspan='2']").click();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("mergedNumberingEditor").editor;
    const text = document.querySelector("#merged-numbering-test td[rowspan='2'] p")!.firstChild!;
    const from = editor.view.posAtDOM(text, 0);
    editor.commands.setTextSelection({ from, to: from + 1 });
  });
  await page.keyboard.type("9");
  await select("D", "向下插入");
  await expect(prose.locator("td[rowspan='2']")).toHaveText("9");
  await expect(prose.locator("tr").nth(5).locator("td").first()).toHaveText("");
});
