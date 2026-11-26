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

for (const action of ["field", "operator", "value"] as const) {
  test(`a rejected ${action} change restores the filter control and can be retried`, async ({ page }) => {
    await installFixtureGuards(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const data = createDatabaseData();
    data.views[0].filters = [
      { id: "filter-test", fieldId: data.fields[0].id, operator: "startsWith", value: action === "value" ? "B" : "" },
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
      if (action === "field") await panel.getByLabel("筛选列").selectOption(data.fields[1].id);
      if (action === "operator") await panel.getByLabel("筛选条件").selectOption("contains");
      if (action === "value") await panel.getByLabel("筛选值").fill("C");
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
    expect(rejected.views[0].filters).toEqual(data.views[0].filters);
    expect(rejected.records.map((record) => record.values[data.fields[0].id])).toEqual(["B", "C", "A"]);
    await expect(panel.getByLabel("筛选列")).toHaveValue(data.fields[0].id);
    await expect(panel.getByLabel("筛选条件")).toHaveValue("startsWith");
    if (action === "value") await expect(panel.getByLabel("筛选值")).toHaveValue("B");
    await perform();
    const retried = (await read()).views[0].filters[0];
    if (action === "field") expect(retried.fieldId).toBe(data.fields[1].id);
    if (action === "operator") expect(retried.operator).toBe("contains");
    if (action === "value") expect(retried.value).toBe("C");
  });
}

for (const action of ["分组关系", "文本条件", "选项条件"] as const) {
  test(`宿主拒绝筛选的${action}时恢复控件，允许后可重试和撤销`, async ({ page }) => {
    await installFixtureGuards(page);
    const data = createDatabaseData();
    const [text, singleSelect] = data.fields;
    const [first, second] = singleSelect.options;
    const names = ["B", "C", "A"];
    data.records.forEach((record, index) => {
      record.values[text.id] = names[index];
      record.values[singleSelect.id] = index === 2 ? second.id : first.id;
    });
    data.views[0].filterGroups = [
      {
        id: "test-group",
        filterMode: "and",
        filters: [
          { id: "test-text", fieldId: text.id, operator: "startsWith", value: "B" },
          { id: "test-option", fieldId: singleSelect.id, operator: "contains", value: first.label, optionId: first.id },
        ],
      },
    ];
    const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.evaluate((value) => Reflect.set(window, "databaseFilterRejectContent", value), content);
    await page.addScriptTag({
      type: "module",
      content: `
        import { createEditor, Plugin } from '/dist/index.js'
        const host = document.createElement('div'); host.id = 'database-filter-reject'; document.body.prepend(host)
        const controller = createEditor({element: host, outline: false, content: window.databaseFilterRejectContent})
        controller.editor.registerPlugin(new Plugin({
          filterTransaction(transaction) {
            if (!window.databaseFilterRejectNext || !transaction.docChanged) return true
            window.databaseFilterRejectNext = false
            return false
          }
        }))
        window.databaseFilterRejectEditor = controller
      `,
    });
    const root = page.locator("#database-filter-reject .semlo-editor-database");
    await root.getByRole("button", { name: "筛选", exact: true }).click();
    const group = root.getByRole("dialog", { name: "筛选" }).getByRole("group", { name: "筛选分组" });
    const [control, previous, next, expectedRows] =
      action === "分组关系"
        ? [group.getByLabel("分组内筛选关系"), "and", "or", ["B", "C"]]
        : action === "文本条件"
          ? [group.getByLabel("筛选值").first(), "B", "C", ["C"]]
          : [group.getByLabel("筛选值").last(), first.id, second.id, []];
    const perform = () => (action === "文本条件" ? control.fill(next) : control.selectOption(next));
    const rows = () =>
      root
        .locator('input[aria-label$=" 行 文本"]')
        .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
    const snapshot = () =>
      page.evaluate(() => window.__semloRequireFixture("databaseFilterRejectEditor").getSnapshot());
    const original = await snapshot();
    expect(await rows()).toEqual(["B"]);
    await page.evaluate(() => (window.databaseFilterRejectNext = true));
    await perform();
    expect(await page.evaluate(() => window.databaseFilterRejectNext)).toBe(false);
    expect(await snapshot()).toEqual(original);
    await expect(control).toHaveValue(previous);
    expect(await rows()).toEqual(["B"]);

    await perform();
    await expect(control).toHaveValue(next);
    expect(await rows()).toEqual(expectedRows);
    const saved = await snapshot();
    expect(saved.json).not.toEqual(original.json);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("databaseFilterRejectEditor").editor.commands.undo()),
    ).toBe(true);
    expect(await snapshot()).toEqual(original);
    expect(await rows()).toEqual(["B"]);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("databaseFilterRejectEditor").editor.commands.redo()),
    ).toBe(true);
    expect(await snapshot()).toEqual(saved);
    expect(await rows()).toEqual(expectedRows);
  });
}
