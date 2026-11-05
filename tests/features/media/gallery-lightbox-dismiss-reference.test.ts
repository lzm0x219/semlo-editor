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

for (const target of ["image", "background"] as const) {
  test(`single click on preview ${target} closes it`, async ({ page }) => {
    await page.setContent('<button id="opener">打开</button>');
    await page.addStyleTag({ content: readFileSync("packages/core/src/features/media/shared/lightbox.css", "utf8") });
    await page.locator("#opener").focus();
    await page.addScriptTag({
      type: "module",
      content: `${source}
        const src = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"/>'], {type:'image/svg+xml'}))
        openGalleryLightbox(document, [{id:'test', src, title:'预览图', href:''}], 0)`,
    });
    const viewer = page.getByRole("dialog", { name: "图册图片预览" });
    await expect(viewer.getByRole("img", { name: "预览图" })).toBeVisible();
    if (target === "image") await viewer.getByRole("img", { name: "预览图" }).click();
    else await viewer.click({ position: { x: 5, y: 350 } });
    await expect(viewer).toHaveCount(0);
    await expect(page.locator("#opener")).toBeFocused();
  });
}

test("dragging a zoomed image does not dismiss the preview", async ({ page }) => {
  await page.setContent("<body></body>");
  await page.addStyleTag({ content: readFileSync("packages/core/src/features/media/shared/lightbox.css", "utf8") });
  await page.addScriptTag({
    type: "module",
    content: `${source}
      const src = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000"/>'], {type:'image/svg+xml'}))
      openGalleryLightbox(document, [{id:'test', src, title:'大图', href:''}], 0)`,
  });
  const viewer = page.getByRole("dialog", { name: "图册图片预览" });
  await expect(viewer.getByRole("img", { name: "大图" })).toBeVisible();
  await viewer.getByRole("button", { name: "原始大小" }).click();
  const stage = viewer.locator(".semlo-editor-gallery-lightbox-stage");
  const bounds = (await stage.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 - 100, bounds.y + bounds.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(viewer).toBeVisible();
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await expect(viewer).toBeVisible();
  await expect
    .poll(async () => (await viewer.getByRole("img", { name: "大图" }).boundingBox())!.width)
    .toBeLessThan(2000);
});

test("clicking a manually zoomed image restores the fitted size before a second click closes it", async ({ page }) => {
  await page.setContent("<body></body>");
  await page.addStyleTag({ content: readFileSync("packages/core/src/features/media/shared/lightbox.css", "utf8") });
  await page.addScriptTag({
    type: "module",
    content: `${source}
      const src = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"/>'], {type:'image/svg+xml'}))
      openGalleryLightbox(document, [{id:'test', src, title:'预览图', href:''}], 0)`,
  });
  const viewer = page.getByRole("dialog", { name: "图册图片预览" });
  const image = viewer.getByRole("img", { name: "预览图" });
  await expect(image).toBeVisible();
  await viewer.getByRole("button", { name: "放大" }).click();
  await expect.poll(async () => (await image.boundingBox())!.width).toBe(384);
  await image.click();
  await expect(viewer).toBeVisible();
  await expect.poll(async () => (await image.boundingBox())!.width).toBe(320);
  await image.click();
  await expect(viewer).toHaveCount(0);
});

test("horizontal drags switch fitted images without turning short drags into clicks", async ({ page }) => {
  await page.setContent("<body></body>");
  await page.addStyleTag({ content: readFileSync("packages/core/src/features/media/shared/lightbox.css", "utf8") });
  await page.addScriptTag({
    type: "module",
    content: `${source}
      const src = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"/>'], {type:'image/svg+xml'}))
      openGalleryLightbox(document, [{id:'first', src, title:'第一张', href:''}, {id:'second', src, title:'第二张', href:''}], 0)`,
  });
  const viewer = page.getByRole("dialog", { name: "图册图片预览" });
  const image = viewer.getByRole("img", { name: "第一张" });
  await expect(image).toBeVisible();
  const box = (await image.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 10, y);
  await page.mouse.up();
  await expect(viewer).toBeVisible();
  await expect(image).toBeVisible();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 40, y, { steps: 4 });
  await page.mouse.up();
  await expect(viewer.getByRole("img", { name: "第二张" })).toBeVisible();
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y, { steps: 4 });
  await page.mouse.up();
  await expect(image).toBeVisible();
  await viewer.getByRole("button", { name: "放大" }).click();
  await expect.poll(async () => (await image.boundingBox())!.width).toBe(384);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 100, y, { steps: 4 });
  await page.mouse.up();
  await expect(image).toBeVisible();
  await expect(viewer.getByText("1 / 2")).toBeVisible();
  await image.click();
  await expect.poll(async () => (await image.boundingBox())!.width).toBe(320);
  await image.click();
  await expect(viewer).toHaveCount(0);
});

test("swipe transitions are cancelled when reduced motion is enabled", async ({ page }) => {
  await page.setContent("<body></body>");
  await page.addStyleTag({ content: readFileSync("packages/core/src/features/media/shared/lightbox.css", "utf8") });
  await page.addScriptTag({
    type: "module",
    content: `${source}
      const src = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"/>'], {type:'image/svg+xml'}))
      openGalleryLightbox(document, [{id:'first', src, title:'第一张', href:''}, {id:'second', src, title:'第二张', href:''}], 0)`,
  });
  const viewer = page.getByRole("dialog", { name: "图册图片预览" });
  const image = viewer.getByRole("img", { name: "第一张" });
  await expect(image).toBeVisible();
  const box = (await image.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 40, y, { steps: 4 });
  await page.mouse.up();
  const frames = viewer.locator(".semlo-editor-gallery-lightbox-image-frame");
  await expect(frames).toHaveCount(2);
  await expect(viewer.getByText("1 / 2")).toBeVisible();
  const outgoing = viewer.locator('.semlo-editor-gallery-lightbox-image-frame[aria-hidden="true"]');
  expect(await outgoing.evaluate((element) => element.getAnimations()[0]?.effect?.getTiming().duration)).toBe(360);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(frames).toHaveCount(1);
  await expect(viewer.getByText("2 / 2")).toBeVisible();
  await expect(viewer.getByRole("img", { name: "第二张" })).toBeVisible();
  expect(await frames.evaluate((element) => element.getAnimations().length)).toBe(0);
});

test("clicking a fitted image smaller than its original size toggles zoom rather than closing", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
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
  const actual = viewer.getByRole("button", { name: "原始大小" });
  const best = viewer.getByRole("button", { name: "最佳大小" });
  await expect(image).toBeVisible();
  await expect(image).toHaveCSS("cursor", "zoom-in");
  expect((await image.boundingBox())!.width).toBe(311);
  await image.click();
  await expect(viewer).toBeVisible();
  await expect.poll(async () => (await image.boundingBox())!.width).toBe(320);
  await expect(actual).toHaveAttribute("aria-pressed", "true");
  await image.click();
  await expect(viewer).toBeVisible();
  await expect.poll(async () => (await image.boundingBox())!.width).toBe(311);
  await expect(best).toHaveAttribute("aria-pressed", "true");
  await viewer.click({ position: { x: 5, y: 350 } });
  await expect(viewer).toHaveCount(0);
});

test("a drag interrupts an in-progress zoom back to fit", async ({ page }) => {
  await page.setContent("<body></body>");
  await page.addStyleTag({ content: readFileSync("packages/core/src/features/media/shared/lightbox.css", "utf8") });
  await page.addScriptTag({
    type: "module",
    content: `${source}
      const src = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"/>'], {type:'image/svg+xml'}))
      openGalleryLightbox(document, [{id:'first', src, title:'第一张', href:''}, {id:'second', src, title:'第二张', href:''}], 0)`,
  });
  const viewer = page.getByRole("dialog", { name: "图册图片预览" });
  const image = viewer.getByRole("img", { name: "第一张" });
  await expect(image).toBeVisible();
  await viewer.getByRole("button", { name: "放大" }).click();
  await expect.poll(async () => (await image.boundingBox())!.width).toBe(384);
  await image.click();
  const frame = viewer.locator(".semlo-editor-gallery-lightbox-image-frame");
  expect(await frame.evaluate((element) => element.getAnimations()[0]?.effect?.getTiming().duration)).toBe(333);
  const bounds = (await frame.boundingBox())!;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 60, y, { steps: 4 });
  await page.mouse.up();
  await expect(viewer.getByRole("img", { name: "第二张" })).toBeVisible();
});

test("wheel events in preview do not scroll the document underneath", async ({ page }) => {
  await page.setContent('<body style="height:3000px"></body>');
  await page.addStyleTag({ content: readFileSync("packages/core/src/features/media/shared/lightbox.css", "utf8") });
  await page.addScriptTag({
    type: "module",
    content: `${source}
      const src = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"/>'], {type:'image/svg+xml'}))
      openGalleryLightbox(document, [{id:'test', src, title:'预览图', href:''}], 0)`,
  });
  const viewer = page.getByRole("dialog", { name: "图册图片预览" });
  await expect(viewer.getByRole("img", { name: "预览图" })).toBeVisible();
  const stage = (await viewer.locator(".semlo-editor-gallery-lightbox-stage").boundingBox())!;
  await page.mouse.move(stage.x + stage.width / 2, stage.y + stage.height / 2);
  await page.mouse.wheel(0, 600);
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const toolbar = (await viewer.getByRole("toolbar").boundingBox())!;
  await page.mouse.move(toolbar.x + toolbar.width / 2, toolbar.y + toolbar.height / 2);
  await page.mouse.wheel(0, 600);
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
});
