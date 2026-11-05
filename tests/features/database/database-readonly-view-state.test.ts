import { expect, test } from "@rstest/playwright";

import { createDatabaseData, createDatabaseView } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    readonlyViewStateEditor?: EditorController;
  }
}

test("read-only view selection does not leak to a different database with matching view IDs", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  data.views.push(createDatabaseView("另一视图"));
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "readonlyViewStateContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'readonly-view-state-test'
    document.body.prepend(host)
    window.readonlyViewStateEditor = createEditor({ element: host, outline: false, editable: false, content: window.readonlyViewStateContent })
  `,
  });
  const root = page.locator("#readonly-view-state-test .semlo-editor-database");
  await root.getByRole("button", { name: "切换视图" }).click();
  await root.getByRole("dialog", { name: "切换视图" }).getByRole("button", { name: "切换到另一视图" }).click();
  await expect(root.getByRole("table", { name: "另一视图" })).toBeVisible();
  await root.getByRole("button", { name: "搜索", exact: true }).click();
  await root.getByLabel("搜索记录").fill("没有结果");
  await expect(root.locator(".semlo-editor-database-record-index")).toHaveCount(0);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("readonlyViewStateEditor");
    editor.setContent(structuredClone(editor.getSnapshot().json));
  });
  await expect(root.getByRole("table", { name: "另一视图" })).toBeVisible();
  await expect(root.getByLabel("搜索记录")).toHaveValue("没有结果");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("readonlyViewStateEditor");
    const replacement = editor.getSnapshot().json;
    replacement.content!.find((node) => node.type === "semloEditorDatabase")!.attrs!.data.id = "other-database";
    editor.setContent(replacement);
  });
  await expect(root.getByRole("table", { name: "表格视图" })).toBeVisible();
  await expect(root.getByLabel("搜索记录")).toHaveCount(0);
  await expect(root.locator(".semlo-editor-database-record-index")).toHaveCount(3);
});
