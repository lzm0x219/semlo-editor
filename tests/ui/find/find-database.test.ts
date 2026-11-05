import { expect, test, type Locator, type Page } from "@rstest/playwright";
import { Schema } from "@tiptap/pm/model";

import {
  findDatabaseMatches,
  findStringRanges,
} from "../../../packages/core/src/features/database/find-database-matches";
import { createDatabaseData } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    databaseFindEditors?: EditorController[];
  }
}

function sampleData() {
  const data = createDatabaseData();
  const field = data.fields[0];
  data.records[0].values[field.id] = "甲记录甲记录";
  data.records[1].values[field.id] = "另一件";
  return data;
}

function sampleDocument(data = sampleData()) {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "前文甲记录" }] },
      { type: "semloEditorDatabase", attrs: { data } },
      { type: "paragraph", content: [{ type: "text", text: "正文甲记录" }] },
    ],
  };
}

async function mount(page: Page, count = 1, content = sampleDocument(), toolbar = true) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      window.databaseFindEditors = []
      for (let index = 0; index < ${count}; index++) {
        const host = document.createElement('div')
        host.id = 'database-find-' + index
        document.body.prepend(host)
        window.databaseFindEditors.push(createEditor({
          element: host,
          outline: false,
          toolbar: ${toolbar},
          content: ${JSON.stringify(content)},
        }))
      }
    `,
  });
  await page.waitForFunction((number) => window.databaseFindEditors?.length === number, count);
  return page.locator("#database-find-0");
}

async function expectFindPanelPlacement(page: Page, host: Locator, panel: Locator) {
  await expect
    .poll(async () => {
      const [shell, find, viewSwitch] = await Promise.all([
        host.locator(".semlo-editor").boundingBox(),
        panel.boundingBox(),
        host.getByRole("button", { name: "切换视图" }).boundingBox(),
      ]);
      const viewport = page.viewportSize();
      if (!shell || !find || !viewSwitch || !viewport) return false;
      const epsilon = 0.5;
      const withinEditor =
        find.width > 0 &&
        find.height > 0 &&
        find.x >= Math.max(shell.x, 0) - epsilon &&
        find.y >= Math.max(shell.y, 0) - epsilon &&
        find.x + find.width <= Math.min(shell.x + shell.width, viewport.width) + epsilon &&
        find.y + find.height <= Math.min(shell.y + shell.height, viewport.height) + epsilon;
      const overlapsSwitch =
        find.x < viewSwitch.x + viewSwitch.width &&
        find.x + find.width > viewSwitch.x &&
        find.y < viewSwitch.y + viewSwitch.height &&
        find.y + find.height > viewSwitch.y;
      return withinEditor && !overlapsSwitch;
    })
    .toBe(true);
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("database matches use atom positions and never cross cells", () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { content: "text*", group: "block" },
      semloEditorDatabase: { group: "block", atom: true, attrs: { data: { default: null } } },
      text: { group: "inline" },
    },
  });
  const data = sampleData();
  const table = schema.node("semloEditorDatabase", { data });
  const doc = schema.node("doc", null, [table, table]);
  const matches = findDatabaseMatches(doc, "甲记录");
  expect(matches).toHaveLength(4);
  expect(matches.map((match) => [match.from, match.start, match.end])).toEqual([
    [0, 0, 3],
    [0, 3, 6],
    [1, 0, 3],
    [1, 3, 6],
  ]);
  expect(findDatabaseMatches(doc, "记录另一")).toEqual([]);
  expect(findStringRanges("İX", "i\u0307x")).toEqual([{ start: 0, end: 2 }]);
});

test("find uses displayed option labels and filters out records hidden by the active view", () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      semloEditorDatabase: { group: "block", atom: true, attrs: { data: { default: null } } },
      text: { group: "inline" },
    },
  });
  const data = sampleData();
  data.records[0].values[data.fields[1].id] = data.fields[1].options[0].id;
  const node = () => schema.node("doc", null, [schema.node("semloEditorDatabase", { data })]);
  expect(findDatabaseMatches(node(), "待开始")).toHaveLength(1);
  expect(findDatabaseMatches(node(), "单选")).toHaveLength(0);
  data.views[0].filters = [{ id: "filter", fieldId: data.fields[0].id, operator: "startsWith", value: "另一" }];
  expect(findDatabaseMatches(node(), "甲记录")).toHaveLength(0);
  expect(findDatabaseMatches(node(), "另一件")).toHaveLength(1);
  data.views[0].filters = [];
  data.views[0].hiddenFields = [data.fields[0].id];
  expect(findDatabaseMatches(node(), "甲记录")).toHaveLength(0);
  expect(findDatabaseMatches(node(), "待开始")).toHaveLength(1);
});

test("data table matches follow the rendered board group order", () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      semloEditorDatabase: { group: "block", atom: true, attrs: { data: { default: null } } },
      text: { group: "inline" },
    },
  });
  const data = sampleData();
  const [text, status] = data.fields;
  for (const record of data.records) record.values[text.id] = "共同";
  data.records[0].values[status.id] = status.options[2].id;
  data.records[1].values[status.id] = status.options[0].id;
  data.views[0].kind = "kanban";
  data.views[0].groupFieldId = status.id;
  const doc = schema.node("doc", null, [schema.node("semloEditorDatabase", { data })]);
  expect(findDatabaseMatches(doc, "共同").map((match) => match.recordId)).toEqual([
    data.records[2].id,
    data.records[1].id,
    data.records[0].id,
  ]);
});

test("the preview finds its data table and cannot replace a table match", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.getByRole("combobox", { name: "选择示例" }).selectOption("database");
  const host = page.locator("#editor-host");
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("收集灵感");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/1");
  await expect(host.locator(".semlo-editor-database-cell.semlo-editor-find-match-current")).toHaveCount(1);
  await panel.getByRole("tab", { name: "替换" }).click();
  await expect(panel.getByRole("button", { name: "替换", exact: true })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "全部替换" })).toBeDisabled();
  await panel.getByRole("button", { name: "关闭查找替换" }).click();
  await expect(host.locator(".semlo-editor-database-cell.semlo-editor-find-match")).toHaveCount(0);
});

test("find navigates across table cells and prose while replacements skip the table", async ({ page }) => {
  const host = await mount(page);
  const before = await page.evaluate(() => window.__semloRequireFixture("databaseFindEditors")[0].getSnapshot());
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  const search = panel.getByRole("textbox", { name: "查找内容" });
  await search.fill("甲记录");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/4");
  await expect(host.locator(".semlo-editor-database-cell.semlo-editor-find-match")).toHaveCount(1);
  await panel.getByRole("button", { name: "下一个" }).click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("2/4");
  await expect(host.locator(".semlo-editor-database-cell.semlo-editor-find-match-current")).toHaveCount(1);
  await panel.getByRole("tab", { name: "替换" }).click();
  await panel.getByRole("textbox", { name: "替换为" }).fill("新内容");
  await expect(panel.getByRole("button", { name: "替换", exact: true })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "全部替换" })).toBeEnabled();
  await panel.getByRole("button", { name: "全部替换" }).click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/2");
  const after = await page.evaluate(() => window.__semloRequireFixture("databaseFindEditors")[0].getSnapshot());
  expect(after.json.content?.[1]).toEqual(before.json.content?.[1]);
  expect(after.text).toContain("甲记录甲记录");
  expect(after.text).toContain("前文新内容");
  expect(after.text).toContain("正文新内容");
  await expect(panel.getByRole("button", { name: "全部替换" })).toBeDisabled();
  expect(await page.evaluate(() => window.__semloRequireFixture("databaseFindEditors")[0].editor.commands.undo())).toBe(
    true,
  );
  expect(
    (await page.evaluate(() => window.__semloRequireFixture("databaseFindEditors")[0].getSnapshot())).json,
  ).toEqual(before.json);
  await panel.getByRole("button", { name: "关闭查找替换" }).click();
  await expect(host.locator(".semlo-editor-find-match")).toHaveCount(0);
});

test("search highlights copied tables independently and stays within its editor", async ({ page }) => {
  const host = await mount(page, 2);
  const other = page.locator("#database-find-1");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("databaseFindEditors")[0].editor;
    const table = editor.getJSON().content?.find((item) => item.type === "semloEditorDatabase");
    if (!table) throw new Error("Missing data table");
    editor.commands.insertContentAt(editor.state.doc.content.size, structuredClone(table));
  });
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("甲记录");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/6");
  await expect(host.locator(".semlo-editor-database-cell.semlo-editor-find-match")).toHaveCount(2);
  await expect(other.locator(".semlo-editor-find-match")).toHaveCount(0);
  await panel.getByRole("tab", { name: "替换" }).click();
  await page.evaluate(() => window.__semloRequireFixture("databaseFindEditors")[0].setEditable(false));
  await expect(panel.getByRole("button", { name: "全部替换" })).toBeDisabled();
  await expect(panel.getByRole("button", { name: "替换", exact: true })).toBeDisabled();
  await page.evaluate(() => window.__semloRequireFixture("databaseFindEditors")[0].destroy());
  await expect(panel).toHaveCount(0);
});

test("document search follows data table filters when they change", async ({ page }) => {
  const data = sampleData();
  data.views[0].filters = [{ id: "filter", fieldId: data.fields[0].id, operator: "startsWith", value: "另一" }];
  const host = await mount(page, 1, sampleDocument(data));
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("甲记录");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/2");
  await expect(host.locator(".semlo-editor-database-cell.semlo-editor-find-match")).toHaveCount(0);
  const table = host.locator(".semlo-editor-database");
  await table.getByRole("button", { name: "筛选", exact: true }).click();
  await table.getByRole("dialog", { name: "筛选" }).getByRole("button", { name: "删除筛选规则" }).click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/4");
  await expect(table.locator(".semlo-editor-database-cell.semlo-editor-find-match")).toHaveCount(1);
  await table.getByRole("dialog", { name: "筛选" }).getByRole("button", { name: "关闭" }).click();
  await table.getByRole("button", { name: "字段配置" }).click();
  const fieldPanel = table.getByRole("dialog", { name: "字段配置" });
  await fieldPanel.getByRole("checkbox", { name: "显示文本" }).uncheck();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/2");
  await expect(table.locator(".semlo-editor-database-cell.semlo-editor-find-match")).toHaveCount(0);
  await fieldPanel.getByRole("checkbox", { name: "显示文本" }).check();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/4");
});

test("a board search highlights the matching record card", async ({ page }) => {
  const data = sampleData();
  data.views[0].kind = "kanban";
  data.views[0].groupFieldId = data.fields[1].id;
  data.records[0].values[data.fields[1].id] = data.fields[1].options[0].id;
  const host = await mount(page, 1, sampleDocument(data));
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("甲记录");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/4");
  await panel.getByRole("button", { name: "下一个" }).click();
  await expect(host.locator(".semlo-editor-database-card.semlo-editor-find-match-current")).toHaveCount(1);
  const background = await host
    .locator(".semlo-editor-database-card.semlo-editor-find-match-current")
    .evaluate((element) => getComputedStyle(element).backgroundColor);
  expect(background).not.toBe("rgb(255, 255, 255)");
});

test("read-only local view switching updates matches without editing the document", async ({ page }) => {
  const data = sampleData();
  data.views.push({
    ...structuredClone(data.views[0]),
    id: "hidden-view",
    name: "隐藏文本列",
    hiddenFields: [data.fields[0].id],
  });
  const host = await mount(page, 1, sampleDocument(data));
  await page.evaluate(() => window.__semloRequireFixture("databaseFindEditors")[0].setEditable(false));
  const before = await page.evaluate(() => window.__semloRequireFixture("databaseFindEditors")[0].getSnapshot().json);
  await host.locator(".semlo-editor-prose > p").first().click();
  await page.keyboard.press("ControlOrMeta+f");
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("甲记录");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/4");
  await expectFindPanelPlacement(page, host, panel);
  const table = host.locator(".semlo-editor-database");
  await table.getByRole("button", { name: "切换视图" }).click();
  await table.getByRole("button", { name: "切换到隐藏文本列" }).click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/2");
  await table.getByRole("button", { name: "切换视图" }).click();
  await table.getByRole("button", { name: "切换到表格视图" }).click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/4");
  expect(await page.evaluate(() => window.__semloRequireFixture("databaseFindEditors")[0].getSnapshot().json)).toEqual(
    before,
  );
});

test("find stays in a toolbar-free editor and leaves view switching accessible", async ({ page }) => {
  const data = sampleData();
  data.views.push({
    ...structuredClone(data.views[0]),
    id: "hidden-view",
    name: "隐藏文本列",
    hiddenFields: [data.fields[0].id],
  });
  const host = await mount(page, 1, sampleDocument(data), false);
  await expect(host.locator(".semlo-editor-toolbar")).toHaveCount(0);
  await host.locator(".semlo-editor-prose > p").first().click();
  await page.keyboard.press("ControlOrMeta+f");
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("甲记录");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/4");
  await expectFindPanelPlacement(page, host, panel);
  const table = host.locator(".semlo-editor-database");
  await table.getByRole("button", { name: "切换视图" }).click();
  await table.getByRole("button", { name: "切换到隐藏文本列" }).click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/2");
});

test("the shortcut inside a data table opens its own search, not document search", async ({ page }) => {
  const first = await mount(page, 2);
  const second = page.locator("#database-find-1");
  await second.getByLabel("第 1 行 文本").click();
  await page.keyboard.press("ControlOrMeta+f");
  await expect(second.getByRole("searchbox", { name: "搜索记录" })).toBeVisible();
  await expect(first.getByRole("searchbox", { name: "搜索记录" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "查找替换" })).toHaveCount(0);
  await second.getByRole("searchbox", { name: "搜索记录" }).fill("甲记录");
  await expect(second.getByLabel("第 1 行 文本")).toHaveValue("甲记录甲记录");
});
