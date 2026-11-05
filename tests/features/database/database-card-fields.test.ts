import { expect, test, type Locator, type Page } from "@rstest/playwright";

import {
  createDatabaseData,
  createDatabaseField,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import type { EditorContent, EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    databaseCardEditors?: EditorController[];
  }
}

function content(data: DatabaseData): EditorContent {
  return { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
}

async function mount(page: Page, data: DatabaseData, count = 1) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      window.databaseCardEditors = []
      for (let index = 0; index < ${count}; index++) {
        const host = document.createElement('div')
        host.id = 'card-fields-' + index
        document.body.prepend(host)
        window.databaseCardEditors.push(createEditor({
          element: host, outline: false, content: ${JSON.stringify(content(data))},
        }))
      }
    `,
  });
  await page.waitForFunction((expected) => window.databaseCardEditors?.length === expected, count);
  return page.locator("#card-fields-0 .semlo-editor-database");
}

async function snapshot(page: Page, index = 0): Promise<DatabaseData> {
  return page.evaluate((selected) => {
    const node = window
      .__semloRequireFixture("databaseCardEditors")
      [selected].getSnapshot()
      .json.content?.find((entry) => entry.type === "semloEditorDatabase");
    if (!node?.attrs?.data) throw new Error("Missing database content");
    return node.attrs.data as DatabaseData;
  }, index);
}

async function createView(database: Locator, kind: "画册" | "看板") {
  await database.getByRole("button", { name: "新建视图" }).click();
  await database.getByRole("dialog", { name: "新建视图" }).getByRole("button", { name: kind, exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("card views initialize field visibility and render changes and field labels", async ({ page }) => {
  const data = createDatabaseData();
  const [title, status, date] = data.fields;
  const detail = createDatabaseField("详情");
  data.fields.push(detail);
  const record = data.records[0];
  record.values[title.id] = "标题甲";
  record.values[detail.id] = "隐含字段";
  const database = await mount(page, data, 2);
  const other = page.locator("#card-fields-1 .semlo-editor-database");

  await createView(database, "画册");
  let saved = await snapshot(page);
  expect(saved.views.find((view) => view.kind === "gallery")?.hiddenFields).toEqual([detail.id]);
  const card = database.locator(`.semlo-editor-database-card[data-record-id="${record.id}"]`);
  await expect(card.locator("strong")).toHaveText("标题甲");
  await expect(card.locator(`[data-field-id="${detail.id}"]`)).toHaveCount(0);
  await expect(other.getByLabel("第 1 行 文本")).toHaveValue("标题甲");

  await database.getByRole("button", { name: "字段配置" }).click();
  const fields = database.getByRole("dialog", { name: "字段配置" });
  await expect(fields.getByLabel("显示详情")).not.toBeChecked();
  await fields.getByLabel("显示详情").check();
  await expect(card.locator(`[data-field-id="${detail.id}"]`)).toContainText("隐含字段");
  await fields.getByLabel("显示文本").uncheck();
  await expect(card.locator("strong")).toHaveText("未命名记录");
  await fields.getByLabel("显示字段名").check();
  await expect(card.locator(".semlo-editor-database-card-title .semlo-editor-database-card-field-name")).toHaveText(
    "单选",
  );
  await expect(card.locator(`[data-field-id="${date.id}"] .semlo-editor-database-card-field-name`)).toHaveText("日期");
  await expect(card.locator(`[data-field-id="${detail.id}"] .semlo-editor-database-card-field-name`)).toHaveText(
    "详情",
  );
  await fields.getByLabel("显示单选").uncheck();
  await fields.getByLabel("显示日期").uncheck();
  await expect(card.locator("strong")).toHaveText("隐含字段");
  await expect(card.locator(".semlo-editor-database-card-title")).toHaveAttribute("data-field-id", detail.id);
  await fields.getByLabel("显示详情").uncheck();
  await expect(card.locator("strong")).toHaveText("未命名记录");
  await expect(card.locator(".semlo-editor-database-card-title")).not.toHaveAttribute("data-field-id", /.+/);
  await fields.getByRole("button", { name: "关闭" }).click();

  expect(await page.evaluate(() => window.__semloRequireFixture("databaseCardEditors")[0].editor.commands.undo())).toBe(
    true,
  );
  await expect(card.locator("strong")).toHaveText("隐含字段");
  saved = await snapshot(page);
  expect(saved.views.find((view) => view.kind === "gallery")?.showFieldNames).toBe(true);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("databaseCardEditors")[0];
    editor.setContent(editor.getSnapshot().html);
    editor.setEditable(false);
  });
  await expect(card.locator("strong")).toHaveText("隐含字段");
  expect((await snapshot(page)).views.find((view) => view.kind === "gallery")).toMatchObject({
    hiddenFields: [title.id, status.id, date.id],
    showFieldNames: true,
  });
  await expect(other.getByLabel("第 1 行 文本")).toHaveValue("标题甲");
});

test("board defaults to three visible fields and visible supported values render independently", async ({ page }) => {
  const data = createDatabaseData();
  const [title, status, date] = data.fields;
  const extra = [
    createDatabaseField("说明"),
    createDatabaseField("数量", "number"),
    createDatabaseField("完成", "checkbox"),
    createDatabaseField("链接", "link"),
    createDatabaseField("邮箱", "email"),
    createDatabaseField("电话", "phone"),
    createDatabaseField("评分", "rating"),
    createDatabaseField("进度", "progress"),
  ];
  data.fields.push(...extra);
  const [detail, number, checked, link, email, phone, rating, progress] = extra;
  const record = data.records[0];
  Object.assign(record.values, {
    [title.id]: "可见标题",
    [status.id]: status.options[1].id,
    [date.id]: "2026-11-03",
    [detail.id]: "可见说明",
    [number.id]: "42",
    [checked.id]: true,
    [link.id]: "https://example.com/",
    [email.id]: "user@example.com",
    [phone.id]: "13800000000",
    [rating.id]: "4",
    [progress.id]: "75",
  });
  const database = await mount(page, data);
  await createView(database, "看板");
  expect((await snapshot(page)).views.find((view) => view.kind === "kanban")?.hiddenFields).toEqual(
    extra.map((field) => field.id),
  );
  const card = database.locator(`.semlo-editor-database-card[data-record-id="${record.id}"]`);
  await expect(card).toContainText("可见标题");
  await expect(card).toContainText("进行中");
  await expect(card).toContainText("2026-11-03");
  await expect(card).not.toContainText("可见说明");

  await database.getByRole("button", { name: "字段配置" }).click();
  const fields = database.getByRole("dialog", { name: "字段配置" });
  for (const field of extra) await fields.getByLabel(`显示${field.name}`).check();
  for (const [field, value] of [
    [detail, "可见说明"],
    [number, "42"],
    [link, "https://example.com/"],
    [email, "user@example.com"],
    [phone, "13800000000"],
    [rating, "4"],
    [progress, "75"],
  ] as const) {
    await expect(card.locator(`[data-field-id="${field.id}"]`)).toContainText(value);
  }
  await expect(card.locator(`[data-field-id="${checked.id}"]`).getByLabel("已勾选")).toBeVisible();
  await expect(card.locator(`[data-field-id="${status.id}"]`)).toContainText("进行中");
});
