import { expect, test } from "@rstest/playwright";

import { createDatabaseData, visibleDatabaseRecords } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    numericSortEditor?: EditorController;
  }
}

test("numeric sorting is consistent for preserved text in every input order", () => {
  const values = ["-10", "-2", "-5a"];
  const permutations = values.flatMap((first) =>
    values
      .filter((second) => second !== first)
      .map((second) => [first, second, values.find((v) => v !== first && v !== second)!]),
  );
  for (const type of ["number", "rating", "progress"] as const) {
    for (const permutation of permutations) {
      const data = createDatabaseData();
      const field = data.fields[0];
      field.type = type;
      data.records.forEach((record, index) => (record.values[field.id] = permutation[index]));
      const view = data.views[0];
      view.sorts = [{ fieldId: field.id, direction: "asc" }];
      expect(visibleDatabaseRecords(data, view).map((record) => record.values[field.id])).toEqual(values);
      view.sorts[0].direction = "desc";
      expect(visibleDatabaseRecords(data, view).map((record) => record.values[field.id])).toEqual(
        [...values].reverse(),
      );
    }
  }
});

test("sorting mixed numeric values persists and supports undo and redo", async ({ page }) => {
  const data = createDatabaseData();
  const field = data.fields[0];
  field.type = "number";
  for (const [index, value] of ["-2", "-5a", "-10"].entries()) data.records[index].values[field.id] = value;
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((initial) => Reflect.set(window, "numericSortContent", initial), content);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'numeric-sort-test'
      document.body.prepend(host)
      window.numericSortEditor = createEditor({ element: host, outline: false, content: window.numericSortContent })
    `,
  });
  const root = page.locator("#numeric-sort-test .semlo-editor-database");
  const values = root.locator('input[aria-label$=" 行 文本"]');
  const readValues = () => values.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  await root.getByRole("button", { name: "排序", exact: true }).click();
  await root.getByRole("dialog", { name: "排序" }).getByRole("button", { name: "添加排序" }).click();
  await root.getByRole("dialog", { name: "排序" }).getByLabel("保持排序").check();
  expect(await readValues()).toEqual(["-10", "-2", "-5a"]);
  const saved = await page.evaluate(() => window.__semloRequireFixture("numericSortEditor").getSnapshot().json);
  expect(await page.evaluate(() => window.__semloRequireFixture("numericSortEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await readValues()).toEqual(["-2", "-5a", "-10"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("numericSortEditor").editor.commands.redo())).toBe(
    true,
  );
  expect(await readValues()).toEqual(["-10", "-2", "-5a"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("numericSortEditor").getSnapshot().json)).toEqual(
    saved,
  );
  await page.evaluate((snapshot) => {
    window.__semloRequireFixture("numericSortEditor").destroy();
    Reflect.set(window, "numericSortContent", snapshot);
    document.getElementById("numeric-sort-test")?.remove();
  }, saved);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'numeric-sort-test'
      document.body.prepend(host)
      window.numericSortEditor = createEditor({ element: host, outline: false, content: window.numericSortContent })
    `,
  });
  await expect(values).toHaveCount(3);
  expect(await readValues()).toEqual(["-10", "-2", "-5a"]);
});
