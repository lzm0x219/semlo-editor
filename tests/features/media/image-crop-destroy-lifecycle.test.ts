import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
declare global {
  interface Window {
    cropDestroyCount: number;
    cropDestroyArmed: boolean;
  }
}
for (const mode of ["raw", "controller"] as const)
  test(`image crop commit handles synchronous ${mode} destroy`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installFixtureGuards(page);
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
 import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='crop-destroy';host.style.width='700px';document.body.append(host);window.cropDestroyCount=0
 const controller=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'paragraph',content:[{type:'image',attrs:{src:'/tests/sample-image.svg',width:300,height:130}}]}]},onChange:()=>{if(window.cropDestroyArmed){window.cropDestroyCount++;if('${mode}'==='raw')controller.editor.destroy();else controller.destroy()}}})
 `,
    });
    const host = page.locator("#crop-destroy"),
      frame = host.locator(".semlo-editor-image-frame");
    await expect
      .poll(() => frame.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBe(600);
    await frame.locator("img").click();
    await host.getByRole("button", { name: "裁剪图片" }).click();
    await expect(frame.getByRole("group", { name: "图片裁剪区域" })).toBeVisible();
    const box = (await frame.boundingBox())!;
    await page.mouse.move(box.x + box.width - 2, box.y + box.height - 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 92, box.y + box.height - 28, { steps: 5 });
    await page.mouse.up();
    await page.evaluate(() => (window.cropDestroyArmed = true));
    await host.getByRole("button", { name: "裁剪图片" }).click();
    expect(await page.evaluate(() => window.cropDestroyCount)).toBe(1);
    expect(errors).toEqual([]);
    if (mode === "controller") await expect(host.locator(".semlo-editor")).toHaveCount(0);
  });
