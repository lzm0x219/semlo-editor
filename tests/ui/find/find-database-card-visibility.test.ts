import { expect, test, type Locator } from "@rstest/playwright";
import { Schema } from "@tiptap/pm/model";

import { findDatabaseMatches } from "../../../packages/core/src/features/database/find-database-matches";
import { createDatabaseData, createDatabaseField } from "../../../packages/core/src/features/database/model";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    semloEditorDatabase: { group: "block", atom: true, attrs: { data: { default: null } } },
    text: { group: "inline" },
  },
});

test("card views search each visible field and exclude hidden fields", () => {
  const data = createDatabaseData();
  const [title, status, date] = data.fields;
  const details = createDatabaseField("详情");
  const tags = createDatabaseField("标签", "multiSelect");
  tags.options = [{ id: "writing", label: "写作", color: 0 }];
  data.fields.push(details, tags);
  data.records[0].values[title.id] = "可见标题";
  data.records[0].values[status.id] = status.options[0].id;
  data.records[0].values[date.id] = "2026-05-14";
  data.records[0].values[details.id] = "可配置的详情";
  data.records[0].values[tags.id] = ["writing"];
  const doc = () => schema.node("doc", null, [schema.node("semloEditorDatabase", { data })]);

  for (const kind of ["gallery", "kanban"] as const) {
    data.views[0].kind = kind;
    data.views[0].groupFieldId = status.id;
    data.views[0].hiddenFields = [details.id, date.id];
    expect(findDatabaseMatches(doc(), "可见标题")).toHaveLength(1);
    expect(findDatabaseMatches(doc(), "待开始")).toHaveLength(1);
    expect(findDatabaseMatches(doc(), "写作")).toHaveLength(1);
    expect(findDatabaseMatches(doc(), "可配置的详情")).toHaveLength(0);
    expect(findDatabaseMatches(doc(), "2026-05-14")).toHaveLength(0);
    data.views[0].hiddenFields = [tags.id, title.id];
    expect(findDatabaseMatches(doc(), "写作")).toHaveLength(0);
    expect(findDatabaseMatches(doc(), "可见标题")).toHaveLength(0);
    expect(findDatabaseMatches(doc(), "可配置的详情")).toHaveLength(1);
    expect(findDatabaseMatches(doc(), "2026-05-14")).toHaveLength(1);
    data.views[0].hiddenFields = data.fields.map((field) => field.id);
    expect(findDatabaseMatches(doc(), "未命名记录")).toHaveLength(0);
    data.views[0].hiddenFields = [];
  }

  data.views[0].kind = "table";
  expect(findDatabaseMatches(doc(), "可配置的详情")).toHaveLength(1);
  expect(findDatabaseMatches(doc(), "2026-05-14")).toHaveLength(1);
});

test("card search follows visible field order after reordering and type changes", () => {
  const data = createDatabaseData();
  const [title, status, date] = data.fields;
  status.options[0].label = "同步状态";
  data.fields = [status, title, date];
  data.records[0].values[title.id] = "同步标题";
  data.records[0].values[status.id] = status.options[0].id;
  data.views[0].kind = "gallery";
  const doc = () => schema.node("doc", null, [schema.node("semloEditorDatabase", { data })]);
  expect(findDatabaseMatches(doc(), "同步").map((match) => match.fieldId)).toEqual([status.id, title.id]);

  data.fields = [title, status, date];
  title.type = "number";
  data.records[0].values[title.id] = "12345";
  expect(findDatabaseMatches(doc(), "12345")).toHaveLength(1);
  title.type = "checkbox";
  data.records[0].values[title.id] = true;
  expect(findDatabaseMatches(doc(), "已勾选")).toHaveLength(1);
});

async function switchView(database: Locator, name: string) {
  await database.getByRole("button", { name: "切换视图" }).click();
  await database
    .getByRole("dialog", { name: "切换视图" })
    .getByRole("button", { name: `切换到${name}` })
    .click();
}

test("preview find follows visible card fields across editable and read-only views", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.getByRole("combobox", { name: "选择示例" }).selectOption("database");
  const host = page.locator("#editor-host");
  const database = host.locator(".semlo-editor-database");
  const firstDate = await database.getByLabel("第 1 行 日期").inputValue();
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  const search = panel.getByRole("textbox", { name: "查找内容" });
  const counter = panel.locator(".semlo-editor-find-counter");

  await search.fill("hello@example.com");
  await expect(counter).toHaveText("1/3");
  await switchView(database, "画册视图");
  await database.getByRole("button", { name: "字段配置" }).click();
  let fields = database.getByRole("dialog", { name: "字段配置" });
  await fields.getByLabel("显示联系邮箱").uncheck();
  await expect(counter).toHaveText("0");
  await expect(database.locator(".semlo-editor-database-card.semlo-editor-find-match")).toHaveCount(0);
  await fields.getByLabel("显示联系邮箱").check();
  await expect(counter).toHaveText("1/3");
  await expect(database.getByRole("button", { name: "记录：收集灵感" })).toContainText("hello@example.com");

  await search.fill("收集灵感");
  await expect(counter).toHaveText("1/1");
  await expect(database.getByRole("button", { name: "记录：收集灵感" })).toHaveClass(/semlo-editor-find-match-current/);
  await fields.getByLabel("显示事项").uncheck();
  await expect(counter).toHaveText("0");
  await expect(database.getByRole("button", { name: "记录：待开始" })).toBeVisible();
  await fields.getByLabel("显示事项").check();
  await expect(counter).toHaveText("1/1");

  await fields.getByLabel("显示日期").check();
  await search.fill(firstDate);
  await expect(counter).toHaveText("1/1");
  await expect(database.getByRole("button", { name: "记录：收集灵感" })).toContainText(firstDate);
  await fields.getByLabel("显示标签").check();
  await search.fill("写作");
  await expect(counter).toHaveText("1/1");
  await expect(database.getByRole("button", { name: "记录：整理内容" })).toHaveClass(/semlo-editor-find-match-current/);
  await fields.getByLabel("显示标签").uncheck();
  await expect(counter).toHaveText("0");
  await fields.getByRole("button", { name: "关闭" }).click();

  await switchView(database, "看板视图");
  await database.getByRole("button", { name: "字段配置" }).click();
  fields = database.getByRole("dialog", { name: "字段配置" });
  await fields.getByLabel("显示联系邮箱").uncheck();
  await fields.getByRole("button", { name: "关闭" }).click();
  await switchView(database, "表格视图");
  await expect(counter).toHaveText("1/1");

  await search.fill("hello@example.com");
  await expect(counter).toHaveText("1/3");
  await page.getByRole("button", { name: "只读预览" }).click();
  await switchView(database, "画册视图");
  await expect(counter).toHaveText("1/3");
  await switchView(database, "看板视图");
  await expect(counter).toHaveText("0");
  await search.fill("收集灵感");
  await expect(counter).toHaveText("1/1");
  await expect(database.getByRole("button", { name: "记录：收集灵感" })).toHaveClass(/semlo-editor-find-match-current/);
  await switchView(database, "表格视图");
  await search.fill("hello@example.com");
  await expect(counter).toHaveText("1/3");
  expect(errors).toEqual([]);
});

test("a second text field becomes searchable when shown and stays searchable as the card title", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.getByRole("combobox", { name: "选择示例" }).selectOption("database");
  const host = page.locator("#editor-host");
  const database = host.locator(".semlo-editor-database");
  await database.getByRole("button", { name: "添加列" }).click();
  const column = database.getByRole("dialog", { name: "新增列" });
  await column.getByLabel("数据表列名").fill("详情");
  await column.getByRole("button", { name: "确定" }).click();
  await database.getByLabel("第 1 行 详情").fill("第二条文本的独特内容");
  await database.getByLabel("第 1 行 详情").press("Tab");
  await switchView(database, "画册视图");
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  const search = panel.getByRole("textbox", { name: "查找内容" });
  const counter = panel.locator(".semlo-editor-find-counter");
  await search.fill("第二条文本的独特内容");

  await database.getByRole("button", { name: "字段配置" }).click();
  const fields = database.getByRole("dialog", { name: "字段配置" });
  await fields.getByLabel("显示详情").uncheck();
  await expect(counter).toHaveText("0");
  await fields.getByLabel("显示详情").check();
  await expect(counter).toHaveText("1/1");
  await expect(database.getByRole("button", { name: "记录：收集灵感" })).toContainText("第二条文本的独特内容");

  for (const field of [
    "事项",
    "状态",
    "日期",
    "标签",
    "工作量（小时）",
    "已归档",
    "参考链接",
    "联系邮箱",
    "联系电话",
    "评分",
    "进度",
    "结束日期",
  ]) {
    await fields.getByLabel(`显示${field}`).uncheck();
  }
  await expect(counter).toHaveText("1/1");
  await expect(database.getByRole("button", { name: "记录：第二条文本的独特内容" })).toHaveClass(
    /semlo-editor-find-match-current/,
  );
  await fields.getByLabel("显示详情").uncheck();
  await expect(counter).toHaveText("0");
  await fields.getByRole("button", { name: "关闭" }).click();
  await search.fill("未命名记录");
  await expect(counter).toHaveText("0");
  await switchView(database, "表格视图");
  await search.fill("第二条文本的独特内容");
  await expect(counter).toHaveText("1/1");
  await expect(database.getByLabel("第 1 行 详情")).toHaveValue("第二条文本的独特内容");
  expect(errors).toEqual([]);
});
