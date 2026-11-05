import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    imageBatchReferenceEditor?: EditorController;
  }
}

test("bulk image style and width apply separately and undo as single steps", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'image-batch-reference'
      host.style.width = '800px'
      document.body.prepend(host)
      window.imageBatchReferenceEditor = createEditor({ element: host, outline: false, content: { type: 'doc', content: [
        {type:'paragraph', content:[{type:'text', text:'前文'}]},
        {type:'paragraph', content:[{type:'image', attrs:{src:'/tests/sample-image.svg', width:320, height:140, semloEditorImageStyle:'border'}}]},
        {type:'paragraph', content:[{type:'image', attrs:{src:'/tests/sample-image.svg', width:160, height:70, semloEditorImageStyle:'shadow'}}]},
        {type:'paragraph', content:[{type:'image', attrs:{src:'/tests/sample-image.svg', width:80, height:40, semloEditorImageStyle:'none'}}]},
        {type:'paragraph', content:[{type:'image', attrs:{src:'/tests/missing-image.svg'}}]}
      ]} })`,
  });
  const frames = page.locator("#image-batch-reference .semlo-editor-image-frame");
  await frames.first().locator("img").click();
  const first = frames.first();
  await first.getByRole("button", { name: "批量应用格式" }).click();
  const menu = first.getByRole("menu", { name: "批量应用图片格式" });
  await menu.getByRole("menuitem", { name: "同步图片宽度到全文" }).click();
  await expect(page.getByRole("status").filter({ hasText: "图片格式已对所有图片生效" })).toBeVisible();
  const attrs = () =>
    page.evaluate(() =>
      window
        .__semloRequireFixture("imageBatchReferenceEditor")
        .getSnapshot()
        .json.content!.slice(1)
        .map((p) => p.content![0].attrs),
    );
  expect((await attrs()).map((a) => [a?.width, a?.height])).toEqual([
    [320, 140],
    [320, 140],
    [320, 160],
    [320, null],
  ]);
  await page.evaluate(() => window.__semloRequireFixture("imageBatchReferenceEditor").editor.commands.undo());
  expect((await attrs()).map((a) => a?.width)).toEqual([320, 160, 80, null]);
  await first.locator("img").click();
  await first.getByRole("button", { name: "批量应用格式" }).click();
  await menu.getByRole("menuitem", { name: "同步图片样式到全文" }).click();
  expect((await attrs()).map((a) => a?.semloEditorImageStyle)).toEqual(["border", "border", "border", "border"]);
  await page.evaluate(() => window.__semloRequireFixture("imageBatchReferenceEditor").editor.commands.undo());
  expect((await attrs()).map((a) => a?.semloEditorImageStyle)).toEqual(["border", "shadow", "none", "none"]);
  await first.locator("img").click();
  const batch = first.getByRole("button", { name: "批量应用格式" });
  await batch.click();
  await batch.press("Escape");
  await expect(batch).toBeFocused();
  await expect(menu).toBeVisible();
});

test("bulk width is retained while a target image is still loading", async ({ page }) => {
  await installFixtureGuards(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route("**/tests/delayed-batch-image.svg", async (route) => {
    await gate;
    await route.fulfill({
      status: 200,
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200"/>',
    });
  });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'image-batch-delayed'
      host.style.width = '800px'
      document.body.prepend(host)
      window.imageBatchReferenceEditor = createEditor({ element: host, outline: false, content: { type: 'doc', content: [
        {type:'paragraph', content:[{type:'text', text:'前文'}]},
        {type:'paragraph', content:[{type:'image', attrs:{src:'/tests/sample-image.svg', width:320, height:140}}]},
        {type:'paragraph', content:[{type:'image', attrs:{src:'/tests/delayed-batch-image.svg'}}]}
      ]} })`,
  });
  const frames = page.locator("#image-batch-delayed .semlo-editor-image-frame");
  await frames.first().locator("img").click();
  await frames.first().getByRole("button", { name: "批量应用格式" }).click();
  await frames.first().getByRole("menuitem", { name: "同步图片宽度到全文" }).click();
  const before = await page.evaluate(
    () => window.__semloRequireFixture("imageBatchReferenceEditor").getSnapshot().json.content![2].content![0].attrs,
  );
  expect(before).toMatchObject({ width: 320, height: null });
  release();
  const image = frames.nth(1).locator("img");
  await expect(image).toHaveJSProperty("naturalWidth", 640);
  await expect.poll(async () => (await image.boundingBox())?.width).toBe(320);
  await expect.poll(async () => (await image.boundingBox())?.height).toBe(100);
});
