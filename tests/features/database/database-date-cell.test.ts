import { expect, test } from "@rstest/playwright";

import { createDatabaseData } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    databaseDateCellEditor?: EditorController;
  }
}

test("empty date cells stay visually blank until focused and restore correctly on undo", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  data.records[1].values[data.fields[2].id] = "2026-11-05";
  data.records[2].values[data.fields[2].id] = "0000-01-01";
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "databaseDateCellContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'database-date-cell-test'
    document.body.prepend(host)
    window.databaseDateCellEditor = createEditor({ element: host, outline: false, content: window.databaseDateCellContent })
  `,
  });
  const root = page.locator("#database-date-cell-test .semlo-editor-database");
  const first = root.getByLabel("第 1 行 日期");
  const second = root.getByLabel("第 2 行 日期");
  const third = root.getByLabel("第 3 行 日期");
  const firstDisplay = first.locator("..").locator(".semlo-editor-database-date-display");
  const secondDisplay = second.locator("..").locator(".semlo-editor-database-date-display");
  await expect(firstDisplay).toHaveText("");
  await expect(secondDisplay).toHaveText("2026-11-05");
  await expect(third).toHaveAttribute("type", "text");
  await expect(third).toHaveValue("0000-01-01");
  await first.focus();
  await expect(first).toBeFocused();
  await expect(firstDisplay).toBeHidden();
  await first.fill("2026-11-06");
  await expect(firstDisplay).toHaveText("2026-11-06");
  await first.press("ControlOrMeta+z");
  await expect(first).toHaveValue("");
  await expect(firstDisplay).toHaveText("");
  await first.press("ControlOrMeta+Shift+z");
  await expect(first).toHaveValue("2026-11-06");
  await expect(firstDisplay).toHaveText("2026-11-06");
  await first.blur();
  await expect(firstDisplay).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("databaseDateCellEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(first).toHaveValue("");
  await expect(firstDisplay).toHaveText("");
});
