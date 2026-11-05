import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
for (const result of ["resolve", "reject"] as const)
  for (const block of [false, true]) {
    test(`pending image ${result} after direct editor read-only transition, remove blocked=${block}`, async ({
      page,
    }) => {
      await installFixtureGuards(page);
      await page.goto(process.env.SEMLO_TEST_ORIGIN!);
      await page.addScriptTag({
        type: "module",
        content: `
      import {createEditor} from '/dist/index.js'
      const host=document.createElement('div');host.id='image-direct-readonly';document.body.append(host)
      window.roReports=[];window.roFailures=[];window.roCalls=[];window.roBlock=false
      window.addEventListener('unhandledrejection',e=>{window.roFailures.push(e.reason?.message);e.preventDefault()})
      const c=createEditor({element:host,outline:false,content:'<p>正文</p>',uploadImage:file=>{window.roCalls.push(file.name);return new Promise((resolve,reject)=>{window.roResolve=resolve;window.roReject=reject})},onError:error=>window.roReports.push(error.message)})
      c.editor.on('beforeTransaction',({transaction})=>{if(window.roBlock && transaction.getMeta('semlo-editor-image-upload$')?.remove){window.roBlock=false;throw new Error('remove blocked')}})
      c.editor.commands.setTextSelection(2);const data=new DataTransfer();for(const name of ['one.png','two.png'])data.items.add(new File(['a'],name,{type:'image/png'}));c.editor.view.dom.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));window.roController=c
    `,
      });
      await page.waitForFunction(() => Boolean((window as any).roResolve));
      await page.evaluate(
        ({ fail, outcome }) => {
          (window as any).roController.editor.setEditable(false, false);
          (window as any).roBlock = fail;
          if (outcome === "resolve") (window as any).roResolve("/tests/sample-image.svg?one");
          else (window as any).roReject(new Error("upload failed"));
        },
        { fail: block, outcome: result },
      );
      if (block) {
        await expect.poll(() => page.evaluate(() => (window as any).roFailures)).toEqual(["remove blocked"]);
        expect(await page.evaluate(() => (window as any).roReports)).toEqual([]);
      } else {
        await expect.poll(() => page.evaluate(() => (window as any).roReports.length)).toBe(2);
        const reports = await page.evaluate(() => (window as any).roReports);
        expect(reports[0]).toContain(result === "resolve" ? "只读" : "upload failed");
      }
      expect(await page.evaluate(() => (window as any).roCalls)).toEqual(["one.png"]);
      await expect.poll(() => page.locator("#image-direct-readonly .semlo-editor-uploading").count()).toBe(0);
      await expect(page.locator("#image-direct-readonly img")).toHaveCount(0);
    });
  }
