import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    sequenceAlignmentEditor?: EditorController;
  }
}

test("inserted sequence column centers its generated paragraphs and survives round trips", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'sequence-alignment-test'
      document.body.prepend(host)
      window.sequenceAlignmentEditor = createEditor({ element: host, content: '<table><tbody><tr><td><p>A</p></td><td><p>B</p></td></tr><tr><td><p>C</p></td><td><p>D</p></td></tr><tr><td><p>E</p></td><td><p>F</p></td></tr></tbody></table><p>后文</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.sequenceAlignmentEditor));
  const prose = page.locator("#sequence-alignment-test .semlo-editor-prose");
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("sequenceAlignmentEditor").getSnapshot());
  const before = await snapshot();
  await prose.getByRole("cell", { name: "C", exact: true }).click({ button: "right" });
  await page.getByRole("menu", { name: "表格操作" }).getByRole("menuitem", { name: "插入序号列到最左侧" }).click();
  const numbers = prose.locator("tr td:first-child p");
  await expect(numbers).toHaveText(["", "1", "2"]);
  await expect(numbers.first()).toHaveCSS("text-align", "start");
  await expect(numbers.nth(1)).toHaveCSS("text-align", "center");
  const inserted = await snapshot();
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceAlignmentEditor").editor.commands.undo()),
  ).toBe(true);
  expect((await snapshot()).json).toEqual(before.json);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("sequenceAlignmentEditor").editor.commands.redo()),
  ).toBe(true);
  expect((await snapshot()).json).toEqual(inserted.json);
  for (const content of [inserted.html, inserted.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("sequenceAlignmentEditor").setContent(value), content);
    expect((await snapshot()).json).toEqual(inserted.json);
    await expect(numbers.nth(1)).toHaveCSS("text-align", "center");
  }
  await prose.getByRole("cell", { name: "F", exact: true }).click({ button: "right" });
  await page.getByRole("menu", { name: "表格操作" }).getByRole("menuitem", { name: "向下插入" }).click();
  await expect(numbers.nth(3)).toHaveText("3");
  await expect(numbers.nth(3)).toHaveCSS("text-align", "center");
});
