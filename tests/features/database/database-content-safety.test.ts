import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { createDatabaseData, normalizeDatabaseData } from "../../../packages/core/src/features/database/model";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/contracts/content-safety-fixture";
import type {} from "../../fixtures/database/content-safety-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/database/content-safety-fixture.ts"));
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(origin);
  await page.waitForFunction(() => !!window.contentSafetyFixture);
});

const documentWithDatabase = (data: unknown) => ({
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "需要保留的正文" }] },
    { type: "semloEditorDatabase", attrs: { data } },
  ],
});

const invalidHTML =
  '<section data-semlo-editor-database data-database="{broken"><table><tbody><tr><td>原始记录</td></tr></tbody></table></section>';

test("损坏的数据表 HTML 初始化失败，替换时保留原文档", async ({ page }) => {
  const result = await page.evaluate((html) => {
    const fixture = window.__semloRequireFixture("contentSafetyFixture");
    return { initial: fixture.initialize(html), replacement: fixture.replace(html) };
  }, invalidHTML);
  expect(result.initial.error).toContain("数据表");
  expect(result.initial.snapshot).toBeNull();
  expect(result.initial.shellPresent).toBe(false);
  expect(result.initial.otherText).toBe("独立实例仍可编辑");
  expect(result.replacement.errors).toHaveLength(1);
  expect(result.replacement.errors[0]).toContain("数据表");
  expect(result.replacement.after).toEqual(result.replacement.before);
});

test("缺少数据表载荷或载荷结构损坏时拒绝导入", async ({ page }) => {
  const samples = [
    "<section data-semlo-editor-database><table><tbody><tr><td>原始记录</td></tr></tbody></table></section>",
    documentWithDatabase({ id: "broken", fields: "not-an-array", records: [], views: [] }),
    documentWithDatabase({ id: "broken", fields: [], records: "not-an-array", views: [] }),
  ];
  for (const content of samples) {
    const result = await page.evaluate((value) => {
      const fixture = window.__semloRequireFixture("contentSafetyFixture");
      return { initial: fixture.initialize(value), replacement: fixture.replace(value) };
    }, content);
    expect(result.initial.error).toContain("数据表");
    expect(result.initial.snapshot).toBeNull();
    expect(result.replacement.errors).toHaveLength(1);
    expect(result.replacement.after).toEqual(result.replacement.before);
  }
});

test("超过字段或记录容量的 JSON 在初始化和替换时被拒绝", async ({ page }) => {
  const tooManyFields = createDatabaseData();
  while (tooManyFields.fields.length <= 200) tooManyFields.fields.push(structuredClone(tooManyFields.fields[0]));
  const tooManyRecords = createDatabaseData();
  tooManyRecords.records = Array.from({ length: 10001 }, (_, index) => ({ id: `record-${index}`, values: {} }));
  for (const data of [tooManyFields, tooManyRecords]) {
    const content = documentWithDatabase(data);
    const result = await page.evaluate((value) => {
      const fixture = window.__semloRequireFixture("contentSafetyFixture");
      return { initial: fixture.initialize(value), replacement: fixture.replace(value) };
    }, content);
    expect(result.initial.error).toContain("数据表");
    expect(result.initial.inputUnchanged).toBe(true);
    expect(result.replacement.errors).toHaveLength(1);
    expect(result.replacement.after).toEqual(result.replacement.before);
  }
});

test("无法保留的数据表嵌套字段不会被静默丢弃", async ({ page }) => {
  const data = createDatabaseData();
  const record = data.records[0] as (typeof data.records)[number] & { customMetadata?: string };
  record.customMetadata = "需要保留的元数据";
  const result = await page.evaluate((content) => {
    const fixture = window.__semloRequireFixture("contentSafetyFixture");
    return { initial: fixture.initialize(content), replacement: fixture.replace(content) };
  }, documentWithDatabase(data));
  expect(result.initial.error).toContain("数据表");
  expect(result.replacement.errors).toHaveLength(1);
  expect(result.replacement.after).toEqual(result.replacement.before);
});

test("数据表归一化拒绝超限内容而非截断输入", () => {
  expect(() => normalizeDatabaseData(null)).toThrow(/数据表/);
  expect(() => normalizeDatabaseData({ fields: "无效", records: [], views: [] })).toThrow(/数据表/);
  const records = createDatabaseData();
  records.records = Array.from({ length: 10001 }, (_, index) => ({ id: `record-${index}`, values: {} }));
  expect(() => normalizeDatabaseData(records)).toThrow(/数据表/);
  expect(records.records).toHaveLength(10001);

  const text = createDatabaseData();
  text.records[0].values[text.fields[0].id] = "字".repeat(10001);
  expect(() => normalizeDatabaseData(text)).toThrow(/数据表/);
  expect(text.records[0].values[text.fields[0].id]).toHaveLength(10001);
});

test("选项、视图配置和顺序数组超限时均被拒绝", () => {
  const mutations: ((data: ReturnType<typeof createDatabaseData>) => void)[] = [
    (data) => (data.fields[1].options = Array.from({ length: 201 }, () => ({ ...data.fields[1].options[0] }))),
    (data) => (data.views = Array.from({ length: 101 }, () => structuredClone(data.views[0]))),
    (data) => (data.views[0].hiddenFields = Array.from({ length: 201 }, () => data.fields[0].id)),
    (data) => (data.views[0].recordOrder = Array.from({ length: 10001 }, () => data.records[0].id)),
    (data) => (data.views[0].boardOrder = Array.from({ length: 10001 }, () => data.records[0].id)),
    (data) =>
      (data.views[0].sorts = Array.from({ length: 51 }, () => ({ fieldId: data.fields[0].id, direction: "asc" }))),
  ];
  for (const mutate of mutations) {
    const data = createDatabaseData();
    mutate(data);
    const before = JSON.stringify(data);
    expect(() => normalizeDatabaseData(data)).toThrow(/数据表/);
    expect(JSON.stringify(data)).toBe(before);
  }
});

test("允许容量上限，并拒绝 HTML 内的超限文本", async ({ page }) => {
  const records = createDatabaseData();
  records.records = Array.from({ length: 10000 }, (_, index) => ({ id: `record-${index}`, values: {} }));
  expect(normalizeDatabaseData(records).records).toHaveLength(10000);

  const data = createDatabaseData();
  data.records[0].values[data.fields[0].id] = "字".repeat(10001);
  const html = `<section data-semlo-editor-database data-database='${JSON.stringify(data)}'></section>`;
  const result = await page.evaluate((content) => {
    const fixture = window.__semloRequireFixture("contentSafetyFixture");
    return { initial: fixture.initialize(content), replacement: fixture.replace(content) };
  }, html);
  expect(result.initial.error).toContain("数据表");
  expect(result.replacement.errors).toHaveLength(1);
  expect(result.replacement.after).toEqual(result.replacement.before);
});

test("单元格超限时恢复原值，随后仍可编辑和撤销", async ({ page }) => {
  const data = createDatabaseData();
  data.records[0].values[data.fields[0].id] = "原始记录";
  await page.evaluate((value) => window.__semloRequireFixture("databaseContentSafetyFixture").mount(value), data);
  const before = await page.evaluate(() => window.__semloRequireFixture("databaseContentSafetyFixture").snapshot());
  const input = page.locator("#database-content-safety").getByLabel(`第 1 行 ${data.fields[0].name}`);
  await input.fill("字".repeat(10001));
  await expect(input).toHaveValue("原始记录");
  await expect(page.locator("#database-content-safety").getByRole("alert")).toContainText("10000");
  const rejected = await page.evaluate(() => ({
    snapshot: window.__semloRequireFixture("databaseContentSafetyFixture").snapshot(),
    errors: window.__semloRequireFixture("databaseContentSafetyFixture").errors,
  }));
  expect(rejected.snapshot).toEqual(before);
  expect(rejected.errors).toHaveLength(1);
  expect(rejected.errors[0]).toContain("10000");
  await input.fill("修改后的记录");
  await input.press("Tab");
  expect(await page.evaluate(() => window.__semloRequireFixture("databaseContentSafetyFixture").undo())).toBe(true);
  await expect(input).toHaveValue("原始记录");
  expect(await page.evaluate(() => window.__semloRequireFixture("databaseContentSafetyFixture").redo())).toBe(true);
  await expect(input).toHaveValue("修改后的记录");
});

test("添加字段超限时保留编辑草稿并提示错误", async ({ page }) => {
  const data = createDatabaseData();
  while (data.fields.length < 200) {
    const field = structuredClone(data.fields[0]);
    field.id = `additional-${data.fields.length}`;
    field.name = `字段 ${data.fields.length}`;
    data.fields.push(field);
    for (const record of data.records) record.values[field.id] = "";
  }
  await page.evaluate((value) => window.__semloRequireFixture("databaseContentSafetyFixture").mount(value), data);
  const before = await page.evaluate(() => window.__semloRequireFixture("databaseContentSafetyFixture").snapshot());
  const root = page.locator("#database-content-safety");
  await root.getByRole("button", { name: "添加列" }).click();
  const dialog = root.getByRole("dialog", { name: "新增列" });
  await dialog.getByLabel("数据表列名").fill("仍需保留的草稿");
  await dialog.getByRole("button", { name: "确定" }).click();
  await expect(dialog.getByLabel("数据表列名")).toHaveValue("仍需保留的草稿");
  await expect(dialog.getByRole("status")).toContainText("200");
  await expect(root.getByRole("alert")).toContainText("200");
  const rejected = await page.evaluate(() => ({
    snapshot: window.__semloRequireFixture("databaseContentSafetyFixture").snapshot(),
    errors: window.__semloRequireFixture("databaseContentSafetyFixture").errors,
  }));
  expect(rejected.snapshot).toEqual(before);
  expect(rejected.errors).toHaveLength(1);
});

test("超长字段名不会在输入时被截断，可以修改后重试", async ({ page }) => {
  const data = createDatabaseData();
  await page.evaluate((value) => window.__semloRequireFixture("databaseContentSafetyFixture").mount(value), data);
  const before = await page.evaluate(() => window.__semloRequireFixture("databaseContentSafetyFixture").snapshot());
  const root = page.locator("#database-content-safety");
  await root.getByRole("button", { name: "添加列" }).click();
  const dialog = root.getByRole("dialog", { name: "新增列" });
  const name = dialog.getByLabel("数据表列名");
  await name.fill("字".repeat(201));
  await expect(name).toHaveValue("字".repeat(201));
  await dialog.getByRole("button", { name: "确定" }).click();
  await expect(dialog.getByRole("status")).toContainText("200");
  expect(await page.evaluate(() => window.__semloRequireFixture("databaseContentSafetyFixture").snapshot())).toEqual(
    before,
  );
  await name.fill("新字段");
  await dialog.getByRole("button", { name: "确定" }).click();
  await expect(root.getByRole("columnheader", { name: "新字段" })).toBeVisible();
});

test("超长视图名称被拒绝并恢复已保存名称", async ({ page }) => {
  const data = createDatabaseData();
  await page.evaluate((value) => window.__semloRequireFixture("databaseContentSafetyFixture").mount(value), data);
  const before = await page.evaluate(() => window.__semloRequireFixture("databaseContentSafetyFixture").snapshot());
  const root = page.locator("#database-content-safety");
  const name = root.getByLabel("视图名称");
  await name.fill("字".repeat(201));
  await expect(name).toHaveValue(data.views[0].name);
  await expect(root.getByRole("alert")).toContainText("200");
  expect(await page.evaluate(() => window.__semloRequireFixture("databaseContentSafetyFixture").snapshot())).toEqual(
    before,
  );
});

test("窄屏下超限提示可见，单元格仍可通过键盘继续编辑", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addStyleTag({ path: "packages/core/dist/style.css" });
  const data = createDatabaseData();
  data.records[0].values[data.fields[0].id] = "原始记录";
  await page.evaluate((value) => window.__semloRequireFixture("databaseContentSafetyFixture").mount(value), data);
  const root = page.locator("#database-content-safety");
  const input = root.getByLabel(`第 1 行 ${data.fields[0].name}`);
  await input.fill("字".repeat(10001));
  await expect(root.getByRole("alert")).toBeVisible();
  await expect(input).toHaveValue("原始记录");
  await input.fill("窄屏修改");
  await input.press("Tab");
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("databaseContentSafetyFixture").snapshot());
  const node = snapshot.json.content?.find((item) => item.type === "semloEditorDatabase");
  expect(node?.attrs?.data.records[0].values[data.fields[0].id]).toBe("窄屏修改");
});

test("超长人员标识不会被截断写入", async ({ page }) => {
  const data = createDatabaseData();
  data.fields.push({ id: "people", name: "人员", type: "person", options: [], defaultValue: [] });
  for (const record of data.records) record.values.people = [];
  await page.evaluate((value) => window.__semloRequireFixture("databaseContentSafetyFixture").mount(value), data);
  const before = await page.evaluate(() => window.__semloRequireFixture("databaseContentSafetyFixture").snapshot());
  const root = page.locator("#database-content-safety");
  await root.getByLabel("第 1 行 人员").click();
  await root.getByRole("dialog", { name: "人员 人员" }).getByRole("button", { name: "超长人员" }).click();
  await expect(root.getByRole("alert")).toContainText("人员标识");
  const rejected = await page.evaluate(() => ({
    snapshot: window.__semloRequireFixture("databaseContentSafetyFixture").snapshot(),
    errors: window.__semloRequireFixture("databaseContentSafetyFixture").errors,
  }));
  expect(rejected.snapshot).toEqual(before);
  expect(rejected.errors).toHaveLength(1);
});

test("附件数量超限时不会上传或替换已有附件", async ({ page }) => {
  const data = createDatabaseData();
  data.fields.push({ id: "files", name: "附件", type: "attachment", options: [], defaultValue: [] });
  data.records.forEach((record) => (record.values.files = []));
  data.records[0].values.files = Array.from({ length: 100 }, (_, index) => ({
    id: `file-${index}`,
    name: `文件${index}.txt`,
    url: `/files/${index}`,
    size: 1,
    mimeType: "text/plain",
  }));
  await page.evaluate((value) => window.__semloRequireFixture("databaseContentSafetyFixture").mount(value), data);
  const before = await page.evaluate(() => window.__semloRequireFixture("databaseContentSafetyFixture").snapshot());
  const root = page.locator("#database-content-safety");
  await root.getByLabel("第 1 行 附件").click();
  const picker = root.getByRole("dialog", { name: "附件 文件" });
  await picker
    .getByLabel("选择附件")
    .setInputFiles({ name: "新文件.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
  await expect(picker.getByRole("status")).toContainText("100");
  const rejected = await page.evaluate(() => ({
    snapshot: window.__semloRequireFixture("databaseContentSafetyFixture").snapshot(),
    errors: window.__semloRequireFixture("databaseContentSafetyFixture").errors,
    uploads: window.__semloRequireFixture("databaseContentSafetyFixture").uploads,
  }));
  expect(rejected.snapshot).toEqual(before);
  expect(rejected.errors).toHaveLength(1);
  expect(rejected.uploads).toBe(0);
  await picker.getByRole("button", { name: "删除文件 文件0.txt" }).click();
  await root.getByLabel("第 1 行 附件").click();
  await root
    .getByRole("dialog", { name: "附件 文件" })
    .getByLabel("选择附件")
    .setInputFiles({ name: "新文件.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
  await expect(root.getByLabel("第 1 行 附件")).toContainText("新文件.txt");
  const saved = await page.evaluate(() => ({
    snapshot: window.__semloRequireFixture("databaseContentSafetyFixture").snapshot(),
    uploads: window.__semloRequireFixture("databaseContentSafetyFixture").uploads,
  }));
  const database = saved.snapshot.json.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data;
  expect(database.records[0].values.files).toHaveLength(100);
  expect(saved.uploads).toBe(1);
});

test("有效数据表的 JSON 和 HTML 可以往返", async ({ page }) => {
  const data = createDatabaseData();
  data.records[0].values[data.fields[0].id] = "需要保留的记录";
  const result = await page.evaluate((content) => {
    const fixture = window.__semloRequireFixture("contentSafetyFixture");
    const initial = fixture.initialize(content);
    if (!initial.snapshot) return { initial, json: null, html: null };
    return {
      initial,
      json: fixture.initialize(initial.snapshot.json),
      html: fixture.initialize(initial.snapshot.html),
    };
  }, documentWithDatabase(data));
  expect(result.initial.error).toBeNull();
  expect(result.json?.error).toBeNull();
  expect(result.html?.error).toBeNull();
  expect(result.json?.snapshot?.json).toEqual(result.initial.snapshot?.json);
  expect(result.html?.snapshot?.json).toEqual(result.initial.snapshot?.json);
});
