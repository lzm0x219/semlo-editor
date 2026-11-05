import { expect, test } from "@rstest/playwright";

import { createDatabaseData, type DatabaseData } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    databaseFilterRejectEditor?: EditorController;
    databaseFilterRejectNext?: boolean;
  }
}

for (const action of ["mode"] as const) {
  test(`a rejected ${action} change restores the filter control and can be retried`, async ({ page }) => {
    await installFixtureGuards(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const data = createDatabaseData();
    data.views[0].filters = [
      { id: "filter-a", fieldId: data.fields[0].id, operator: "startsWith", value: "B" },
      { id: "filter-b", fieldId: data.fields[0].id, operator: "contains", value: "" },
    ];
    data.records.forEach((record, index) => (record.values[data.fields[0].id] = ["B", "C", "A"][index]));
    const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.evaluate((value) => Reflect.set(window, "databaseFilterRejectContent", value), content);
    await page.addScriptTag({
      type: "module",
      content: `
        import { createEditor } from '/dist/index.js'
        const host = document.createElement('div'); host.id = 'database-filter-reject'; document.body.prepend(host)
        const controller = createEditor({element: host, outline: false, content: window.databaseFilterRejectContent})
        controller.editor.on('beforeTransaction', ({transaction}) => {
          if (!window.databaseFilterRejectNext || !transaction.docChanged) return
          window.databaseFilterRejectNext = false
          const node = controller.editor.state.doc.nodeAt(0)
          controller.editor.view.dispatch(controller.editor.state.tr.setNodeMarkup(0, undefined, {...node.attrs}))
        })
        window.databaseFilterRejectEditor = controller
      `,
    });
    const root = page.locator("#database-filter-reject .semlo-editor-database");
    await root.getByRole("button", { name: "筛选", exact: true }).click();
    const panel = root.getByRole("dialog", { name: "筛选" });
    const perform = async () => {
      await panel.getByLabel("筛选关系").selectOption("or");
    };
    const read = async () =>
      (await page.evaluate(
        () => window.__semloRequireFixture("databaseFilterRejectEditor").getSnapshot().json.content![0].attrs!.data,
      )) as DatabaseData;
    await page.evaluate(() => (window.databaseFilterRejectNext = true));
    await perform();
    await expect
      .poll(() => errors.join(" | "))
      .toContain("A transaction cannot be dispatched before the current transaction commits");
    const rejected = await read();
    expect(rejected.views[0].filterMode).toBe("and");
    expect(rejected.views[0].filters).toEqual(data.views[0].filters);
    expect(rejected.records.map((record) => record.values[data.fields[0].id])).toEqual(["B", "C", "A"]);
    await expect(panel.getByLabel("筛选关系")).toHaveValue("and");
    await perform();
    expect((await read()).views[0].filterMode).toBe("or");
  });
}
