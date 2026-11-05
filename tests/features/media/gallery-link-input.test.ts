import { expect, test } from "@rstest/playwright";

import type { GalleryData } from "../../../packages/core/src/features/media/gallery/extension";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    galleryLinkInputEditor?: EditorController;
  }
}

test("gallery retains a bare-domain link and resolves it for navigation and HTML", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'gallery-link-input'
      document.body.prepend(host)
      window.galleryLinkInputEditor = createEditor({element:host,outline:false,content:{type:'doc',content:[
        {type:'semloEditorGallery',attrs:{data:{id:'gallery',layout:'grid',images:[
          {id:'a',src:'/tests/sample-image.svg',title:'测试',href:''}
        ]}}},{type:'paragraph'}]}})
    `,
  });
  const host = page.locator("#gallery-link-input");
  await host.locator(".semlo-editor-gallery-surface").click({ position: { x: 5, y: 5 } });
  await host.getByRole("button", { name: "编辑图册" }).click();
  const panel = page.getByRole("dialog", { name: "图册设置" });
  await panel.getByLabel("链接（图片一）").fill("example.com/test");
  await panel.getByRole("button", { name: "确定", exact: true }).click();
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("galleryLinkInputEditor").getSnapshot());
  const link = async () => {
    const data = (await snapshot()).json.content?.[0]?.attrs?.data as GalleryData | undefined;
    return data?.images[0]?.href;
  };
  expect(await link()).toBe("example.com/test");
  await expect(host.locator(".semlo-editor-gallery-image")).toHaveAttribute("href", "https://example.com/test");
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryLinkInputEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await link()).toBe("");
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryLinkInputEditor").editor.commands.redo())).toBe(
    true,
  );
  const saved = await snapshot();
  for (const content of [saved.html, saved.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("galleryLinkInputEditor").setContent(value), content);
    expect(await link()).toBe("example.com/test");
    await expect(host.locator(".semlo-editor-gallery-image")).toHaveAttribute("href", "https://example.com/test");
  }
  await host.locator(".semlo-editor-gallery-surface").click({ position: { x: 5, y: 5 } });
  await host.getByRole("button", { name: "编辑图册" }).click();
  await panel.getByLabel("链接（图片一）").fill("not a url");
  await panel.getByRole("button", { name: "确定", exact: true }).click();
  expect(await link()).toBe("not a url");
  await expect(host.locator("a.semlo-editor-gallery-image")).toHaveCount(0);
  const unfinished = await snapshot();
  for (const content of [unfinished.html, unfinished.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("galleryLinkInputEditor").setContent(value), content);
    expect(await link()).toBe("not a url");
    await expect(host.locator("a.semlo-editor-gallery-image")).toHaveCount(0);
  }
});
