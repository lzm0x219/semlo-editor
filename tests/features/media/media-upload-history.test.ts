import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    uploadUndoProbe: { controller: EditorController; pending: Array<{ name: string; resolve: (url: string) => void }> };
  }
}
for (const layout of ["paragraph", "codeBlock"] as const) {
  for (const grouping of ["separate", "same-selection"] as const) {
    test(`${layout}: ${grouping} upload history`, async ({ page }) => {
      await installFixtureGuards(page);
      await page.goto(process.env.SEMLO_TEST_ORIGIN!);
      await page.addScriptTag({
        type: "module",
        content: `
        import { createEditor } from '/dist/index.js';
        const host=document.createElement('div');host.id='undo-probe';document.body.append(host);
        const pending=[]; const controller=createEditor({element:host,outline:false,
          content:{type:'doc',content:[{type:${JSON.stringify(layout)},content:[{type:'text',text:'hello world'}]}]},
          uploadAttachment:file=>new Promise(resolve=>pending.push({name:file.name,resolve}))});
        window.uploadUndoProbe={controller,pending};
      `,
      });
      await page.waitForFunction(() => Boolean(window.uploadUndoProbe));
      const host = page.locator("#undo-probe");
      const first = { name: "first.txt", mimeType: "text/plain", buffer: Buffer.from("1") };
      const second = { name: "second.txt", mimeType: "text/plain", buffer: Buffer.from("2") };
      async function choose(files: typeof first | Array<typeof first>) {
        await page.evaluate(() => {
          const editor = window.uploadUndoProbe.controller.editor;
          editor.commands.setTextSelection(6);
          editor.commands.focus();
        });
        await host.getByRole("button", { name: "插入内容" }).click();
        const chooserPromise = page.waitForEvent("filechooser");
        await page
          .getByRole("dialog", { name: "插入内容" })
          .locator('.semlo-editor-card-item[data-command="attachment"]')
          .click();
        await (await chooserPromise).setFiles(files);
      }
      if (grouping === "separate") {
        await choose(first);
        await choose(second);
        await page.waitForFunction(() => window.uploadUndoProbe.pending.length === 2);
        await page.evaluate(() => {
          window.uploadUndoProbe.pending[0].resolve("/files/first.txt");
          window.uploadUndoProbe.pending[1].resolve("/files/second.txt");
        });
      } else {
        await choose([first, second]);
        await page.waitForFunction(() => window.uploadUndoProbe.pending.length === 1);
        await page.evaluate(() => window.uploadUndoProbe.pending[0].resolve("/files/first.txt"));
        await page.waitForFunction(() => window.uploadUndoProbe.pending.length === 2);
        await page.evaluate(() => window.uploadUndoProbe.pending[1].resolve("/files/second.txt"));
      }
      await host.locator("a[data-semlo-editor-attachment]").nth(1).waitFor();
      await page.evaluate(() => window.uploadUndoProbe.controller.editor.commands.undo());
      const names = await host.locator("a[data-semlo-editor-attachment]").allTextContents();
      console.log("UNDO_GROUP", layout, grouping, JSON.stringify(names));
      expect(names.length).toBe(grouping === "separate" ? 1 : 0);
      await page.evaluate(() => window.uploadUndoProbe.controller.editor.commands.redo());
      await expect(host.locator("a[data-semlo-editor-attachment]")).toHaveCount(2);
      await page.evaluate(() => window.uploadUndoProbe.controller.destroy());
    });
  }
}

test("interleaved upload batches do not merge each other's undo steps", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js';
    const host=document.createElement('div');host.id='undo-probe';document.body.append(host);
    const pending=[]; const controller=createEditor({element:host,outline:false,content:'<p>hello world</p>',
      uploadAttachment:file=>new Promise(resolve=>pending.push({name:file.name,resolve}))});
    window.uploadUndoProbe={controller,pending};
  `,
  });
  await page.waitForFunction(() => Boolean(window.uploadUndoProbe));
  const host = page.locator("#undo-probe");
  const input = host.locator('input[type="file"][multiple]');
  await page.evaluate(() => window.uploadUndoProbe.controller.editor.commands.setTextSelection(6));
  await input.setInputFiles([
    { name: "a1.txt", mimeType: "text/plain", buffer: Buffer.from("1") },
    { name: "a2.txt", mimeType: "text/plain", buffer: Buffer.from("2") },
  ]);
  await input.setInputFiles({ name: "b1.txt", mimeType: "text/plain", buffer: Buffer.from("b") });
  await page.waitForFunction(() => window.uploadUndoProbe.pending.length === 2);
  await page.evaluate(() =>
    window.uploadUndoProbe.pending.find((item) => item.name === "a1.txt")!.resolve("/files/a1.txt"),
  );
  await page.waitForFunction(() => window.uploadUndoProbe.pending.length === 3);
  await page.evaluate(() =>
    window.uploadUndoProbe.pending.find((item) => item.name === "b1.txt")!.resolve("/files/b1.txt"),
  );
  await expect(host.locator("a[data-semlo-editor-attachment]", { hasText: "b1.txt" })).toHaveCount(1);
  await page.evaluate(() =>
    window.uploadUndoProbe.pending.find((item) => item.name === "a2.txt")!.resolve("/files/a2.txt"),
  );
  await expect(host.locator("a[data-semlo-editor-attachment]")).toHaveCount(3);
  await page.evaluate(() => window.uploadUndoProbe.controller.editor.commands.undo());
  await expect(host.locator("a[data-semlo-editor-attachment]", { hasText: "a2.txt" })).toHaveCount(0);
  await expect(host.locator("a[data-semlo-editor-attachment]", { hasText: "b1.txt" })).toHaveCount(1);
  await expect(host.locator("a[data-semlo-editor-attachment]", { hasText: "a1.txt" })).toHaveCount(1);
  await page.evaluate(() => window.uploadUndoProbe.controller.editor.commands.redo());
  await expect(host.locator("a[data-semlo-editor-attachment]")).toHaveCount(3);
  await page.evaluate(() => window.uploadUndoProbe.controller.destroy());
});

test("typing between uploads is not lost when undoing the later upload", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js';
    const host=document.createElement('div');host.id='undo-probe';document.body.append(host);
    const pending=[]; const controller=createEditor({element:host,outline:false,content:'<p>hello world</p>',
      uploadAttachment:file=>new Promise(resolve=>pending.push({name:file.name,resolve}))});
    window.uploadUndoProbe={controller,pending};
  `,
  });
  await page.waitForFunction(() => Boolean(window.uploadUndoProbe));
  const host = page.locator("#undo-probe");
  const input = host.locator('input[type="file"][multiple]');
  await page.evaluate(() => window.uploadUndoProbe.controller.editor.commands.setTextSelection(6));
  await input.setInputFiles([
    { name: "a1.txt", mimeType: "text/plain", buffer: Buffer.from("1") },
    { name: "a2.txt", mimeType: "text/plain", buffer: Buffer.from("2") },
  ]);
  await page.waitForFunction(() => window.uploadUndoProbe.pending.length === 1);
  await page.evaluate(() => window.uploadUndoProbe.pending[0].resolve("/files/a1.txt"));
  await expect(host.locator("a[data-semlo-editor-attachment]", { hasText: "a1.txt" })).toHaveCount(1);
  await page.waitForFunction(() => window.uploadUndoProbe.pending.length === 2);
  await page.evaluate(() => {
    const editor = window.uploadUndoProbe.controller.editor;
    let end = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorAttachment") end = pos + node.nodeSize;
    });
    editor.commands.setTextSelection(end);
    editor.commands.focus();
  });
  await host.locator(".tiptap, .ProseMirror").first().focus();
  await expect(host.locator(".tiptap, .ProseMirror").first()).toBeFocused();
  await page.keyboard.type("X");
  await expect(host.locator(".tiptap, .ProseMirror").first()).toContainText("X");
  await page.evaluate(() => window.uploadUndoProbe.pending[1].resolve("/files/a2.txt"));
  await expect(host.locator("a[data-semlo-editor-attachment]", { hasText: "a2.txt" })).toHaveCount(1);
  await page.evaluate(() => window.uploadUndoProbe.controller.editor.commands.undo());
  console.log(
    "TYPING_UNDO_DOC",
    JSON.stringify(await page.evaluate(() => window.uploadUndoProbe.controller.getSnapshot().json)),
  );
  await expect(host.locator("a[data-semlo-editor-attachment]", { hasText: "a2.txt" })).toHaveCount(0);
  await expect(host.locator("a[data-semlo-editor-attachment]", { hasText: "a1.txt" })).toHaveCount(1);
  await expect(host.locator(".tiptap, .ProseMirror").first()).toContainText("X");
  await page.evaluate(() => window.uploadUndoProbe.controller.editor.commands.undo());
  await expect(host.locator(".tiptap, .ProseMirror").first()).not.toContainText("X");
  await expect(host.locator("a[data-semlo-editor-attachment]", { hasText: "a1.txt" })).toHaveCount(1);
  await page.evaluate(() => window.uploadUndoProbe.controller.destroy());
});
