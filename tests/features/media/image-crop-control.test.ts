import { readFileSync } from "node:fs";

import { expect, test, type Page } from "@rstest/playwright";

import {
  normalizeImageCropRect,
  rotateImageCropRect,
  type ImageCropRect,
} from "../../../packages/core/src/features/media/shared/crop";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { inlineMediaModules } from "../../fixtures/shared/media-inline-modules";

const script = inlineMediaModules([
  "packages/core/src/features/media/shared/crop.ts",
  "packages/core/src/features/media/image/crop-control.ts",
]);
const styles = readFileSync("packages/core/src/features/media/image/crop-control.css", "utf8");

declare global {
  interface Window {
    imageCropHarness?: {
      getRect: () => ImageCropRect;
      commits: ImageCropRect[];
      otherCommits: ImageCropRect[];
      finish: () => void;
      destroy: () => void;
    };
  }
}

async function mount(
  page: Page,
  initialRect: unknown = { x: 0.1, y: 0.2, width: 0.5, height: 0.5 },
  options: { secondCrop?: boolean; keyboardScope?: boolean } = {},
) {
  await page.setContent(
    '<div id="editor-a" contenteditable="true"><div id="stage" contenteditable="false"></div></div><div id="editor-b" contenteditable="true">另一篇文档<div id="other-stage" contenteditable="false"></div></div><button id="outside">正文</button>',
  );
  await page.addStyleTag({ content: "#stage{position:relative;width:320px;height:200px;background:#eee;margin:30px}" });
  await page.addStyleTag({
    content: "#other-stage{position:relative;width:320px;height:200px;background:#eee;margin:30px}",
  });
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({
    type: "module",
    content: `${script}
      const commits = []
      const otherCommits = []
      const control = createImageCropControl({ doc: document, stage: document.querySelector('#stage'),
        keyboardScope: ${options.keyboardScope === false ? "undefined" : "document.querySelector('#editor-a')"},
        initialRect: ${JSON.stringify(initialRect)}, onCommit: (rect) => commits.push(rect) })
      ${options.secondCrop ? "createImageCropControl({ doc: document, stage: document.querySelector('#other-stage'), keyboardScope: document.querySelector('#editor-b'), onCommit: (rect) => otherCommits.push(rect) })" : ""}
      window.imageCropHarness = { commits, otherCommits, getRect: control.getRect, finish: control.finish, destroy: control.destroy }
    `,
  });
  await page.waitForFunction(() => !!window.imageCropHarness);
  return page.locator("#stage .semlo-editor-image-crop-selection");
}

async function drag(page: Page, start: { x: number; y: number }, end: { x: number; y: number }) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 5 });
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("crop geometry normalizes unsafe input and rotates the same source region", () => {
  const full = { x: 0, y: 0, width: 1, height: 1 };
  for (const input of [null, {}, { x: NaN, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: -1, height: 1 }]) {
    expect(normalizeImageCropRect(input)).toEqual(full);
  }
  expect(normalizeImageCropRect({ x: -0.1, y: 0.25, width: 0.6, height: 2 })).toEqual({
    x: 0,
    y: 0.25,
    width: 0.5,
    height: 0.75,
  });
  const rect = { x: 0.1, y: 0.2, width: 0.5, height: 0.3 };
  expect(rotateImageCropRect(rect, 1)).toEqual({ x: 0.5, y: 0.1, width: 0.3, height: 0.5 });
  expect(rotateImageCropRect(rect, -1)).toEqual({ x: 0.2, y: 0.4, width: 0.3, height: 0.5 });
  expect(rotateImageCropRect(rect, 4)).toEqual(rect);
  expect(rotateImageCropRect(rotateImageCropRect(rect, 1), -1)).toEqual(rect);
});

test("dragging the region and its edges changes a draft, then Enter commits only once", async ({ page }) => {
  const selection = await mount(page);
  const rect = (await selection.boundingBox())!;
  await drag(
    page,
    { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
    { x: rect.x + rect.width / 2 + 64, y: rect.y + rect.height / 2 + 20 },
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("imageCropHarness").getRect())).toEqual({
    x: 0.3,
    y: 0.3,
    width: 0.5,
    height: 0.5,
  });
  const corner = (await page.getByRole("button", { name: "调整裁剪右下边界" }).boundingBox())!;
  await drag(
    page,
    { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 },
    { x: corner.x + 400, y: corner.y + 400 },
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("imageCropHarness").getRect())).toEqual({
    x: 0.3,
    y: 0.3,
    width: 0.7,
    height: 0.7,
  });
  expect(await page.evaluate(() => window.__semloRequireFixture("imageCropHarness").commits)).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(selection).toBeVisible();
  await page.locator("#editor-a").focus();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => window.__semloRequireFixture("imageCropHarness").commits)).toEqual([
    { x: 0.3, y: 0.3, width: 0.7, height: 0.7 },
  ]);
  await page.evaluate(() => window.__semloRequireFixture("imageCropHarness").finish());
  expect(await page.evaluate(() => window.__semloRequireFixture("imageCropHarness").commits)).toHaveLength(1);
  await expect(selection).toHaveCount(0);
});

test("pointer cancellation restores the last draft and destroy does not commit", async ({ page }) => {
  const selection = await mount(page);
  const rect = (await selection.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 + 30, rect.y + rect.height / 2 + 30);
  await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1, bubbles: true })));
  await page.mouse.up();
  expect(await page.evaluate(() => window.__semloRequireFixture("imageCropHarness").getRect())).toEqual({
    x: 0.1,
    y: 0.2,
    width: 0.5,
    height: 0.5,
  });
  await page.evaluate(() => {
    window.__semloRequireFixture("imageCropHarness").destroy();
    window.__semloRequireFixture("imageCropHarness").destroy();
  });
  expect(await page.evaluate(() => window.__semloRequireFixture("imageCropHarness").commits)).toEqual([]);
  await expect(selection).toHaveCount(0);
});

test("a zero-sized or disconnected image cannot commit a crop", async ({ page }) => {
  await mount(page);
  await page.locator("#stage").evaluate((node) => {
    (node as HTMLElement).style.width = "0";
  });
  await page.evaluate(() => window.__semloRequireFixture("imageCropHarness").finish());
  expect(await page.evaluate(() => window.__semloRequireFixture("imageCropHarness").commits)).toEqual([]);
  await mount(page);
  await page.locator("#stage").evaluate((node) => node.remove());
  await page.evaluate(() => window.__semloRequireFixture("imageCropHarness").finish());
  expect(await page.evaluate(() => window.__semloRequireFixture("imageCropHarness").commits)).toEqual([]);
});

test("keyboard movement and explicit finish use the same bounded geometry", async ({ page }) => {
  await mount(page);
  const right = page.getByRole("button", { name: "调整裁剪右边界" });
  await right.focus();
  await page.keyboard.press("Shift+ArrowRight");
  expect(await page.evaluate(() => window.__semloRequireFixture("imageCropHarness").getRect())).toEqual({
    x: 0.1,
    y: 0.2,
    width: 0.53125,
    height: 0.5,
  });
  await page.evaluate(() => window.__semloRequireFixture("imageCropHarness").finish());
  expect(await page.evaluate(() => window.__semloRequireFixture("imageCropHarness").commits)).toEqual([
    { x: 0.1, y: 0.2, width: 0.53125, height: 0.5 },
  ]);
});

test("Enter in a separate editor is not intercepted by a crop", async ({ page }) => {
  const selection = await mount(page);
  const otherEditor = page.locator("#editor-b");
  await otherEditor.evaluate((node) => {
    node.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Enter")
        (node as HTMLElement).dataset.enterPrevented = String(event.defaultPrevented);
    });
  });
  await otherEditor.focus();
  await page.keyboard.press("Enter");
  await expect(otherEditor).toHaveAttribute("data-enter-prevented", "false");
  expect(await page.evaluate(() => window.__semloRequireFixture("imageCropHarness").commits)).toEqual([]);
  await expect(selection).toBeVisible();

  // The ProseMirror root itself, rather than the image, normally owns focus.
  await page.locator("#editor-a").focus();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => window.__semloRequireFixture("imageCropHarness").commits)).toEqual([
    { x: 0.1, y: 0.2, width: 0.5, height: 0.5 },
  ]);
});

test("two active editors commit only their own crop on Enter", async ({ page }) => {
  const selection = await mount(page, undefined, { secondCrop: true });
  const otherSelection = page.locator("#other-stage .semlo-editor-image-crop-selection");
  await page.locator("#editor-b").focus();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => window.__semloRequireFixture("imageCropHarness").otherCommits)).toEqual([
    { x: 0, y: 0, width: 1, height: 1 },
  ]);
  expect(await page.evaluate(() => window.__semloRequireFixture("imageCropHarness").commits)).toEqual([]);
  await expect(otherSelection).toHaveCount(0);
  await expect(selection).toBeVisible();
  await page.locator("#editor-a").focus();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => window.__semloRequireFixture("imageCropHarness").commits)).toHaveLength(1);
});

test("without a host keyboard scope only the crop controls handle Enter", async ({ page }) => {
  const selection = await mount(page, undefined, { keyboardScope: false });
  await page.locator("#editor-a").focus();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => window.__semloRequireFixture("imageCropHarness").commits)).toEqual([]);
  await expect(selection).toBeVisible();
  await selection.focus();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => window.__semloRequireFixture("imageCropHarness").commits)).toHaveLength(1);
});

test("crop edges cannot cross or shrink below the visible minimum", async ({ page }) => {
  await mount(page);
  const corner = (await page.getByRole("button", { name: "调整裁剪右下边界" }).boundingBox())!;
  await drag(page, { x: corner.x + corner.width / 2, y: corner.y + corner.height / 2 }, { x: 0, y: 0 });
  const rect = await page.evaluate(() => window.__semloRequireFixture("imageCropHarness").getRect());
  expect(rect).toEqual({ x: 0.1, y: 0.2, width: 0.0875, height: 0.14 });
  expect(rect.x + rect.width).toBeLessThanOrEqual(1);
  expect(rect.y + rect.height).toBeLessThanOrEqual(1);
});

test("removing the image during a drag cannot commit the stale draft", async ({ page }) => {
  const selection = await mount(page);
  const rect = (await selection.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width / 2 + 30, rect.y + rect.height / 2 + 30);
  await page.locator("#stage").evaluate((node) => node.remove());
  await page.mouse.move(rect.x + rect.width / 2 + 50, rect.y + rect.height / 2 + 50);
  await page.mouse.up();
  await page.evaluate(() => window.__semloRequireFixture("imageCropHarness").finish());
  expect(await page.evaluate(() => window.__semloRequireFixture("imageCropHarness").commits)).toEqual([]);
});
