import { expect, test } from "@rstest/playwright";

import { createDatabaseData, createDatabaseField } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    groupCheckboxEditor?: EditorController;
  }
}

test("checkbox groups show checked state and retain accessible labels", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const field = createDatabaseField("完成", "checkbox");
  data.fields.push(field);
  data.records[2].values[field.id] = true;
  data.views[0].groupFieldId = field.id;
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "groupCheckboxContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'group-checkbox-test'
    document.body.prepend(host)
    window.groupCheckboxEditor = createEditor({ element: host, outline: false, content: window.groupCheckboxContent })
  `,
  });
  const root = page.locator("#group-checkbox-test .semlo-editor-database");
  const unchecked = root.getByRole("button", { name: "折叠分组 未勾选" });
  const checked = root.getByRole("button", { name: "折叠分组 已勾选" });
  await expect(unchecked.locator(".semlo-editor-database-group-checkbox")).not.toHaveClass(/is-checked/);
  await expect(checked.locator(".semlo-editor-database-group-checkbox")).toHaveClass(/is-checked/);
  await expect(unchecked.locator(".semlo-editor-database-group-count")).toHaveCount(0);
  await expect(checked.locator(".semlo-editor-database-group-count")).toHaveCount(0);
  await unchecked.click();
  await expect(unchecked).toHaveAttribute("aria-expanded", "false");
  await expect(checked).toHaveAttribute("aria-expanded", "true");
});
