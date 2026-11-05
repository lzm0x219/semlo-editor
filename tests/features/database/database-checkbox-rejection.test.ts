import { expect, test } from "@rstest/playwright";

import { createDatabaseData, type DatabaseData } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    databaseCheckboxRejectEditor?: EditorController;
    databaseCheckboxRejectNext?: boolean;
  }
}

for (const action of ["checkbox"] as const) {
  test(`a rejected ${action} change restores the cell and can be retried`, async ({ page }) => {
    await installFixtureGuards(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const data = createDatabaseData();
    data.fields[2].type = "checkbox";
    data.fields[2].defaultValue = false;
    for (const record of data.records) record.values[data.fields[2].id] = false;
    data.records.forEach((record, index) => (record.values[data.fields[0].id] = ["B", "C", "A"][index]));
    const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.evaluate((value) => Reflect.set(window, "databaseCheckboxRejectContent", value), content);
    await page.addScriptTag({
      type: "module",
      content: `
        import { createEditor } from '/dist/index.js'
        const host = document.createElement('div'); host.id = 'database-checkbox-reject'; document.body.prepend(host)
        const controller = createEditor({element: host, outline: false, content: window.databaseCheckboxRejectContent})
        controller.editor.on('beforeTransaction', ({transaction}) => {
          if (!window.databaseCheckboxRejectNext || !transaction.docChanged) return
          window.databaseCheckboxRejectNext = false
          const node = controller.editor.state.doc.nodeAt(0)
          controller.editor.view.dispatch(controller.editor.state.tr.setNodeMarkup(0, undefined, {...node.attrs}))
        })
        window.databaseCheckboxRejectEditor = controller
      `,
    });
    const root = page.locator("#database-checkbox-reject .semlo-editor-database");
    const cell = root.getByLabel("第 1 行 日期");
    const perform = async () => {
      await cell.click();
    };
    const read = async () =>
      (await page.evaluate(
        () => window.__semloRequireFixture("databaseCheckboxRejectEditor").getSnapshot().json.content![0].attrs!.data,
      )) as DatabaseData;
    await page.evaluate(() => (window.databaseCheckboxRejectNext = true));
    await perform();
    await expect
      .poll(() => errors.join(" | "))
      .toContain("A transaction cannot be dispatched before the current transaction commits");
    const rejected = await read();
    expect(rejected.records[0].values[data.fields[2].id]).toBe(false);
    expect(rejected.records.map((record) => record.values[data.fields[0].id])).toEqual(["B", "C", "A"]);
    await expect(cell).not.toBeChecked();
    await perform();
    expect((await read()).records[0].values[data.fields[2].id]).toBe(true);
  });
}
