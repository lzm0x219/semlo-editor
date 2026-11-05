import { expect, test } from "@rstest/playwright";

import {
  createDatabaseChart,
  createDatabaseData,
  createDatabaseView,
} from "../../../packages/core/src/features/database/model";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("Escape only closes the data table popup in the focused editor", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "databasePopupIsolationContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    for (let index = 0; index < 2; index++) {
      const host = document.createElement('div'); host.id = 'database-popup-' + index; document.body.prepend(host)
      createEditor({ element: host, outline: false, content: window.databasePopupIsolationContent })
    }
  `,
  });
  const first = page.locator("#database-popup-0 .semlo-editor-database");
  const second = page.locator("#database-popup-1 .semlo-editor-database");
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  await page.evaluate(() => {
    for (const host of document.querySelectorAll('[id^="database-popup-"]'))
      host.querySelector<HTMLButtonElement>('button[aria-label="筛选"]')!.click();
  });
  const firstPanel = first.getByRole("dialog", { name: "筛选" });
  const secondPanel = second.getByRole("dialog", { name: "筛选" });
  await expect(firstPanel).toBeVisible();
  await expect(secondPanel).toBeVisible();
  await firstPanel.getByLabel("筛选值").focus();
  await page.evaluate(() => {
    for (const options of [{ isComposing: true }, { keyCode: 229 }])
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, ...options }));
  });
  await expect(firstPanel).toBeVisible();
  await expect(secondPanel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(firstPanel).toHaveCount(0);
  await expect(secondPanel).toBeVisible();
});

test("Escape and Tab stay within the focused chart dialog", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const view = createDatabaseView("图表", "chart");
  view.charts.push(createDatabaseChart("column", data.fields));
  data.views.push(view);
  data.activeViewId = view.id;
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "databasePopupIsolationContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    for (let index = 0; index < 2; index++) {
      const host = document.createElement('div'); host.id = 'database-chart-popup-' + index; document.body.prepend(host)
      createEditor({ element: host, outline: false, content: window.databasePopupIsolationContent })
    }
  `,
  });
  await expect(page.locator(".semlo-editor-database-chart-card")).toHaveCount(2);
  await page.evaluate(() => {
    for (const host of document.querySelectorAll('[id^="database-chart-popup-"]')) {
      host.querySelector<HTMLButtonElement>('button[aria-label="图表操作"]')!.click();
      document.querySelector<HTMLButtonElement>('[role="menuitem"][aria-label="编辑图表"]')!.click();
    }
  });
  const dialogs = page.getByRole("dialog", { name: "编辑图表" });
  await expect(dialogs).toHaveCount(2);
  const first = dialogs.first();
  const second = dialogs.last();
  await second.getByLabel("图表名称").focus();
  await page.evaluate(() => {
    for (const options of [{ isComposing: true }, { keyCode: 229 }])
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, ...options }));
  });
  await expect(dialogs).toHaveCount(2);
  await page.keyboard.press("Tab");
  expect(await second.evaluate((node) => node.contains(document.activeElement))).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialogs).toHaveCount(1);
  await expect(first).toBeVisible();
});
