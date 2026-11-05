import { expect, test } from "@rstest/playwright";
import { Schema } from "@tiptap/pm/model";

import { findDatabaseMatches } from "../../../packages/core/src/features/database/find-database-matches";
import {
  createDatabaseData,
  createDatabaseField,
  createDatabaseView,
} from "../../../packages/core/src/features/database/model";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    semloEditorDatabase: { group: "block", atom: true, attrs: { data: { default: null } } },
    text: { group: "inline" },
  },
});

test("search follows projected group order and excludes collapsed projected records", () => {
  const data = createDatabaseData();
  const group = createDatabaseField("标签", "multiSelect");
  group.options = [{ id: "default", label: "默认", color: 0 }];
  const field = createDatabaseField("内容");
  data.fields.push(group, field);
  data.views[0].groupFieldId = group.id;
  const [first, second, third] = data.records;
  for (const record of data.records) {
    record.values[group.id] = ["default"];
    record.values[field.id] = "共同命中";
  }
  const node = schema.node("semloEditorDatabase", { data });
  const doc = schema.node("doc", null, [node]);
  const groups = [
    { key: "default", recordIds: [third.id], collapsed: false },
    { key: "empty", recordIds: [second.id, first.id], collapsed: false },
  ];
  const projection = (position: number, candidate: typeof node) => {
    expect(position).toBe(0);
    expect(candidate).toBe(node);
    return { groups };
  };
  const matches = () => findDatabaseMatches(doc, "共同命中", undefined, projection).map((match) => match.recordId);
  expect(matches()).toEqual([third.id, second.id, first.id]);
  groups[1].collapsed = true;
  expect(matches()).toEqual([third.id]);
  groups[0].collapsed = true;
  expect(matches()).toEqual([]);
  expect(findDatabaseMatches(doc, "共同命中").map((match) => match.recordId)).toEqual([first.id, second.id, third.id]);
  // An active input can leave the old rows rendered until repaint even when its edit changes a filter.
  groups[0].collapsed = false;
  groups[1].collapsed = false;
  data.views[0].filters = [{ id: "filter", fieldId: field.id, operator: "startsWith", value: "其他" }];
  const filteredNode = schema.node("semloEditorDatabase", { data });
  const filteredDoc = schema.node("doc", null, [filteredNode]);
  expect(findDatabaseMatches(filteredDoc, "共同命中")).toHaveLength(0);
  expect(
    findDatabaseMatches(filteredDoc, "共同命中", undefined, () => ({ groups })).map((match) => match.recordId),
  ).toEqual([third.id, second.id, first.id]);
});

test("find follows real pending group projection through collapse and controlled writes", async ({ page }) => {
  const data = createDatabaseData();
  const [title, group] = data.fields;
  group.type = "multiSelect";
  group.options = [{ id: "default", label: "默认", color: 0 }];
  group.defaultValue = ["default"];
  title.defaultValue = "共同命中";
  data.records.forEach((record, index) => {
    record.values[group.id] = index === 0 ? ["default"] : [];
    record.values[title.id] = "共同命中";
  });
  data.views[0].groupFieldId = group.id;
  const alternate = createDatabaseView("另一视图", "table");
  alternate.groupFieldId = group.id;
  data.views.push(alternate);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "projectionFixture", value), data);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'projection-test'; document.body.append(host)
    window.projectionEditor = createEditor({ element: host, outline: false,
      content: { type: 'doc', content: [{type: 'semloEditorDatabase', attrs: {data: window.projectionFixture}}, {type: 'paragraph'}] } })
  `,
  });
  const root = page.locator("#projection-test");
  const database = root.locator(".semlo-editor-database");
  for (let i = 0; i < 2; i++) await database.getByRole("button", { name: "在（空）分组添加记录" }).click();
  const snapshot = await page.evaluate(() => Reflect.get(window, "projectionEditor").getSnapshot().json);
  const added = snapshot.content[0].attrs.data.records.slice(-2).map((record: { id: string }) => record.id);
  expect(
    snapshot.content[0].attrs.data.records
      .slice(-2)
      .map((record: { values: Record<string, unknown> }) => record.values[group.id]),
  ).toEqual([["default"], ["default"]]);
  await root.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("共同命中");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/5");
  for (const id of added)
    await expect(
      database.locator(`.semlo-editor-database-cell[data-record-id="${id}"][data-field-id="${title.id}"]`),
    ).toHaveClass(/semlo-editor-find-match/);
  await database.getByRole("button", { name: "折叠分组 （空）" }).click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/1");
  await page.evaluate(() => {
    const editor = Reflect.get(window, "projectionEditor");
    editor.setContent(structuredClone(editor.getSnapshot().json));
  });
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/1");
  await database.getByRole("button", { name: "折叠分组 （空）" }).click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText(/^[1-5]\/5$/);
  const input = database.locator(
    `.semlo-editor-database-cell[data-record-id="${added[0]}"][data-field-id="${title.id}"] input`,
  );
  await input.fill("其他");
  await input.press("Enter");
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText(/^[1-4]\/4$/);
  expect(await page.evaluate(() => Reflect.get(window, "projectionEditor").editor.commands.undo())).toBe(true);
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText(/^[1-5]\/5$/);
  expect(await page.evaluate(() => Reflect.get(window, "projectionEditor").editor.commands.redo())).toBe(true);
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText(/^[1-4]\/4$/);
  await database.getByRole("button", { name: "切换视图" }).click();
  await database.getByRole("dialog", { name: "切换视图" }).getByRole("button", { name: "切换到另一视图" }).click();
  await expect(panel.locator(".semlo-editor-find-counter")).toHaveText(/^[1-4]\/4$/);
  await page.evaluate(() => Reflect.get(window, "projectionEditor").destroy());
});
