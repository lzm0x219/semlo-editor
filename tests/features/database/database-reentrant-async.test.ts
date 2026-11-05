import { expect, test } from "@rstest/playwright";

import { createDatabaseData, createDatabaseField } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    databaseAsyncReentrantEditor?: EditorController;
    databaseAsyncReentrantMode?: boolean;
    resolveDatabaseAsyncReentrant?: (value: never) => void;
  }
}

for (const kind of ["attachment", "person"] as const) {
  test(`a pending ${kind} result cannot cross an appended database replacement`, async ({ page }) => {
    await installFixtureGuards(page);
    const data = createDatabaseData();
    const field = createDatabaseField(kind === "person" ? "负责人" : "材料", kind);
    data.fields.push(field);
    for (const record of data.records) record.values[field.id] = [];
    const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.evaluate((value) => Reflect.set(window, "databaseAsyncReentrantContent", value), content);
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor, Plugin } from '/dist/index.js'
      const host = document.createElement('div'); host.id = 'database-async-reentrant'; document.body.prepend(host)
      const pending = () => new Promise(resolve => { window.resolveDatabaseAsyncReentrant = resolve })
      const controller = createEditor({ element: host, outline: false, content: window.databaseAsyncReentrantContent,
        uploadAttachment: pending, searchMentions: pending })
      controller.editor.registerPlugin(new Plugin({ appendTransaction(transactions, _old, state) {
        if (!window.databaseAsyncReentrantMode || !transactions.some(tr => tr.docChanged)) return null
        window.databaseAsyncReentrantMode = false
        const node = state.doc.nodeAt(0)
        return state.tr.setNodeMarkup(0, undefined, { ...node.attrs, data: structuredClone(node.attrs.data) })
      } }))
      window.databaseAsyncReentrantEditor = controller
    `,
    });
    const root = page.locator("#database-async-reentrant .semlo-editor-database");
    await root.getByLabel(`第 1 行 ${field.name}`).click();
    const dialog = root.getByRole("dialog", { name: `${field.name} ${kind === "person" ? "人员" : "文件"}` });
    if (kind === "attachment")
      await dialog
        .getByLabel("选择附件")
        .setInputFiles({ name: "迟到.pdf", mimeType: "application/pdf", buffer: Buffer.from("pdf") });
    await page.waitForFunction(() => typeof window.resolveDatabaseAsyncReentrant === "function");
    await page.evaluate(() => {
      window.databaseAsyncReentrantMode = true;
      document.querySelector<HTMLButtonElement>('#database-async-reentrant button[aria-label="添加记录"]')!.click();
    });
    await expect(dialog).toHaveCount(0);
    const before = await page.evaluate(
      () => window.__semloRequireFixture("databaseAsyncReentrantEditor").getSnapshot().json,
    );
    await page.evaluate(async (kind) => {
      const value = kind === "person" ? [{ id: "old", label: "过期人员", kind: "person" }] : "/late.pdf";
      (window.resolveDatabaseAsyncReentrant as (result: unknown) => void)(value);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }, kind);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("databaseAsyncReentrantEditor").getSnapshot().json),
    ).toEqual(before);
    await expect(root.getByText(kind === "person" ? "过期人员" : "迟到.pdf")).toHaveCount(0);
  });
}
