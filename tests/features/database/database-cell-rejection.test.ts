import { expect, test } from "@rstest/playwright";

import { createDatabaseData, type DatabaseData } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    databaseCellRejectEditor?: EditorController;
    databaseCellRejectNext?: boolean;
  }
}

for (const kind of ["text", "date", "composition"] as const) {
  test(`a rejected ${kind} cell input restores its value and supports retry and undo`, async ({ page }) => {
    await installFixtureGuards(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const data = createDatabaseData();
    const field = kind === "date" ? data.fields[2] : data.fields[0];
    const original = kind === "date" ? "2024-02-01" : "B";
    const next = kind === "date" ? "2024-03-01" : kind === "composition" ? "中文" : "Z";
    data.records[0].values[field.id] = original;
    const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.evaluate((value) => Reflect.set(window, "databaseCellRejectContent", value), content);
    await page.addScriptTag({
      type: "module",
      content: `
        import { createEditor } from '/dist/index.js'
        const host = document.createElement('div'); host.id = 'database-cell-reject'; document.body.prepend(host)
        const controller = createEditor({element: host, outline: false, content: window.databaseCellRejectContent})
        controller.editor.on('beforeTransaction', ({transaction}) => {
          if (!window.databaseCellRejectNext || !transaction.docChanged) return
          window.databaseCellRejectNext = false
          const node = controller.editor.state.doc.nodeAt(0)
          controller.editor.view.dispatch(controller.editor.state.tr.setNodeMarkup(0, undefined, {...node.attrs}))
        })
        window.databaseCellRejectEditor = controller
      `,
    });
    const cell = page.locator("#database-cell-reject .semlo-editor-database").getByLabel(`第 1 行 ${field.name}`);
    const read = async () =>
      (await page.evaluate(
        () => window.__semloRequireFixture("databaseCellRejectEditor").getSnapshot().json.content![0].attrs!.data,
      )) as DatabaseData;
    if (kind === "composition") {
      await cell.focus();
      await cell.evaluate((element) =>
        element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
      );
      await cell.fill("中");
    }
    await page.evaluate(() => (window.databaseCellRejectNext = true));
    await cell.fill(next);
    await expect
      .poll(() => errors.join(" | "))
      .toContain("A transaction cannot be dispatched before the current transaction commits");
    expect((await read()).records[0].values[field.id]).toBe(kind === "composition" ? "中" : original);
    await expect(cell).toHaveValue(kind === "composition" ? "中" : original);
    if (kind === "composition")
      await cell.evaluate((element) =>
        element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })),
      );
    await cell.fill(next);
    await cell.press("Enter");
    expect((await read()).records[0].values[field.id]).toBe(next);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("databaseCellRejectEditor").editor.commands.undo()),
    ).toBe(true);
    expect((await read()).records[0].values[field.id]).toBe(original);
  });
}

test("筛选分组表格拒绝单元格写入时恢复已保存值，重试及撤销仍按原记录处理", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const field = data.fields[0];
  const recordId = data.records[0].id;
  data.records.forEach((record, index) => (record.values[field.id] = ["B", "C", "A"][index]));
  data.views[0].groupFieldId = field.id;
  data.views[0].filters = [{ id: "test-filter", fieldId: field.id, operator: "startsWith", value: "B" }];
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "databaseCellRejectContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor, Plugin } from '/dist/index.js'
      const host = document.createElement('div'); host.id = 'database-cell-reject'; document.body.prepend(host)
      const controller = createEditor({element: host, outline: false, content: window.databaseCellRejectContent})
      controller.editor.registerPlugin(new Plugin({
        filterTransaction(transaction) {
          if (!window.databaseCellRejectNext || !transaction.docChanged) return true
          window.databaseCellRejectNext = false
          return false
        }
      }))
      window.databaseCellRejectEditor = controller
    `,
  });
  const cell = page.locator("#database-cell-reject .semlo-editor-database").getByLabel("第 1 行 文本");
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("databaseCellRejectEditor").getSnapshot());
  const savedValue = async () =>
    ((await snapshot()).json.content![0].attrs!.data as DatabaseData).records.find((record) => record.id === recordId)
      ?.values[field.id];
  await expect(cell).toHaveValue("B");
  const original = await snapshot();
  await cell.fill("B改");
  expect(await savedValue()).toBe("B改");
  const accepted = await snapshot();

  await page.evaluate(() => (window.databaseCellRejectNext = true));
  await cell.fill("Z");
  expect(await page.evaluate(() => window.databaseCellRejectNext)).toBe(false);
  expect(await snapshot()).toEqual(accepted);
  await expect(cell).toHaveValue("B改");
  await cell.press("ControlOrMeta+z");
  await expect(cell).toHaveValue("B");
  await cell.press("ControlOrMeta+Shift+z");
  await expect(cell).toHaveValue("B改");

  await cell.fill("Z");
  expect(await savedValue()).toBe("Z");
  await cell.press("Enter");
  await expect(cell).toHaveCount(0);
  const saved = await snapshot();
  expect(
    await page.evaluate(() => window.__semloRequireFixture("databaseCellRejectEditor").editor.commands.undo()),
  ).toBe(true);
  await expect(cell).toHaveValue("B");
  expect(await snapshot()).toEqual(original);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("databaseCellRejectEditor").editor.commands.redo()),
  ).toBe(true);
  await expect(cell).toHaveCount(0);
  expect(await snapshot()).toEqual(saved);
  await page.evaluate(
    ([originalHtml, savedHtml]) => {
      const controller = window.__semloRequireFixture("databaseCellRejectEditor");
      controller.setContent(originalHtml);
      controller.setContent(savedHtml);
    },
    [original.html, saved.html] as const,
  );
  await expect(cell).toHaveCount(0);
  expect(await snapshot()).toEqual(saved);
});
