import { expect, test } from "@rstest/playwright";

import {
  createDatabaseData,
  createDatabaseField,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("automatic timestamp statistics use local calendar dates independent of display format", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const created = createDatabaseField("创建时间", "createdTime");
  const modified = createDatabaseField("修改时间", "modifiedTime");
  created.timeFormat = "year";
  modified.timeFormat = "time";
  data.fields.push(created, modified);
  data.views[0].fieldOrder.push(created.id, modified.id);
  const times = [
    new Date(2024, 0, 31, 12).toISOString(),
    new Date(2024, 1, 29, 12).toISOString(),
    new Date(2024, 2, 1, 12).toISOString(),
  ];
  data.records.forEach((record, index) => {
    record.createdAt = times[index];
    record.modifiedAt = times[index];
  });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "statsData", value), data);
  await page.addScriptTag({
    type: "module",
    content: `import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='stats-test';document.body.prepend(host);window.statsEditor=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'semloEditorDatabase',attrs:{data:window.statsData}},{type:'paragraph'}]}})`,
  });
  const root = page.locator("#stats-test .semlo-editor-database");
  for (const field of [created, modified]) {
    const button = root.getByRole("button", { name: `${field.name}统计`, exact: true });
    for (const [choice, expected] of [
      ["最早时间", "最早时间 2024-01-31"],
      ["最晚时间", "最晚时间 2024-03-01"],
      ["时间范围（日）", "时间范围 30 天"],
      ["时间范围（月）", "时间范围 1 月"],
    ] as const) {
      await button.click();
      await root
        .getByRole("dialog", { name: `${field.name} 统计` })
        .getByRole("button", { name: choice, exact: true })
        .click();
      await expect(button).toHaveText(expected);
    }
  }
  const saved = await page.evaluate(
    () => Reflect.get(window, "statsEditor").getSnapshot().json.content[0].attrs.data as DatabaseData,
  );
  expect(saved.views[0].statistics[created.id]).toBe("dateRangeMonths");
  expect(saved.views[0].statistics[modified.id]).toBe("dateRangeMonths");
  await page.evaluate(() => {
    const editor = Reflect.get(window, "statsEditor");
    editor.setContent(structuredClone(editor.getSnapshot().json));
  });
  await expect(root.getByRole("button", { name: "创建时间统计", exact: true })).toHaveText("时间范围 1 月");
  await expect(root.getByRole("button", { name: "修改时间统计", exact: true })).toHaveText("时间范围 1 月");
  await page.evaluate(
    ({ firstId, secondId }) => {
      const editor = Reflect.get(window, "statsEditor");
      const json = structuredClone(editor.getSnapshot().json);
      const data = json.content[0].attrs.data;
      for (const record of data.records) {
        delete record.createdAt;
        delete record.modifiedAt;
        delete record.values[firstId];
        delete record.values[secondId];
      }
      data.views[0].statistics[firstId] = "earliestDate";
      data.views[0].statistics[secondId] = "latestDate";
      editor.setContent(json);
    },
    { firstId: created.id, secondId: modified.id },
  );
  await expect(root.getByRole("button", { name: "创建时间统计", exact: true })).toHaveText("最早时间 —");
  await expect(root.getByRole("button", { name: "修改时间统计", exact: true })).toHaveText("最晚时间 —");
});
