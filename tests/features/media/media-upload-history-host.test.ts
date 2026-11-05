import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    historyHost: { controller: EditorController; pending: Array<{ resolve: (url: string) => void }>; trace: string[] };
  }
}

for (const mode of ["reject", "append", "destroy", "reenter"] as const) {
  test(`upload history handles host ${mode}`, async ({ page }) => {
    await installFixtureGuards(page);
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
      import {createEditor, Plugin} from '/dist/index.js';
      const host=document.createElement('div');host.id='host-probe';document.body.append(host);
      const pending=[],trace=[]; const mode=${JSON.stringify(mode)};
      const controller=createEditor({element:host,outline:false,content:'<p>hello world</p>',uploadAttachment:()=>new Promise(resolve=>pending.push({resolve}))});
      const editor=controller.editor;
      editor.registerPlugin(new Plugin({
        filterTransaction(tr) {if(tr.getMeta('host-reject')) {trace.push('reject:'+Boolean(tr.getMeta('closeHistory$')));return false} return true},
        appendTransaction(transactions, oldState, state) {
          if(mode==='append' && transactions.some(tr=>tr.getMeta('semlo-editor-attachment-upload$')?.remove) && !transactions.some(tr=>tr.getMeta('host-append'))) {
            trace.push('append');return state.tr.insertText('!',1).setMeta('host-append',true)
          }
        }
      }));
      editor.on('transaction', ({transaction}) => {
        if (!transaction.getMeta('semlo-editor-attachment-upload$')?.remove) return;
        if (mode==='destroy') {trace.push('destroy');controller.destroy()}
        if (mode==='reenter') {try {let end=-1;editor.state.doc.descendants((n,p)=>{if(n.type.name==='semloEditorAttachment')end=p+n.nodeSize});editor.commands.insertContentAt(end,'!');trace.push('reenter-ok')} catch(e){trace.push(e.name)}}
      });
      window.historyHost={controller,pending,trace};
    `,
    });
    await page.waitForFunction(() => Boolean(window.historyHost));
    const host = page.locator("#host-probe");
    await page.evaluate(() => window.historyHost.controller.editor.commands.setTextSelection(6));
    await host
      .locator('input[type="file"][multiple]')
      .setInputFiles({ name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("a") });
    await page.waitForFunction(() => window.historyHost.pending.length === 1);
    await page.evaluate(() => window.historyHost.pending[0].resolve("/files/a.txt"));
    if (mode === "destroy") {
      await page.waitForFunction(() => window.historyHost.trace.includes("destroy"));
      await expect(host.locator('[role="alert"]')).toHaveCount(0);
      return;
    }
    await expect(host.locator("a[data-semlo-editor-attachment]")).toHaveCount(1);
    if (mode === "reject") {
      const result = await page.evaluate(() => {
        const e = window.historyHost.controller.editor;
        const before = e.getJSON();
        e.view.dispatch(e.state.tr.insertText("Z", 1).setMeta("host-reject", true));
        return { before, after: e.getJSON() };
      });
      expect(result.after).toEqual(result.before);
      expect(await page.evaluate(() => window.historyHost.trace)).toContain("reject:true");
    }
    if (mode === "append") {
      expect(await page.evaluate(() => window.historyHost.trace)).toEqual(["append"]);
      await expect(host.locator(".ProseMirror")).toContainText("!");
    }
    if (mode === "reenter") {
      expect(await page.evaluate(() => window.historyHost.trace)).toEqual(["reenter-ok"]);
      await expect(host.locator(".ProseMirror")).toContainText("!");
    }
    await page.evaluate(() => {
      const e = window.historyHost.controller.editor;
      let end = -1;
      e.state.doc.descendants((n, p) => {
        if (n.type.name === "semloEditorAttachment") end = p + n.nodeSize;
      });
      e.commands.setTextSelection(end);
    });
    await host.locator(".ProseMirror").focus();
    await expect(host.locator(".ProseMirror")).toBeFocused();
    await page.keyboard.type("X");
    await expect(host.locator(".ProseMirror")).toContainText("X");
    await page.evaluate(() => window.historyHost.controller.editor.commands.undo());
    await expect(host.locator(".ProseMirror")).not.toContainText("X");
    await expect(host.locator("a[data-semlo-editor-attachment]")).toHaveCount(1);
    if (mode === "reenter") {
      if ((await host.locator(".ProseMirror").textContent())?.includes("!")) {
        await page.evaluate(() => window.historyHost.controller.editor.commands.undo());
        await expect(host.locator(".ProseMirror")).not.toContainText("!");
        await expect(host.locator("a[data-semlo-editor-attachment]")).toHaveCount(1);
      }
    }
    await page.evaluate(() => window.historyHost.controller.destroy());
  });
}

test("a host-rejected upload insertion must not leave a permanent uploading placeholder", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor,Plugin} from '/dist/index.js';
    const host=document.createElement('div');host.id='host-probe';document.body.append(host);
    const pending=[],trace=[];
    const controller=createEditor({element:host,outline:false,content:'<p>hello world</p>',uploadAttachment:()=>new Promise(resolve=>pending.push({resolve}))});
    let reject=true; controller.editor.registerPlugin(new Plugin({filterTransaction(tr) {if(reject && tr.docChanged && tr.getMeta('semlo-editor-attachment-upload$')?.remove){reject=false;trace.push('rejected');return false}return true}}));
    window.historyHost={controller,pending,trace};
  `,
  });
  await page.waitForFunction(() => Boolean(window.historyHost));
  const host = page.locator("#host-probe");
  await host.locator('input[type="file"][multiple]').setInputFiles([
    { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("a") },
    { name: "b.txt", mimeType: "text/plain", buffer: Buffer.from("b") },
  ]);
  await page.waitForFunction(() => window.historyHost.pending.length === 1);
  await page.evaluate(() => window.historyHost.pending[0].resolve("/files/a.txt"));
  await page.waitForFunction(() => window.historyHost.trace.includes("rejected"));
  await expect(host.locator('[role="alert"]')).toHaveText("附件插入被宿主拒绝");
  await page.waitForFunction(() => window.historyHost.pending.length === 2);
  await page.evaluate(() => window.historyHost.pending[1].resolve("/files/b.txt"));
  await expect(host.locator(".semlo-editor-uploading")).toHaveCount(0);
  await expect(host.locator("a[data-semlo-editor-attachment]")).toHaveText("b.txt");
  await page.evaluate(() => window.historyHost.controller.destroy());
});

test("a throwing host beforeTransaction does not leak an upload history marker", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js';
    const host=document.createElement('div');host.id='host-probe';document.body.append(host);
    const pending=[],trace=[]; const controller=createEditor({element:host,outline:false,content:'<p>hello world</p>',uploadAttachment:()=>new Promise(resolve=>pending.push({resolve}))});
    let shouldThrow=true;controller.editor.on('beforeTransaction',({transaction})=>{
      if(shouldThrow && transaction.docChanged && transaction.getMeta('semlo-editor-attachment-upload$')?.remove){shouldThrow=false;trace.push('thrown');throw new Error('host before error')}
    });
    window.historyHost={controller,pending,trace};
  `,
  });
  await page.waitForFunction(() => Boolean(window.historyHost));
  const host = page.locator("#host-probe");
  await host.locator('input[type="file"][multiple]').setInputFiles([
    { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("a") },
    { name: "b.txt", mimeType: "text/plain", buffer: Buffer.from("b") },
  ]);
  await page.waitForFunction(() => window.historyHost.pending.length === 1);
  await page.evaluate(() => window.historyHost.pending[0].resolve("/files/a.txt"));
  await page.waitForFunction(() => window.historyHost.trace.includes("thrown"));
  await expect(host.locator('[role="alert"]')).toHaveText("host before error");
  await page.waitForFunction(() => window.historyHost.pending.length === 2);
  await page.evaluate(() => window.historyHost.pending[1].resolve("/files/b.txt"));
  await expect(host.locator(".semlo-editor-uploading")).toHaveCount(0);
  await expect(host.locator("a[data-semlo-editor-attachment]")).toHaveText("b.txt");
  await page.evaluate(() => {
    const e = window.historyHost.controller.editor;
    let end = -1;
    e.state.doc.descendants((n, p) => {
      if (n.type.name === "semloEditorAttachment") end = p + n.nodeSize;
    });
    e.commands.setTextSelection(end);
  });
  await host.locator(".ProseMirror").focus();
  await expect(host.locator(".ProseMirror")).toBeFocused();
  await page.keyboard.type("X");
  await expect(host.locator(".ProseMirror")).toContainText("X");
  await page.evaluate(() => window.historyHost.controller.editor.commands.undo());
  await expect(host.locator(".ProseMirror")).not.toContainText("X");
  await expect(host.locator("a[data-semlo-editor-attachment]")).toHaveText("b.txt");
  await page.evaluate(() => window.historyHost.controller.destroy());
});
