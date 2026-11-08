import { expect, test } from "@rstest/playwright";

import { createDatabaseData, type DatabaseData } from "../../../packages/core/src/features/database/model";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

for (const [name, values, earliest, latest, days] of [
  ["empty", ["", "", ""], "Invalid Date", "—", "0"],
  ["invalid only", ["2024-02-30", "", ""], "—", "—", "0"],
  ["leap and month end", ["2024-02-29", "2024-03-01", "2024-01-31"], "2024-01-31", "2024-03-01", "30"],
  ["invalid dates ignored", ["2024-02-30", "2024-03-01", "2024-02-29"], "2024-02-29", "2024-03-01", "1"],
] as const) {
  test(`date statistics: ${name}`, async ({ page }) => {
    await installFixtureGuards(page);
    const data = createDatabaseData();
    const field = data.fields.find((entry) => entry.type === "date")!;
    data.records.forEach((record, index) => {
      record.values[field.id] = values[index];
    });
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.evaluate((value) => Reflect.set(window, "statsData", value), data);
    await page.addScriptTag({
      type: "module",
      content: `import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='stats-test';document.body.prepend(host);window.statsEditor=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'semloEditorDatabase',attrs:{data:window.statsData}},{type:'paragraph'}]}})`,
    });
    const root = page.locator("#stats-test .semlo-editor-database");
    const button = root.getByRole("button", { name: "日期统计", exact: true });
    const select = async (choice: string) => {
      await button.click();
      const dialog = root.getByRole("dialog", { name: "日期 统计" });
      await expect(dialog.getByRole("button", { name: "时间范围（月）" })).toHaveCount(1);
      await dialog.getByRole("button", { name: choice, exact: true }).click();
    };
    await select("最早时间");
    await expect(button).toHaveText(`最早时间 ${earliest}`);
    await select("最晚时间");
    await expect(button).toHaveText(`最晚时间 ${latest}`);
    await select("时间范围（日）");
    await expect(button).toHaveText(`时间范围 ${days} 天`);
    const saved = await page.evaluate(
      () => Reflect.get(window, "statsEditor").getSnapshot().json.content[0].attrs.data as DatabaseData,
    );
    expect(saved.views[0].statistics[field.id]).toBe("dateRangeDays");
    await page.evaluate(() => {
      const editor = Reflect.get(window, "statsEditor");
      editor.setContent(structuredClone(editor.getSnapshot().json));
    });
    await expect(button).toHaveText(`时间范围 ${days} 天`);
  });
}

test("date range shares configuration but calculates within each group", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const group = data.fields[1];
  const date = data.fields.find((entry) => entry.type === "date")!;
  data.views[0].groupFieldId = group.id;
  data.records[0].values[group.id] = group.options[0].id;
  data.records[1].values[group.id] = group.options[0].id;
  data.records[2].values[group.id] = "";
  data.records[0].values[date.id] = "2024-02-29";
  data.records[1].values[date.id] = "2024-03-01";
  data.records[2].values[date.id] = "2024-01-31";
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "statsData", value), data);
  await page.addScriptTag({
    type: "module",
    content: `import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='stats-test';document.body.prepend(host);window.statsEditor=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'semloEditorDatabase',attrs:{data:window.statsData}},{type:'paragraph'}]}})`,
  });
  const root = page.locator("#stats-test .semlo-editor-database");
  const grouped = root.getByRole("button", { name: `${group.options[0].label}分组的日期统计`, exact: true });
  await grouped.click();
  await root
    .getByRole("dialog", { name: "日期 统计" })
    .getByRole("button", { name: "时间范围（日）", exact: true })
    .click();
  await expect(grouped).toHaveText("时间范围 1 天");
  await expect(root.getByRole("button", { name: "（空）分组的日期统计", exact: true })).toHaveText("时间范围 0 天");
  await expect(root.getByRole("button", { name: "日期统计", exact: true })).toHaveText("时间范围 30 天");
});
