import { expect, test } from "@rstest/playwright";

import {
  createDatabaseData,
  createDatabaseField,
  createDatabaseView,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("find follows a pending single-select empty group through controlled writes and view refresh", async ({
  page,
}) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const title = data.fields[0];
  title.defaultValue = "共同命中";
  const status = createDatabaseField("状态", "singleSelect");
  status.options = [{ id: "pending", label: "待开始", color: 0 }];
  status.defaultValue = "pending";
  data.fields.push(status);
  data.records.forEach((record, index) => {
    record.values[title.id] = "共同命中";
    record.values[status.id] = index === 0 ? "pending" : "";
  });
  data.views[0].groupFieldId = status.id;
  const other = createDatabaseView("另一视图", "table");
  other.groupFieldId = status.id;
  data.views.push(other);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "singleProjectionData", value), data);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'find-single-projection'; document.body.append(host)
    window.singleProjectionEditor = createEditor({ element: host, outline: false,
      content: { type: 'doc', content: [{type: 'semloEditorDatabase', attrs: {data: window.singleProjectionData}}, {type: 'paragraph'}] } })
  `,
  });
  const root = page.locator("#find-single-projection");
  const database = root.locator(".semlo-editor-database");
  const read = () =>
    page.evaluate(
      () => Reflect.get(window, "singleProjectionEditor").getSnapshot().json.content[0].attrs.data as DatabaseData,
    );
  await database.getByRole("button", { name: "在（空）分组添加记录" }).click();
  const added = (await read()).records.at(-1)!;
  expect(added.values[status.id]).toBe("pending");
  const visualGroup = () =>
    page.evaluate((id) => {
      const cell = document.querySelector<HTMLElement>(
        `#find-single-projection .semlo-editor-database-cell[data-record-id="${id}"]`,
      );
      let row = cell?.parentElement?.previousElementSibling;
      while (row && !row.classList.contains("semlo-editor-database-group-row")) row = row.previousElementSibling;
      return row?.querySelector(".semlo-editor-database-group-heading")?.getAttribute("aria-label");
    }, added.id);
  expect(await visualGroup()).toBe("折叠分组 （空）");
  await root.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("共同命中");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/4");
  await database.getByRole("button", { name: "折叠分组 （空）" }).click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/1");
  const addedCell = database.locator(
    `.semlo-editor-database-cell[data-record-id="${added.id}"][data-field-id="${title.id}"]`,
  );
  await expect(addedCell).toHaveCount(0);
  await page.evaluate(() => {
    const editor = Reflect.get(window, "singleProjectionEditor");
    editor.setContent(structuredClone(editor.getSnapshot().json));
  });
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/1");
  await database.getByRole("button", { name: "切换视图" }).click();
  await database.getByRole("dialog", { name: "切换视图" }).getByRole("button", { name: "切换到另一视图" }).click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText(/^[1-4]\/4$/);
  expect(await visualGroup()).toBe("折叠分组 待开始");
  await expect(addedCell).toHaveClass(/semlo-editor-find-match/);
  await page.evaluate(() => Reflect.get(window, "singleProjectionEditor").destroy());
});
