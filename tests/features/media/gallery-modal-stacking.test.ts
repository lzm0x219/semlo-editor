import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

import { expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    galleryStackClose?: { dialog: () => void };
  }
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

const script = [
  "packages/core/src/features/media/gallery/uploads.ts",
  "packages/core/src/features/media/shared/crop.ts",
  "packages/core/src/features/media/shared/modal-order.ts",
  "packages/core/src/features/media/shared/transform.ts",
  "packages/core/src/features/media/gallery/dialog.ts",
  "packages/core/src/features/media/shared/lightbox.ts",
]
  .map((path) =>
    stripTypeScriptTypes(readFileSync(path, "utf8")).replace(/^import[^\n]*from ['"][^'"]+['"];?\s*$/gm, ""),
  )
  .join("\n");

async function mount(page: Page, lightboxFirst: boolean) {
  await page.setContent('<button id="opener">打开</button>');
  await page.addScriptTag({
    type: "module",
    content: `${script}
      document.querySelector('#opener').focus()
      const images = [{id:'a',src:'/a',title:'测试',href:''}]
      const dialog = () => openGalleryDialog(document,{id:'a',layout:'grid',images}, {getUploadImage:()=>undefined,onCommit:()=>{}})
      const lightbox = () => openGalleryLightbox(document,images,0)
      window.galleryStackClose = ${lightboxFirst ? "{lightbox:lightbox(),dialog:dialog()}" : "{dialog:dialog(),lightbox:lightbox()}"}
    `,
  });
  await expect(page.getByRole("dialog", { name: "图册设置" })).toHaveCount(1);
  await expect(page.getByRole("dialog", { name: "图册图片预览" })).toHaveCount(1);
}

for (const lightboxFirst of [false, true]) {
  test(`Escape closes only the visible top modal (lightbox first: ${lightboxFirst})`, async ({ page }) => {
    await mount(page, lightboxFirst);
    const preview = page.getByRole("dialog", { name: "图册图片预览" });
    const settings = page.getByRole("dialog", { name: "图册设置" });
    await expect(preview).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
    await expect(settings).toHaveCount(1);
    await expect(settings.getByRole("button", { name: "关闭图册设置" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(settings).toHaveCount(0);
    await expect(page.locator("#opener")).toBeFocused();
  });
}

test("closing a covered settings dialog does not steal focus from the preview", async ({ page }) => {
  await mount(page, false);
  const preview = page.getByRole("dialog", { name: "图册图片预览" });
  await page.evaluate(() => window.__semloRequireFixture("galleryStackClose").dialog());
  await expect(preview).toBeFocused();
  await expect(page.getByRole("dialog", { name: "图册设置" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(page.locator("#opener")).toBeFocused();
});
