import { expect, test } from "@rstest/playwright";

import {
  createDatabaseData,
  createDatabaseField,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    databaseWhitespaceEditor?: EditorController;
  }
}

test("text cells trim outer whitespace on commit and retain undo history", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const other = createDatabaseField("普通文本");
  data.fields.push(other);
  for (const record of data.records) record.values[other.id] = "";
  data.records[0].values[data.fields[0].id] = "原值";
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "databaseWhitespaceContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div'); host.id = 'database-whitespace'; document.body.prepend(host)
      window.databaseWhitespaceEditor = createEditor({element: host, outline: false, content: window.databaseWhitespaceContent})
    `,
  });
  const root = page.locator("#database-whitespace .semlo-editor-database");
  const first = root.getByLabel("第 1 行 文本");
  const second = root.getByLabel("第 2 行 文本");
  const read = async () =>
    (await page.evaluate(
      () => window.__semloRequireFixture("databaseWhitespaceEditor").getSnapshot().json.content![0].attrs!.data,
    )) as DatabaseData;
  await first.fill("  乙 丙  ");
  await expect(first).toHaveValue("  乙 丙  ");
  await first.press("Enter");
  await expect(first).toHaveValue("乙 丙");
  expect((await read()).records[0].values[data.fields[0].id]).toBe("乙 丙");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("databaseWhitespaceEditor").editor.commands.undo()),
  ).toBe(true);
  expect((await read()).records[0].values[data.fields[0].id]).toBe("原值");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("databaseWhitespaceEditor").editor.commands.redo()),
  ).toBe(true);
  expect((await read()).records[0].values[data.fields[0].id]).toBe("乙 丙");
  await second.fill("　   ");
  await second.press("Enter");
  await expect(second).toHaveValue("");
  expect((await read()).records[1].values[data.fields[0].id]).toBe("");
  const otherText = root.getByLabel("第 1 行 普通文本");
  await otherText.fill("  乙 丙  ");
  await otherText.press("Enter");
  await expect(otherText).toHaveValue("乙 丙");
  expect((await read()).records[0].values[other.id]).toBe("乙 丙");
});
