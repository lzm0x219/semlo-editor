import { expect, test, type Page } from "@rstest/playwright";

import {
  createDatabaseData,
  createDatabaseView,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    selectionSafetyEditor?: EditorController;
  }
}

async function mount(page: Page, data: DatabaseData) {
  await installFixtureGuards(page);
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "selectionSafetyContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'selection-safety-test'
    document.body.prepend(host)
    window.selectionSafetyEditor = createEditor({ element: host, outline: false, content: window.selectionSafetyContent })
  `,
  });
  return page.locator("#selection-safety-test .semlo-editor-database");
}

test("record selection does not survive replacing a document with matching identifiers", async ({ page }) => {
  const data = createDatabaseData();
  const root = await mount(page, data);
  await root.getByLabel("选择第 1 条记录").check();
  await expect(root.getByRole("button", { name: "删除选中记录" })).toBeVisible();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("selectionSafetyEditor");
    editor.setContent(structuredClone(editor.getSnapshot().json));
  });
  await expect(root.getByLabel("选择第 1 条记录")).toBeChecked();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("selectionSafetyEditor").editor;
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, "其他文字");
  });
  await expect(root.getByLabel("选择第 1 条记录")).toBeChecked();
  expect(await page.evaluate(() => window.__semloRequireFixture("selectionSafetyEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(root.getByLabel("选择第 1 条记录")).toBeChecked();
  expect(await page.evaluate(() => window.__semloRequireFixture("selectionSafetyEditor").editor.commands.redo())).toBe(
    true,
  );
  await expect(root.getByLabel("选择第 1 条记录")).toBeChecked();
  await page.evaluate((fieldId) => {
    const editor = window.__semloRequireFixture("selectionSafetyEditor");
    const replacement = editor.getSnapshot().json;
    const database = replacement.content?.find((item) => item.type === "semloEditorDatabase")?.attrs?.data;
    database.records[0].values[fieldId] = "新内容";
    editor.setContent(replacement);
  }, data.fields[0].id);
  await expect(root.getByLabel("选择第 1 条记录")).not.toBeChecked();
  await expect(root.getByRole("button", { name: "删除选中记录" })).toHaveCount(0);
  await root.getByLabel("选择第 1 条记录").check();
  expect(await page.evaluate(() => window.__semloRequireFixture("selectionSafetyEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(root.getByLabel("选择第 1 条记录")).not.toBeChecked();
  await root.getByLabel("选择第 1 条记录").check();
  expect(await page.evaluate(() => window.__semloRequireFixture("selectionSafetyEditor").editor.commands.redo())).toBe(
    true,
  );
  await expect(root.getByLabel("选择第 1 条记录")).not.toBeChecked();
});

test("bulk delete follows the records still visible after searching", async ({ page }) => {
  const data = createDatabaseData();
  const title = data.fields[0].id;
  data.records[0].values[title] = "甲";
  data.records[1].values[title] = "乙";
  const root = await mount(page, data);
  await root.getByRole("checkbox", { name: "选择第 1 条记录" }).check();
  await root.getByRole("checkbox", { name: "选择第 2 条记录" }).check();
  await root.getByRole("button", { name: "搜索", exact: true }).click();
  await root.getByRole("searchbox", { name: "搜索记录" }).fill("乙");
  const remove = root.getByRole("button", { name: "删除选中记录" });
  await remove.click();
  const recordIds = () =>
    page.evaluate(() => {
      const data = window.__semloRequireFixture("selectionSafetyEditor").getSnapshot().json.content?.[0].attrs
        ?.data as DatabaseData;
      return data.records.map((record) => record.id);
    });
  expect(await recordIds()).toEqual([data.records[0].id, data.records[2].id]);
  expect(await page.evaluate(() => window.__semloRequireFixture("selectionSafetyEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await recordIds()).toEqual(data.records.map((record) => record.id));
});

test("switching to a card view and back clears table selection", async ({ page }) => {
  const data = createDatabaseData();
  data.views.push(createDatabaseView("画册视图", "gallery"));
  const root = await mount(page, data);
  await root.getByRole("checkbox", { name: "选择第 1 条记录" }).check();
  const changeView = async (name: string) => {
    await root.getByRole("button", { name: "切换视图", exact: true }).click();
    await root.getByRole("button", { name: `切换到${name}`, exact: true }).click();
  };
  await changeView("画册视图");
  await expect(root.getByRole("button", { name: "删除选中记录" })).toHaveCount(0);
  await changeView("表格视图");
  await expect(root.getByRole("checkbox", { name: "选择第 1 条记录" })).not.toBeChecked();
});

test("select all excludes records in a collapsed group", async ({ page }) => {
  const data = createDatabaseData();
  const status = data.fields[1];
  data.views[0].groupFieldId = status.id;
  data.records[0].values[status.id] = status.options[0].id;
  data.records[1].values[status.id] = status.options[1].id;
  const root = await mount(page, data);
  await root.getByRole("button", { name: "折叠分组 待开始", exact: true }).click();
  await root.getByRole("checkbox", { name: "选择所有记录" }).check();
  await root.getByRole("button", { name: "删除选中记录" }).click();
  const surviving = await page.evaluate(() => {
    const data = window.__semloRequireFixture("selectionSafetyEditor").getSnapshot().json.content?.[0].attrs
      ?.data as DatabaseData;
    return data.records.map((record) => record.id);
  });
  expect(surviving).toEqual([data.records[0].id]);
});

test("bulk delete refreshes collapsed groups before applying a just-edited selection", async ({ page }) => {
  const data = createDatabaseData();
  const title = data.fields[0].id;
  data.views[0].groupFieldId = title;
  data.records[0].values[title] = "甲";
  data.records[1].values[title] = "乙";
  const root = await mount(page, data);
  await root.getByRole("button", { name: "折叠分组 乙", exact: true }).click();
  const row = root.getByRole("row").filter({ has: page.locator(`[data-record-id="${data.records[0].id}"]`) });
  await row.getByRole("checkbox").check();
  const edit = row.getByRole("textbox", { name: /行 文本$/ });
  await edit.focus();
  const records = await edit.evaluate((input: HTMLInputElement) => {
    const database = input.closest(".semlo-editor-database")!;
    const remove = database.querySelector<HTMLButtonElement>(".semlo-editor-database-delete-selected")!;
    input.value = "乙";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    remove.focus();
    remove.click();
    const data = window.__semloRequireFixture("selectionSafetyEditor").getSnapshot().json.content?.[0].attrs
      ?.data as DatabaseData;
    return data.records.map((record) => [record.id, record.values[data.fields[0].id]]);
  });
  expect(records).toEqual(data.records.map((record, index) => [record.id, index === 0 ? "乙" : record.values[title]]));
  await expect(root.getByRole("button", { name: "删除选中记录" })).toHaveCount(0);
});

test("view switching and dismissing the picker keep keyboard focus inside a narrow editor", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 780 });
  const data = createDatabaseData();
  data.views.push(createDatabaseView("画册视图", "gallery"), createDatabaseView("看板视图", "kanban"));
  const root = await mount(page, data);
  const opener = root.getByRole("button", { name: "切换视图", exact: true });
  const panel = root.getByRole("dialog", { name: "切换视图", exact: true });
  await opener.press("Enter");
  await expect(panel.getByRole("button", { name: "切换到表格视图" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(panel.getByRole("button", { name: "切换到画册视图" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(root.getByLabel("视图名称")).toHaveValue("画册视图");
  await expect(opener).toBeFocused();
  await opener.press("Enter");
  await expect(panel.getByRole("button", { name: "切换到画册视图" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(opener).toBeFocused();
});
