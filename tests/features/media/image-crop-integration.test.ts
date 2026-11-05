import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { imageNodes } from "../../fixtures/media/image-test-helpers";

declare global {
  interface Window {
    imageCropEditor?: EditorController;
    imageCropClipboard?: ClipboardItem[];
  }
}

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'image-crop-integration'
      host.style.width = '700px'
      document.body.prepend(host)
      window.imageCropEditor = createEditor({ element: host, outline: false, content: { type: 'doc', content: [
        { type: "paragraph", attrs: { textAlign: "center" }, content: [{ type: 'image', attrs: { src: '/tests/sample-image.svg', alt: '裁剪图片', width: 300, height: 130,
          semloEditorCaption: '保留说明', semloEditorCaptionVisible: true, semloEditorImageStyle: 'shadow',
          semloEditorImageHref: 'https://example.com/crop', semloEditorImageOpenInCurrent: true } }] },
        { type: 'paragraph', content: [{ type: 'text', text: '后续正文' }] },
      ] } })
    `,
  });
  await page.waitForFunction(() => Boolean(window.imageCropEditor));
  const host = page.locator("#image-crop-integration");
  const frame = host.locator(".semlo-editor-image-frame");
  await expect.poll(() => frame.locator("img").evaluate((item) => (item as HTMLImageElement).naturalWidth)).toBe(600);
  await frame.locator("img").click();
  return { host, frame };
}

const snapshot = (page: Page) => page.evaluate(() => window.__semloRequireFixture("imageCropEditor").getSnapshot());
const attrs = async (page: Page) => imageNodes((await snapshot(page)).json)[0]?.attrs;
async function drag(page: Page, fromX: number, fromY: number, toX: number, toY: number) {
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move(toX, toY, { steps: 5 });
  await page.mouse.up();
}
async function cropBottomRight(page: Page, frame: ReturnType<Page["locator"]>) {
  const bounds = (await frame.boundingBox())!;
  await drag(
    page,
    bounds.x + bounds.width - 2,
    bounds.y + bounds.height - 2,
    bounds.x + bounds.width - 92,
    bounds.y + bounds.height - 28,
  );
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("crop can be edited again, rotated, resized, previewed and restored", async ({ page }) => {
  const { host, frame } = await mount(page);
  await host.getByRole("button", { name: "裁剪图片" }).click();
  const selection = frame.getByRole("group", { name: "图片裁剪区域" });
  await expect(selection).toBeVisible();
  await expect(frame.locator(".semlo-editor-image-toolbar")).toBeHidden();
  await cropBottomRight(page, frame);
  expect(await attrs(page)).toMatchObject({ width: 300, height: 130, semloEditorImageCrop: null });
  await page.keyboard.press("Escape");
  await expect(selection).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(selection).toHaveCount(0);
  await frame.hover();
  await expect(frame.locator(".semlo-editor-image-toolbar")).toBeVisible();
  expect(await attrs(page)).toMatchObject({
    width: 210,
    height: 104,
    semloEditorImageCrop: { x: 0, y: 0, width: 0.7, height: 0.8 },
  });
  await host.getByRole("button", { name: "撤销", exact: true }).click();
  expect(await attrs(page)).toMatchObject({ width: 300, height: 130, semloEditorImageCrop: null });
  await host.getByRole("button", { name: "重做", exact: true }).click();
  expect(await attrs(page)).toMatchObject({ width: 210, height: 104 });
  await frame.click({ position: { x: 20, y: 20 } });
  await host.getByRole("button", { name: "裁剪图片" }).click();
  const fullBounds = (await frame.boundingBox())!;
  const area = (await selection.boundingBox())!;
  expect(Math.round(fullBounds.width)).toBe(300);
  expect(Math.round(area.width)).toBe(210);
  await drag(page, area.x + 50, area.y + 50, area.x + 80, area.y + 63);
  await host.getByRole("button", { name: "裁剪图片" }).click();
  expect(await attrs(page)).toMatchObject({ semloEditorImageCrop: { x: 0.1, y: 0.1, width: 0.7, height: 0.8 } });
  await host.getByRole("button", { name: "逆时针旋转 90 度" }).click();
  expect(await attrs(page)).toMatchObject({
    semloEditorImageRotation: 270,
    semloEditorImageCrop: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 },
    width: 104,
    height: 210,
  });
  await host.getByRole("button", { name: "图片尺寸" }).click();
  const size = host.getByRole("dialog", { name: "图片尺寸" });
  await expect(size.getByLabel("图片宽度")).toHaveValue("104");
  await expect(size.getByLabel("图片高度")).toHaveValue("210");
  await expect(size.getByRole("radio", { name: "50%" })).toHaveAttribute("aria-checked", "true");
  await size.getByRole("radio", { name: "25%" }).click();
  expect(await attrs(page)).toMatchObject({ width: 52, height: 105 });
  await host.getByRole("button", { name: "撤销", exact: true }).click();
  expect(await attrs(page)).toMatchObject({ width: 104, height: 210 });
  await frame.click({ position: { x: 10, y: 100 } });
  const resize = (await frame.getByRole("button", { name: "调整图片大小（右下）" }).boundingBox())!;
  await drag(
    page,
    resize.x + resize.width / 2,
    resize.y + resize.height / 2,
    resize.x + resize.width / 2 + 10,
    resize.y + resize.height / 2 + 20,
  );
  expect((await attrs(page))?.width).toBeGreaterThan(104);
  await host.getByRole("button", { name: "撤销", exact: true }).click();
  expect(await attrs(page)).toMatchObject({ width: 104, height: 210 });
  const rotated = await snapshot(page);
  const geometry = await page.evaluate((html) => {
    const container = document.createElement("div");
    container.style.width = "600px";
    container.innerHTML = html;
    document.body.append(container);
    const frame = container.querySelector("[data-semlo-editor-image] a > span")!.getBoundingClientRect();
    const image = container.querySelector("[data-semlo-editor-image] img") as HTMLImageElement;
    const clip = getComputedStyle(image).clipPath;
    container.remove();
    return { width: frame.width, height: frame.height, clip };
  }, rotated.html);
  expect(Math.round(geometry.width)).toBe(104);
  expect(Math.round(geometry.height)).toBe(210);
  expect(geometry.clip).toMatch(/inset\(/);
  await page.evaluate((html) => window.__semloRequireFixture("imageCropEditor").setContent(html), rotated.html);
  expect(await attrs(page)).toMatchObject({
    semloEditorImageRotation: 270,
    semloEditorImageCrop: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 },
  });
  await frame.hover();
  await frame.getByRole("button", { name: "预览图片" }).click();
  const viewer = page.getByRole("dialog", { name: "图片预览" });
  await viewer.getByRole("button", { name: "原始大小" }).click();
  const previewFrame = viewer.locator(".semlo-editor-gallery-lightbox-image-frame");
  await expect.poll(async () => Math.round((await previewFrame.boundingBox())!.width)).toBe(208);
  expect(Math.round((await previewFrame.boundingBox())!.height)).toBe(420);
  await expect(viewer.getByRole("img")).toHaveCSS("clip-path", /inset\(/);
  await viewer.getByRole("button", { name: "关闭图片预览" }).click();
  await frame.click({ position: { x: 10, y: 100 } });
  await host.getByRole("button", { name: "还原图片" }).click();
  expect(await attrs(page)).toMatchObject({
    semloEditorImageRotation: 0,
    semloEditorImageCrop: null,
    width: 300,
    height: 130,
  });
});

test("preview switches between different crops of the same image", async ({ page }) => {
  const { host } = await mount(page);
  await page.evaluate(() =>
    window.__semloRequireFixture("imageCropEditor").setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "image",
              attrs: {
                src: "/tests/sample-image.svg",
                alt: "第一张裁剪图",
                width: 150,
                height: 52,
                semloEditorImageCrop: { x: 0, y: 0, width: 0.5, height: 0.4 },
              },
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            {
              type: "image",
              attrs: {
                src: "/tests/sample-image.svg",
                alt: "第二张旋转裁剪图",
                width: 104,
                height: 210,
                semloEditorImageRotation: 270,
                semloEditorImageCrop: { x: 0.1, y: 0.2, width: 0.8, height: 0.7 },
              },
            },
          ],
        },
      ],
    }),
  );
  const frames = host.locator(".semlo-editor-image-frame");
  await frames.first().hover();
  await frames.first().getByRole("button", { name: "预览图片" }).click();
  const viewer = page.getByRole("dialog", { name: "图片预览" });
  await expect(viewer.getByRole("img", { name: "第一张裁剪图" })).toBeVisible();
  await viewer.getByRole("button", { name: "原始大小" }).click();
  const previewFrame = viewer.locator(".semlo-editor-gallery-lightbox-image-frame");
  await expect.poll(async () => Math.round((await previewFrame.boundingBox())!.width)).toBe(300);
  await expect.poll(async () => Math.round((await previewFrame.boundingBox())!.height)).toBe(104);
  await viewer.getByRole("button", { name: "下一张" }).click();
  await expect(viewer.getByRole("img", { name: "第二张旋转裁剪图" })).toBeVisible();
  await viewer.getByRole("button", { name: "原始大小" }).click();
  await expect.poll(async () => Math.round((await previewFrame.boundingBox())!.width)).toBe(208);
  await expect.poll(async () => Math.round((await previewFrame.boundingBox())!.height)).toBe(420);
});

test("cropped content survives static HTML, copy, JSON and read-only mode", async ({ page }) => {
  const { host, frame } = await mount(page);
  await host.getByRole("button", { name: "裁剪图片" }).click();
  await cropBottomRight(page, frame);
  await host.locator(".semlo-editor-prose p").filter({ hasText: "后续正文" }).click();
  expect(await attrs(page)).toMatchObject({
    width: 210,
    height: 104,
    semloEditorImageCrop: { x: 0, y: 0, width: 0.7, height: 0.8 },
  });
  await frame.click({ position: { x: 20, y: 20 } });
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write: async (items: ClipboardItem[]) => (window.imageCropClipboard = items) },
    }),
  );
  await frame.getByRole("button", { name: "图片更多操作" }).click();
  await frame.getByRole("menuitem", { name: "复制图片" }).click();
  const copied = await page.evaluate(async () =>
    (await window.__semloRequireFixture("imageCropClipboard")[0].getType("text/html")).text(),
  );
  const saved = await snapshot(page);
  for (const [content, paragraphAlignment] of [
    [saved.html, "center"],
    [copied, null],
    [saved.json, "center"],
  ] as const) {
    await page.evaluate((value) => {
      window.__semloRequireFixture("imageCropEditor").setContent("<p>临时内容</p>");
      window.__semloRequireFixture("imageCropEditor").setContent(value);
    }, content);
    expect(await attrs(page)).toMatchObject({
      semloEditorImageCrop: { x: 0, y: 0, width: 0.7, height: 0.8 },
      semloEditorImageStyle: "shadow",
      semloEditorCaption: "保留说明",
      semloEditorImageHref: "https://example.com/crop",
      semloEditorImageOpenInCurrent: true,
    });
    if (paragraphAlignment) expect((await snapshot(page)).json.content?.[0].attrs?.textAlign).toBe(paragraphAlignment);
    await expect(frame.locator("img")).toHaveCSS("clip-path", /inset\(/);
  }
  expect(saved.html).toContain("data-semlo-editor-image-crop=");
  expect(saved.html).toContain("clip-path: inset(");
  await page.evaluate(() => window.__semloRequireFixture("imageCropEditor").setEditable(false));
  await expect(host.getByRole("link", { name: "打开图片链接" })).toHaveAttribute("target", "_self");
  await expect(frame.getByRole("button", { name: "裁剪图片" })).toBeHidden();
  await frame.hover();
  await frame.getByRole("button", { name: "预览图片" }).click();
  await expect(page.getByRole("dialog", { name: "图片预览" }).getByRole("img")).toHaveCSS("clip-path", /inset\(/);
});

test("unfinished drafts cannot affect read-only, replacement or destroyed editors", async ({ page }) => {
  const { host, frame } = await mount(page);
  await host.getByRole("button", { name: "裁剪图片" }).click();
  await cropBottomRight(page, frame);
  await page.evaluate(() => window.__semloRequireFixture("imageCropEditor").setEditable(false));
  await expect(frame.getByRole("group", { name: "图片裁剪区域" })).toHaveCount(0);
  expect(await attrs(page)).toMatchObject({ width: 300, height: 130, semloEditorImageCrop: null });
  await page.evaluate(() => window.__semloRequireFixture("imageCropEditor").setEditable(true));
  await frame.locator("img").click();
  await host.getByRole("button", { name: "裁剪图片" }).click();
  await cropBottomRight(page, frame);
  await page.evaluate(() =>
    window.__semloRequireFixture("imageCropEditor").setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "image", attrs: { src: "/tests/sample-image.svg", alt: "替换图片", width: 150, height: 65 } },
          ],
        },
      ],
    }),
  );
  await page.keyboard.press("Enter");
  expect(await attrs(page)).toMatchObject({ alt: "替换图片", width: 150, height: 65, semloEditorImageCrop: null });
  await frame.locator("img").click({ position: { x: 10, y: 40 } });
  await host.getByRole("button", { name: "裁剪图片" }).click();
  await page.evaluate(() => window.__semloRequireFixture("imageCropEditor").destroy());
  await expect(page.locator(".semlo-editor-image-crop-control")).toHaveCount(0);
});

test("opening and finishing without changing an unsized image is a no-op", async ({ page }) => {
  const { host, frame } = await mount(page);
  await page.evaluate(() =>
    window.__semloRequireFixture("imageCropEditor").setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "image", attrs: { src: "/tests/sample-image.svg", alt: "无指定尺寸" } }],
        },
      ],
    }),
  );
  await expect.poll(() => frame.locator("img").evaluate((item) => (item as HTMLImageElement).naturalWidth)).toBe(600);
  await frame.locator("img").click({ position: { x: 30, y: 30 } });
  const before = (await snapshot(page)).json;
  await host.getByRole("button", { name: "裁剪图片" }).click();
  await page.keyboard.press("Enter");
  expect((await snapshot(page)).json).toEqual(before);
});

test("malformed dimensions and crop data do not generate non-finite styles", async ({ page }) => {
  const { host } = await mount(page);
  await page.evaluate(() =>
    window.__semloRequireFixture("imageCropEditor").setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "image",
              attrs: {
                src: "/tests/sample-image.svg",
                width: 1e308,
                height: 1e308,
                semloEditorImageRotation: 270,
                semloEditorImageCrop: { x: 0, y: 0, width: 0.000001, height: 0.000001 },
              },
            },
          ],
        },
      ],
    }),
  );
  const html = (await snapshot(page)).html;
  expect(html).not.toMatch(/Infinity|NaN|1e\+308/);
  const style = await host.locator(".semlo-editor-image-frame img").getAttribute("style");
  expect(style).not.toMatch(/Infinity|NaN/);
});
