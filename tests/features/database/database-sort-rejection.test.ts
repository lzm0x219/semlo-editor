import { expect, test } from "@rstest/playwright";

import { createDatabaseData, type DatabaseData } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    databaseSortRejectEditor?: EditorController;
    databaseSortRejectNext?: boolean;
  }
}

for (const action of ["direction", "field", "add", "remove"] as const) {
  test(`a rejected ${action} change restores the sorting draft and can be retried`, async ({ page }) => {
    await installFixtureGuards(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const data = createDatabaseData();
    data.views[0].sorts = [{ fieldId: data.fields[0].id, direction: "asc" }];
    data.records.forEach((record, index) => (record.values[data.fields[0].id] = ["B", "C", "A"][index]));
    const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.evaluate((value) => Reflect.set(window, "databaseSortRejectContent", value), content);
    await page.addScriptTag({
      type: "module",
      content: `
        import { createEditor } from '/dist/index.js'
        const host = document.createElement('div'); host.id = 'database-sort-reject'; document.body.prepend(host)
        const controller = createEditor({element: host, outline: false, content: window.databaseSortRejectContent})
        controller.editor.on('beforeTransaction', ({transaction}) => {
          if (!window.databaseSortRejectNext || !transaction.docChanged) return
          window.databaseSortRejectNext = false
          const node = controller.editor.state.doc.nodeAt(0)
          controller.editor.view.dispatch(controller.editor.state.tr.setNodeMarkup(0, undefined, {...node.attrs}))
        })
        window.databaseSortRejectEditor = controller
      `,
    });
    const root = page.locator("#database-sort-reject .semlo-editor-database");
    await root.getByRole("button", { name: "排序", exact: true }).click();
    const panel = root.getByRole("dialog", { name: "排序" });
    const perform = async () => {
      if (action === "direction") await panel.getByLabel("排序顺序").selectOption("desc");
      if (action === "field") await panel.getByLabel("排序列").selectOption(data.fields[1].id);
      if (action === "add") await panel.getByRole("button", { name: "添加排序" }).click();
      if (action === "remove") await panel.getByRole("button", { name: "删除排序" }).click();
    };
    const read = async () =>
      (await page.evaluate(
        () => window.__semloRequireFixture("databaseSortRejectEditor").getSnapshot().json.content![0].attrs!.data,
      )) as DatabaseData;
    await page.evaluate(() => (window.databaseSortRejectNext = true));
    await perform();
    expect(errors.join(" | ")).toContain("A transaction cannot be dispatched before the current transaction commits");
    const rejected = await read();
    expect(rejected.views[0].sorts).toEqual(data.views[0].sorts);
    expect(rejected.records.map((record) => record.values[data.fields[0].id])).toEqual(["B", "C", "A"]);
    await expect(panel.getByLabel("排序顺序")).toHaveValue("asc");
    await expect(panel.getByLabel("排序列")).toHaveValue(data.fields[0].id);
    await expect(panel.getByLabel("排序列")).toHaveCount(1);
    await perform();
    const retried = (await read()).views[0].sorts;
    if (action === "direction") expect(retried[0].direction).toBe("desc");
    if (action === "field") expect(retried[0].fieldId).toBe(data.fields[1].id);
    if (action === "add") expect(retried).toHaveLength(2);
    if (action === "remove") expect(retried).toEqual([]);
  });
}
