import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    galleryIsolationFirst?: EditorController;
    galleryIsolationSecond?: EditorController;
    galleryIsolationResolve?: (url: string) => void;
    galleryIsolationErrors?: string[];
  }
}

test("replacing one editor does not close or modify another editor's gallery draft", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const make = (id) => {
        const host = document.createElement('div')
        host.id = id
        document.body.prepend(host)
        return createEditor({ element: host, outline: false, content: { type: 'doc', content: [
          { type: 'semloEditorGallery', attrs: { data: { id, layout: 'grid', images: [
            { id: 'image', src: '/tests/sample-image.svg', title: '原图', href: '' }
          ] } } }, { type: 'paragraph' }
        ] } })
      }
      window.galleryIsolationFirst = make('gallery-isolation-first')
      window.galleryIsolationSecond = make('gallery-isolation-second')
    `,
  });
  const second = page.locator("#gallery-isolation-second");
  await second.locator(".semlo-editor-gallery-surface").click({ position: { x: 5, y: 5 } });
  await second.getByRole("button", { name: "编辑图册" }).click();
  const panel = page.getByRole("dialog", { name: "图册设置" });
  await panel.getByLabel("标题（图片一）").fill("第二个编辑器草稿");
  const before = await page.evaluate(() => window.__semloRequireFixture("galleryIsolationSecond").getSnapshot().json);
  await page.evaluate(() =>
    window.__semloRequireFixture("galleryIsolationFirst").setContent("<p>第一个编辑器已替换</p>"),
  );
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("标题（图片一）")).toHaveValue("第二个编辑器草稿");
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryIsolationSecond").getSnapshot().json)).toEqual(
    before,
  );
  await panel.getByRole("button", { name: "确定", exact: true }).click();
  const saved = await page.evaluate(() => window.__semloRequireFixture("galleryIsolationSecond").getSnapshot().json);
  const gallery = saved.content?.[0].attrs?.data as { images: Array<{ title: string }> };
  expect(gallery.images[0].title).toBe("第二个编辑器草稿");
});

test("invalid replacement leaves an existing gallery draft intact", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'gallery-isolation-invalid'
      document.body.prepend(host)
      window.galleryIsolationErrors = []
      window.galleryIsolationFirst = createEditor({ element: host, outline: false,
        onError: error => window.galleryIsolationErrors.push(error.message),
        content: { type: 'doc', content: [
          { type: 'semloEditorGallery', attrs: { data: { id: 'gallery', layout: 'grid', images: [
            { id: 'image', src: '/tests/sample-image.svg', title: '原图', href: '' }
          ] } } }, { type: 'paragraph' }
        ] } })
    `,
  });
  const host = page.locator("#gallery-isolation-invalid");
  await host.locator(".semlo-editor-gallery-surface").click({ position: { x: 5, y: 5 } });
  await host.getByRole("button", { name: "编辑图册" }).click();
  const panel = page.getByRole("dialog", { name: "图册设置" });
  await panel.getByLabel("标题（图片一）").fill("未提交草稿");
  const before = await page.evaluate(() => window.__semloRequireFixture("galleryIsolationFirst").getSnapshot().json);
  await page.evaluate(() =>
    window.__semloRequireFixture("galleryIsolationFirst").setContent({ type: "not-a-node" } as never),
  );
  await expect(panel).toBeVisible();
  await expect(panel.getByLabel("标题（图片一）")).toHaveValue("未提交草稿");
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryIsolationFirst").getSnapshot().json)).toEqual(
    before,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryIsolationErrors"))).toHaveLength(1);
});

test("replacing one editor does not cancel an image upload in another editor", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const make = (id) => {
        const host = document.createElement('div')
        host.id = id
        document.body.prepend(host)
        return createEditor({ element: host, outline: false, content: '<p></p>',
          uploadImage: () => new Promise(resolve => { window.galleryIsolationResolve = resolve }) })
      }
      window.galleryIsolationFirst = make('gallery-isolation-first')
      window.galleryIsolationSecond = make('gallery-isolation-second')
    `,
  });
  await page.waitForFunction(() => Boolean(window.galleryIsolationSecond));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("galleryIsolationSecond").editor;
    const transfer = new DataTransfer();
    transfer.items.add(new File(["image"], "image.png", { type: "image/png" }));
    editor.view.dom.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
    );
  });
  await page.waitForFunction(() => Boolean(window.galleryIsolationResolve));
  await page.evaluate(() => {
    window.__semloRequireFixture("galleryIsolationFirst").setContent("<p>外部替换</p>");
    window.galleryIsolationResolve!("/tests/sample-image.svg");
  });
  await expect(page.locator("#gallery-isolation-second .semlo-editor-image-frame img")).toHaveCount(1);
});
