import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
declare global {
  interface Window {
    resizeController?: EditorController;
    resizeOther?: EditorController;
    resizeArm?: () => void;
    resizeCount?: () => number;
  }
}
for (const timing of ["during-drag", "on-release", "controller-on-release"] as const)
  test(`image resize raw destroy ${timing}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installFixtureGuards(page);
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
 import {createEditor} from '/dist/index.js';const a=document.createElement('div');a.id='resize-destroy';document.body.append(a);const b=document.createElement('div');b.id='resize-other';document.body.append(b)
 let armed=false;let count=0
 const controller=createEditor({element:a,outline:false,content:{type:'doc',content:[{type:'paragraph',content:[{type:'image',attrs:{src:'/tests/sample-image.svg',width:300,height:130}}]}]},onChange:()=>{if(armed && '${timing}'==='on-release'){count++;controller.editor.destroy()} else if(armed && '${timing}'==='controller-on-release'){count++;controller.destroy()}}})
 window.resizeController=controller;window.resizeOther=createEditor({element:b,outline:false,content:'<p>独立实例</p>'});window.resizeArm=()=>armed=true;window.resizeCount=()=>count
 `,
    });
    const host = page.locator("#resize-destroy"),
      frame = host.locator(".semlo-editor-image-frame");
    await frame.locator("img").click();
    const handle = frame.getByRole("button", { name: "调整图片大小（右下）" }),
      box = (await handle.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 45, box.y + box.height / 2 + 20, { steps: 3 });
    if (timing === "during-drag")
      await page.evaluate(() => window.__semloRequireFixture("resizeController").editor.destroy());
    else await page.evaluate(() => window.__semloRequireFixture("resizeArm")());
    await page.mouse.up();
    await page.mouse.move(50, 50);
    if (timing !== "during-drag")
      expect(await page.evaluate(() => window.__semloRequireFixture("resizeCount")())).toBe(1);
    expect(await page.evaluate(() => window.__semloRequireFixture("resizeController").editor.isDestroyed)).toBe(true);
    if (timing === "controller-on-release") await expect(host.locator(".semlo-editor")).toHaveCount(0);
    await page.evaluate(() => window.__semloRequireFixture("resizeOther").setContent("<p>仍可编辑</p>"));
    await expect(page.locator("#resize-other .semlo-editor-prose")).toHaveText("仍可编辑");
    expect(errors).toEqual([]);
  });
