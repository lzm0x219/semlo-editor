import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
declare global {
  interface Window {
    remountQueueCalls: string[];
    remountQueueResolves: Array<(url: string) => void>;
    remountQueueFirst: EditorController;
    remountQueueOther: EditorController;
    remountQueueTarget: HTMLElement;
  }
}
test("two-file upload queue remounts into another document without affecting a second editor", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
 import {createEditor} from '/dist/index.js'
 const a=document.createElement('div');a.id='remount-queue-a';document.body.append(a);const b=document.createElement('div');b.id='remount-queue-b';document.body.append(b)
 window.remountQueueCalls=[];window.remountQueueResolves=[]
 window.remountQueueFirst=createEditor({element:a,outline:false,content:'<p>原文</p>',uploadImage:file=>{window.remountQueueCalls.push(file.name);return new Promise(resolve=>window.remountQueueResolves.push(resolve))}})
 window.remountQueueOther=createEditor({element:b,outline:false,content:'<p>独立实例</p>'})
 const editor=window.remountQueueFirst.editor;editor.commands.setTextSelection(2);const transfer=new DataTransfer();transfer.items.add(new File(['a'],'one.png',{type:'image/png'}));transfer.items.add(new File(['b'],'two.png',{type:'image/png'}));editor.view.dom.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}))
 `,
  });
  await page.waitForFunction(() => window.remountQueueResolves?.length === 1);
  const result = await page.evaluate(() => {
    const controller = window.remountQueueFirst;
    controller.editor.unmount();
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const target = frame.contentDocument!.createElement("div");
    frame.contentDocument!.body.append(target);
    controller.editor.mount(target);
    window.remountQueueTarget = target;
    const widgets = [...target.querySelectorAll(".semlo-editor-uploading")];
    return { count: widgets.length, owner: widgets.every((widget) => widget.ownerDocument === frame.contentDocument) };
  });
  expect(result).toEqual({ count: 2, owner: true });
  await page.evaluate(() => {
    window.remountQueueOther.setContent("<p>另一个文档更新</p>");
    window.remountQueueResolves[0]("/tests/sample-image.svg?one");
  });
  await page.waitForFunction(() => window.remountQueueResolves?.length === 2);
  await page.evaluate(() => window.remountQueueResolves[1]("/tests/sample-image.svg?two"));
  await expect
    .poll(() => page.evaluate(() => window.remountQueueTarget.querySelectorAll(".semlo-editor-image-node").length))
    .toBe(2);
  expect(await page.evaluate(() => window.remountQueueCalls)).toEqual(["one.png", "two.png"]);
  expect(await page.evaluate(() => window.remountQueueTarget.querySelectorAll(".semlo-editor-uploading").length)).toBe(
    0,
  );
  await expect(page.locator("#remount-queue-b .semlo-editor-prose")).toHaveText("另一个文档更新");
  expect(errors).toEqual([]);
});
