import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    multiCalls?: string[];
    multiResolve?: Array<(url: string) => void>;
    multiAdds?: number;
    multiReady?: boolean;
    multiController?: EditorController;
    multiGalleryReady?: boolean;
    multiGalleryResolvers?: Array<(url: string) => void>;
  }
}

for (const mode of ["normal", "equal", "replace", "clear", "readonly", "destroy"] as const) {
  test(`multi-image upload handles ${mode} synchronously during placeholder transaction`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installFixtureGuards(page);
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor, Plugin } from '/dist/index.js'
      const host=document.createElement('div');host.id='multi-image';document.body.prepend(host)
      window.multiCalls=[];window.multiResolve=[];window.multiAdds=0
      const controller=createEditor({element:host,outline:false,content:'<p>原文</p>',uploadImage:file=>{window.multiCalls.push(file.name);return new Promise(resolve=>window.multiResolve.push(resolve))}})
      const editor=controller.editor
      if ('${mode}' === 'equal') editor.registerPlugin(new Plugin({appendTransaction(transactions,_old,state){
        if (!transactions.some(tr=>Object.entries(tr.meta).some(([key,value])=>key.startsWith('semlo-editor-image-upload') && value?.add)))return null
        return state.tr.replaceWith(0,state.doc.content.size,state.doc.content)
      }}))
      let once=false
      editor.on('transaction',({transaction})=>{
        const add=Object.entries(transaction.meta).find(([key])=>key.startsWith('semlo-editor-image-upload'))?.[1]?.add
        if (!add)return
        window.multiAdds++
        if (once)return;once=true
        if ('${mode}'==='replace') controller.setContent('<p>新文档</p>')
        if ('${mode}'==='clear') {controller.setEditable(false);controller.setEditable(true)}
        if ('${mode}'==='readonly') controller.setEditable(false)
        if ('${mode}'==='destroy') controller.destroy()
      })
      editor.commands.setTextSelection(2)
      const transfer=new DataTransfer()
      transfer.items.add(new File(['a'],'one.png',{type:'image/png'}))
      transfer.items.add(new File(['b'],'two.png',{type:'image/png'}))
      editor.view.dom.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}))
      window.multiController=controller;window.multiReady=true
    `,
    });
    await page.waitForFunction(() => window.multiReady);
    if (mode !== "replace") expect(await page.evaluate(() => window.__semloRequireFixture("multiAdds"))).toBe(1);
    if (mode === "replace" || mode === "clear" || mode === "readonly" || mode === "destroy") {
      await page.waitForTimeout(50);
      expect(await page.evaluate(() => window.__semloRequireFixture("multiCalls"))).toEqual([]);
      expect(errors).toEqual([]);
      if (mode !== "destroy") await expect(page.locator("#multi-image .semlo-editor-uploading")).toHaveCount(0);
      return;
    }
    await expect(page.locator("#multi-image .semlo-editor-uploading")).toHaveCount(2);
    expect(await page.evaluate(() => window.__semloRequireFixture("multiCalls"))).toEqual(["one.png"]);
    await page.evaluate(() => window.__semloRequireFixture("multiResolve")[0]("/one.png"));
    await page.waitForFunction(() => window.multiCalls?.length === 2);
    await page.evaluate(() => window.__semloRequireFixture("multiResolve")[1]("/two.png"));
    await expect(page.locator("#multi-image .semlo-editor-image-node")).toHaveCount(2);
    const content = await page.evaluate(
      () => window.__semloRequireFixture("multiController").getSnapshot().json.content?.[0]?.content ?? [],
    );
    expect(content.filter((node) => node.type === "image").map((node) => node.attrs?.src)).toEqual([
      "/one.png",
      "/two.png",
    ]);
    expect(await page.evaluate(() => window.__semloRequireFixture("multiController").editor.commands.undo())).toBe(
      true,
    );
    expect(await page.locator("#multi-image .semlo-editor-image-node").count()).toBeLessThan(2);
    expect(await page.evaluate(() => window.__semloRequireFixture("multiController").editor.commands.redo())).toBe(
      true,
    );
    await expect(page.locator("#multi-image .semlo-editor-image-node")).toHaveCount(2);
    expect(errors).toEqual([]);
  });
}

test("gallery multi-file results cannot escape synchronous document replacement after first success", async ({
  page,
}) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'reentry-gallery'; document.body.prepend(host)
    window.multiGalleryResolvers = []
    const doc = {type:'doc',content:[{type:'semloEditorGallery',attrs:{data:{id:'gallery',layout:'grid',images:[{id:'one',src:'/tests/sample-image.svg',title:'',href:''}]}}},{type:'paragraph'}]}
    const controller = createEditor({element:host,outline:false,content:doc,uploadImage:file=>{return new Promise(resolve=>window.multiGalleryResolvers.push(resolve))}})
    let once = false
    controller.editor.on('update', () => { if (!once) {once=true;controller.setContent({type:'doc',content:[{type:'semloEditorGallery',attrs:{data:{id:'gallery',layout:'grid',images:[{id:'new',src:'/tests/sample-image.svg',title:'新文档',href:''}]}}},{type:'paragraph'}]})} })
    window.multiGalleryReady = true
  `,
  });
  await page.waitForFunction(() => window.multiGalleryReady);
  await page.locator('#reentry-gallery input[aria-label="选择图册图片"]').setInputFiles([
    { name: "one.png", mimeType: "image/png", buffer: Buffer.from("a") },
    { name: "two.png", mimeType: "image/png", buffer: Buffer.from("b") },
  ]);
  await page.waitForFunction(() => window.multiGalleryResolvers?.length === 2);
  await page.evaluate(async () => {
    window.__semloRequireFixture("multiGalleryResolvers")[0]("/tests/sample-image.svg?first");
    await new Promise((r) => setTimeout(r, 0));
    window.__semloRequireFixture("multiGalleryResolvers")[1]("/tests/sample-image.svg?second");
    await new Promise((r) => setTimeout(r, 0));
  });
  await expect(page.locator("#reentry-gallery .semlo-editor-gallery-surface img")).toHaveCount(1);
  expect(
    await page.locator("#reentry-gallery .semlo-editor-gallery-surface img").first().getAttribute("src"),
  ).not.toContain("second");
});
