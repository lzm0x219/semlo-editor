import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    cropMinimumEditor?: EditorController;
  }
}

test("minimum crop is undoable and retains its region through JSON and HTML", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'crop-minimum-editor'
      document.body.prepend(host)
      window.cropMinimumEditor = createEditor({element:host,outline:false,content:{type:'doc',content:[
        {type:'paragraph',content:[{type:'image',attrs:{src:'/tests/sample-image.svg',width:320,height:200}}]}
      ]}})
    `,
  });
  const host = page.locator("#crop-minimum-editor");
  const frame = host.locator(".semlo-editor-image-frame");
  await expect.poll(() => frame.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(600);
  await frame.locator("img").click();
  await host.getByRole("button", { name: "裁剪图片" }).click();
  const bounds = (await frame.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width - 1, bounds.y + bounds.height - 1);
  await page.mouse.down();
  await page.mouse.move(bounds.x, bounds.y, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("Enter");
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("cropMinimumEditor").getSnapshot());
  const attrs = async () => (await snapshot()).json.content?.[0]?.content?.[0]?.attrs;
  expect(await attrs()).toMatchObject({
    width: 28,
    height: 28,
    semloEditorImageCrop: { x: 0, y: 0, width: 0.0875, height: 0.14 },
  });
  expect(await page.evaluate(() => window.__semloRequireFixture("cropMinimumEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await attrs()).toMatchObject({ width: 320, height: 200, semloEditorImageCrop: null });
  expect(await page.evaluate(() => window.__semloRequireFixture("cropMinimumEditor").editor.commands.redo())).toBe(
    true,
  );
  const saved = await snapshot();
  for (const content of [saved.html, saved.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("cropMinimumEditor").setContent(value), content);
    const restored = await attrs();
    expect(Number(restored?.width)).toBe(28);
    expect(Number(restored?.height)).toBe(28);
    expect(restored?.semloEditorImageCrop).toEqual({ x: 0, y: 0, width: 0.0875, height: 0.14 });
  }
});
