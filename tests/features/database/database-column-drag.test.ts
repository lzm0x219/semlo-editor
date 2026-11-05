import { expect, test } from "@rstest/playwright";

import {
  createDatabaseData,
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
    columnDragEditor?: EditorController;
  }
}

test("column dragging is view-specific, persisted and undoable", async ({ page }) => {
  const data = createDatabaseData();
  const other = createDatabaseView("另一视图");
  data.views.push(other);
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((initial) => Reflect.set(window, "columnDragContent", initial), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'column-drag-test'
    document.body.prepend(host)
    window.columnDragEditor = createEditor({ element: host, outline: false, content: window.columnDragContent })
  `,
  });
  const root = page.locator("#column-drag-test .semlo-editor-database");
  const header = root.locator(".semlo-editor-database-header");
  const names = () => header.locator("[data-column-id]").allTextContents();
  const from = header.getByRole("columnheader").filter({ hasText: "单选" });
  const target = header.getByRole("columnheader").filter({ hasText: "文本" });
  await from.dragTo(target, { targetPosition: { x: 4, y: 10 } });
  expect((await names()).slice(0, 3).map((text) => text.trim().replace("⌄", ""))).toEqual([
    "◉  单选",
    "T  文本",
    "▦  日期",
  ]);
  const saved = await page.evaluate(() => window.__semloRequireFixture("columnDragEditor").getSnapshot().json);
  const exportedHeaders = await page.evaluate(() => {
    const html = window.__semloRequireFixture("columnDragEditor").getSnapshot().html;
    return [
      ...new DOMParser().parseFromString(html, "text/html").querySelectorAll("[data-semlo-editor-database] th"),
    ].map((item) => item.textContent);
  });
  expect(exportedHeaders).toEqual(["单选", "文本", "日期"]);
  const savedData = saved.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data as DatabaseData;
  expect(savedData.views[0].fieldOrder).toEqual([data.fields[1].id, data.fields[0].id, data.fields[2].id]);
  expect(savedData.views[1].fieldOrder).toEqual([]);
  expect(await page.evaluate(() => window.__semloRequireFixture("columnDragEditor").editor.commands.undo())).toBe(true);
  await expect(header.getByRole("columnheader").first()).toContainText("文本");
  expect(await page.evaluate(() => window.__semloRequireFixture("columnDragEditor").editor.commands.redo())).toBe(true);
  await expect(header.getByRole("columnheader").first()).toContainText("单选");
  await root.getByRole("button", { name: "切换视图" }).click();
  await root.getByRole("dialog", { name: "切换视图" }).getByRole("button", { name: "切换到另一视图" }).click();
  await expect(header.getByRole("columnheader").first()).toContainText("文本");
  await root.getByRole("button", { name: "切换视图" }).click();
  await root.getByRole("dialog", { name: "切换视图" }).getByRole("button", { name: "切换到表格视图" }).click();
  await expect(header.getByRole("columnheader").first()).toContainText("单选");
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("columnDragEditor").getSnapshot().html);
  await page.evaluate((value) => window.__semloRequireFixture("columnDragEditor").setContent(value), snapshot);
  await expect(header.getByRole("columnheader").first()).toContainText("单选");
  await header.getByRole("button", { name: "单选列菜单" }).click();
  await root.getByRole("menu", { name: "单选 列菜单" }).getByRole("menuitem", { name: "向右插入列" }).click();
  const dialog = root.getByRole("dialog", { name: "新增列" });
  await dialog.getByLabel("数据表列名").fill("新增");
  await dialog.getByRole("button", { name: "确定" }).click();
  const reordered = await names();
  expect(reordered.slice(0, 3).map((text) => text.trim().replace("⌄", ""))).toEqual(["◉  单选", "T  新增", "T  文本"]);
  await page.evaluate(() => window.__semloRequireFixture("columnDragEditor").setEditable(false));
  await expect(header.locator("[data-column-id]").first()).toHaveAttribute("draggable", "false");
});

test("a stale column drag cannot alter a replaced document with the same identifiers", async ({ page }) => {
  const data = createDatabaseData();
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((initial) => Reflect.set(window, "columnDragContent", initial), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'column-drag-stale-test'
    document.body.prepend(host)
    window.columnDragEditor = createEditor({ element: host, outline: false, content: window.columnDragContent })
  `,
  });
  await expect(page.locator("#column-drag-stale-test .semlo-editor-database")).toBeVisible();
  const result = await page.evaluate(() => {
    const root = document.querySelector("#column-drag-stale-test .semlo-editor-database")!;
    const source = root.querySelectorAll<HTMLElement>("[data-column-id]")[1];
    const transfer = new DataTransfer();
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    const snapshot = window.__semloRequireFixture("columnDragEditor").getSnapshot().json;
    snapshot.content?.push({ type: "paragraph", content: [{ type: "text", text: "替换" }] });
    window.__semloRequireFixture("columnDragEditor").setContent(snapshot);
    const beforeDrop = window.__semloRequireFixture("columnDragEditor").getSnapshot().json;
    const target = document.querySelector<HTMLElement>("#column-drag-stale-test [data-column-id]")!;
    target.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer, clientX: 1 }),
    );
    return { beforeDrop, afterDrop: window.__semloRequireFixture("columnDragEditor").getSnapshot().json };
  });
  expect(result.afterDrop).toEqual(result.beforeDrop);
});
