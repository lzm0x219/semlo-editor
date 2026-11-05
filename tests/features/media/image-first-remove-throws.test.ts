import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("a failed image removal does not leave the failed batch uploading forever", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host=document.createElement('div');host.id='image-first-remove';document.body.append(host)
    window.firstRemoveErrors=[];window.firstRemoveReports=[];window.firstRemoveCalls=[];window.blockFirstRemove=true
    window.addEventListener('unhandledrejection', e => {window.firstRemoveErrors.push(e.reason?.message);e.preventDefault()})
    const c=createEditor({element:host,outline:false,content:'<p>原文</p>',uploadImage:file=>{window.firstRemoveCalls.push(file.name);return new Promise((resolve,reject)=>{if(file.name==='one.png')window.firstRemoveReject=reject;else window.firstRemoveOtherResolve=resolve})},onError:error=>window.firstRemoveReports.push(error.message)})
    c.editor.on('beforeTransaction',({transaction})=>{if(window.blockFirstRemove && transaction.getMeta('semlo-editor-image-upload$')?.remove){window.blockFirstRemove=false;throw new Error('remove blocked')}})
    function paste(names){const data=new DataTransfer();for(const name of names)data.items.add(new File(['a'],name,{type:'image/png'}));c.editor.view.dom.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))}
    c.editor.commands.setTextSelection(2);paste(['one.png','two.png']);paste(['other.png']);window.firstRemoveController=c
  `,
  });
  await page.waitForFunction(() =>
    Boolean((window as any).firstRemoveReject && (window as any).firstRemoveOtherResolve),
  );
  await page.evaluate(() => (window as any).firstRemoveReject(new Error("upload failed")));
  await expect.poll(() => page.evaluate(() => (window as any).firstRemoveErrors)).toContain("remove blocked");
  expect(await page.evaluate(() => (window as any).firstRemoveCalls)).toEqual(["one.png", "other.png"]);
  await expect.poll(() => page.locator(".semlo-editor-uploading").count()).toBe(1);
  await page.evaluate(() => (window as any).firstRemoveOtherResolve("/tests/sample-image.svg?other"));
  await expect.poll(() => page.locator(".semlo-editor-uploading").count()).toBe(0);
  await expect(page.locator('img[src*="other"]')).toHaveCount(1);
});
