import { expect, test } from "@rstest/playwright";

import { openFontToolbar } from "../../fixtures/browser/font-toolbar";

test("font menu closes when a plugin appends a document change", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'font-appended-test'
      document.body.append(host)
      const controller = createEditor({ element: host, outline: false, content: '<p>旧文档</p>' })
      window.fontAppendedEditor = controller
      const editor = controller.editor
      const Plugin = editor.state.plugins[0].constructor
      editor.registerPlugin(new Plugin({
        appendTransaction(transactions, _oldState, state) {
          if (!transactions.some(transaction => transaction.getMeta('font-replace-test'))) return null
          return state.tr.replaceWith(0, state.doc.content.size, state.schema.nodes.paragraph.create(null, state.schema.text('新文档')))
        },
      }))
    `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "fontAppendedEditor")));
  const host = page.locator("#font-appended-test");
  await openFontToolbar(host);
  const menu = page.getByRole("dialog", { name: "选择字体" });
  await expect(menu).toBeVisible();
  await page.evaluate(() => {
    const editor = Reflect.get(window, "fontAppendedEditor").editor;
    editor.view.dispatch(editor.state.tr.setMeta("font-no-change-test", true));
  });
  await expect(menu).toBeVisible();
  await page.evaluate(() => {
    const editor = Reflect.get(window, "fontAppendedEditor").editor;
    editor.view.dispatch(editor.state.tr.setMeta("font-replace-test", true));
  });
  await expect(host.locator(".semlo-editor-prose")).toHaveText("新文档");
  await expect(menu).toHaveCount(0);
  await page.evaluate(() => Reflect.get(window, "fontAppendedEditor").destroy());
});
