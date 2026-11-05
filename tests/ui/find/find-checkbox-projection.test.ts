import { expect, test } from "@rstest/playwright";

import {
  createDatabaseData,
  createDatabaseField,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("find follows a pending checkbox group across collapse and redraw", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const title = data.fields[0];
  title.defaultValue = "共同命中";
  const checkbox = createDatabaseField("完成", "checkbox");
  checkbox.defaultValue = true;
  data.fields.push(checkbox);
  data.records.forEach((record, index) => {
    record.values[title.id] = "共同命中";
    record.values[checkbox.id] = index === 0;
  });
  data.views[0].groupFieldId = checkbox.id;
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "checkboxProjectionData", value), data);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'find-checkbox-projection'; document.body.append(host)
    window.checkboxProjectionEditor = createEditor({ element: host, outline: false,
      content: { type: 'doc', content: [{type: 'semloEditorDatabase', attrs: {data: window.checkboxProjectionData}}, {type: 'paragraph'}] } })
  `,
  });
  const root = page.locator("#find-checkbox-projection");
  const database = root.locator(".semlo-editor-database");
  const read = () =>
    page.evaluate(
      () => Reflect.get(window, "checkboxProjectionEditor").getSnapshot().json.content[0].attrs.data as DatabaseData,
    );
  await database.getByRole("button", { name: "在未勾选分组添加记录" }).click();
  const first = (await read()).records.at(-1)!;
  expect(first.values[checkbox.id]).toBe(true);
  await database.getByRole("button", { name: "在已勾选分组添加记录" }).click();
  const second = (await read()).records.at(-1)!;
  expect(second.values[checkbox.id]).toBe(true);
  const visualGroup = (id: string) =>
    page.evaluate((id) => {
      const cell = document.querySelector<HTMLElement>(
        `#find-checkbox-projection .semlo-editor-database-cell[data-record-id="${id}"]`,
      );
      let row = cell?.parentElement?.previousElementSibling;
      while (row && !row.classList.contains("semlo-editor-database-group-row")) row = row.previousElementSibling;
      return row?.querySelector(".semlo-editor-database-group-heading")?.getAttribute("aria-label");
    }, id);
  expect(await visualGroup(first.id)).toBe("折叠分组 未勾选");
  expect(await visualGroup(second.id)).toBe("折叠分组 已勾选");
  await root.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("共同命中");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/5");
  await database.getByRole("button", { name: "折叠分组 未勾选" }).click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText(/^[12]\/2$/);
  const firstCell = database.locator(
    `.semlo-editor-database-cell[data-record-id="${first.id}"][data-field-id="${title.id}"]`,
  );
  await expect(firstCell).toHaveCount(0);
  const secondCell = database.locator(
    `.semlo-editor-database-cell[data-record-id="${second.id}"][data-field-id="${title.id}"]`,
  );
  await expect(secondCell).toHaveClass(/semlo-editor-find-match/);
  await secondCell
    .locator("..")
    .getByRole("button", { name: /删除第 .* 条记录/ })
    .click({ force: true });
  expect((await read()).records.some((record) => record.id === second.id)).toBe(false);
  expect(await visualGroup(first.id)).toBe("折叠分组 已勾选");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText(/^[12]\/2$/);
  await expect(firstCell).toHaveClass(/semlo-editor-find-match/);
  await page.evaluate(() => Reflect.get(window, "checkboxProjectionEditor").destroy());
});
