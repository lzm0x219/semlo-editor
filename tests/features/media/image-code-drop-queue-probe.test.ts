import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("two dropped images keep the code block intact and both upload anchors survive", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js';
    const host=document.createElement('div');host.id='code-drop';document.body.append(host);
    window.pending=[];window.calls=[];
    window.c=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'javascript'},content:[{type:'text',text:'hello world'}]}]},uploadImage:file=>{window.calls.push(file.name);return new Promise(resolve=>window.pending.push(resolve))}});
    const editor=window.c.editor;editor.commands.setTextSelection(6);
    const transfer=new DataTransfer();transfer.items.add(new File(['a'],'one.png',{type:'image/png'}));transfer.items.add(new File(['b'],'two.png',{type:'image/png'}));
    const rect=editor.view.dom.querySelector('code').getBoundingClientRect();
    editor.view.dom.dispatchEvent(new DragEvent('drop',{dataTransfer:transfer,clientX:rect.left+10,clientY:rect.top+5,bubbles:true,cancelable:true}));
  `,
  });
  await page.waitForFunction(() => (window as any).pending?.length === 1);
  await page.evaluate(() => (window as any).pending[0]("/tests/sample-image.svg?one"));
  await page.waitForFunction(() => (window as any).pending?.length === 2);
  await page.evaluate(() => (window as any).pending[1]("/tests/sample-image.svg?two"));
  const host = page.locator("#code-drop");
  await expect(host.locator('img[src*="one"]')).toHaveCount(1);
  await expect(host.locator('img[src*="two"]')).toHaveCount(1);
  await expect(host.locator(".semlo-editor-code-card")).toHaveCount(1);
  await expect(host.locator(".semlo-editor-code-card")).toContainText("hello world");
  expect(await page.evaluate(() => (window as any).calls)).toEqual(["one.png", "two.png"]);
});
