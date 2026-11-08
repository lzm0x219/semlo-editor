import { expect, test } from "@rstest/playwright";

import {
  createDatabaseData,
  createDatabaseField,
  createDatabaseRecord,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

for (const [name, values, median, maximum, minimum] of [
  ["empty", [], "NaN", "—", "—"],
  ["nonnumeric only", ["not a number"], "—", "—", "—"],
  ["single", ["-2"], "-2", "-2", "-2"],
  ["even negative", ["-2", "1"], "-0.5", "1", "-2"],
  ["odd", ["-2", "1", "10"], "1", "10", "-2"],
  ["four values", ["-2", "1", "10", "20"], "5.5", "20", "-2"],
  ["decimal midpoint", ["0.1", "0.2"], "0.15", "0.2", "0.1"],
  [
    "large finite midpoint",
    [String(Number.MAX_VALUE), String(Number.MAX_VALUE)],
    String(Number.MAX_VALUE),
    String(Number.MAX_VALUE),
    String(Number.MAX_VALUE),
  ],
] as const) {
  test(`numeric statistics: ${name}`, async ({ page }) => {
    await installFixtureGuards(page);
    const data = createDatabaseData();
    const field = createDatabaseField("数字", "number");
    data.fields.push(field);
    data.views[0].fieldOrder.push(field.id);
    while (data.records.length < values.length) data.records.push(createDatabaseRecord(data.fields));
    data.records.forEach((record, index) => {
      record.values[field.id] = values[index] ?? "";
    });
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.evaluate((value) => Reflect.set(window, "statsData", value), data);
    await page.addScriptTag({
      type: "module",
      content: `import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='stats-test';document.body.prepend(host);window.statsEditor=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'semloEditorDatabase',attrs:{data:window.statsData}},{type:'paragraph'}]}})`,
    });
    const root = page.locator("#stats-test .semlo-editor-database");
    const button = root.getByRole("button", { name: "数字统计", exact: true });
    for (const [choice, expected] of [
      ["中位数", median],
      ["最大值", maximum],
      ["最小值", minimum],
    ] as const) {
      await button.click();
      await root.getByRole("dialog", { name: "数字 统计" }).getByRole("button", { name: choice, exact: true }).click();
      await expect(button).toHaveText(`${choice} ${expected}`);
    }
    const saved = await page.evaluate(
      () => Reflect.get(window, "statsEditor").getSnapshot().json.content[0].attrs.data as DatabaseData,
    );
    expect(saved.views[0].statistics[field.id]).toBe("minimum");
    await page.evaluate(() => {
      const editor = Reflect.get(window, "statsEditor");
      editor.setContent(structuredClone(editor.getSnapshot().json));
    });
    await expect(button).toHaveText(`最小值 ${minimum}`);
  });
}
