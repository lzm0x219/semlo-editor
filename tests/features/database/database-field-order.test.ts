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
    fieldOrderEditor?: EditorController;
  }
}

test("field settings follow each view's field order and visibility", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const [text, choice, date] = data.fields;
  data.views[0].fieldOrder = [choice.id, date.id, text.id];
  data.views[0].hiddenFields = [date.id];
  const other = createDatabaseView("另一视图");
  const gallery = createDatabaseView("画册", "gallery");
  gallery.fieldOrder = [date.id, text.id, choice.id];
  data.views.push(other, gallery);
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "fieldOrderContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'field-order-test'
    document.body.prepend(host)
    window.fieldOrderEditor = createEditor({ element: host, outline: false, content: window.fieldOrderContent })
  `,
  });
  const root = page.locator("#field-order-test .semlo-editor-database");
  const panel = root.getByRole("dialog", { name: "字段配置" });
  const names = () =>
    panel
      .locator(".semlo-editor-database-field-toggle input:not([aria-label='显示字段名'])")
      .evaluateAll((inputs) => inputs.map((input) => input.getAttribute("aria-label")));
  const open = () => root.getByRole("button", { name: "字段配置", exact: true }).click();
  const switchView = async (name: string) => {
    await root.getByRole("button", { name: "切换视图" }).click();
    await root
      .getByRole("dialog", { name: "切换视图" })
      .getByRole("button", { name: `切换到${name}` })
      .click();
  };
  await open();
  expect(await names()).toEqual(["显示单选", "显示日期", "显示文本"]);
  await expect(panel.getByLabel("显示日期")).not.toBeChecked();
  await panel.getByLabel("显示日期").click();
  await expect(root.locator(".semlo-editor-database-header [data-column-id]")).toHaveCount(3);
  await panel.getByRole("button", { name: "关闭" }).click();
  await switchView("另一视图");
  await open();
  expect(await names()).toEqual(["显示文本", "显示单选", "显示日期"]);
  await panel.getByRole("button", { name: "关闭" }).click();
  await switchView("画册");
  await open();
  expect(await names()).toEqual(["显示日期", "显示文本", "显示单选"]);
  const saved = await page.evaluate(
    () =>
      window
        .__semloRequireFixture("fieldOrderEditor")
        .getSnapshot()
        .json.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data as DatabaseData,
  );
  expect(saved.views[0].hiddenFields).toEqual([]);
  expect(saved.views[1].fieldOrder).toEqual([]);
  expect(saved.views[2].fieldOrder).toEqual([date.id, text.id, choice.id]);
});
