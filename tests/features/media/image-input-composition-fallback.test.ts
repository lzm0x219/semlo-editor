import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
declare global {
  interface Window {
    imeInputController: EditorController;
  }
}
for (const kind of ["caption", "link"] as const)
  test(`image ${kind} does not commit a 229 Enter without compositionstart`, async ({ page }) => {
    await installFixtureGuards(page);
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
 import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='image-input-ime';document.body.prepend(host)
 window.imeInputController=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'paragraph',content:[{type:'image',attrs:{src:'/tests/sample-image.svg',width:300,height:130}}]}]}})
 `,
    });
    const host = page.locator("#image-input-ime"),
      frame = host.locator(".semlo-editor-image-frame");
    await frame.locator("img").click();
    await frame.getByRole("button", { name: kind === "caption" ? "图片描述" : "图片链接", exact: true }).click();
    const input = host.getByRole("textbox", { name: kind === "caption" ? "图片描述内容" : "图片链接地址" });
    await input.fill(kind === "caption" ? "描述草稿" : "https://example.com/new");
    const before = await page.evaluate(() => window.imeInputController.getSnapshot().json);
    await input.evaluate((element) =>
      element.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "Enter",
          keyCode: 229,
          isComposing: false,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(await page.evaluate(() => window.imeInputController.getSnapshot().json)).toEqual(before);
    await expect(input).toBeFocused();
    const escapeAccepted = await input.evaluate((element) =>
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", keyCode: 229, bubbles: true, cancelable: true }),
      ),
    );
    expect(escapeAccepted).toBe(true);
    await input.evaluate((element) => {
      element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }),
      );
      element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    });
    await expect(input).toBeFocused();
    await input.press("Escape");
    await expect(input).toBeFocused();
    await input.press("Enter");
    if (kind === "caption") await expect(host.locator(".ProseMirror")).toBeFocused();
    else
      expect(
        await page.evaluate(
          () => window.imeInputController.getSnapshot().json.content?.[0]?.content?.[0]?.attrs?.semloEditorImageHref,
        ),
      ).toBe("https://example.com/new");
  });
