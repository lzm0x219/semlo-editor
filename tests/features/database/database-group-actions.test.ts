import { expect, test } from "@rstest/playwright";

import {
  createDatabaseData,
  createDatabaseView,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    databaseGroupActionsEditor?: EditorController;
  }
}

test("multi-select group addition preserves the group and group statistics share the column configuration", async ({
  page,
}) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const [title, field] = data.fields;
  title.defaultValue = "初始";
  field.type = "multiSelect";
  field.defaultValue = ["a", "b"];
  field.options = [
    { id: "a", label: "甲", color: 0 },
    { id: "b", label: "乙", color: 1 },
  ];
  data.records[0].values[field.id] = ["a", "b"];
  data.records[1].values[field.id] = ["a", "b"];
  data.records[2].values[field.id] = [];
  data.records[0].values[title.id] = "测试";
  data.records[1].values[title.id] = "测试";
  data.views[0].groupFieldId = field.id;
  const other = createDatabaseView("另一视图");
  other.groupFieldId = field.id;
  data.views.push(other);
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "databaseGroupActionsContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host=document.createElement('div');host.id='database-group-actions';document.body.prepend(host)
    window.databaseGroupActionsEditor=createEditor({element:host,outline:false,content:window.databaseGroupActionsContent,currentUser:()=>({id:'u',label:'用户'})})
  `,
  });
  const root = page.locator("#database-group-actions .semlo-editor-database");
  const read = () =>
    page.evaluate(
      () =>
        window.__semloRequireFixture("databaseGroupActionsEditor").getSnapshot().json.content![0].attrs!
          .data as DatabaseData,
    );
  await root.getByRole("button", { name: "甲、乙分组的文本统计" }).click();
  await root.getByRole("dialog", { name: "文本 统计" }).getByRole("button", { name: "记录总数" }).click();
  await expect(root.getByRole("button", { name: "甲、乙分组的文本统计" })).toHaveText("2 条记录");
  await expect(root.getByRole("button", { name: "（空）分组的文本统计" })).toHaveText("1 条记录");
  await expect(root.getByRole("button", { name: "文本统计", exact: true })).toHaveText("3 条记录");
  await root.getByRole("button", { name: "文本统计", exact: true }).click();
  await root.getByRole("dialog", { name: "文本 统计" }).getByRole("button", { name: "唯一数占比" }).click();
  await expect(root.getByRole("button", { name: "文本统计", exact: true })).toHaveText("唯一数占比 33.33%");
  await expect(root.getByRole("button", { name: "甲、乙分组的文本统计" })).toHaveText("唯一数占比 50%");
  await expect(root.getByRole("button", { name: "（空）分组的文本统计" })).toHaveText("唯一数占比 0%");
  await root.getByRole("button", { name: "文本统计", exact: true }).click();
  await root.getByRole("dialog", { name: "文本 统计" }).getByRole("button", { name: "记录总数" }).click();
  await root.getByRole("button", { name: "切换视图" }).click();
  await root.getByRole("dialog", { name: "切换视图" }).getByRole("button", { name: "切换到另一视图" }).click();
  await expect(root.getByRole("button", { name: "甲、乙分组的文本统计" })).toHaveText("统计");
  await expect(root.getByRole("button", { name: "文本统计", exact: true })).toHaveText("统计");
  await root.getByRole("button", { name: "切换视图" }).click();
  await root.getByRole("dialog", { name: "切换视图" }).getByRole("button", { name: "切换到表格视图" }).click();
  await expect(root.getByRole("button", { name: "甲、乙分组的文本统计" })).toHaveText("2 条记录");
  await root.getByRole("button", { name: "在甲、乙分组添加记录" }).click();
  let saved = await read();
  expect(saved.records).toHaveLength(4);
  expect(saved.records[3].values[field.id]).toEqual(["a", "b"]);
  expect(saved.records[3].values[title.id]).toBe("初始");
  expect(saved.records[3].createdBy).toEqual({ id: "u", label: "用户" });
  await expect(root.getByRole("button", { name: "甲、乙分组的文本统计" })).toHaveText("3 条记录");
  await expect(root.getByRole("button", { name: "文本统计", exact: true })).toHaveText("4 条记录");
  await expect(root.getByLabel("第 3 行 文本")).toBeFocused();
  expect(
    await page.evaluate(() => window.__semloRequireFixture("databaseGroupActionsEditor").editor.commands.undo()),
  ).toBe(true);
  saved = await read();
  expect(saved.records).toHaveLength(3);
  await expect(root.getByRole("button", { name: "甲、乙分组的文本统计" })).toHaveText("2 条记录");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("databaseGroupActionsEditor").editor.commands.redo()),
  ).toBe(true);
  expect((await read()).records[3].values[field.id]).toEqual(["a", "b"]);
  await root.getByRole("button", { name: "在（空）分组添加记录" }).click();
  expect((await read()).records[4].values[field.id]).toEqual(["a", "b"]);
});

test("single-select group addition sets the group choice", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const field = data.fields[1];
  data.records[0].values[field.id] = field.options[0].id;
  data.views[0].groupFieldId = field.id;
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "databaseGroupActionsContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host=document.createElement('div');host.id='database-group-actions';document.body.prepend(host)
    window.databaseGroupActionsEditor=createEditor({element:host,outline:false,content:window.databaseGroupActionsContent})
  `,
  });
  const root = page.locator("#database-group-actions .semlo-editor-database");
  await root.getByRole("button", { name: "在待开始分组添加记录" }).click();
  const saved = await page.evaluate(
    () =>
      window.__semloRequireFixture("databaseGroupActionsEditor").getSnapshot().json.content![0].attrs!
        .data as DatabaseData,
  );
  expect(saved.records[3].values[field.id]).toBe(field.options[0].id);
});

test("group addition opens the first visible single-select cell", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const single = data.fields[1];
  const multi = createDatabaseData().fields[1];
  multi.id = "group-multi";
  multi.name = "多选";
  multi.type = "multiSelect";
  multi.defaultValue = [];
  data.fields.push(multi);
  data.views[0].fieldOrder = [single.id, data.fields[0].id, data.fields[2].id, multi.id];
  data.views[0].groupFieldId = multi.id;
  for (const record of data.records) record.values[multi.id] = [multi.options[0].id];
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "databaseGroupActionsContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host=document.createElement('div');host.id='database-group-actions';document.body.prepend(host)
    window.databaseGroupActionsEditor=createEditor({element:host,outline:false,content:window.databaseGroupActionsContent})
  `,
  });
  const root = page.locator("#database-group-actions .semlo-editor-database");
  await root.getByRole("button", { name: "在待开始分组添加记录" }).click();
  await expect(root.getByRole("dialog", { name: "单选 选项" })).toBeVisible();
  const saved = await page.evaluate(
    () =>
      window.__semloRequireFixture("databaseGroupActionsEditor").getSnapshot().json.content![0].attrs!
        .data as DatabaseData,
  );
  expect(saved.records).toHaveLength(4);
  expect(saved.records[3].values[multi.id]).toEqual([multi.options[0].id]);
});

test("single-select empty group retains a record with its nonempty default", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const field = data.fields[1];
  field.defaultValue = field.options[0].id;
  data.records.forEach((r) => (r.values[field.id] = ""));
  data.records[0].values[field.id] = field.options[1].id;
  data.views[0].groupFieldId = field.id;
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate(
    (v) =>
      Reflect.set(window, "databaseGroupActionsContent", {
        type: "doc",
        content: [{ type: "semloEditorDatabase", attrs: { data: v } }, { type: "paragraph" }],
      }),
    data,
  );
  await page.addScriptTag({
    type: "module",
    content: `import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='database-group-actions';document.body.prepend(host);window.databaseGroupActionsEditor=createEditor({element:host,outline:false,content:window.databaseGroupActionsContent})`,
  });
  const root = page.locator("#database-group-actions .semlo-editor-database");
  await root.getByRole("button", { name: "在（空）分组添加记录" }).click();
  const saved = await page.evaluate(
    () =>
      window.__semloRequireFixture("databaseGroupActionsEditor").getSnapshot().json.content![0].attrs!
        .data as DatabaseData,
  );
  const added = saved.records.at(-1)!;
  expect(added.values[field.id]).toBe(field.options[0].id);
  const group = await page.evaluate((id) => {
    let row = document.querySelector<HTMLElement>(
      `#database-group-actions .semlo-editor-database-cell[data-record-id="${id}"]`,
    )?.parentElement?.previousElementSibling;
    while (row && !row.classList.contains("semlo-editor-database-group-row")) row = row.previousElementSibling;
    return row?.querySelector(".semlo-editor-database-group-heading")?.getAttribute("aria-label");
  }, added.id);
  expect(group).toBe("折叠分组 （空）");
  await page.evaluate(
    ({ source, target }) => {
      const row = (id: string) =>
        document.querySelector<HTMLElement>(
          `#database-group-actions .semlo-editor-database-cell[data-record-id="${id}"]`,
        )!.parentElement!;
      const from = row(source).querySelector<HTMLButtonElement>(".semlo-editor-database-record-drag")!,
        to = row(target);
      const rect = to.querySelector<HTMLElement>(".semlo-editor-database-record-index")!.getBoundingClientRect(),
        transfer = new DataTransfer();
      from.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }));
      to.dispatchEvent(
        new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: rect.top + 1 }),
      );
    },
    { source: added.id, target: data.records[0].id },
  );
  const after = await page.evaluate(
    () =>
      window.__semloRequireFixture("databaseGroupActionsEditor").getSnapshot().json.content![0].attrs!
        .data as DatabaseData,
  );
  expect(after.records.find((record) => record.id === added.id)?.values[field.id]).toBe(field.options[1].id);
});
