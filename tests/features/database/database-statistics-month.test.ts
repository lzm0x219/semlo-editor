import { expect, test } from "@rstest/playwright";

import { createDatabaseData, type DatabaseData } from "../../../packages/core/src/features/database/model";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

for (const [start, end, months] of [
  ["", "", 0],
  ["2024-02-29", "2024-02-29", 0],
  ["2024-01-15", "2024-02-14", 0],
  ["2024-01-15", "2024-02-15", 1],
  ["2024-01-31", "2024-02-28", 0],
  ["2024-01-30", "2024-02-29", 1],
  ["2024-01-31", "2024-02-29", 1],
  ["2024-01-31", "2024-03-30", 1],
  ["2024-01-31", "2024-03-31", 2],
  ["2023-12-31", "2024-02-29", 2],
  ["2023-01-31", "2023-02-28", 1],
] as const) {
  test(`date month range ${start} to ${end}`, async ({ page }) => {
    await installFixtureGuards(page);
    const data = createDatabaseData();
    const field = data.fields.find((entry) => entry.type === "date")!;
    data.records[0].values[field.id] = end;
    data.records[1].values[field.id] = start;
    data.records[2].values[field.id] = "";
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.evaluate((value) => Reflect.set(window, "statsData", value), data);
    await page.addScriptTag({
      type: "module",
      content: `import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='stats-test';document.body.prepend(host);window.statsEditor=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'semloEditorDatabase',attrs:{data:window.statsData}},{type:'paragraph'}]}})`,
    });
    const root = page.locator("#stats-test .semlo-editor-database");
    const button = root.getByRole("button", { name: "日期统计", exact: true });
    await button.click();
    await root
      .getByRole("dialog", { name: "日期 统计" })
      .getByRole("button", { name: "时间范围（月）", exact: true })
      .click();
    await expect(button).toHaveText(`时间范围 ${months} 月`);
    const saved = await page.evaluate(
      () => Reflect.get(window, "statsEditor").getSnapshot().json.content[0].attrs.data as DatabaseData,
    );
    expect(saved.views[0].statistics[field.id]).toBe("dateRangeMonths");
  });
}
