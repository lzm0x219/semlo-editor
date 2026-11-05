import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    gController: EditorController;
    gErrors: string[];
    gChanges: number;
    gResolve: (url: string) => void;
    gReject: (error: Error) => void;
    gThrow?: boolean;
    gChangeThrow?: boolean;
  }
}
for (const scenario of [
  "success",
  "failure",
  "readonly",
  "replace",
  "destroy",
  "host-throw",
  "mount-first",
  "host-change-throw",
] as const) {
  test(`direct gallery upload during unmount: ${scenario}`, async ({ page }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await installFixtureGuards(page);
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
  import {createEditor} from '/dist/index.js';
  const host=document.createElement('div');host.id='gallery-probe';document.body.append(host);window.gErrors=[];window.gChanges=0;
  window.gController=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'semloEditorGallery',attrs:{data:{id:'g',layout:'grid',images:[{id:'i',src:'/tests/sample-image.svg',title:'old',href:''}]}}},{type:'paragraph'}]},uploadImage:()=>new Promise((resolve,reject)=>{window.gResolve=resolve;window.gReject=reject}),onError:e=>{window.gErrors.push(String(e));if(window.gThrow)throw new Error('host error')},onChange:()=>{window.gChanges++;if(window.gChangeThrow)throw new Error('host change')}})
  `,
    });
    await page
      .locator('#gallery-probe input[aria-label="选择图册图片"]')
      .setInputFiles({ name: "probe.png", mimeType: "image/png", buffer: Buffer.from("test") });
    await page.waitForFunction(() => Boolean(window.gResolve));
    const result = await page.evaluate(async (scenario) => {
      const c = window.gController;
      let actionError = "";
      if (scenario === "host-throw" || scenario === "host-change-throw") {
        window.gThrow = true;
        window.gChangeThrow = scenario === "host-change-throw";
        if (scenario === "host-change-throw") window.gResolve("/tests/sample-image.svg?new");
        else window.gReject(new Error("upload failed"));
        await new Promise((r) => setTimeout(r, 0));
      }
      c.editor.unmount();
      try {
        if (scenario === "readonly") c.setEditable(false);
        if (scenario === "replace") c.setContent("<p>replacement</p>");
        if (scenario === "destroy") c.destroy();
        if (scenario === "host-throw") window.gThrow = true;
      } catch (e) {
        actionError = String(e);
      }
      if (scenario === "mount-first") {
        const target = document.createElement("div");
        document.body.append(target);
        c.editor.mount(target);
      }
      if (scenario === "failure") window.gReject(new Error("upload failed"));
      else if (!scenario.startsWith("host-")) window.gResolve("/tests/sample-image.svg?new");
      await new Promise((r) => setTimeout(r, 0));
      let mountError = "";
      if (scenario !== "destroy" && scenario !== "mount-first") {
        const target = document.createElement("div");
        document.body.append(target);
        try {
          c.editor.mount(target);
        } catch (e) {
          mountError = String(e);
        }
      }
      await new Promise((r) => setTimeout(r, 0));
      return {
        actionError,
        mountError,
        errors: window.gErrors,
        changes: window.gChanges,
        json: c.editor.state.doc.toJSON(),
        editable: c.editor.isEditable,
        hasShell: !!document.querySelector("#gallery-probe .semlo-editor"),
      };
    }, scenario);
    console.log("PROBE", scenario, JSON.stringify(result));
    expect(result.mountError).toBe("");
    expect(result.actionError).toBe("");
    if (scenario === "readonly") expect(result.editable).toBe(false);
    if (scenario === "destroy") expect(result.hasShell).toBe(false);
    if (scenario === "replace") {
      expect(result.errors).toEqual([]);
      expect(JSON.stringify(result.json)).toContain("replacement");
      expect(JSON.stringify(result.json)).not.toContain("semloEditorGallery");
    }
    if (scenario === "host-throw") expect(result.errors.join()).toContain("upload failed");
    if (scenario === "host-change-throw") {
      expect(result.changes).toBe(1);
      expect(result.errors.join()).toContain("host change");
      expect(JSON.stringify(result.json)).toContain("?new");
    }
    if (!scenario.startsWith("host-") && scenario !== "destroy")
      expect(JSON.stringify(result.json)).not.toContain("?new");
    if (!scenario.startsWith("host-")) expect(pageErrors).toEqual([]);
  });
}
