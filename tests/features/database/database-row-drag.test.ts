import { expect, test } from "@rstest/playwright";

import {
  createDatabaseData,
  createDatabaseField,
  createDatabaseView,
  type DatabaseData,
} from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    rowDragEditor?: EditorController;
  }
}

test("table record movement belongs to one view and preserves record metadata", async ({ page }) => {
  const data = createDatabaseData({ id: "author", label: "作者" });
  for (const [index, value] of ["甲", "乙", "丙"].entries()) data.records[index].values[data.fields[0].id] = value;
  data.views.push(createDatabaseView("另一视图"));
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "rowDragContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'row-drag-test'
    document.body.prepend(host)
    window.rowDragEditor = createEditor({ element: host, outline: false, content: window.rowDragContent })
  `,
  });
  const root = page.locator("#row-drag-test .semlo-editor-database");
  const read = async (): Promise<DatabaseData> =>
    page.evaluate(
      () =>
        window
          .__semloRequireFixture("rowDragEditor")
          .getSnapshot()
          .json.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data as DatabaseData,
    );
  const rows = () =>
    root
      .locator('input[aria-label$=" 行 文本"]')
      .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  const handle = root.getByRole("button", { name: "移动第 3 条记录" });
  await handle.locator("..").hover();
  await handle.dragTo(root.locator(".semlo-editor-database-record-index").first(), { targetPosition: { x: 25, y: 2 } });
  expect(await rows()).toEqual(["丙", "甲", "乙"]);
  const exported = await page.evaluate(() => {
    const html = window.__semloRequireFixture("rowDragEditor").getSnapshot().html;
    return [
      ...new DOMParser().parseFromString(html, "text/html").querySelectorAll("[data-semlo-editor-database] tbody tr"),
    ].map((row) => row.querySelector("td")?.textContent);
  });
  expect(exported).toEqual(["丙", "甲", "乙"]);
  let saved = await read();
  expect(saved.views[0].recordOrder).toEqual([data.records[2].id, data.records[0].id, data.records[1].id]);
  expect(saved.records.map((record) => record.id)).toEqual(data.records.map((record) => record.id));
  expect(saved.records.map((record) => record.modifiedBy)).toEqual(data.records.map((record) => record.modifiedBy));
  expect(await page.evaluate(() => window.__semloRequireFixture("rowDragEditor").editor.commands.undo())).toBe(true);
  expect(await rows()).toEqual(["甲", "乙", "丙"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("rowDragEditor").editor.commands.redo())).toBe(true);
  await root.getByRole("button", { name: "切换视图" }).click();
  await root.getByRole("dialog", { name: "切换视图" }).getByRole("button", { name: "切换到另一视图" }).click();
  expect(await rows()).toEqual(["甲", "乙", "丙"]);
  await root.getByRole("button", { name: "切换视图" }).click();
  await root.getByRole("dialog", { name: "切换视图" }).getByRole("button", { name: "切换到表格视图" }).click();
  expect(await rows()).toEqual(["丙", "甲", "乙"]);
  const html = await page.evaluate(() => window.__semloRequireFixture("rowDragEditor").getSnapshot().html);
  await page.evaluate((value) => window.__semloRequireFixture("rowDragEditor").setContent(value), html);
  expect(await rows()).toEqual(["丙", "甲", "乙"]);
  await root.getByRole("button", { name: "文本列菜单" }).click();
  await root.getByRole("menu", { name: "文本 列菜单" }).getByRole("menuitem", { name: "降序" }).click();
  const sorted = await page.evaluate(() => ["甲", "乙", "丙"].sort((a, b) => b.localeCompare(a, "zh-CN")));
  expect(await rows()).toEqual(sorted);
  expect((await read()).views[0].sorts).toEqual([]);
  await expect(root.getByRole("button", { name: "移动第 1 条记录", includeHidden: true })).toBeEnabled();
  expect(await page.evaluate(() => window.__semloRequireFixture("rowDragEditor").editor.commands.undo())).toBe(true);
  expect(await rows()).toEqual(["丙", "甲", "乙"]);
  await root.getByRole("button", { name: "排序", exact: true }).click();
  await root.getByRole("dialog", { name: "排序" }).getByRole("button", { name: "添加排序" }).click();
  await root.getByRole("dialog", { name: "排序" }).getByLabel("保持排序").check();
  await expect(root.getByRole("button", { name: "移动第 1 条记录", includeHidden: true })).toBeDisabled();
  saved = await read();
  expect(saved.views[0].recordOrder).toEqual([data.records[2].id, data.records[0].id, data.records[1].id]);
  await root.getByRole("dialog", { name: "排序" }).getByLabel("保持排序").click();
  expect((await read()).views[0].sorts).toEqual([]);
  await expect(root.getByRole("button", { name: "移动第 1 条记录", includeHidden: true })).toBeEnabled();
});

test("grouped row movement changes the group value and is undoable", async ({ page }) => {
  const data = createDatabaseData({ id: "author", label: "作者" });
  const field = createDatabaseField("完成", "checkbox");
  data.fields.push(field);
  data.views[0].groupFieldId = field.id;
  data.records.forEach((record, index) => {
    record.values[data.fields[0].id] = ["甲", "乙", "丙"][index];
    record.values[field.id] = index === 2;
  });
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "rowDragContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'row-drag-test'
    document.body.prepend(host)
    window.rowDragEditor = createEditor({ element: host, outline: false, content: window.rowDragContent })
  `,
  });
  const root = page.locator("#row-drag-test .semlo-editor-database");
  const handle = root.getByRole("button", { name: "移动第 3 条记录" });
  await handle.locator("..").hover();
  await handle.dragTo(root.getByRole("button", { name: "移动第 1 条记录", includeHidden: true }).locator(".."), {
    targetPosition: { x: 25, y: 2 },
  });
  const read = () =>
    page.evaluate(
      () =>
        window
          .__semloRequireFixture("rowDragEditor")
          .getSnapshot()
          .json.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data as DatabaseData,
    );
  let saved = await read();
  expect(saved.records[2].values[field.id]).toBe(false);
  expect(saved.views[0].recordOrder).toEqual([data.records[2].id, data.records[0].id, data.records[1].id]);
  expect(await page.evaluate(() => window.__semloRequireFixture("rowDragEditor").editor.commands.undo())).toBe(true);
  saved = await read();
  expect(saved.records[2].values[field.id]).toBe(true);
  expect(saved.views[0].recordOrder).toEqual([]);
  const sameGroup = root.getByRole("button", { name: "移动第 2 条记录" });
  await sameGroup.locator("..").hover();
  await sameGroup.dragTo(root.getByRole("button", { name: "移动第 1 条记录", includeHidden: true }).locator(".."), {
    targetPosition: { x: 25, y: 2 },
  });
  saved = await read();
  expect(saved.views[0].recordOrder).toEqual([data.records[1].id, data.records[0].id, data.records[2].id]);
  expect(saved.records[1].modifiedAt).toBe(data.records[1].modifiedAt);
});

test("a row drag cannot modify a replacement document with the same identifiers", async ({ page }) => {
  const data = createDatabaseData();
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "rowDragContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'row-drag-test'
    document.body.prepend(host)
    window.rowDragEditor = createEditor({ element: host, outline: false, content: window.rowDragContent })
  `,
  });
  await expect(page.locator("#row-drag-test .semlo-editor-database")).toBeVisible();
  const result = await page.evaluate(() => {
    const root = document.querySelector("#row-drag-test .semlo-editor-database")!;
    const source = root.querySelectorAll<HTMLButtonElement>(".semlo-editor-database-record-drag")[1];
    const transfer = new DataTransfer();
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    const snapshot = window.__semloRequireFixture("rowDragEditor").getSnapshot().json;
    snapshot.content?.push({ type: "paragraph", content: [{ type: "text", text: "替换" }] });
    window.__semloRequireFixture("rowDragEditor").setContent(snapshot);
    const beforeDrop = window.__semloRequireFixture("rowDragEditor").getSnapshot().json;
    const target = document.querySelector<HTMLElement>(
      "#row-drag-test .semlo-editor-database-record-index",
    )!.parentElement!;
    target.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: 1 }),
    );
    return { beforeDrop, afterDrop: window.__semloRequireFixture("rowDragEditor").getSnapshot().json };
  });
  expect(result.afterDrop).toEqual(result.beforeDrop);
});
