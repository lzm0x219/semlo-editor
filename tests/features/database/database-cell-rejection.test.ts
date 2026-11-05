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
