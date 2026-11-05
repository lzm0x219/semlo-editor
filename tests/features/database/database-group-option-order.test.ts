import { expect, test } from "@rstest/playwright";

import { createDatabaseData, createDatabaseView } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    groupOptionOrderEditor?: EditorController;
  }
}

for (const type of ["singleSelect", "multiSelect"] as const) {
  test(`${type} groups follow the field's option order`, async ({ page }) => {
    await installFixtureGuards(page);
    const data = createDatabaseData();
    const field = data.fields[1];
    field.type = type;
    field.defaultValue = type === "multiSelect" ? [] : "";
    field.options = [
      { id: "b", label: "乙", color: 0 },
      { id: "a", label: "甲", color: 1 },
    ];
    data.records[0].values[field.id] = type === "multiSelect" ? ["a"] : "a";
    data.records[1].values[field.id] = type === "multiSelect" ? ["b"] : "b";
    data.records[2].values[field.id] = type === "multiSelect" ? [] : "";
    data.views[0].groupFieldId = field.id;
    const other = createDatabaseView("另一视图");
    other.groupFieldId = field.id;
    other.groupDirection = "desc";
    data.views.push(other);
    const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.evaluate((value) => Reflect.set(window, "groupOptionOrderContent", value), content);
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'group-option-order-test'
      document.body.prepend(host)
      window.groupOptionOrderEditor = createEditor({ element: host, outline: false, content: window.groupOptionOrderContent })
    `,
    });
    const root = page.locator("#group-option-order-test .semlo-editor-database");
    const groups = () =>
      root
        .locator(".semlo-editor-database-group-heading")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("aria-label")));
    await expect(root.locator(".semlo-editor-database-group-heading")).toHaveCount(3);
    expect(await groups()).toEqual(["折叠分组 乙", "折叠分组 甲", "折叠分组 （空）"]);
    const tag = root.getByRole("button", { name: "折叠分组 乙", exact: true }).locator(".semlo-editor-database-chip");
    await expect(tag).toHaveText("乙");
    await expect(tag).toHaveCSS("background-color", "rgb(219, 242, 230)");
    await root.getByRole("button", { name: "切换视图" }).click();
    await root.getByRole("dialog", { name: "切换视图" }).getByRole("button", { name: "切换到另一视图" }).click();
    expect(await groups()).toEqual(["折叠分组 甲", "折叠分组 乙", "折叠分组 （空）"]);
    await root.getByRole("button", { name: "切换视图" }).click();
    await root.getByRole("dialog", { name: "切换视图" }).getByRole("button", { name: "切换到表格视图" }).click();
    expect(await groups()).toEqual(["折叠分组 乙", "折叠分组 甲", "折叠分组 （空）"]);
    await root.getByRole("button", { name: "分组", exact: true }).click();
    const panel = root.getByRole("dialog", { name: "分组" });
    await expect(panel.getByLabel("分组顺序").locator("option:checked")).toHaveText("选项顺序");
    await panel.getByLabel("分组顺序").selectOption("desc");
    expect(await groups()).toEqual(["折叠分组 甲", "折叠分组 乙", "折叠分组 （空）"]);
    await panel.getByRole("button", { name: "关闭" }).click();
    await root.getByRole("button", { name: "单选列菜单", exact: true }).click();
    await root.getByRole("menu", { name: "单选 列菜单" }).getByRole("menuitem", { name: "编辑列" }).click();
    const fieldDialog = root.getByRole("dialog", { name: "编辑列" });
    await fieldDialog.getByRole("button", { name: "下移选项 1" }).click();
    await fieldDialog.getByRole("button", { name: "确定" }).click();
    expect(await groups()).toEqual(["折叠分组 乙", "折叠分组 甲", "折叠分组 （空）"]);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("groupOptionOrderEditor").editor.commands.undo()),
    ).toBe(true);
    expect(await groups()).toEqual(["折叠分组 甲", "折叠分组 乙", "折叠分组 （空）"]);
    await root.getByRole("button", { name: "分组", exact: true }).click();
    await panel.getByLabel("分组列").selectOption({ label: "文本" });
    await expect(panel.getByLabel("分组顺序").locator("option:checked")).toHaveText("降序");
  });
}

test("a multi-option group shows a separate colored chip for each option", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const field = data.fields[1];
  field.type = "multiSelect";
  field.defaultValue = [];
  data.records.forEach((record) => {
    record.values[field.id] = [field.options[0].id, field.options[1].id];
  });
  data.views[0].groupFieldId = field.id;
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "groupOptionOrderContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'group-option-order-test'
    document.body.prepend(host)
    window.groupOptionOrderEditor = createEditor({ element: host, outline: false, content: window.groupOptionOrderContent })
  `,
  });
  const group = page.locator("#group-option-order-test .semlo-editor-database-group-heading");
  await expect(group).toHaveCount(1);
  await expect(group.locator(".semlo-editor-database-chip")).toHaveText(["待开始", "进行中"]);
  await expect(group.locator(".semlo-editor-database-group-count")).toHaveCount(0);
  await expect(group).toHaveAttribute("aria-expanded", "true");
});

test("multi-option groups preserve selection order when sorting", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const field = data.fields[1];
  field.type = "multiSelect";
  field.defaultValue = [];
  field.options = [
    { id: "b", label: "乙", color: 0 },
    { id: "a", label: "甲", color: 1 },
  ];
  data.records[0].values[field.id] = ["a", "b"];
  data.records[1].values[field.id] = ["b", "a"];
  data.records[2].values[field.id] = [];
  data.views[0].groupFieldId = field.id;
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((v) => Reflect.set(window, "groupOptionOrderContent", v), content);
  await page.addScriptTag({
    type: "module",
    content: `import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='group-option-order-test';document.body.prepend(host);window.groupOptionOrderEditor=createEditor({element:host,outline:false,content:window.groupOptionOrderContent})`,
  });
  const root = page.locator("#group-option-order-test .semlo-editor-database");
  const groups = () =>
    root
      .locator(".semlo-editor-database-group-heading")
      .evaluateAll((nodes) => nodes.map((n) => n.getAttribute("aria-label")));
  await expect(root.locator(".semlo-editor-database-group-heading")).toHaveCount(3);
  expect(await groups()).toEqual(["折叠分组 乙、甲", "折叠分组 甲、乙", "折叠分组 （空）"]);
  await root.getByRole("button", { name: "分组", exact: true }).click();
  await root.getByRole("dialog", { name: "分组" }).getByLabel("分组顺序").selectOption("desc");
  expect(await groups()).toEqual(["折叠分组 甲、乙", "折叠分组 乙、甲", "折叠分组 （空）"]);
});
