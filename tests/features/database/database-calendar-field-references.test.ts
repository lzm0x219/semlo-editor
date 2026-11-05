import { expect, test } from "@rstest/playwright";

import {
  createDatabaseData,
  createDatabaseField,
  createDatabaseView,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    calendarFieldReferencesEditor?: EditorController;
  }
}

test("field deletion and type changes keep calendar references valid in JSON and history", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const [title, color, start] = data.fields;
  const backupDate = createDatabaseField("备用日期", "date");
  const backupTitle = createDatabaseField("备用标题", "text");
  data.fields.push(backupDate, backupTitle);
  const calendar = createDatabaseView("日历视图", "calendar");
  calendar.calendar.titleFieldId = title.id;
  calendar.calendar.startFieldId = start.id;
  calendar.calendar.endFieldId = backupDate.id;
  calendar.calendar.colorFieldId = color.id;
  data.views.push(calendar);
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "calendarFieldReferencesContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'calendar-field-references-test'
    document.body.prepend(host)
    window.calendarFieldReferencesEditor = createEditor({ element: host, outline: false, content: window.calendarFieldReferencesContent })
  `,
  });
  const root = page.locator("#calendar-field-references-test .semlo-editor-database");
  const read = () =>
    page.evaluate(
      () =>
        window
          .__semloRequireFixture("calendarFieldReferencesEditor")
          .getSnapshot()
          .json.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data as DatabaseData,
    );
  await root.getByRole("button", { name: "日期列菜单", exact: true }).click();
  await root.getByRole("menu", { name: "日期 列菜单" }).getByRole("menuitem", { name: "删除列" }).click();
  let saved = await read();
  let settings = saved.views.find((view) => view.id === calendar.id)!.calendar;
  expect(settings.startFieldId).toBe(backupDate.id);
  expect(settings.endFieldId).toBe(backupDate.id);
  expect(saved.fields.some((field) => field.id === start.id)).toBe(false);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("calendarFieldReferencesEditor").editor.commands.undo()),
  ).toBe(true);
  saved = await read();
  expect(saved.views.find((view) => view.id === calendar.id)!.calendar.startFieldId).toBe(start.id);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("calendarFieldReferencesEditor").editor.commands.redo()),
  ).toBe(true);
  await root.getByRole("button", { name: "文本列菜单", exact: true }).click();
  await root.getByRole("menu", { name: "文本 列菜单" }).getByRole("menuitem", { name: "编辑列" }).click();
  const dialog = root.getByRole("dialog", { name: "编辑列" });
  await dialog.getByLabel("列类型").selectOption("number");
  await dialog.getByRole("button", { name: "确定" }).click();
  saved = await read();
  settings = saved.views.find((view) => view.id === calendar.id)!.calendar;
  expect(settings.titleFieldId).toBe(backupTitle.id);
  expect(settings.startFieldId).toBe(backupDate.id);
  expect(settings.colorFieldId).toBe(color.id);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("calendarFieldReferencesEditor").editor.commands.undo()),
  ).toBe(true);
  expect((await read()).views.find((view) => view.id === calendar.id)!.calendar.titleFieldId).toBe(title.id);
  await root.getByRole("button", { name: "单选列菜单", exact: true }).click();
  await root.getByRole("menu", { name: "单选 列菜单" }).getByRole("menuitem", { name: "编辑列" }).click();
  await dialog.getByLabel("列类型").selectOption("text");
  await dialog.getByRole("button", { name: "确定" }).click();
  expect((await read()).views.find((view) => view.id === calendar.id)!.calendar.colorFieldId).toBe("");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("calendarFieldReferencesEditor").editor.commands.undo()),
  ).toBe(true);
  expect((await read()).views.find((view) => view.id === calendar.id)!.calendar.colorFieldId).toBe(color.id);
});
