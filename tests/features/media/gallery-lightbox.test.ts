import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

import { expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

// The lightbox browser fixture evaluates the real modules in one ES module;
// remove their local imports after placing the dependencies in source order.
const localModule = (path: string) =>
  stripTypeScriptTypes(readFileSync(path, "utf8")).replace(/^import[^\n]*from ['"][^'"]+['"];?\s*$/gm, "");
const script = [
  "packages/core/src/features/media/shared/crop.ts",
  "packages/core/src/features/media/shared/modal-order.ts",
  "packages/core/src/features/media/shared/transform.ts",
  "packages/core/src/features/media/shared/lightbox.ts",
]
  .map(localModule)
  .join("\n");
const styles = readFileSync("packages/core/src/features/media/shared/lightbox.css", "utf8");

declare global {
  interface Window {
    galleryLightboxTest?: {
      open: (index?: number) => void;
      close: () => void;
      changes: number[];
      closed: number;
    };
  }
}

async function mount(page: Page, initialIndex = 0) {
  await page.setContent('<button id="opener">打开图片预览</button>');
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({
    type: "module",
    content: `${script}
      const source = (width, height, color) => URL.createObjectURL(new Blob([
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '"><rect width="100%" height="100%" fill="' + color + '"/></svg>'
      ], {type:'image/svg+xml'}))
      const images = [
        { id:'a', src:source(60, 40, 'red'), title:'小图', href:'' },
        { id:'b', src:source(2000, 1000, 'blue'), title:'大图', href:'' },
        { id:'c', src:source(120, 90, 'green'), title:'第三张', href:'' },
      ]
      const state = { changes:[], closed:0, close:()=>{}, open(index=0) {
        state.close = openGalleryLightbox(document, images, index, {
          onClose: () => state.closed++, onIndexChange: index => state.changes.push(index),
        })
      }}
      window.galleryLightboxTest = state
    `,
  });
  await page.waitForFunction(() => Boolean(window.galleryLightboxTest));
  await page.locator("#opener").focus();
  await page.evaluate((index) => window.__semloRequireFixture("galleryLightboxTest").open(index), initialIndex);
  return page.getByRole("dialog", { name: "图册图片预览" });
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("preview fits images without enlarging small originals and switches independently", async ({ page }) => {
  const viewer = await mount(page);
  const image = viewer.getByRole("img", { name: "小图" });
  await expect(image).toBeVisible();
  await expect(image).toHaveJSProperty("naturalWidth", 60);
  expect((await image.boundingBox())?.width).toBe(60);
  await expect(viewer.getByRole("button", { name: "上一张" })).toBeEnabled();
  await expect(viewer.getByRole("toolbar", { name: "图片预览工具" })).toContainText("1 / 3");
  await viewer.getByRole("button", { name: "下一张" }).click();
  const large = viewer.getByRole("img", { name: "大图" });
  await expect(large).toBeVisible();
  const largeBounds = await large.boundingBox();
  const stageBounds = await viewer.locator(".semlo-editor-gallery-lightbox-stage").boundingBox();
  expect(largeBounds!.width).toBeLessThan(2000);
  expect(largeBounds!.width).toBeLessThanOrEqual(stageBounds!.width);
  expect(largeBounds!.height).toBeLessThanOrEqual(stageBounds!.height);
  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByRole("img", { name: "第三张" })).toBeVisible();
  await expect(viewer.getByRole("button", { name: "下一张" })).toBeEnabled();
  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByRole("img", { name: "小图" })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(viewer.getByRole("img", { name: "第三张" })).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryLightboxTest").changes)).toEqual([1, 2, 0, 2]);
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(page.locator("#opener")).toBeFocused();
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryLightboxTest").closed)).toBe(1);
  await page.evaluate(() => window.__semloRequireFixture("galleryLightboxTest").close());
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryLightboxTest").closed)).toBe(1);
});

test("zoom and original size preserve actual dimensions and allow dragging an oversized image", async ({ page }) => {
  const viewer = await mount(page);
  const small = viewer.getByRole("img", { name: "小图" });
  await expect(small).toBeVisible();
  await viewer.getByRole("button", { name: "放大" }).click();
  await expect.poll(async () => (await small.boundingBox())!.width).toBe(72);
  await viewer.getByRole("button", { name: "下一张" }).click();
  const image = viewer.getByRole("img", { name: "大图" });
  await expect(image).toBeVisible();
  const fitted = (await image.boundingBox())!.width;
  await viewer.getByRole("button", { name: "放大" }).click();
  await expect.poll(async () => (await image.boundingBox())!.width).toBeGreaterThan(fitted);
  await viewer.getByRole("button", { name: "缩小" }).click();
  await expect.poll(async () => Math.abs((await image.boundingBox())!.width - fitted)).toBeLessThan(1);
  await viewer.getByRole("button", { name: "原始大小" }).click();
  await expect.poll(async () => (await image.boundingBox())!.width).toBe(2000);
  const stage = viewer.locator(".semlo-editor-gallery-lightbox-stage");
  const before = await stage.evaluate((element) => element.scrollLeft);
  const bounds = (await stage.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 - 100, bounds.y + bounds.height / 2);
  await page.mouse.up();
  await expect.poll(() => stage.evaluate((element) => element.scrollLeft)).toBeGreaterThan(before + 80);
  await page.setViewportSize({ width: 375, height: 667 });
  await expect
    .poll(async () => (await image.boundingBox())!.width - (await stage.boundingBox())!.width)
    .toBeLessThanOrEqual(0);
  await expect(viewer.getByRole("button", { name: "最佳大小" })).toHaveAttribute("aria-pressed", "false");
});

test("best size restores the fit and follows viewport resizing", async ({ page }) => {
  const viewer = await mount(page, 1);
  const image = viewer.getByRole("img", { name: "大图" });
  await expect(image).toBeVisible();
  const initialWidth = (await image.boundingBox())!.width;
  await page.setViewportSize({ width: 375, height: 667 });
  await expect.poll(async () => (await image.boundingBox())!.width).toBeLessThan(initialWidth);
  const stage = (await viewer.locator(".semlo-editor-gallery-lightbox-stage").boundingBox())!;
  const fittedWidth = (await image.boundingBox())!.width;
  expect(fittedWidth).toBeLessThanOrEqual(stage.width);
  await viewer.getByRole("button", { name: "原始大小" }).click();
  await expect.poll(async () => (await image.boundingBox())!.width).toBe(2000);
  const best = viewer.getByRole("button", { name: "最佳大小" });
  await best.click();
  await expect(best).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => Math.abs((await image.boundingBox())!.width - fittedWidth)).toBeLessThan(1);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect.poll(async () => (await image.boundingBox())!.width).toBeGreaterThan(fittedWidth);
  await viewer.getByRole("button", { name: "关闭图片预览" }).click();
  await expect(viewer).toHaveCount(0);
});

test("empty images do not open a viewer and an image error can still be navigated away from", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => window.__semloRequireFixture("galleryLightboxTest").close());
  await page.addScriptTag({
    type: "module",
    content: `${script}
      const valid = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30"/>'], {type:'image/svg+xml'}))
      const images = [{id:'broken', src:'blob:missing', title:'坏图', href:''}, {id:'valid', src:valid, title:'好图', href:''}]
      openGalleryLightbox(document, images, 0)
    `,
  });
  const viewer = page.getByRole("dialog", { name: "图册图片预览" });
  await expect(viewer.getByRole("status")).toHaveText("图片加载失败");
  await expect(viewer.getByRole("button", { name: "放大" })).toBeDisabled();
  await viewer.getByRole("button", { name: "下一张" }).click();
  await expect(viewer.getByRole("img", { name: "好图" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await page.addScriptTag({ type: "module", content: `${script}\nopenGalleryLightbox(document, [], 0)` });
  await expect(viewer).toHaveCount(0);
});
