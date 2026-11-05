import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { imageNodes } from "../../fixtures/media/image-test-helpers";

declare global {
  interface Window {
    imageSelectionEditor?: EditorController;
  }
}

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'image-selection-test'
      host.style.width = '800px'
      document.body.prepend(host)
      window.imageSelectionEditor = createEditor({
        element: host,
        outline: false,
        content: { type: 'doc', content: [
          { type: 'paragraph', content: [{ type: 'text', text: '前文' }] },
          { type: "paragraph", content: [{ type: 'image', attrs: { src: '/tests/sample-image.svg', alt: '第一张', width: 320, height: 139,
            semloEditorCaption: '图片描述', semloEditorCaptionVisible: true } }] },
          { type: "paragraph", content: [{ type: 'image', attrs: { src: '/tests/sample-image.svg', alt: '第二张', width: 320, height: 139 } }] },
          { type: 'paragraph', content: [{ type: 'text', text: '后文' }] },
        ] },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.imageSelectionEditor));
  const host = page.locator("#image-selection-test");
  const frame = host.locator(".semlo-editor-image-frame").first();
  await expect
    .poll(() => frame.locator("img").evaluate((element) => (element as HTMLImageElement).naturalWidth))
    .toBe(600);
  return { host, frame, image: frame.locator("img") };
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("double-clicking an unselected or selected image keeps it selected without opening preview", async ({ page }) => {
  const { host, frame, image } = await mount(page);
  await expect(frame).not.toHaveClass(/is-selected/);
  await image.dblclick();
  await expect(frame).toHaveClass(/is-selected/);
  await expect(host.getByRole("button", { name: "图片尺寸" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "图片预览" })).toHaveCount(0);
  await image.dblclick();
  await expect(frame).toHaveClass(/is-selected/);
  await expect(host.getByRole("button", { name: "图片尺寸" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "图片预览" })).toHaveCount(0);
});

test("clicking the same image after a keyboard selection change selects it again", async ({ page }) => {
  const { frame, image } = await mount(page);
  await image.click();
  await expect(frame).toHaveClass(/is-selected/);
  await page.keyboard.press("ArrowLeft");
  await expect(frame).not.toHaveClass(/is-selected/);
  await image.click();
  await expect(frame).toHaveClass(/is-selected/);
});

test("read-only image double-click does not select it or change content", async ({ page }) => {
  const { host, frame, image } = await mount(page);
  await page.evaluate(() => window.__semloRequireFixture("imageSelectionEditor").setEditable(false));
  const before = await page.evaluate(() => window.__semloRequireFixture("imageSelectionEditor").getSnapshot().json);
  await image.dblclick();
  await expect(frame).not.toHaveClass(/is-selected/);
  await expect(host.getByRole("button", { name: "图片尺寸" })).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "图片预览" })).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("imageSelectionEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("dragging an image preserves its content while reordering it", async ({ page }) => {
  const { host, image } = await mount(page);
  await image.dragTo(host.locator(".semlo-editor-prose p").last(), { targetPosition: { x: 10, y: 10 } });
  const result = (await page.evaluate(() => window.__semloRequireFixture("imageSelectionEditor").getSnapshot())).json;
  const images = imageNodes(result);
  expect(images.map((node) => node.attrs?.alt)).toEqual(["第二张", "第一张"]);
  expect(images[1]?.attrs).toMatchObject({ semloEditorCaption: "图片描述", semloEditorCaptionVisible: true });
  expect(result.content?.[0].content?.[0].text).toBe("前文");
  const last = result.content?.at(-1)?.content;
  expect(last?.map((node) => node.type)).toEqual(["text", "image", "text"]);
  expect(
    last
      ?.filter((node) => node.type === "text")
      .map((node) => node.text)
      .join(""),
  ).toBe("后文");
  expect(last?.[1].attrs?.alt).toBe("第一张");
});
