import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
declare global {
  interface Window {
    imeChanges: number;
    imeController: EditorController;
  }
}
for (const mode of ["composing", "keycode229"] as const)
  test(`image size Enter ignores ${mode}`, async ({ page }) => {
    await installFixtureGuards(page);
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
  import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='ime-image';document.body.prepend(host)
  window.imeChanges=0;window.imeController=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'paragraph',content:[{type:'image',attrs:{src:'/tests/sample-image.svg',width:300,height:130}}]}]},onChange:()=>window.imeChanges++})
 `,
    });
    const frame = page.locator("#ime-image .semlo-editor-image-frame");
    await frame.locator("img").click();
    await frame.getByRole("button", { name: "图片尺寸" }).click();
    const width = frame.getByRole("dialog", { name: "图片尺寸" }).getByLabel("图片宽度");
    await width.fill("420");
    await width.evaluate((input) => input.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
    await width.evaluate(
      (input, kind) =>
        input.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
            isComposing: kind === "composing",
            keyCode: kind === "keycode229" ? 229 : 13,
          }),
        ),
      mode,
    );
    expect(await page.evaluate(() => window.imeChanges)).toBe(0);
    expect(
      await page.evaluate(() => window.imeController.getSnapshot().json.content?.[0]?.content?.[0]?.attrs?.width),
    ).toBe(300);
    await expect(width).toHaveValue("420");
    await width.evaluate((input) => input.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
    await width.press("Enter");
    expect(await page.evaluate(() => window.imeChanges)).toBe(1);
    expect(
      await page.evaluate(() => window.imeController.getSnapshot().json.content?.[0]?.content?.[0]?.attrs?.width),
    ).toBe(420);
  });
