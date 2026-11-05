import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

for (const mode of ["mounted", "unmount", "destroy", "cleanup-throws", "cleanup-unmounted"] as const) {
  test(`image host onError throws: ${mode}`, async ({ page }) => {
    await installFixtureGuards(page);
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor, Plugin, PluginKey } from '/dist/index.js'
      const host = document.createElement('div'); host.id = 'image-error-queue'; document.body.append(host)
      window.errorCalls = []; window.errorReject = null; window.errorOtherResolve = null; window.hostFailures = []
      window.addEventListener('unhandledrejection', event => { window.hostFailures.push({ message:event.reason?.message, errors:event.reason instanceof AggregateError ? event.reason.errors.map(error=>error?.message) : [] }); event.preventDefault() })
      const controller = createEditor({ element: host, outline: false, content: '<p>原文</p>',
        uploadImage: file => { window.errorCalls.push(file.name); return new Promise((resolve, reject) => {
          if (file.name === 'one.png') window.errorReject = reject
          else if (file.name === 'other.png') window.errorOtherResolve = resolve
        }) },
        onError: () => { if ((window.errorMode === 'unmount' || window.errorMode === 'cleanup-unmounted')) controller.editor.unmount(); if (window.errorMode === 'destroy') controller.destroy(); throw new Error('host onError failure') } })
      window.errorController = controller; const probeKey = new PluginKey('filter-probe'); controller.editor.registerPlugin(new Plugin({key:probeKey,appendTransaction(transactions,_old,state) {if(!transactions.some(tr=>tr.getMeta(probeKey)))return null;return state.tr.replaceWith(0,state.doc.content.size,state.doc.content)}})); window.runNetEqual = () => controller.editor.view.dispatch(controller.editor.state.tr.setMeta(probeKey,true)); controller.editor.on('beforeTransaction', ({transaction}) => { if ((window.errorMode === 'cleanup-throws' || window.errorMode === 'cleanup-unmounted') && transaction.getMeta('semlo-editor-image-upload$')?.removeMany) throw new Error('cleanup failed') }); controller.editor.commands.setTextSelection(2)
      function paste(names) { const data = new DataTransfer(); for (const name of names) data.items.add(new File(['a'],name,{type:'image/png'})); controller.editor.view.dom.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true})) }
      paste(['one.png','two.png']); paste(['other.png'])
    `,
    });
    await page.waitForFunction(() => Boolean((window as any).errorReject && (window as any).errorOtherResolve));
    await page.evaluate((scenario) => {
      (window as any).errorMode = scenario;
      (window as any).errorReject(new Error("upload failed"));
    }, mode);
    await expect.poll(() => page.evaluate(() => (window as any).hostFailures.length)).toBe(1);
    const failure = await page.evaluate(() => (window as any).hostFailures[0]);
    if (mode === "cleanup-throws" || mode === "cleanup-unmounted") {
      expect(failure.errors).toEqual(["host onError failure", "cleanup failed"]);
      const pending = () =>
        page.evaluate(() => {
          const c = (window as any).errorController;
          const plugin = c.editor.state.plugins.find((p: any) => p.key.startsWith("semlo-editor-image-upload$"));
          return plugin
            .getState(c.editor.state)
            .find()
            .map((d: any) => d.spec.name);
        });
      expect(await pending()).toContain("two.png");
      if (mode === "cleanup-unmounted")
        await page.evaluate(() => {
          const target = document.createElement("div");
          document.body.append(target);
          (window as any).errorController.editor.mount(target);
        });
      await expect.poll(() => page.locator(".semlo-editor-uploading").count()).toBe(1);
      await page.evaluate(() => (window as any).runNetEqual());
      expect(await pending()).not.toContain("two.png");
      await expect.poll(() => page.locator(".semlo-editor-uploading").count()).toBe(1);
      await page.evaluate(() => (window as any).errorOtherResolve("/tests/sample-image.svg?other"));
      await expect.poll(() => page.locator(".semlo-editor-uploading").count()).toBe(0);
      await expect(page.locator('img[src*="other"]')).toHaveCount(1);
      return;
    }
    expect(failure).toEqual({ message: "host onError failure", errors: [] });
    expect(await page.evaluate(() => (window as any).errorCalls)).toEqual(["one.png", "other.png"]);
    if (mode === "destroy") return;
    if (mode === "unmount")
      await page.evaluate(() => {
        const target = document.createElement("div");
        target.id = "remounted";
        document.body.append(target);
        (window as any).errorController.editor.mount(target);
      });
    await expect.poll(() => page.locator(".semlo-editor-uploading").count()).toBe(1);
    await page.evaluate(() => (window as any).errorOtherResolve("/tests/sample-image.svg?other"));
    await expect.poll(() => page.locator(".semlo-editor-uploading").count()).toBe(0);
    await expect(page.locator('img[src*="other"]')).toHaveCount(1);
  });
}

test("an onError handler can start a separate image batch before throwing", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='new-batch';document.body.append(host)
    window.batchCalls=[];window.batchFailures=[];window.batchResolvers={};window.batchReject=null
    window.addEventListener('unhandledrejection',event=>{window.batchFailures.push(event.reason?.message);event.preventDefault()})
    const c=createEditor({element:host,outline:false,content:'<p>原文</p>',uploadImage:file=>{window.batchCalls.push(file.name);return new Promise((resolve,reject)=>{if(file.name==='one.png')window.batchReject=reject;else window.batchResolvers[file.name]=resolve})},onError:()=>{paste(['new.png']);throw new Error('host error')}})
    function paste(names){const data=new DataTransfer();for(const name of names)data.items.add(new File(['a'],name,{type:'image/png'}));c.editor.view.dom.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))}
    c.editor.commands.setTextSelection(2);paste(['one.png','two.png'])
  `,
  });
  await page.waitForFunction(() => Boolean((window as any).batchReject));
  await page.evaluate(() => (window as any).batchReject(new Error("upload failed")));
  await expect.poll(() => page.evaluate(() => (window as any).batchFailures)).toEqual(["host error"]);
  expect(await page.evaluate(() => (window as any).batchCalls)).toEqual(["one.png", "new.png"]);
  await expect.poll(() => page.locator(".semlo-editor-uploading").count()).toBe(1);
  await page.evaluate(() => (window as any).batchResolvers["new.png"]("/tests/sample-image.svg?new"));
  await expect.poll(() => page.locator(".semlo-editor-uploading").count()).toBe(0);
  await expect(page.locator('img[src*="new"]')).toHaveCount(1);
});
