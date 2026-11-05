import { expect, test } from "@rstest/playwright";

import { createDatabaseData, createDatabaseField } from "../../../packages/core/src/features/database/model";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

for (const [name, values, expected] of [
  ["decimal addition", ["0.1", "0.2", ""], "0.3"],
  ["mixed precision", ["0.29", "0.01", "-0.1"], "0.2"],
  ["unsafe scaled integer fallback", ["9007199254740991", "1", ""], "9007199254740992"],
  ["scientific notation fallback", ["1e-7", "2e-7", ""], String(1e-7 + 2e-7)],
  ["overflow fallback", [String(Number.MAX_VALUE), String(Number.MAX_VALUE), ""], "Infinity"],
  ["high precision fallback", ["0.0000000000001", "0.0000000000002", ""], String(0.0000000000001 + 0.0000000000002)],
] as const) {
  test(`numeric column sum: ${name}`, async ({ page }) => {
    await installFixtureGuards(page);
    const data = createDatabaseData();
    const field = createDatabaseField("数字", "number");
    data.fields.push(field);
    data.views[0].fieldOrder.push(field.id);
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
    await root.getByRole("button", { name: "数字统计", exact: true }).click();
    await root.getByRole("dialog", { name: "数字 统计" }).getByRole("button", { name: "求和", exact: true }).click();
    await expect(root.getByRole("button", { name: "数字统计", exact: true })).toHaveText(`求和 ${expected}`);
  });
}
