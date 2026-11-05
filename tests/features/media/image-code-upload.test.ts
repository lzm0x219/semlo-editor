import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("image insertion from a code block preserves its contents", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='image-code-probe';document.body.append(host)
    const c=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',attrs:{language:'javascript'},content:[{type:'text',text:'hello world'}]}]},uploadImage:()=>new Promise(resolve=>window.imageCodeFinish=resolve)})
    c.editor.commands.setTextSelection(6);window.imageCodeController=c
  `,
  });
  await page.waitForFunction(() => Boolean((window as any).imageCodeController));
  const host = page.locator("#image-code-probe");
  await page.evaluate(() => (window as any).imageCodeController.editor.commands.focus());
  await host.getByRole("button", { name: "插入内容" }).click();
  await page.getByRole("dialog", { name: "插入内容" }).locator('.semlo-editor-card-item[data-command="image"]').click();
  const chooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "上传图片" }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles({ name: "one.png", mimeType: "image/png", buffer: Buffer.from("local") });
  await page.waitForFunction(() => Boolean((window as any).imageCodeFinish));
  await page.evaluate(() => (window as any).imageCodeFinish("/tests/sample-image.svg?one"));
  await expect(host.locator('img[src*="one"]')).toHaveCount(1);
  await expect(host.locator(".semlo-editor-code-card")).toHaveCount(1);
  await expect(host.locator(".semlo-editor-code-card")).toContainText("hello world");
  const json = await page.evaluate(() => (window as any).imageCodeController.getSnapshot().json);
  console.log("IMAGE_CODE_SNAPSHOT", JSON.stringify(json));
});
