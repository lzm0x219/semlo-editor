import { expect, test } from "@rstest/playwright";

import { createDatabaseData, type DatabaseData } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    databaseGallerySortEditor?: EditorController;
  }
}

test("gallery sorting allows repeated field changes and later direction changes", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  data.views[0].kind = "gallery";
  data.views[0].sorts = [{ fieldId: data.fields[0].id, direction: "asc" }];
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "databaseGallerySortContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div'); host.id = 'database-gallery-sort'; document.body.prepend(host)
      window.databaseGallerySortEditor = createEditor({element: host, outline: false, content: window.databaseGallerySortContent})
    `,
  });
  const panel = page.locator("#database-gallery-sort .semlo-editor-database").getByRole("dialog", { name: "排序" });
  await page
    .locator("#database-gallery-sort .semlo-editor-database")
    .getByRole("button", { name: "排序", exact: true })
    .click();
  const read = async () =>
    (await page.evaluate(
      () => window.__semloRequireFixture("databaseGallerySortEditor").getSnapshot().json.content![0].attrs!.data,
    )) as DatabaseData;
  await panel.getByLabel("排序列").selectOption(data.fields[1].id);
  expect((await read()).views[0].sorts[0].fieldId).toBe(data.fields[1].id);
  await panel.getByLabel("排序列").selectOption(data.fields[2].id);
  expect((await read()).views[0].sorts[0].fieldId).toBe(data.fields[2].id);
  await panel.getByLabel("排序顺序").selectOption("desc");
  expect((await read()).views[0].sorts[0].direction).toBe("desc");
});
