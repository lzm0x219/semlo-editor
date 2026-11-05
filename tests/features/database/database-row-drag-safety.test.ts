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
    rowDragSafetyA?: EditorController;
    rowDragSafetyB?: EditorController;
  }
}

test("a record drag cannot cross editors or complete after becoming read-only", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "rowDragSafetyContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    for (const suffix of ['A', 'B']) {
      const host = document.createElement('div')
      host.id = 'row-drag-safety-' + suffix
      document.body.append(host)
      window['rowDragSafety' + suffix] = createEditor({ element: host, outline: false, content: window.rowDragSafetyContent })
    }
  `,
  });
  await expect(page.locator("#row-drag-safety-A .semlo-editor-database-record-drag")).toHaveCount(3);
  await expect(page.locator("#row-drag-safety-B .semlo-editor-database-record-drag")).toHaveCount(3);
  const result = await page.evaluate(() => {
    const a = window.__semloRequireFixture("rowDragSafetyA");
    const b = window.__semloRequireFixture("rowDragSafetyB");
    const source = document.querySelectorAll<HTMLButtonElement>(
      "#row-drag-safety-A .semlo-editor-database-record-drag",
    )[1];
    const otherTarget = document.querySelector<HTMLElement>(
      "#row-drag-safety-B .semlo-editor-database-record-index",
    )!.parentElement!;
    const transfer = new DataTransfer();
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    const started = transfer.types.includes("application/x-semlo-database-row");
    const beforeA = a.getSnapshot().json;
    const beforeB = b.getSnapshot().json;
    otherTarget.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: 1 }),
    );
    const afterCrossA = a.getSnapshot().json;
    const afterCrossB = b.getSnapshot().json;
    a.setEditable(false);
    const target = document.querySelector<HTMLElement>(
      "#row-drag-safety-A .semlo-editor-database-record-index",
    )!.parentElement!;
    target.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: 1 }),
    );
    return { started, beforeA, beforeB, afterCrossA, afterCrossB, afterReadonly: a.getSnapshot().json };
  });
  expect(result.started).toBe(true);
  expect(result.afterCrossA).toEqual(result.beforeA);
  expect(result.afterCrossB).toEqual(result.beforeB);
  expect(result.afterReadonly).toEqual(result.beforeA);
});

test("a drag begun in one view cannot reorder a different view", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  data.views.push(createDatabaseView("另一视图"));
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "rowDragSafetyContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'row-drag-safety-A'
    document.body.append(host)
    window.rowDragSafetyA = createEditor({ element: host, outline: false, content: window.rowDragSafetyContent })
  `,
  });
  const root = page.locator("#row-drag-safety-A .semlo-editor-database");
  await expect(root.locator(".semlo-editor-database-record-drag")).toHaveCount(3);
  const started = await page.evaluate(() => {
    const source = document.querySelectorAll<HTMLButtonElement>(
      "#row-drag-safety-A .semlo-editor-database-record-drag",
    )[1];
    const transfer = new DataTransfer();
    Reflect.set(window, "rowDragSafetyTransfer", transfer);
    source.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: transfer }));
    return transfer.types.includes("application/x-semlo-database-row");
  });
  expect(started).toBe(true);
  await root.getByRole("button", { name: "切换视图" }).click();
  await root.getByRole("dialog", { name: "切换视图" }).getByRole("button", { name: "切换到另一视图" }).click();
  const result = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("rowDragSafetyA");
    const before = editor.getSnapshot().json;
    const transfer = Reflect.get(window, "rowDragSafetyTransfer") as DataTransfer;
    const target = document.querySelector<HTMLElement>(
      "#row-drag-safety-A .semlo-editor-database-record-index",
    )!.parentElement!;
    target.dispatchEvent(
      new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer, clientY: 1 }),
    );
    return { before, after: editor.getSnapshot().json };
  });
  expect(result.after).toEqual(result.before);
  const saved = result.after.content?.find((node) => node.type === "semloEditorDatabase")?.attrs?.data as DatabaseData;
  expect(saved.views.map((view) => view.recordOrder)).toEqual([[], []]);
});
