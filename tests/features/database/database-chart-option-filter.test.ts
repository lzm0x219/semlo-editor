import { expect, test } from "@rstest/playwright";

import {
  createDatabaseChart,
  createDatabaseData,
  createDatabaseView,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    chartOptionFilterEditor?: EditorController;
  }
}

test("chart filter editing displays the current option label and clears identity when changed to text", async ({
  page,
}) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const field = data.fields[1];
  field.options[0].label = "新名称";
  data.records[0].values[field.id] = field.options[0].id;
  const view = createDatabaseView("图表视图", "chart");
  const chart = createDatabaseChart("column", data.fields);
  chart.filters = [
    { id: "filter", fieldId: field.id, operator: "contains", value: "旧名称", optionId: field.options[0].id },
  ];
  view.charts.push(chart);
  data.views.push(view);
  data.activeViewId = view.id;
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "chartOptionFilterContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'chart-option-filter-test'
    document.body.prepend(host)
    window.chartOptionFilterEditor = createEditor({ element: host, outline: false, content: window.chartOptionFilterContent })
  `,
  });
  const root = page.locator("#chart-option-filter-test .semlo-editor-database");
  const card = root.locator(".semlo-editor-database-chart-card").first();
  await card.getByRole("button", { name: "图表操作" }).click();
  await page.getByRole("menu", { name: "图表操作" }).getByRole("menuitem", { name: "编辑图表" }).click();
  const dialog = page.getByRole("dialog", { name: "编辑图表" });
  await expect(dialog.getByLabel("筛选值")).toHaveValue("新名称");
  await dialog.getByLabel("筛选值").fill("新的文本条件");
  await dialog.getByRole("button", { name: "确定" }).click();
  const saved = await page.evaluate(
    () =>
      window
        .__semloRequireFixture("chartOptionFilterEditor")
        .getSnapshot()
        .json.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data as DatabaseData,
  );
  const filter = saved.views.find((item) => item.id === view.id)!.charts[0].filters[0];
  expect(filter.value).toBe("新的文本条件");
  expect(filter.optionId).toBeUndefined();
});
