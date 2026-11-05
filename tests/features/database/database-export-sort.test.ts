import { expect, test } from "@rstest/playwright";

import {
  createDatabaseData,
  createDatabaseView,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    databaseExportSortEditor?: EditorController;
  }
}

test("static export respects the active view sort without dropping filtered records", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const field = data.fields[0];
  data.records.forEach((record, index) => {
    record.values[field.id] = ["B", "C", "A"][index];
  });
  data.views[0].sorts = [{ fieldId: field.id, direction: "asc" }];
  data.views[0].filters = [{ id: "filter", fieldId: field.id, operator: "notEquals", value: "B" }];
  data.views.push(createDatabaseView("无排序视图"));
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "databaseExportSortContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'database-export-sort-test'
    document.body.prepend(host)
    window.databaseExportSortEditor = createEditor({ element: host, outline: false, content: window.databaseExportSortContent })
  `,
  });
  const root = page.locator("#database-export-sort-test .semlo-editor-database");
  const exported = () =>
    page.evaluate(() => {
      const snapshot = window.__semloRequireFixture("databaseExportSortEditor").getSnapshot();
      const document = new DOMParser().parseFromString(snapshot.html, "text/html");
      const rows = [...document.querySelectorAll("[data-semlo-editor-database] tbody tr")].map(
        (row) => row.querySelector("td")?.textContent,
      );
      return {
        rows,
        text: snapshot.text,
        data: snapshot.json.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data as DatabaseData,
      };
    });
  await expect(root.locator('input[aria-label$=" 行 文本"]')).toHaveCount(2);
  let result = await exported();
  expect(result.rows).toEqual(["A", "B", "C"]);
  expect(result.text.indexOf("A")).toBeLessThan(result.text.indexOf("B"));
  expect(result.text.indexOf("B")).toBeLessThan(result.text.indexOf("C"));
  expect(result.data.records.map((record) => record.values[field.id])).toEqual(["B", "C", "A"]);
  await root.getByRole("button", { name: "切换视图" }).click();
  await root.getByRole("dialog", { name: "切换视图" }).getByRole("button", { name: "切换到无排序视图" }).click();
  result = await exported();
  expect(result.rows).toEqual(["B", "C", "A"]);
});

test("gallery and board static exports retain each view's order without losing records", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const [textField, choiceField, dateField] = data.fields;
  data.records.forEach((record, index) => {
    record.values[textField.id] = ["B", "C", "A"][index];
  });
  const gallery = createDatabaseView("画册视图", "gallery");
  gallery.fieldOrder = [dateField.id, textField.id, choiceField.id];
  gallery.sorts = [{ fieldId: textField.id, direction: "asc" }];
  gallery.filters = [{ id: "filter", fieldId: textField.id, operator: "notEquals", value: "B" }];
  const board = createDatabaseView("看板视图", "kanban");
  board.fieldOrder = [choiceField.id, textField.id, dateField.id];
  board.boardOrder = [data.records[1].id, data.records[2].id, data.records[0].id];
  data.views.push(gallery, board);
  data.activeViewId = gallery.id;
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "databaseExportSortContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'database-export-sort-test'
    document.body.prepend(host)
    window.databaseExportSortEditor = createEditor({ element: host, outline: false, content: window.databaseExportSortContent })
  `,
  });
  const root = page.locator("#database-export-sort-test .semlo-editor-database");
  const read = () =>
    page.evaluate(() => {
      const snapshot = window.__semloRequireFixture("databaseExportSortEditor").getSnapshot();
      const document = new DOMParser().parseFromString(snapshot.html, "text/html");
      return {
        headers: [...document.querySelectorAll("[data-semlo-editor-database] th")].map((cell) => cell.textContent),
        rows: [...document.querySelectorAll("[data-semlo-editor-database] tbody tr")].map((row) =>
          [...row.querySelectorAll("td")].map((cell) => cell.textContent),
        ),
      };
    });
  await expect(root).toBeVisible();
  let exported = await read();
  expect(exported.headers).toEqual(["日期", "文本", "单选"]);
  expect(exported.rows.map((row) => row[1])).toEqual(["A", "B", "C"]);
  await root.getByRole("button", { name: "切换视图" }).click();
  await root.getByRole("dialog", { name: "切换视图" }).getByRole("button", { name: "切换到看板视图" }).click();
  exported = await read();
  expect(exported.headers).toEqual(["单选", "文本", "日期"]);
  expect(exported.rows.map((row) => row[1])).toEqual(["C", "A", "B"]);
});
