import { expect, test } from "@rstest/playwright";

import { createDatabaseData } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    selectionSafetyEditor?: EditorController;
  }
}

test("record selection does not survive replacing a document with matching identifiers", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
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
  const root = page.locator("#selection-safety-test .semlo-editor-database");
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
