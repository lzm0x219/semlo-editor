import { expect, test } from "@rstest/playwright";

import { createDatabaseData, type DatabaseData } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    databaseReentrantEditor?: EditorController;
    databaseReentrantMode?: string;
  }
}

for (const mode of [
  "append-replace",
  "append-clone",
  "append-adjacent",
  "append-before",
  "before-replace",
  "before-clone",
] as const) {
  test(`${mode}: a synchronous transaction cannot leave a stale sorting draft`, async ({ page }) => {
    await installFixtureGuards(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const data = createDatabaseData();
    data.records.forEach((record, index) => {
      record.values[data.fields[0].id] = ["B", "C", "A"][index];
    });
    const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.evaluate((value) => Reflect.set(window, "databaseReentrantContent", value), content);
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor, Plugin } from '/dist/index.js'
      const host = document.createElement('div'); host.id = 'database-reentrant'; document.body.prepend(host)
      const controller = createEditor({ element: host, outline: false, content: window.databaseReentrantContent })
      const editor = controller.editor
      editor.registerPlugin(new Plugin({ appendTransaction(transactions, _old, state) {
        const mode = window.databaseReentrantMode
        if (!mode?.startsWith('append-') || !transactions.some(tr => tr.docChanged)) return null
        window.databaseReentrantMode = undefined
        if (mode === 'append-adjacent') return state.tr.insertText('旁', state.doc.content.size - 1)
        if (mode === 'append-before') return state.tr.insert(0, state.schema.nodes.paragraph.create(null, state.schema.text('之前')))
        const node = state.doc.nodeAt(0)
        const replacement = structuredClone(node.attrs.data)
        if (mode !== 'append-clone') replacement.records[0].values[replacement.fields[0].id] = '新文档'
        return state.tr.setNodeMarkup(0, undefined, { ...node.attrs, data: replacement })
      } }))
      editor.on('beforeTransaction', ({ transaction }) => {
        const mode = window.databaseReentrantMode
        if (!mode?.startsWith('before-') || !transaction.docChanged) return
        window.databaseReentrantMode = undefined
        const node = editor.state.doc.nodeAt(0)
        const replacement = structuredClone(node.attrs.data)
        if (mode !== 'before-clone') replacement.records[0].values[replacement.fields[0].id] = '新文档'
        editor.view.dispatch(editor.state.tr.setNodeMarkup(0, undefined, { ...node.attrs, data: replacement }))
      })
      window.databaseReentrantEditor = controller
    `,
    });
    const root = page.locator("#database-reentrant .semlo-editor-database");
    await root.getByLabel("选择第 1 条记录").check();
    await root.getByRole("button", { name: "排序", exact: true }).click();
    const panel = root.getByRole("dialog", { name: "排序" });
    await panel.getByRole("button", { name: "添加排序" }).click();
    await page.evaluate((value) => {
      window.databaseReentrantMode = value;
    }, mode);
    await page.evaluate(() =>
      Reflect.set(
        window,
        "databaseOldConfirm",
        document.querySelector('#database-reentrant button[aria-label="确定排序"]'),
      ),
    );
    await panel.getByLabel("保持排序").click();
    if (mode === "before-replace" || mode === "before-clone") {
      expect(errors.join(" | ")).toContain("A transaction cannot be dispatched before the current transaction commits");
      const read = async () =>
        (await page.evaluate(
          () => window.__semloRequireFixture("databaseReentrantEditor").getSnapshot().json.content![0].attrs!.data,
        )) as DatabaseData;
      const rejected = await read();
      expect(rejected.views[0].sorts).toEqual([]);
      expect(rejected.records.map((record) => record.values[data.fields[0].id])).toEqual(["B", "C", "A"]);
      await expect(panel.getByLabel("保持排序")).not.toBeChecked();
      await page.evaluate(() => (Reflect.get(window, "databaseOldConfirm") as HTMLButtonElement).click());
      expect(await read()).toEqual(rejected);
      await panel.getByLabel("保持排序").check();
      expect((await read()).views[0].sorts).toHaveLength(1);
    } else if (mode === "append-adjacent" || mode === "append-before") {
      await expect(panel).toBeVisible();
      await expect(root.locator('input[aria-label^="选择第"][aria-label$="条记录"]:checked')).toHaveCount(1);
      const current = await page.evaluate(
        () => window.__semloRequireFixture("databaseReentrantEditor").getSnapshot().json,
      );
      if (mode === "append-adjacent") expect(current.content?.[1].content?.[0].text).toBe("旁");
      else expect(current.content?.[0].content?.[0].text).toBe("之前");
    } else {
      await expect(panel).toHaveCount(0);
      await expect(root.locator('input[aria-label^="选择第"][aria-label$="条记录"]:checked')).toHaveCount(0);
      const current = await page.evaluate(
        () => window.__semloRequireFixture("databaseReentrantEditor").getSnapshot().json,
      );
      const saved = current.content?.[0].attrs?.data as DatabaseData;
      if (mode === "append-replace") expect(saved.records[0].values[data.fields[0].id]).toBe("新文档");
      const after = await page.evaluate(() => {
        (Reflect.get(window, "databaseOldConfirm") as HTMLButtonElement).click();
        return window.__semloRequireFixture("databaseReentrantEditor").getSnapshot().json;
      });
      expect(after).toEqual(current);
    }
  });
}

for (const mode of ["cell", "cell-clone"] as const) {
  test(`${mode}: an appended replacement invalidates the active cell editing session`, async ({ page }) => {
    await installFixtureGuards(page);
    const data = createDatabaseData();
    data.records[0].values[data.fields[0].id] = "原值";
    const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.evaluate((value) => Reflect.set(window, "databaseReentrantContent", value), content);
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor, Plugin } from '/dist/index.js'
      const host = document.createElement('div'); host.id = 'database-reentrant'; document.body.prepend(host)
      const controller = createEditor({ element: host, outline: false, content: window.databaseReentrantContent })
      controller.editor.registerPlugin(new Plugin({ appendTransaction(transactions, _old, state) {
        const mode = window.databaseReentrantMode
        if (!mode?.startsWith('cell') || !transactions.some(tr => tr.docChanged)) return null
        window.databaseReentrantMode = undefined
        const node = state.doc.nodeAt(0)
        const replacement = structuredClone(node.attrs.data)
        if (mode !== 'cell-clone') replacement.records[0].values[replacement.fields[0].id] = '替换值'
        return state.tr.setNodeMarkup(0, undefined, { ...node.attrs, data: replacement })
      } }))
      window.databaseReentrantEditor = controller
    `,
    });
    const root = page.locator("#database-reentrant .semlo-editor-database");
    const input = root.locator('input[aria-label$=" 行 文本"]').first();
    await input.focus();
    await page.evaluate((mode) => {
      const input = document.querySelector<HTMLInputElement>('#database-reentrant input[aria-label$=" 行 文本"]')!;
      Reflect.set(window, "databaseOldInput", input);
      window.databaseReentrantMode = mode;
      input.value = "草稿";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, mode);
    await expect(input).toHaveValue(mode === "cell" ? "替换值" : "草稿");
    const before = await page.evaluate(
      () => window.__semloRequireFixture("databaseReentrantEditor").getSnapshot().json,
    );
    const after = await page.evaluate(() => {
      const old = Reflect.get(window, "databaseOldInput") as HTMLInputElement;
      old.value = "过期草稿";
      old.dispatchEvent(new Event("input", { bubbles: true }));
      old.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
      return window.__semloRequireFixture("databaseReentrantEditor").getSnapshot().json;
    });
    expect(after).toEqual(before);
  });
}
