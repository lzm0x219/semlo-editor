import { expect, test } from "@rstest/playwright";

import type { GalleryData } from "../../../packages/core/src/features/media/gallery/extension";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    galleryLongTitleEditor?: EditorController;
  }
}

test("long gallery titles and emoji are not truncated when saved or restored", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'gallery-long-title'
      document.body.prepend(host)
      window.galleryLongTitleEditor = createEditor({element:host,outline:false,content:{type:'doc',content:[
        {type:'semloEditorGallery',attrs:{data:{id:'gallery',layout:'grid',images:[
          {id:'a',src:'/tests/sample-image.svg',title:'',href:''}
        ]}}},{type:'paragraph'}]}})
    `,
  });
  const host = page.locator("#gallery-long-title");
  await host.locator(".semlo-editor-gallery-surface").click({ position: { x: 5, y: 5 } });
  await host.getByRole("button", { name: "编辑图册" }).click();
  const panel = page.getByRole("dialog", { name: "图册设置" });
  const title = "测".repeat(500) + "🦊";
  await panel.getByLabel("标题（图片一）").fill(title);
  await panel.getByRole("button", { name: "确定", exact: true }).click();
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("galleryLongTitleEditor").getSnapshot());
  const saved = await snapshot();
  expect((saved.json.content?.[0]?.attrs?.data as GalleryData | undefined)?.images[0]?.title).toBe(title);
  const rendered = host.locator(".semlo-editor-gallery-grid-title > span");
  await expect(rendered).toHaveCSS("-webkit-line-clamp", "2");
  const bounds = await rendered.evaluate((element) => ({ client: element.clientHeight, scroll: element.scrollHeight }));
  expect(bounds.scroll).toBeGreaterThan(bounds.client);
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryLongTitleEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryLongTitleEditor").editor.commands.redo())).toBe(
    true,
  );
  for (const content of [saved.html, saved.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("galleryLongTitleEditor").setContent(value), content);
    const restored = await snapshot();
    expect((restored.json.content?.[0]?.attrs?.data as GalleryData | undefined)?.images[0]?.title).toBe(title);
  }
});
