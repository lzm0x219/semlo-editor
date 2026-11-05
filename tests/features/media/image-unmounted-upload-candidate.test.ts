import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    uController: EditorController;
    uOther: EditorController;
    uCalls: string[];
    uErrors: string[];
    uSyncCalls: number;
    uReady: boolean;
    uTarget: HTMLElement;
    uResolve: (url: string) => void;
    uResolves: Array<(url: string) => void> & Record<string, (url: string) => void>;
    uRejects: Array<(error: Error) => void> & Record<string, (error: Error) => void>;
    uBaseline: { mount: number; destroy: number };
    uWaiting: { mount: number; destroy: number };
    uCounts: () => { mount: number; destroy: number };
    uWaitMount: unknown;
    uWaitDestroy: unknown;
    uBaselineMount: unknown[];
    uBaselineDestroy: unknown[];
  }
}
for (const mode of ["resolve", "reject"] as const)
  for (const destination of ["same", "iframe"] as const)
    test(`image ${mode} while unmounted resumes in ${destination}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await installFixtureGuards(page);
      await page.goto(process.env.SEMLO_TEST_ORIGIN!);
      await page.addScriptTag({
        type: "module",
        content: `
 import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='unmounted-test';document.body.append(host);window.uErrors=[];window.uCalls=[];window.uResolves=[];window.uRejects=[]
 const controller=createEditor({element:host,outline:false,content:'<p>原文</p>',uploadImage:file=>{window.uCalls.push(file.name);return new Promise((resolve,reject)=>{window.uResolves.push(resolve);window.uRejects.push(reject)})},onError:error=>window.uErrors.push(error.message)});window.uController=controller
 controller.editor.commands.setTextSelection(2);const transfer=new DataTransfer();transfer.items.add(new File(['a'],'one.png',{type:'image/png'}));transfer.items.add(new File(['b'],'two.png',{type:'image/png'}));controller.editor.view.dom.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));window.uSyncCalls=window.uCalls.length
 `,
      });
      await page.waitForFunction(() => window.uSyncCalls !== undefined);
      expect(await page.evaluate(() => window.uSyncCalls)).toBe(1);
      await page.evaluate(async (kind) => {
        window.uController.editor.unmount();
        if (kind === "resolve") window.uResolves[0]("/tests/sample-image.svg?one");
        else window.uRejects[0](new Error("上传失败"));
        await new Promise((r) => setTimeout(r, 0));
      }, mode);
      expect(await page.evaluate(() => window.uCalls)).toEqual(["one.png"]);
      await page.evaluate((dest) => {
        let target;
        if (dest === "iframe") {
          const frame = document.createElement("iframe");
          document.body.append(frame);
          target = frame.contentDocument!.createElement("div");
          frame.contentDocument!.body.append(target);
        } else {
          target = document.createElement("div");
          document.body.append(target);
        }
        window.uTarget = target;
        window.uController.editor.mount(target);
      }, destination);
      await page.waitForFunction(() => window.uCalls.length === 2);
      if (mode === "reject") expect(await page.evaluate(() => window.uErrors)).toEqual(["上传失败"]);
      else expect(await page.evaluate(() => window.uErrors)).toEqual([]);
      await page.evaluate(() => window.uResolves[1]("/tests/sample-image.svg?two"));
      await expect
        .poll(() => page.evaluate(() => window.uTarget.querySelectorAll(".semlo-editor-uploading").length))
        .toBe(0);
      const images = await page.evaluate(() => {
        const urls: string[] = [];
        window.uController.editor.state.doc.descendants((node) => {
          if (node.type.name === "image") urls.push(node.attrs.src);
        });
        return urls;
      });
      expect(images).toEqual(
        mode === "resolve"
          ? ["/tests/sample-image.svg?one", "/tests/sample-image.svg?two"]
          : ["/tests/sample-image.svg?two"],
      );
      expect(errors).toEqual([]);
    });

for (const action of ["replace", "readonly", "destroy"] as const)
  test(`unmounted settled upload is cancelled by ${action}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installFixtureGuards(page);
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
 import {createEditor} from '/dist/index.js';const host=document.createElement('div');document.body.append(host);window.uErrors=[];window.uCalls=[]
 const c=createEditor({element:host,outline:false,content:'<p>原文</p>',uploadImage:file=>{window.uCalls.push(file.name);return new Promise(resolve=>window.uResolve=resolve)},onError:error=>window.uErrors.push(error.message)});window.uController=c
 c.editor.commands.setTextSelection(2);const transfer=new DataTransfer();transfer.items.add(new File(['a'],'one.png',{type:'image/png'}));transfer.items.add(new File(['b'],'two.png',{type:'image/png'}));c.editor.view.dom.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}))
 `,
    });
    await page.waitForFunction(() => Boolean(window.uResolve));
    const outcome = await page.evaluate(async (kind) => {
      const c = window.uController;
      c.editor.unmount();
      window.uResolve("/tests/sample-image.svg?one");
      await new Promise((r) => setTimeout(r, 0));
      if (kind === "destroy") {
        c.editor.destroy();
        await new Promise((r) => setTimeout(r, 0));
        return { calls: window.uCalls, errors: window.uErrors };
      }
      const target = document.createElement("div");
      document.body.append(target);
      c.editor.mount(target);
      window.uTarget = target;
      if (kind === "replace") c.setContent("<p>新文档</p>");
      else c.setEditable(false);
      await new Promise((r) => setTimeout(r, 0));
      return { calls: window.uCalls, errors: window.uErrors };
    }, action);
    expect(outcome.calls).toEqual(["one.png"]);
    expect(outcome.errors).toEqual([]);
    if (action !== "destroy")
      await expect
        .poll(() => page.evaluate(() => window.uTarget.querySelectorAll(".semlo-editor-uploading").length))
        .toBe(0);
    expect(errors).toEqual([]);
  });

test("a mount listener that immediately unmounts cannot discard the settled image", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
 import {createEditor} from '/dist/index.js';const host=document.createElement('div');document.body.append(host)
 const c=createEditor({element:host,outline:false,content:'<p>原文</p>',uploadImage:()=>new Promise(resolve=>window.uResolve=resolve)});window.uController=c
 c.editor.commands.setTextSelection(2);const transfer=new DataTransfer();transfer.items.add(new File(['a'],'one.png',{type:'image/png'}));c.editor.view.dom.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}))
 `,
  });
  await page.waitForFunction(() => Boolean(window.uResolve));
  await page.evaluate(async () => {
    const e = window.uController.editor;
    e.unmount();
    window.uResolve("/tests/sample-image.svg");
    await new Promise((r) => setTimeout(r, 0));
    const once = () => {
      e.off("mount", once);
      e.unmount();
    };
    e.on("mount", once);
    const first = document.createElement("div");
    document.body.append(first);
    e.mount(first);
    await new Promise((r) => setTimeout(r, 0));
    const second = document.createElement("div");
    document.body.append(second);
    window.uTarget = second;
    e.mount(second);
  });
  await expect
    .poll(() => page.evaluate(() => window.uTarget.querySelectorAll(".semlo-editor-image-node").length))
    .toBe(1);
  await expect
    .poll(() => page.evaluate(() => window.uTarget.querySelectorAll(".semlo-editor-uploading").length))
    .toBe(0);
});

test("unmount during first result update postpones the second queued upload", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
 import {createEditor} from '/dist/index.js';const host=document.createElement('div');document.body.append(host);window.uCalls=[];window.uResolves=[]
 const c=createEditor({element:host,outline:false,content:'<p>原文</p>',uploadImage:file=>{window.uCalls.push(file.name);return new Promise(resolve=>window.uResolves.push(resolve))}});window.uController=c
 c.editor.commands.setTextSelection(2);const transfer=new DataTransfer();for(const name of ['one.png','two.png'])transfer.items.add(new File(['a'],name,{type:'image/png'}));c.editor.view.dom.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}))
 let once=false;c.editor.on('update',()=>{if(!once){once=true;c.editor.unmount()}})
 `,
  });
  await page.waitForFunction(() => window.uResolves?.length === 1);
  await page.evaluate(async () => {
    window.uResolves[0]("/tests/sample-image.svg?one");
    await new Promise((r) => setTimeout(r, 0));
  });
  expect(await page.evaluate(() => window.uCalls)).toEqual(["one.png"]);
  await page.evaluate(() => {
    const target = document.createElement("div");
    document.body.append(target);
    window.uTarget = target;
    window.uController.editor.mount(target);
  });
  await page.waitForFunction(() => window.uResolves?.length === 2);
  await page.evaluate(() => window.uResolves[1]("/tests/sample-image.svg?two"));
  await expect
    .poll(() => page.evaluate(() => window.uTarget.querySelectorAll(".semlo-editor-image-node").length))
    .toBe(2);
  await expect
    .poll(() => page.evaluate(() => window.uTarget.querySelectorAll(".semlo-editor-uploading").length))
    .toBe(0);
});

test("synchronous destruction inside the first upload does not start another", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
 import {createEditor} from '/dist/index.js';const host=document.createElement('div');document.body.append(host);window.uCalls=[];window.uErrors=[]
 const c=createEditor({element:host,outline:false,content:'<p>原文</p>',uploadImage:file=>{window.uCalls.push(file.name);c.editor.destroy();return Promise.resolve('/tests/sample-image.svg')},onError:error=>window.uErrors.push(error.message)})
 c.editor.commands.setTextSelection(2);const transfer=new DataTransfer();for(const name of ['one.png','two.png'])transfer.items.add(new File(['a'],name,{type:'image/png'}));c.editor.view.dom.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));window.uReady=true
 `,
  });
  await page.waitForFunction(() => window.uReady);
  expect(await page.evaluate(() => window.uCalls)).toEqual(["one.png"]);
  expect(await page.evaluate(() => window.uErrors)).toEqual([]);
  expect(errors).toEqual([]);
});

test("independent concurrent upload batches both settle after iframe remount", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
 import {createEditor} from '/dist/index.js';const a=document.createElement('div');document.body.append(a);const b=document.createElement('div');b.id='batch-other';document.body.append(b);window.uErrors=[];window.uResolves={};window.uRejects={};window.uCalls=[]
 const c=createEditor({element:a,outline:false,content:'<p>原文</p>',uploadImage:file=>{window.uCalls.push(file.name);return new Promise((resolve,reject)=>{window.uResolves[file.name]=resolve;window.uRejects[file.name]=reject})},onError:error=>window.uErrors.push(error.message)});window.uController=c;window.uOther=createEditor({element:b,outline:false,content:'<p>另一个实例</p>'})
 const paste=name=>{const transfer=new DataTransfer();transfer.items.add(new File(['a'],name,{type:'image/png'}));c.editor.view.dom.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}))};c.editor.commands.setTextSelection(2);paste('one.png');paste('two.png')
 `,
  });
  await page.waitForFunction(() => window.uCalls?.length === 2);
  await page.evaluate(async () => {
    window.uController.editor.unmount();
    window.uResolves["one.png"]("/tests/sample-image.svg?one");
    window.uRejects["two.png"](new Error("第二张失败"));
    window.uOther.setContent("<p>另一实例更新</p>");
    await new Promise((r) => setTimeout(r, 0));
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const target = frame.contentDocument!.createElement("div");
    frame.contentDocument!.body.append(target);
    window.uTarget = target;
    window.uController.editor.mount(target);
  });
  await expect
    .poll(() => page.evaluate(() => window.uTarget.querySelectorAll(".semlo-editor-uploading").length))
    .toBe(0);
  await expect
    .poll(() => page.evaluate(() => window.uTarget.querySelectorAll(".semlo-editor-image-node").length))
    .toBe(1);
  expect(await page.evaluate(() => window.uErrors)).toEqual(["第二张失败"]);
  await expect(page.locator("#batch-other .semlo-editor-prose")).toHaveText("另一实例更新");
});

test("temporary mount and destroy listeners are removed after an upload resumes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
 import {createEditor} from '/dist/index.js';const host=document.createElement('div');document.body.append(host)
 const c=createEditor({element:host,outline:false,content:'<p>原文</p>',uploadImage:()=>new Promise(resolve=>window.uResolve=resolve)});window.uController=c
 window.uCounts=()=>({mount:c.editor.callbacks.mount?.length||0,destroy:c.editor.callbacks.destroy?.length||0});window.uBaseline=window.uCounts();window.uBaselineMount=[...(c.editor.callbacks.mount||[])];window.uBaselineDestroy=[...(c.editor.callbacks.destroy||[])]
 c.editor.commands.setTextSelection(2);const transfer=new DataTransfer();transfer.items.add(new File(['a'],'one.png',{type:'image/png'}));c.editor.view.dom.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}))
 `,
  });
  await page.waitForFunction(() => Boolean(window.uResolve));
  await page.evaluate(async () => {
    const e = window.uController.editor;
    e.unmount();
    window.uResolve("/tests/sample-image.svg");
    await new Promise((r) => setTimeout(r, 0));
    window.uWaiting = window.uCounts();
    const callbacks = (e as unknown as { callbacks: { mount: unknown[]; destroy: unknown[] } }).callbacks;
    window.uWaitMount = (callbacks.mount || []).find((fn) => !window.uBaselineMount.includes(fn));
    window.uWaitDestroy = (callbacks.destroy || []).find((fn) => !window.uBaselineDestroy.includes(fn));
    const target = document.createElement("div");
    document.body.append(target);
    window.uTarget = target;
    e.mount(target);
  });
  await expect
    .poll(() => page.evaluate(() => window.uTarget.querySelectorAll(".semlo-editor-image-node").length))
    .toBe(1);
  const counts = await page.evaluate(() => ({
    before: window.uBaseline,
    waiting: window.uWaiting,
    after: window.uCounts(),
  }));
  expect(counts.waiting.mount).toBe(counts.before.mount + 1);
  expect(counts.waiting.destroy).toBe(counts.before.destroy + 1);
  expect(
    await page.evaluate(() => ({
      mount: (window.uController.editor as unknown as { callbacks: { mount: unknown[] } }).callbacks.mount.includes(
        window.uWaitMount,
      ),
      destroy: (
        window.uController.editor as unknown as { callbacks: { destroy: unknown[] } }
      ).callbacks.destroy.includes(window.uWaitDestroy),
    })),
  ).toEqual({ mount: false, destroy: false });
});

test("controller destruction while unmounted cancels the settled upload", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
 import {createEditor} from '/dist/index.js';const host=document.createElement('div');document.body.append(host);window.uCalls=[];window.uErrors=[]
 const c=createEditor({element:host,outline:false,content:'<p>原文</p>',uploadImage:file=>{window.uCalls.push(file.name);return new Promise(resolve=>window.uResolve=resolve)},onError:error=>window.uErrors.push(error.message)});window.uController=c
 c.editor.commands.setTextSelection(2);const transfer=new DataTransfer();for(const name of ['one.png','two.png'])transfer.items.add(new File(['a'],name,{type:'image/png'}));c.editor.view.dom.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}))
 `,
  });
  await page.waitForFunction(() => Boolean(window.uResolve));
  const result = await page.evaluate(async () => {
    const c = window.uController;
    c.editor.unmount();
    window.uResolve("/tests/sample-image.svg");
    await new Promise((r) => setTimeout(r, 0));
    let error = "";
    try {
      c.destroy();
    } catch (cause) {
      error = String(cause);
    }
    await new Promise((r) => setTimeout(r, 0));
    return { error, calls: window.uCalls, errors: window.uErrors };
  });
  expect(result.error).toBe("");
  expect(result.calls).toEqual(["one.png"]);
  expect(result.errors).toEqual([]);
});
