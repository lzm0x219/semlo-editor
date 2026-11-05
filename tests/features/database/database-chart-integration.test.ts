import { expect, test, type Locator, type Page } from "@rstest/playwright";

import {
  createDatabaseChart,
  createDatabaseData,
  createDatabaseField,
  createDatabaseView,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import type { EditorContent, EditorController, EditorSnapshot } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    chartIntegrationEditors?: EditorController[];
  }
}

function fixture() {
  const data = createDatabaseData();
  const [name, status] = data.fields;
  name.name = "事项";
  status.name = "状态";
  const amount = createDatabaseField("数量", "number");
  data.fields.push(amount);
  for (const [index, record] of data.records.entries()) {
    record.values[name.id] = ["甲", "乙", "丙"][index];
    record.values[status.id] = status.options[index === 2 ? 1 : 0].id;
    record.values[amount.id] = ["2", "3", "4"][index];
  }
  const chartView = createDatabaseView("图表视图", "chart");
  const column = createDatabaseChart("column", data.fields);
  column.title = "数量汇总";
  column.fieldId = status.id;
  column.metricFieldId = amount.id;
  column.statistic = "sum";
  column.groupFieldId = amount.id;
  column.filters = [{ id: "positive", fieldId: amount.id, operator: "greater", value: "0" }];
  column.layout = { x: 0, y: 0, w: 7, h: 5 };
  const pie = createDatabaseChart("pie", data.fields);
  pie.title = "状态分布";
  pie.fieldId = status.id;
  pie.layout = { x: 8, y: 0, w: 4, h: 4 };
  chartView.charts.push(column, pie);
  data.views.push(chartView);
  data.activeViewId = chartView.id;
  const content: EditorContent = {
    type: "doc",
    content: [{ type: "paragraph" }, { type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }],
  };
  return { content, data, nameId: name.id, statusId: status.id, amountId: amount.id };
}

async function mount(page: Page, numberOfEditors = 1) {
  const initial = fixture();
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      window.chartIntegrationEditors = []
      for (let index = 0; index < ${numberOfEditors}; index++) {
        const host = document.createElement('div')
        host.id = 'chart-integration-' + index
        document.body.prepend(host)
        window.chartIntegrationEditors.push(createEditor({
          element: host,
          outline: false,
          content: ${JSON.stringify(initial.content)},
        }))
      }
    `,
  });
  await page.waitForFunction((number) => window.chartIntegrationEditors?.length === number, numberOfEditors);
  const root = page.locator("#chart-integration-0 .semlo-editor-database");
  await expect(root.locator(".semlo-editor-database-chart-card")).toHaveCount(2);
  return { ...initial, root, other: page.locator("#chart-integration-1 .semlo-editor-database") };
}

async function snapshot(page: Page, index = 0): Promise<EditorSnapshot> {
  return page.evaluate(
    (selected) => window.__semloRequireFixture("chartIntegrationEditors")[selected].getSnapshot(),
    index,
  );
}

function database(content: EditorContent): DatabaseData {
  if (typeof content === "string") throw new Error("Expected structured content");
  const node = content.content?.find((entry) => entry.type === "semloEditorDatabase");
  if (!node?.attrs?.data) throw new Error("Missing chart database");
  return node.attrs.data as DatabaseData;
}

function chart(root: Locator, title: string) {
  return root.locator(".semlo-editor-database-chart-card").filter({ hasText: title });
}

async function switchView(root: Locator, name: string) {
  await root.getByRole("button", { name: "切换视图" }).click();
  await root
    .getByRole("dialog", { name: "切换视图" })
    .getByRole("button", { name: `切换到${name}` })
    .click();
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("chart views round-trip through JSON and HTML and update from shared records", async ({ page }) => {
  const { root } = await mount(page);
  const expected = database((await snapshot(page)).json);
  await expect(chart(root, "数量汇总").getByRole("img")).toHaveAttribute("aria-label", /待开始：5.*进行中：4/);
  await expect(chart(root, "状态分布").getByRole("img")).toHaveAttribute("aria-label", /待开始：2.*进行中：1/);

  const saved = await snapshot(page);
  for (const content of [saved.html, saved.json]) {
    await page.evaluate((next) => {
      const editor = window.__semloRequireFixture("chartIntegrationEditors")[0];
      editor.setContent({
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "中间文档" }] }],
      });
      editor.setContent(next);
    }, content);
    expect(database((await snapshot(page)).json)).toEqual(expected);
    await expect(chart(root, "数量汇总")).toHaveAttribute("data-grid-w", "7");
    await expect(chart(root, "数量汇总")).toHaveAttribute("data-grid-h", "5");
    await expect(chart(root, "状态分布")).toHaveAttribute("data-grid-x", "8");
    await expect(chart(root, "数量汇总").getByRole("img")).toHaveAttribute("aria-label", /待开始：5.*进行中：4/);
  }

  await switchView(root, "表格视图");
  await root.getByLabel("第 1 行 状态").click();
  await root.getByRole("dialog", { name: "状态 选项" }).getByRole("button", { name: "进行中" }).click();
  await switchView(root, "图表视图");
  await expect(chart(root, "数量汇总").getByRole("img")).toHaveAttribute("aria-label", /待开始：3.*进行中：6/);
  await expect(chart(root, "状态分布").getByRole("img")).toHaveAttribute("aria-label", /待开始：1.*进行中：2/);
});

test("deleting a chart field updates JSON and HTML references and undo restores them", async ({ page }) => {
  const { root, amountId } = await mount(page);
  await switchView(root, "表格视图");
  const original = database((await snapshot(page)).json);
  await root.getByRole("button", { name: "数量列菜单" }).click();
  await root.getByRole("menu", { name: "数量 列菜单" }).getByRole("menuitem", { name: "删除列" }).click();
  const removed = database((await snapshot(page)).json);
  const settings = removed.views.find((entry) => entry.kind === "chart")!.charts[0];
  expect(removed.fields.some((entry) => entry.id === amountId)).toBe(false);
  expect(settings.metricFieldId).toBe("");
  expect(settings.groupFieldId).toBe("");
  expect(settings.filters).toEqual([]);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("chartIntegrationEditors")[0].editor.commands.undo()),
  ).toBe(true);
  expect(database((await snapshot(page)).json)).toEqual(original);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("chartIntegrationEditors")[0].editor.commands.redo()),
  ).toBe(true);
  expect(database((await snapshot(page)).json)).toEqual(removed);

  const html = (await snapshot(page)).html;
  await page.evaluate((content) => {
    const editor = window.__semloRequireFixture("chartIntegrationEditors")[0];
    editor.setContent({ type: "doc", content: [{ type: "paragraph" }] });
    editor.setContent(content);
  }, html);
  expect(database((await snapshot(page)).json)).toEqual(removed);
});

test("read-only view navigation remains local and does not mutate the document", async ({ page }) => {
  const { root, other } = await mount(page, 2);
  const before = (await snapshot(page)).json;
  const otherBefore = (await snapshot(page, 1)).json;
  await page.evaluate(() => window.__semloRequireFixture("chartIntegrationEditors")[0].setEditable(false));
  await expect(root.getByRole("button", { name: "添加组件" })).toBeDisabled();
  await switchView(root, "表格视图");
  await expect(root.getByLabel("第 1 行 事项")).toHaveAttribute("readonly", "");
  await switchView(root, "图表视图");
  await expect(root.locator(".semlo-editor-database-chart-card")).toHaveCount(2);
  expect((await snapshot(page)).json).toEqual(before);
  expect((await snapshot(page, 1)).json).toEqual(otherBefore);
  await expect(other.locator(".semlo-editor-database-chart-card")).toHaveCount(2);
});

test("a chart draft cannot write to an actually replaced document with identical IDs", async ({ page }) => {
  const { root, other, nameId } = await mount(page, 2);
  const otherBefore = (await snapshot(page, 1)).json;
  await chart(root, "数量汇总").getByRole("button", { name: "图表操作" }).click();
  await page.getByRole("menu", { name: "图表操作" }).getByRole("menuitem", { name: "编辑图表" }).click();
  const dialog = page.getByRole("dialog", { name: "编辑图表" });
  await dialog.getByLabel("图表名称").fill("不应保存的草稿");
  const confirm = await dialog.getByRole("button", { name: "确定" }).elementHandle();
  if (!confirm) throw new Error("Missing stale confirmation");
  await page.evaluate((fieldId) => {
    const editor = window.__semloRequireFixture("chartIntegrationEditors")[0];
    const replacement = structuredClone(editor.getSnapshot().json);
    const node = replacement.content?.find((entry) => entry.type === "semloEditorDatabase");
    if (!node?.attrs?.data) throw new Error("Missing replacement database");
    (node.attrs.data as DatabaseData).records[0].values[fieldId] = "替换后的事项";
    editor.setContent(replacement);
  }, nameId);
  await expect(dialog).toHaveCount(0);
  await confirm.evaluate((element) => (element as HTMLButtonElement).click());
  const replacement = database((await snapshot(page)).json);
  expect(replacement.records[0].values[nameId]).toBe("替换后的事项");
  expect(replacement.views.find((entry) => entry.kind === "chart")!.charts[0].title).toBe("数量汇总");
  expect((await snapshot(page, 1)).json).toEqual(otherBefore);
  await expect(other.locator(".semlo-editor-database-chart-card")).toHaveCount(2);
});
