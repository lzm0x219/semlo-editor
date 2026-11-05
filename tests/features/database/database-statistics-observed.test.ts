import { expect, test } from "@rstest/playwright";

import { createDatabaseData, createDatabaseField } from "../../../packages/core/src/features/database/model";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("text and checkbox statistic labels and counts follow observed behavior", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const text = data.fields[0];
  const checked = createDatabaseField("复选框", "checkbox");
  data.fields.push(checked);
  data.views[0].fieldOrder.push(checked.id);
  data.records.forEach((record, index) => {
    record.values[text.id] = index === 0 ? "测试" : "";
    record.values[checked.id] = index === 0;
  });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "statsData", value), data);
  await page.addScriptTag({
    type: "module",
    content: `import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='stats-test';document.body.prepend(host);window.statsEditor=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'semloEditorDatabase',attrs:{data:window.statsData}},{type:'paragraph'}]}})`,
  });
  const root = page.locator("#stats-test .semlo-editor-database");
  const select = async (field: string, choice: string) => {
    await root.getByRole("button", { name: `${field}统计`, exact: true }).click();
    await root
      .getByRole("dialog", { name: `${field} 统计` })
      .getByRole("button", { name: choice, exact: true })
      .click();
  };
  await select("文本", "已填写数");
  await expect(root.getByRole("button", { name: "文本统计", exact: true })).toHaveText("已填写 1");
  await select("文本", "未填写数");
  await expect(root.getByRole("button", { name: "文本统计", exact: true })).toHaveText("未填写 2");
  await root.getByRole("button", { name: "复选框统计", exact: true }).click();
  const menu = root.getByRole("dialog", { name: "复选框 统计" });
  await expect(menu.getByRole("button", { name: "唯一数", exact: true })).toHaveCount(0);
  await expect(menu.getByRole("button", { name: "唯一数占比", exact: true })).toHaveCount(0);
  await menu.getByRole("button", { name: "已勾选", exact: true }).click();
  await expect(root.getByRole("button", { name: "复选框统计", exact: true })).toHaveText("已勾选 1");
  await select("复选框", "未勾选");
  await expect(root.getByRole("button", { name: "复选框统计", exact: true })).toHaveText("未勾选 2");
  await select("复选框", "已勾选占比");
  await expect(root.getByRole("button", { name: "复选框统计", exact: true })).toHaveText("已勾选占比 33.33%");
  await select("复选框", "未勾选占比");
  await expect(root.getByRole("button", { name: "复选框统计", exact: true })).toHaveText("未勾选占比 66.67%");
});
