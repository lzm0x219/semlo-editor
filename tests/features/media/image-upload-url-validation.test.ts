import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
declare global {
  interface Window {
    urlProbeErrors: string[];
    urlProbeCalls: number;
    urlQueueErrors: string[];
    urlQueueCalls: string[];
    urlQueueController: EditorController;
  }
}
const cases = [
  { name: "root backslash authority", url: "/\\example.invalid/p.png", valid: false },
  { name: "protocol-relative", url: "//example.invalid/p.png", valid: false },
  { name: "script", url: "javascript:alert(1)", valid: false },
  { name: "control character", url: "/foo\nbar.png", valid: false },
  { name: "oversized", url: "/" + "a".repeat(4097), valid: false },
  { name: "root path", url: "/tests/sample-image.svg", valid: true },
  { name: "https", url: "https://example.invalid/p.png", valid: true },
  { name: "blob", url: "blob:https://example.invalid/00000000-0000-4000-8000-000000000000", valid: true },
] as const;
for (const item of cases)
  test(`image upload URL ${item.name}`, async ({ page }) => {
    const external: string[] = [];
    await page.route("**://example.invalid/**", async (route) => {
      external.push(route.request().url());
      await route.abort();
    });
    await installFixtureGuards(page);
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
  import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='url-probe';document.body.prepend(host)
  window.urlProbeErrors=[];window.urlProbeCalls=0
  const controller=createEditor({element:host,outline:false,content:'<p>原文</p>',uploadImage:async()=>{window.urlProbeCalls++;return ${JSON.stringify(item.url)}},onError:error=>window.urlProbeErrors.push(error.message)})
  controller.editor.commands.setTextSelection(2)
  const transfer=new DataTransfer();transfer.items.add(new File(['x'],'p.png',{type:'image/png'}))
  controller.editor.view.dom.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}))
 `,
    });
    await expect.poll(() => page.evaluate(() => window.urlProbeCalls)).toBe(1);
    if (item.valid) await expect(page.locator("#url-probe .semlo-editor-image-node")).toHaveCount(1);
    else {
      await expect.poll(() => page.evaluate(() => window.urlProbeErrors.length)).toBe(1);
      await expect(page.locator("#url-probe .semlo-editor-image-node")).toHaveCount(0);
      expect(external).toEqual([]);
    }
  });

test("invalid first upload reports failure and the next file still inserts", async ({ page }) => {
  const external: string[] = [];
  await page.route("**://example.invalid/**", async (route) => {
    external.push(route.request().url());
    await route.abort();
  });
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
  import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='queue-probe';document.body.prepend(host)
  window.urlQueueErrors=[];window.urlQueueCalls=[]
  const controller=createEditor({element:host,outline:false,content:'<p>原文</p>',uploadImage:async file=>{window.urlQueueCalls.push(file.name);return file.name==='bad.png'?${JSON.stringify("/\\example.invalid/p.png")}:'/tests/sample-image.svg'},onError:error=>window.urlQueueErrors.push(error.message)})
  window.urlQueueController=controller;controller.editor.commands.setTextSelection(2)
  const transfer=new DataTransfer();transfer.items.add(new File(['x'],'bad.png',{type:'image/png'}));transfer.items.add(new File(['y'],'good.png',{type:'image/png'}))
  controller.editor.view.dom.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}))
 `,
  });
  await expect.poll(() => page.evaluate(() => window.urlQueueCalls.length)).toBe(2);
  await expect(page.locator("#queue-probe .semlo-editor-image-node")).toHaveCount(1);
  expect(await page.evaluate(() => window.urlQueueErrors)).toEqual(["上传成功，但返回的图片地址无效"]);
  expect(await page.evaluate(() => window.urlQueueCalls)).toEqual(["bad.png", "good.png"]);
  const content = await page.evaluate(() => window.urlQueueController.getSnapshot().json.content?.[0]?.content ?? []);
  expect(content.find((node) => node.type === "image")?.attrs?.src).toBe("/tests/sample-image.svg");
  expect(external).toEqual([]);
});
