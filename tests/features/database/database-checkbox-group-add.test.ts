import { expect, test } from "@rstest/playwright";

import {
  createDatabaseData,
  createDatabaseField,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("checkbox groups add default values and temporarily retain the selected group", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const field = createDatabaseField("复选框", "checkbox");
  field.defaultValue = true;
  data.fields.push(field);
  data.views[0].fieldOrder.push(field.id);
  data.views[0].groupFieldId = field.id;
  data.records.forEach((r, i) => (r.values[field.id] = i === 0));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((v) => Reflect.set(window, "checkboxGroupData", v), data);
  await page.addScriptTag({
    type: "module",
    content: `import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='checkbox-group-test';document.body.prepend(host);window.checkboxGroupEditor=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'semloEditorDatabase',attrs:{data:window.checkboxGroupData}},{type:'paragraph'}]}})`,
  });
  const root = page.locator("#checkbox-group-test .semlo-editor-database");
  const read = () =>
    page.evaluate(
      () => Reflect.get(window, "checkboxGroupEditor").getSnapshot().json.content[0].attrs.data as DatabaseData,
    );
  const groupFor = async (id: string) =>
    page.evaluate((id) => {
      let row = document.querySelector<HTMLElement>(
        `#checkbox-group-test .semlo-editor-database-cell[data-record-id="${id}"]`,
      )?.parentElement?.previousElementSibling;
      while (row && !row.classList.contains("semlo-editor-database-group-row")) row = row.previousElementSibling;
      return row?.querySelector(".semlo-editor-database-group-heading")?.getAttribute("aria-label");
    }, id);
  await root.getByRole("button", { name: "在未勾选分组添加记录" }).click();
  const added = (await read()).records.at(-1)!;
  expect(added.values[field.id]).toBe(true);
  expect(await groupFor(added.id)).toBe("折叠分组 未勾选");
  const current = await root.locator(`.semlo-editor-database-cell[data-record-id="${added.id}"] input`).first();
  await expect(current).toBeFocused();
  await root.getByRole("button", { name: "在已勾选分组添加记录" }).click();
  const added2 = (await read()).records.at(-1)!;
  expect(added2.values[field.id]).toBe(true);
  expect(await groupFor(added.id)).toBe("折叠分组 未勾选");
  expect(await groupFor(added2.id)).toBe("折叠分组 已勾选");
  const row = root.locator(`.semlo-editor-database-cell[data-record-id="${added2.id}"]`).first().locator("..");
  await row.getByRole("button", { name: /删除第 .* 条记录/ }).click();
  expect((await read()).records).toHaveLength(4);
  expect(await groupFor(added.id)).toBe("折叠分组 已勾选");
  await expect(root.locator(".semlo-editor-database-group-count")).toHaveCount(0);
});

test("checkbox group drag follows the projected group", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const field = createDatabaseField("复选框", "checkbox");
  field.defaultValue = true;
  data.fields.push(field);
  data.views[0].fieldOrder.push(field.id);
  data.views[0].groupFieldId = field.id;
  data.records.forEach((r, i) => (r.values[field.id] = i === 0));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((v) => Reflect.set(window, "checkboxGroupData", v), data);
  await page.addScriptTag({
    type: "module",
    content: `import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='checkbox-group-test';document.body.prepend(host);window.checkboxGroupEditor=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'semloEditorDatabase',attrs:{data:window.checkboxGroupData}},{type:'paragraph'}]}})`,
  });
  const root = page.locator("#checkbox-group-test .semlo-editor-database");
  const read = () =>
    page.evaluate(
      () => Reflect.get(window, "checkboxGroupEditor").getSnapshot().json.content[0].attrs.data as DatabaseData,
    );
  const drag = async (source: string, target: string) =>
    page.evaluate(
      ({ source, target }) => {
        const row = (id: string) =>
          document.querySelector<HTMLElement>(
            `#checkbox-group-test .semlo-editor-database-cell[data-record-id="${id}"]`,
          )!.parentElement!;
        const from = row(source).querySelector<HTMLButtonElement>(".semlo-editor-database-record-drag")!,
          to = row(target);
        const marker = to.querySelector<HTMLElement>(".semlo-editor-database-record-index")!,
          rect = marker.getBoundingClientRect(),
          transfer = new DataTransfer();
        from.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }));
        to.dispatchEvent(
          new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: rect.top + 1 }),
        );
      },
      { source, target },
    );
  await root.getByRole("button", { name: "在未勾选分组添加记录" }).click();
  const added = (await read()).records.at(-1)!;
  await drag(added.id, data.records[1].id);
  expect((await read()).records.find((r) => r.id === added.id)?.values[field.id]).toBe(true);
  await drag(data.records[0].id, added.id);
  expect((await read()).records.find((r) => r.id === data.records[0].id)?.values[field.id]).toBe(false);
});

test("checked group sets true even when the checkbox default is false", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const field = createDatabaseField("复选框", "checkbox");
  field.defaultValue = false;
  data.fields.push(field);
  data.views[0].fieldOrder.push(field.id);
  data.views[0].groupFieldId = field.id;
  data.fields[0].defaultValue = "共同命中";
  data.records.forEach((r, i) => {
    r.values[field.id] = i === 0;
    r.values[data.fields[0].id] = "共同命中";
  });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((v) => Reflect.set(window, "checkboxGroupData", v), data);
  await page.addScriptTag({
    type: "module",
    content: `import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='checkbox-group-test';document.body.prepend(host);window.checkboxGroupEditor=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'semloEditorDatabase',attrs:{data:window.checkboxGroupData}},{type:'paragraph'}]}})`,
  });
  const root = page.locator("#checkbox-group-test .semlo-editor-database");
  await root.getByRole("button", { name: "在已勾选分组添加记录" }).click();
  const added = await page.evaluate(() =>
    Reflect.get(window, "checkboxGroupEditor").getSnapshot().json.content[0].attrs.data.records.at(-1),
  );
  expect(added.values[field.id]).toBe(true);
  const group = await page.evaluate((id) => {
    let row = document.querySelector<HTMLElement>(
      `#checkbox-group-test .semlo-editor-database-cell[data-record-id="${id}"]`,
    )?.parentElement?.previousElementSibling;
    while (row && !row.classList.contains("semlo-editor-database-group-row")) row = row.previousElementSibling;
    return row?.querySelector(".semlo-editor-database-group-heading")?.getAttribute("aria-label");
  }, added.id);
  expect(group).toBe("折叠分组 已勾选");
  await page.locator("#checkbox-group-test").getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("共同命中");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/4");
  await root.getByRole("button", { name: "折叠分组 已勾选" }).click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText(/^[12]\/2$/);
});
