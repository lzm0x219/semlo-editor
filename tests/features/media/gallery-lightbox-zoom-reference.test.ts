import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

import { expect, test } from "@rstest/playwright";

const source = [
  "features/media/shared/crop.ts",
  "features/media/shared/modal-order.ts",
  "features/media/shared/transform.ts",
  "features/media/shared/lightbox.ts",
]
  .map((name) =>
    stripTypeScriptTypes(readFileSync(`packages/core/src/${name}`, "utf8")).replace(
      /^import[^\n]*from ['"][^'"]+['"];?\s*$/gm,
      "",
    ),
  )
  .join("\n");

test("preview zoom reaches five times original size and stops", async ({ page }) => {
  await page.setContent("<body></body>");
  await page.addStyleTag({ content: readFileSync("packages/core/src/features/media/shared/lightbox.css", "utf8") });
  await page.addScriptTag({
    type: "module",
    content: `${source}
      const src = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"/>'], {type:'image/svg+xml'}))
      openGalleryLightbox(document, [{id:'test', src, title:'测试图片', href:''}], 0)`,
  });
  const viewer = page.getByRole("dialog", { name: "图册图片预览" });
  const image = viewer.getByRole("img", { name: "测试图片" });
  const zoom = viewer.getByRole("button", { name: "放大" });
  await expect(image).toBeVisible();
  for (let index = 0; index < 9; index++) await zoom.click();
  await expect(zoom).toBeDisabled();
  await expect.poll(async () => (await image.boundingBox())?.width).toBe(1600);
});

test("best size restores a large image to the viewport after original size", async ({ page }) => {
  await page.setContent("<body></body>");
  await page.addStyleTag({ content: readFileSync("packages/core/src/features/media/shared/lightbox.css", "utf8") });
  await page.addScriptTag({
    type: "module",
    content: `${source}
      const src = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000"/>'], {type:'image/svg+xml'}))
      openGalleryLightbox(document, [{id:'test', src, title:'大图', href:''}], 0)`,
  });
  const viewer = page.getByRole("dialog", { name: "图册图片预览" });
  const image = viewer.getByRole("img", { name: "大图" });
  await expect(image).toBeVisible();
  await expect(viewer.getByRole("button", { name: "原始大小" })).toHaveAttribute("data-tooltip", "实际尺寸");
  await expect(viewer.getByRole("button", { name: "最佳大小" })).toHaveAttribute("data-tooltip", "适应屏幕");
  await viewer.getByRole("button", { name: "原始大小" }).hover();
  const tooltip = await viewer.getByRole("button", { name: "原始大小" }).evaluate((button) => {
    const style = getComputedStyle(button, "::after");
    return { opacity: style.opacity, background: style.backgroundColor, padding: style.padding };
  });
  expect(tooltip).toEqual({ opacity: "1", background: "rgba(0, 0, 0, 0.75)", padding: "6px 8px" });
  const fitted = (await image.boundingBox())!.width;
  const best = viewer.getByRole("button", { name: "最佳大小" });
  await expect(best).toBeDisabled();
  await expect(best).toHaveAttribute("aria-pressed", "false");
  await viewer.getByRole("button", { name: "原始大小" }).click();
  await expect.poll(async () => (await image.boundingBox())!.width).toBe(2000);
  await expect(best).toBeEnabled();
  await best.click();
  await expect.poll(async () => (await image.boundingBox())!.width).toBe(fitted);
  await expect(best).toHaveAttribute("aria-pressed", "true");
  await expect(best).toHaveCSS("background-color", "rgb(69, 69, 69)");
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
});

test("best fit uses the available preview height in a narrow window", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 300 });
  await page.setContent("<body></body>");
  await page.addStyleTag({ content: readFileSync("packages/core/src/features/media/shared/lightbox.css", "utf8") });
  await page.addScriptTag({
    type: "module",
    content: `${source}
      const src = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"/>'], {type:'image/svg+xml'}))
      openGalleryLightbox(document, [{id:'test', src, title:'窄屏图', href:''}], 0)`,
  });
  const viewer = page.getByRole("dialog", { name: "图册图片预览" });
  const image = viewer.getByRole("img", { name: "窄屏图" });
  await expect(image).toBeVisible();
  expect((await image.boundingBox())!.width).toBeCloseTo(281.6, 0);
  expect(Math.round((await viewer.getByRole("button", { name: "原始大小" }).boundingBox())!.y)).toBe(272);
  expect(Math.round((await viewer.getByRole("button", { name: "最佳大小" }).boundingBox())!.y)).toBe(272);
  await viewer.getByRole("button", { name: "原始大小" }).click();
  const keyframe = await viewer
    .locator(".semlo-editor-gallery-lightbox-image-frame")
    .evaluate(
      (element) => (element.getAnimations()[0]?.effect as KeyframeEffect | undefined)?.getKeyframes()[0]?.transform,
    );
  expect(keyframe).toContain("12px");
  await expect.poll(async () => (await image.boundingBox())!.width).toBe(320);
  expect((await image.boundingBox())!.y).toBe(20);
  await viewer.getByRole("button", { name: "放大" }).click();
  await viewer.getByRole("button", { name: "放大" }).click();
  await expect.poll(async () => (await image.boundingBox())!.width).toBeCloseTo(460.8, 0);
  expect((await image.boundingBox())!.y).toBeCloseTo(-24, 0);
  await page.mouse.move(180, 130);
  await page.mouse.wheel(0, 500);
  await expect.poll(async () => (await image.boundingBox())!.y).toBeCloseTo(-68, 0);
  await viewer.getByRole("button", { name: "最佳大小" }).click();
  await expect.poll(async () => (await image.boundingBox())!.width).toBeCloseTo(281.6, 0);
});

test("window resize returns a manually zoomed image to best fit", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setContent("<body></body>");
  await page.addStyleTag({ content: readFileSync("packages/core/src/features/media/shared/lightbox.css", "utf8") });
  await page.addScriptTag({
    type: "module",
    content: `${source}
      const src = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"/>'], {type:'image/svg+xml'}))
      openGalleryLightbox(document, [{id:'test', src, title:'窗口测试', href:''}], 0)`,
  });
  const viewer = page.getByRole("dialog", { name: "图册图片预览" });
  const image = viewer.getByRole("img", { name: "窗口测试" });
  await expect(image).toBeVisible();
  await viewer.getByRole("button", { name: "放大" }).click();
  await expect.poll(async () => (await image.boundingBox())!.width).toBe(384);
  await page.setViewportSize({ width: 360, height: 300 });
  await expect.poll(async () => (await image.boundingBox())!.width).toBeCloseTo(281.6, 0);
});

test("preview toolbar wraps its last control in a 375px viewport", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.setContent("<body></body>");
  await page.addStyleTag({ content: readFileSync("packages/core/src/features/media/shared/lightbox.css", "utf8") });
  await page.addScriptTag({
    type: "module",
    content: `${source}
      const src = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"/>'], {type:'image/svg+xml'}))
      openGalleryLightbox(document, [{id:'test', src, title:'手机图', href:''}], 0)`,
  });
  const viewer = page.getByRole("dialog", { name: "图册图片预览" });
  const phoneImage = viewer.getByRole("img", { name: "手机图" });
  await expect(phoneImage).toBeVisible();
  const phoneBounds = (await phoneImage.boundingBox())!;
  expect(phoneBounds.x).toBe(32);
  expect(phoneBounds.width).toBe(311);
  expect(phoneBounds.y).toBeCloseTo(218.3, 0);
  const original = (await viewer.getByRole("button", { name: "原始大小" }).boundingBox())!;
  const best = (await viewer.getByRole("button", { name: "最佳大小" }).boundingBox())!;
  expect(Math.round(original.y)).toBe(605);
  expect(Math.round(best.y)).toBe(639);
});

test("zoom transitions respect reduced motion and cancel on viewport resize", async ({ page }) => {
  await page.setContent("<body></body>");
  await page.addStyleTag({ content: readFileSync("packages/core/src/features/media/shared/lightbox.css", "utf8") });
  await page.addScriptTag({
    type: "module",
    content: `${source}
      const src = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"/>'], {type:'image/svg+xml'}))
      openGalleryLightbox(document, [{id:'test', src, title:'动画图', href:''}], 0)`,
  });
  const viewer = page.getByRole("dialog", { name: "图册图片预览" });
  const image = viewer.getByRole("img", { name: "动画图" });
  const frame = viewer.locator(".semlo-editor-gallery-lightbox-image-frame");
  await expect(image).toBeVisible();
  const actual = viewer.getByRole("button", { name: "原始大小" });
  await expect(actual).toHaveAttribute("aria-pressed", "true");
  await expect(actual).toHaveCSS("background-color", "rgb(69, 69, 69)");
  await viewer.getByRole("button", { name: "放大" }).click();
  await expect(actual).toHaveAttribute("aria-pressed", "false");
  expect(await frame.evaluate((element) => element.getAnimations()[0]?.effect?.getTiming().duration)).toBe(100);
  await expect.poll(async () => (await image.boundingBox())!.width).toBe(384);
  await image.click();
  expect(await frame.evaluate((element) => element.getAnimations()[0]?.effect?.getTiming().duration)).toBe(333);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect.poll(() => frame.evaluate((element) => element.getAnimations().length)).toBe(0);
  await expect.poll(async () => (await image.boundingBox())!.width).toBe(320);
  await viewer.getByRole("button", { name: "放大" }).click();
  expect(await frame.evaluate((element) => element.getAnimations().length)).toBe(0);
  expect((await image.boundingBox())!.width).toBe(384);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await image.click();
  await page.setViewportSize({ width: 360, height: 300 });
  await expect.poll(() => frame.evaluate((element) => element.getAnimations().length)).toBe(0);
  await expect.poll(async () => (await image.boundingBox())!.width).toBeCloseTo(281.6, 0);
});

test("switching pictures cancels an in-progress zoom transition", async ({ page }) => {
  await page.setContent("<body></body>");
  await page.addStyleTag({ content: readFileSync("packages/core/src/features/media/shared/lightbox.css", "utf8") });
  await page.addScriptTag({
    type: "module",
    content: `${source}
      const src = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"/>'], {type:'image/svg+xml'}))
      openGalleryLightbox(document, [{id:'first', src, title:'第一张', href:''}, {id:'second', src, title:'第二张', href:''}], 0)`,
  });
  const viewer = page.getByRole("dialog", { name: "图册图片预览" });
  const frame = viewer.locator(".semlo-editor-gallery-lightbox-image-frame");
  await expect(viewer.getByRole("img", { name: "第一张" })).toBeVisible();
  await viewer.getByRole("button", { name: "放大" }).click();
  await expect.poll(async () => (await viewer.getByRole("img", { name: "第一张" }).boundingBox())!.width).toBe(384);
  await viewer.getByRole("img", { name: "第一张" }).click();
  expect(await frame.evaluate((element) => element.getAnimations().length)).toBe(1);
  await viewer.getByRole("button", { name: "下一张" }).click();
  const second = viewer.getByRole("img", { name: "第二张" });
  await expect(second).toBeVisible();
  expect(await frame.evaluate((element) => element.getAnimations().length)).toBe(0);
  expect((await second.boundingBox())!.width).toBe(320);
});

test("desktop preview toolbar follows the measured control dimensions", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setContent("<body></body>");
  await page.addStyleTag({ content: readFileSync("packages/core/src/features/media/shared/lightbox.css", "utf8") });
  await page.addScriptTag({
    type: "module",
    content: `${source}
      const src = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"/>'], {type:'image/svg+xml'}))
      openGalleryLightbox(document, [{id:'one', src, title:'图一', href:''}, {id:'two', src, title:'图二', href:''}, {id:'three', src, title:'图三', href:''}, {id:'four', src, title:'图四', href:''}], 0)`,
  });
  const viewer = page.getByRole("dialog", { name: "图册图片预览" });
  await expect(viewer.getByRole("img", { name: "图一" })).toBeVisible();
  const image = (await viewer.getByRole("img", { name: "图一" }).boundingBox())!;
  expect(image.x).toBe(480);
  expect(image.y).toBe(242);
  const close = (await viewer.getByRole("button", { name: "关闭图片预览" }).boundingBox())!;
  expect(close).toEqual({ x: 1200, y: 32, width: 48, height: 48 });
  const toolbar = (await viewer.getByRole("toolbar").boundingBox())!;
  const previous = (await viewer.getByRole("button", { name: "上一张" }).boundingBox())!;
  const original = (await viewer.getByRole("button", { name: "原始大小" }).boundingBox())!;
  expect(toolbar.width).toBeCloseTo(345.47, -1);
  expect(toolbar.height).toBe(58);
  expect(previous.width).toBe(32);
  expect(previous.x - toolbar.x).toBe(18);
  expect(previous.y - toolbar.y).toBe(14);
  expect(original.width).toBe(32);
  expect(original.y - toolbar.y).toBe(12);
});
