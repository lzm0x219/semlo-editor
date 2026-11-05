import { expect, test } from "@rstest/playwright";

import {
  createDatabaseChart,
  createDatabaseData,
  createDatabaseView,
  normalizeDatabaseData,
  visibleDatabaseRecords,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    optionFilterEditor?: EditorController;
  }
}

test("legacy text option filters keep their previous matching semantics", () => {
  const data = createDatabaseData();
  const field = data.fields[1];
  data.records[0].values[field.id] = field.options[0].id;
  data.views[0].filters = [{ id: "legacy", fieldId: field.id, operator: "contains", value: "开始" }];
  const restored = normalizeDatabaseData(JSON.parse(JSON.stringify(data)));
  expect(restored.views[0].filters[0].optionId).toBeUndefined();
  expect(visibleDatabaseRecords(restored, restored.views[0]).map((record) => record.id)).toEqual([data.records[0].id]);
});

test("identity filters compose with text filters using AND and OR", () => {
  const data = createDatabaseData();
  const [textField, optionField] = data.fields;
  optionField.options = [
    { id: "one", label: "同名", color: 0 },
    { id: "two", label: "同名", color: 1 },
  ];
  data.records.forEach((record, index) => {
    record.values[textField.id] = ["A", "B", "B"][index];
    record.values[optionField.id] = ["one", "one", "two"][index];
  });
  const view = data.views[0];
  view.filters = [
    { id: "option", fieldId: optionField.id, operator: "contains", value: "同名", optionId: "one" },
    { id: "text", fieldId: textField.id, operator: "equals", value: "B" },
  ];
  view.filterMode = "and";
  expect(visibleDatabaseRecords(data, view).map((record) => record.id)).toEqual([data.records[1].id]);
  view.filterMode = "or";
  expect(visibleDatabaseRecords(data, view).map((record) => record.id)).toEqual(
    data.records.map((record) => record.id),
  );
});

test("multi-select option filtering matches identity rather than labels", () => {
  const data = createDatabaseData();
  const field = data.fields[1];
  field.type = "multiSelect";
  field.defaultValue = [];
  field.options = [
    { id: "one", label: "同名", color: 0 },
    { id: "two", label: "同名", color: 1 },
  ];
  data.records[0].values[field.id] = ["one"];
  data.records[1].values[field.id] = ["two"];
  data.records[2].values[field.id] = ["one", "two"];
  data.views[0].filters = [{ id: "filter", fieldId: field.id, operator: "contains", value: "同名", optionId: "one" }];
  const restored = normalizeDatabaseData(JSON.parse(JSON.stringify(data)));
  expect(visibleDatabaseRecords(restored, restored.views[0]).map((record) => record.id)).toEqual([
    data.records[0].id,
    data.records[2].id,
  ]);
  restored.views[0].filters[0].operator = "notContains";
  expect(visibleDatabaseRecords(restored, restored.views[0]).map((record) => record.id)).toEqual([data.records[1].id]);
  restored.fields[1].options[0].label = "改名";
  restored.views[0].filters[0].operator = "contains";
  expect(visibleDatabaseRecords(restored, restored.views[0]).map((record) => record.id)).toEqual([
    data.records[0].id,
    data.records[2].id,
  ]);
  restored.fields[1].options = restored.fields[1].options.filter((option) => option.id !== "one");
  expect(visibleDatabaseRecords(restored, restored.views[0])).toEqual([]);
});

test("renaming and changing the option field update filters across views and charts", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const field = data.fields[1];
  const selected = field.options[0];
  const filter = {
    id: "condition",
    fieldId: field.id,
    operator: "contains" as const,
    value: selected.label,
    optionId: selected.id,
  };
  data.views[0].filters = [structuredClone(filter)];
  const other = createDatabaseView("另一视图");
  other.filters = [structuredClone(filter)];
  const chartView = createDatabaseView("图表视图", "chart");
  const chart = createDatabaseChart("column", data.fields);
  chart.filters = [structuredClone(filter)];
  chartView.charts.push(chart);
  data.views.push(other, chartView);
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "optionFilterContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'option-filter-test'
    document.body.prepend(host)
    window.optionFilterEditor = createEditor({ element: host, outline: false, content: window.optionFilterContent })
  `,
  });
  const root = page.locator("#option-filter-test .semlo-editor-database");
  const readFilters = () =>
    page.evaluate(() => {
      const data = window
        .__semloRequireFixture("optionFilterEditor")
        .getSnapshot()
        .json.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data as DatabaseData;
      return [data.views[0].filters[0], data.views[1].filters[0], data.views[2].charts[0].filters[0]];
    });
  await root.getByRole("button", { name: "单选列菜单", exact: true }).click();
  await root.getByRole("menu", { name: "单选 列菜单" }).getByRole("menuitem", { name: "编辑列" }).click();
  const dialog = root.getByRole("dialog", { name: "编辑列" });
  await dialog.getByLabel("选项名称 1").fill("改名");
  await dialog.getByRole("button", { name: "确定" }).click();
  expect((await readFilters()).map((item) => [item.optionId, item.value])).toEqual(
    Array(3).fill([selected.id, "改名"]),
  );
  await root.getByRole("button", { name: "单选列菜单", exact: true }).click();
  await root.getByRole("menu", { name: "单选 列菜单" }).getByRole("menuitem", { name: "编辑列" }).click();
  await dialog.getByLabel("列类型").selectOption("text");
  await dialog.getByRole("button", { name: "确定" }).click();
  expect((await readFilters()).map((item) => [item.optionId, item.value])).toEqual(Array(3).fill([undefined, "改名"]));
});

test("multi-select filter offers options and can invert the match", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const field = data.fields[1];
  field.type = "multiSelect";
  field.defaultValue = [];
  field.options = [
    { id: "one", label: "甲", color: 0 },
    { id: "two", label: "乙", color: 1 },
  ];
  data.records.forEach((record, index) => {
    record.values[data.fields[0].id] = ["第一", "第二", "第三"][index];
    record.values[field.id] = [["one"], ["two"], ["one", "two"]][index];
  });
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "optionFilterContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'option-filter-test'
    document.body.prepend(host)
    window.optionFilterEditor = createEditor({ element: host, outline: false, content: window.optionFilterContent })
  `,
  });
  const root = page.locator("#option-filter-test .semlo-editor-database");
  const rows = () =>
    root
      .locator('input[aria-label$=" 行 文本"]')
      .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  await root.getByRole("button", { name: "筛选", exact: true }).click();
  const panel = root.getByRole("dialog", { name: "筛选" });
  await panel.getByLabel("筛选列").selectOption(field.id);
  await expect(panel.getByLabel("筛选条件").locator("option:checked")).toHaveText("包含");
  await panel.getByLabel("筛选值").selectOption("one");
  expect(await rows()).toEqual(["第一", "第三"]);
  await panel.getByLabel("筛选条件").selectOption("notContains");
  expect(await rows()).toEqual(["第二"]);
  await panel.getByRole("button", { name: "删除筛选规则" }).click();
  expect(await rows()).toEqual(["第一", "第二", "第三"]);
});

test("stale option filter controls cannot write into a replacement document", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const field = data.fields[1];
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "optionFilterContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'option-filter-test'
    document.body.prepend(host)
    window.optionFilterEditor = createEditor({ element: host, outline: false, content: window.optionFilterContent })
  `,
  });
  const root = page.locator("#option-filter-test .semlo-editor-database");
  await root.getByRole("button", { name: "筛选", exact: true }).click();
  await root.getByRole("dialog", { name: "筛选" }).getByLabel("筛选列").selectOption(field.id);
  const result = await page.evaluate((optionId) => {
    const control = document.querySelector<HTMLSelectElement>('#option-filter-test select[aria-label="筛选值"]')!;
    const editor = window.__semloRequireFixture("optionFilterEditor");
    const replacement = editor.getSnapshot().json;
    replacement.content?.push({ type: "paragraph", content: [{ type: "text", text: "替换" }] });
    editor.setContent(replacement);
    const before = editor.getSnapshot().json;
    control.value = optionId;
    control.dispatchEvent(new Event("change", { bubbles: true }));
    return { before, after: editor.getSnapshot().json };
  }, field.options[0].id);
  expect(result.after).toEqual(result.before);
});

test("option filtering uses stable IDs across duplicate labels, rename, views and HTML", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const field = data.fields[1];
  field.options = [
    { id: "one", label: "同名", color: 0 },
    { id: "two", label: "同名", color: 1 },
  ];
  data.records.forEach((record, index) => {
    record.values[data.fields[0].id] = ["第一", "第二", "第三"][index];
    record.values[field.id] = ["one", "two", ""][index];
  });
  data.views.push(createDatabaseView("另一视图"));
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "optionFilterContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'option-filter-test'
    document.body.prepend(host)
    window.optionFilterEditor = createEditor({ element: host, outline: false, content: window.optionFilterContent })
  `,
  });
  const root = page.locator("#option-filter-test .semlo-editor-database");
  const rows = () =>
    root
      .locator('input[aria-label$=" 行 文本"]')
      .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  const read = () =>
    page.evaluate(
      () =>
        window
          .__semloRequireFixture("optionFilterEditor")
          .getSnapshot()
          .json.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data as DatabaseData,
    );
  await root.getByRole("button", { name: "筛选", exact: true }).click();
  let panel = root.getByRole("dialog", { name: "筛选" });
  await panel.getByLabel("筛选列").selectOption(field.id);
  await expect(panel.getByLabel("筛选条件").locator("option:checked")).toHaveText("是");
  await panel.getByLabel("筛选值").selectOption("one");
  expect(await rows()).toEqual(["第一"]);
  expect((await read()).views[0].filters[0].optionId).toBe("one");
  expect((await read()).records.map((record) => record.modifiedAt)).toEqual(
    data.records.map((record) => record.modifiedAt),
  );
  await panel.getByRole("button", { name: "关闭" }).click();
  expect(await page.evaluate(() => window.__semloRequireFixture("optionFilterEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await read()).views[0].filters[0].optionId).toBeUndefined();
  expect(await rows()).toEqual(["第一", "第二", "第三"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("optionFilterEditor").editor.commands.redo())).toBe(
    true,
  );
  expect((await read()).views[0].filters[0].optionId).toBe("one");
  expect(await rows()).toEqual(["第一"]);
  await root.getByRole("button", { name: "单选列菜单", exact: true }).click();
  await root.getByRole("menu", { name: "单选 列菜单" }).getByRole("menuitem", { name: "编辑列" }).click();
  const fieldDialog = root.getByRole("dialog", { name: "编辑列" });
  await fieldDialog.getByLabel("选项名称 1").fill("改名");
  await fieldDialog.getByRole("button", { name: "确定" }).click();
  expect(await rows()).toEqual(["第一"]);
  expect((await read()).views[0].filters[0].value).toBe("改名");
  expect((await read()).records.map((record) => record.modifiedAt)).toEqual(
    data.records.map((record) => record.modifiedAt),
  );
  await root.getByRole("button", { name: "筛选", exact: true }).click();
  panel = root.getByRole("dialog", { name: "筛选" });
  await expect(panel.getByLabel("筛选值").locator("option:checked")).toHaveText("改名");
  await panel.getByRole("button", { name: "关闭" }).click();
  await root.getByRole("button", { name: "单选列菜单", exact: true }).click();
  await root.getByRole("menu", { name: "单选 列菜单" }).getByRole("menuitem", { name: "编辑列" }).click();
  await fieldDialog.getByRole("button", { name: "删除选项 1" }).click();
  await fieldDialog.getByRole("button", { name: "确定" }).click();
  await expect(fieldDialog.getByRole("status")).toContainText("1 条记录");
  await fieldDialog.getByRole("button", { name: "确定" }).click();
  expect(await rows()).toEqual([]);
  await root.getByRole("button", { name: "筛选", exact: true }).click();
  panel = root.getByRole("dialog", { name: "筛选" });
  await expect(panel.getByLabel("筛选值").locator("option:checked")).toHaveText("已删除的选项");
  await panel.getByRole("button", { name: "关闭" }).click();
  expect(await page.evaluate(() => window.__semloRequireFixture("optionFilterEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await rows()).toEqual(["第一"]);
  await root.getByRole("button", { name: "筛选", exact: true }).click();
  panel = root.getByRole("dialog", { name: "筛选" });
  await panel.getByLabel("筛选条件").selectOption("notContains");
  expect(await rows()).toEqual(["第二", "第三"]);
  await panel.getByRole("button", { name: "关闭" }).click();
  const html = await page.evaluate(() => window.__semloRequireFixture("optionFilterEditor").getSnapshot().html);
  await page.evaluate((value) => window.__semloRequireFixture("optionFilterEditor").setContent(value), html);
  expect((await read()).views[0].filters[0].optionId).toBe("one");
  expect(await rows()).toEqual(["第二", "第三"]);
  await root.getByRole("button", { name: "切换视图" }).click();
  await root.getByRole("dialog", { name: "切换视图" }).getByRole("button", { name: "切换到另一视图" }).click();
  expect(await rows()).toEqual(["第一", "第二", "第三"]);
  await root.getByRole("button", { name: "切换视图" }).click();
  await root.getByRole("dialog", { name: "切换视图" }).getByRole("button", { name: "切换到表格视图" }).click();
  await root.getByRole("button", { name: "单选列菜单", exact: true }).click();
  await root.getByRole("menu", { name: "单选 列菜单" }).getByRole("menuitem", { name: "编辑列" }).click();
  await fieldDialog.getByLabel("列类型").selectOption("text");
  await fieldDialog.getByRole("button", { name: "确定" }).click();
  const converted = (await read()).views[0].filters[0];
  expect(converted.optionId).toBeUndefined();
  expect(converted.value).toBe("改名");
  expect(await rows()).toEqual(["第二", "第三"]);
});
