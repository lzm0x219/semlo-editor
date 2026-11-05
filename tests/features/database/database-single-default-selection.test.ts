import { expect, test } from "@rstest/playwright";

import { createDatabaseData, type DatabaseData } from "../../../packages/core/src/features/database/model";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("single-select default follows option identity across renames and removal", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const field = data.fields[1];
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((v) => Reflect.set(window, "singleDefaultData", v), data);
  await page.addScriptTag({
    type: "module",
    content: `import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='single-default-test';document.body.prepend(host);window.singleDefaultEditor=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'semloEditorDatabase',attrs:{data:window.singleDefaultData}},{type:'paragraph'}]}})`,
  });
  const root = page.locator("#single-default-test .semlo-editor-database");
  const read = () =>
    page.evaluate(
      () => Reflect.get(window, "singleDefaultEditor").getSnapshot().json.content[0].attrs.data as DatabaseData,
    );
  const open = async () => {
    await root.getByRole("button", { name: "单选列菜单" }).click();
    await root.getByRole("menu", { name: "单选 列菜单" }).getByRole("menuitem", { name: "编辑列" }).click();
  };
  await open();
  let panel = root.getByRole("dialog", { name: "编辑列" });
  await panel.getByRole("button", { name: "默认值", exact: true }).click();
  await panel.getByRole("option", { name: field.options[0].label }).click();
  await panel.getByRole("button", { name: "确定" }).click();
  expect((await read()).fields[1].defaultValue).toBe(field.options[0].id);
  await open();
  panel = root.getByRole("dialog", { name: "编辑列" });
  await panel.getByLabel("选项名称 1").fill("改名");
  await expect(panel.getByRole("button", { name: "默认值", exact: true })).toHaveText("改名");
  await panel.getByRole("button", { name: "确定" }).click();
  expect((await read()).fields[1].defaultValue).toBe(field.options[0].id);
  await open();
  panel = root.getByRole("dialog", { name: "编辑列" });
  await panel.getByRole("button", { name: "删除选项 1" }).click();
  await expect(panel.getByRole("button", { name: "默认值", exact: true })).toHaveText("请选择");
  await panel.getByRole("button", { name: "确定" }).click();
  expect((await read()).fields[1].defaultValue).toBe("");
  await open();
  panel = root.getByRole("dialog", { name: "编辑列" });
  await panel.getByLabel("列类型").selectOption("text");
  await panel.getByLabel("默认值").fill("示例");
  await panel.getByRole("button", { name: "取消" }).click();
});

test("legacy single-select default label resolves to its option identity", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData(),
    field = data.fields[1];
  field.defaultValue = field.options[0].label;
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((v) => Reflect.set(window, "singleDefaultData", v), data);
  await page.addScriptTag({
    type: "module",
    content: `import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='single-default-test';document.body.prepend(host);window.singleDefaultEditor=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'semloEditorDatabase',attrs:{data:window.singleDefaultData}},{type:'paragraph'}]}})`,
  });
  const root = page.locator("#single-default-test .semlo-editor-database");
  await root.getByRole("button", { name: "单选列菜单" }).click();
  await root.getByRole("menu", { name: "单选 列菜单" }).getByRole("menuitem", { name: "编辑列" }).click();
  const panel = root.getByRole("dialog", { name: "编辑列" });
  await expect(panel.getByRole("button", { name: "默认值", exact: true })).toHaveText(field.options[0].label);
  await panel.getByRole("button", { name: "确定" }).click();
  const saved = await page.evaluate(
    () => Reflect.get(window, "singleDefaultEditor").getSnapshot().json.content[0].attrs.data as DatabaseData,
  );
  expect(saved.fields[1].defaultValue).toBe(field.options[0].id);
});

test("single-select default picker filters, supports keyboard and clears without closing the editor", async ({
  page,
}) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const field = data.fields[1];
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((v) => Reflect.set(window, "singleDefaultData", v), data);
  await page.addScriptTag({
    type: "module",
    content: `import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='single-default-test';document.body.prepend(host);window.singleDefaultEditor=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'semloEditorDatabase',attrs:{data:window.singleDefaultData}},{type:'paragraph'}]}})`,
  });
  const root = page.locator("#single-default-test .semlo-editor-database");
  await root.getByRole("button", { name: "单选列菜单" }).click();
  await root.getByRole("menu", { name: "单选 列菜单" }).getByRole("menuitem", { name: "编辑列" }).click();
  const panel = root.getByRole("dialog", { name: "编辑列" });
  const trigger = panel.getByRole("button", { name: "默认值", exact: true });
  await trigger.click();
  const search = panel.getByLabel("搜索默认选项");
  await search.fill(field.options[0].label);
  await expect(panel.getByRole("listbox", { name: "默认选项" }).getByRole("option")).toHaveCount(1);
  await search.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveText(field.options[0].label);
  await trigger.click();
  await search.press("Escape");
  await expect(panel).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();
  await trigger.click();
  const list = panel.getByRole("listbox", { name: "默认选项" });
  await list.getByRole("option").last().focus();
  await page.keyboard.press("Tab");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(list).toBeHidden();
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await root.getByRole("button", { name: "单选列菜单" }).click();
  await root.getByRole("menu", { name: "单选 列菜单" }).getByRole("menuitem", { name: "编辑列" }).click();
  await trigger.click();
  await panel.getByRole("listbox", { name: "默认选项" }).getByRole("option", { name: field.options[0].label }).click();
  await panel.getByRole("button", { name: "清除默认值" }).click();
  await expect(trigger).toHaveText("请选择");
  await panel.getByRole("button", { name: "确定" }).click();
  const saved = await page.evaluate(
    () => Reflect.get(window, "singleDefaultEditor").getSnapshot().json.content[0].attrs.data as DatabaseData,
  );
  expect(saved.fields[1].defaultValue).toBe("");
});

for (const mode of ["echo", "readonly", "destroy"]) {
  test(`single-select default save handles host ${mode} reentry`, async ({ page }) => {
    await installFixtureGuards(page);
    const data = createDatabaseData();
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.evaluate(
      ({ value, action }) => {
        Reflect.set(window, "singleDefaultData", value);
        Reflect.set(window, "singleDefaultMode", action);
        Reflect.set(window, "singleDefaultChanges", 0);
      },
      { value: data, action: mode },
    );
    await page.addScriptTag({
      type: "module",
      content: `import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='single-default-test';document.body.prepend(host);let editor;editor=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'semloEditorDatabase',attrs:{data:window.singleDefaultData}},{type:'paragraph'}]},onChange:snapshot=>{window.singleDefaultChanges++;const mode=window.singleDefaultMode;window.singleDefaultMode='';if(mode==='echo')editor.setContent(structuredClone(snapshot.json));if(mode==='readonly')editor.setEditable(false);if(mode==='destroy')editor.destroy()}});window.singleDefaultEditor=editor`,
    });
    const root = page.locator("#single-default-test .semlo-editor-database");
    await root.getByRole("button", { name: "单选列菜单" }).click();
    await root.getByRole("menu", { name: "单选 列菜单" }).getByRole("menuitem", { name: "编辑列" }).click();
    const panel = root.getByRole("dialog", { name: "编辑列" });
    await panel.getByRole("button", { name: "默认值", exact: true }).click();
    await panel.getByRole("option", { name: data.fields[1].options[0].label }).click();
    await panel.getByRole("button", { name: "取消" }).click();
    expect(await page.evaluate(() => Reflect.get(window, "singleDefaultChanges"))).toBe(0);
    await root.getByRole("button", { name: "单选列菜单" }).click();
    await root.getByRole("menu", { name: "单选 列菜单" }).getByRole("menuitem", { name: "编辑列" }).click();
    const reopened = root.getByRole("dialog", { name: "编辑列" });
    await expect(reopened.getByRole("button", { name: "默认值", exact: true })).toHaveText("请选择");
    await reopened.getByRole("button", { name: "默认值", exact: true }).click();
    await reopened.getByRole("option", { name: data.fields[1].options[0].label }).click();
    await reopened.getByRole("button", { name: "确定" }).click();
    expect(await page.evaluate(() => Reflect.get(window, "singleDefaultChanges"))).toBe(1);
    if (mode !== "destroy") {
      const saved = await page.evaluate(
        () => Reflect.get(window, "singleDefaultEditor").getSnapshot().json.content[0].attrs.data as DatabaseData,
      );
      expect(saved.fields[1].defaultValue).toBe(data.fields[1].options[0].id);
    } else await expect(root).toHaveCount(0);
  });
}
