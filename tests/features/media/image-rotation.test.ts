import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { imageNodes } from "../../fixtures/media/image-test-helpers";

declare global {
  interface Window {
    imageRotationEditor?: EditorController;
    imageRotationClipboard?: ClipboardItem[];
  }
}

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'image-rotation-test'
      host.style.width = '700px'
      document.body.prepend(host)
      window.imageRotationEditor = createEditor({
        element: host,
        outline: false,
        content: { type: 'doc', content: [
          { type: "paragraph", attrs: { textAlign: "center" }, content: [{ type: 'image', attrs: { src: '/tests/sample-image.svg', alt: '旋转图片', width: 300, height: 130,
            semloEditorCaption: '说明', semloEditorCaptionVisible: true, semloEditorImageStyle: 'border',
            semloEditorImageHref: 'https://example.com/', semloEditorImageOpenInCurrent: true } }] },
          { type: 'paragraph', content: [{ type: 'text', text: '正文' }] }
        ] },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.imageRotationEditor));
  const host = page.locator("#image-rotation-test");
  const frame = host.locator(".semlo-editor-image-frame");
  const image = frame.locator("img");
  await expect.poll(() => image.evaluate((item) => (item as HTMLImageElement).naturalWidth)).toBe(600);
  await image.click();
  return { host, frame, image };
}

const attrs = async (page: Page) =>
  imageNodes((await page.evaluate(() => window.__semloRequireFixture("imageRotationEditor").getSnapshot())).json)[0]
    ?.attrs;

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("rotation uses visible dimensions, supports resize and independent undo", async ({ page }) => {
  const { host, frame, image } = await mount(page);
  const rotate = host.getByRole("button", { name: "逆时针旋转 90 度" });
  await rotate.click();
  expect(await attrs(page)).toMatchObject({ semloEditorImageRotation: 270, width: 130, height: 300 });
  await expect.poll(async () => Math.round((await frame.boundingBox())!.width)).toBe(130);
  await expect.poll(async () => Math.round((await frame.boundingBox())!.height)).toBe(300);
  const frameRect = (await frame.boundingBox())!;
  const imageRect = (await image.boundingBox())!;
  expect(Math.abs(imageRect.width - frameRect.width)).toBeLessThan(1);
  expect(Math.abs(imageRect.height - frameRect.height)).toBeLessThan(1);

  await host.getByRole("button", { name: "图片尺寸" }).click();
  const panel = host.getByRole("dialog", { name: "图片尺寸" });
  await expect(panel.getByLabel("图片宽度")).toHaveValue("130");
  await expect(panel.getByLabel("图片高度")).toHaveValue("300");
  await expect(panel.getByRole("radio", { name: "50%" })).toHaveAttribute("aria-checked", "true");
  await panel.getByRole("radio", { name: "25%" }).click();
  expect(await attrs(page)).toMatchObject({ semloEditorImageRotation: 270, width: 65, height: 150 });
  await host.getByRole("button", { name: "撤销", exact: true }).click();
  expect(await attrs(page)).toMatchObject({ semloEditorImageRotation: 270, width: 130, height: 300 });
  await host.getByRole("button", { name: "撤销", exact: true }).click();
  expect(await attrs(page)).toMatchObject({ semloEditorImageRotation: 0, width: 300, height: 130 });
  await host.getByRole("button", { name: "重做", exact: true }).click();
  expect(await attrs(page)).toMatchObject({ semloEditorImageRotation: 270, width: 130, height: 300 });
  await image.click();
  await rotate.click();
  expect(await attrs(page)).toMatchObject({ semloEditorImageRotation: 180, width: 300, height: 130 });
  await rotate.click();
  expect(await attrs(page)).toMatchObject({ semloEditorImageRotation: 90, width: 130, height: 300 });
  await rotate.click();
  expect(await attrs(page)).toMatchObject({ semloEditorImageRotation: 0, width: 300, height: 130 });
});

test("rotation survives JSON, standalone HTML, clipboard and read-only image preview", async ({ page }) => {
  const { host, frame, image } = await mount(page);
  await host.getByRole("button", { name: "逆时针旋转 90 度" }).click();
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write: async (items: ClipboardItem[]) => (window.imageRotationClipboard = items) },
    }),
  );
  await frame.getByRole("button", { name: "图片更多操作" }).click();
  await frame.getByRole("menuitem", { name: "复制图片" }).click();
  const copied = await page.evaluate(async () =>
    (await window.__semloRequireFixture("imageRotationClipboard")[0].getType("text/html")).text(),
  );
  const saved = await page.evaluate(() => window.__semloRequireFixture("imageRotationEditor").getSnapshot());
  const staticGeometry = await page.evaluate((html) => {
    const container = document.createElement("div");
    container.style.width = "700px";
    container.innerHTML = html;
    document.body.append(container);
    const wrapper = container.querySelector("[data-semlo-editor-image] a > span")!.getBoundingClientRect();
    const image = container.querySelector("[data-semlo-editor-image] img")!.getBoundingClientRect();
    const result = {
      wrapperWidth: wrapper.width,
      wrapperHeight: wrapper.height,
      imageWidth: image.width,
      imageHeight: image.height,
    };
    container.remove();
    return result;
  }, saved.html);
  expect(staticGeometry.wrapperWidth).toBe(130);
  expect(staticGeometry.wrapperHeight).toBe(300);
  expect(Math.abs(staticGeometry.imageWidth - 130)).toBeLessThan(1);
  expect(Math.abs(staticGeometry.imageHeight - 300)).toBeLessThan(1);
  for (const [html, paragraphAlignment] of [
    [saved.html, "center"],
    [copied, null],
  ] as const) {
    expect(html).toContain('data-semlo-editor-image-rotation="270"');
    expect(html).toContain("rotate(270deg)");
    expect(html).toContain("https://example.com/");
    await page.evaluate((content) => {
      window.__semloRequireFixture("imageRotationEditor").setContent("<p>临时内容</p>");
      window.__semloRequireFixture("imageRotationEditor").setContent(content);
    }, html);
    expect(await attrs(page)).toMatchObject({
      semloEditorImageRotation: 270,
      width: "130",
      height: "300",
      semloEditorCaption: "说明",
      semloEditorImageStyle: "border",
      semloEditorImageHref: "https://example.com/",
      semloEditorImageOpenInCurrent: true,
    });
    if (paragraphAlignment)
      expect(
        (await page.evaluate(() => window.__semloRequireFixture("imageRotationEditor").getSnapshot())).json.content?.[0]
          .attrs?.textAlign,
      ).toBe(paragraphAlignment);
    await expect.poll(async () => Math.round((await frame.boundingBox())!.height)).toBe(300);
  }
  await page.evaluate((content) => window.__semloRequireFixture("imageRotationEditor").setContent(content), saved.json);
  await page.evaluate(() => window.__semloRequireFixture("imageRotationEditor").setEditable(false));
  await expect(host.getByRole("button", { name: "逆时针旋转 90 度" })).toBeHidden();
  await expect(host.getByRole("link", { name: "打开图片链接" })).toHaveAttribute("target", "_self");
  await frame.hover();
  await frame.getByRole("button", { name: "预览图片" }).click();
  const viewer = page.getByRole("dialog", { name: "图片预览" });
  const preview = viewer.getByRole("img", { name: "旋转图片" });
  await expect(preview).toBeVisible();
  await viewer.getByRole("button", { name: "原始大小" }).click();
  await expect.poll(async () => Math.round((await preview.boundingBox())!.width)).toBe(260);
  await expect.poll(async () => Math.round((await preview.boundingBox())!.height)).toBe(600);
  await viewer.getByRole("button", { name: "关闭图片预览" }).click();
  await expect(image).toBeVisible();
});

test("unloaded or invalid dimensions never persist invalid numbers", async ({ page }) => {
  const { host } = await mount(page);
  await page.evaluate(() =>
    window.__semloRequireFixture("imageRotationEditor").setContent({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "image", attrs: { src: "/missing.png", alt: "未加载" } }] }],
    }),
  );
  const broken = host.locator(".semlo-editor-image-frame img");
  await expect.poll(() => broken.evaluate((item) => (item as HTMLImageElement).complete)).toBe(true);
  await expect.poll(() => broken.evaluate((item) => (item as HTMLImageElement).naturalWidth)).toBe(0);
  const failure = host.getByRole("img", { name: "图片加载失败" });
  await expect(failure).toBeVisible();
  const failureBounds = (await failure.boundingBox())!;
  expect(Math.round(failureBounds.width)).toBe(100);
  expect(Math.round(failureBounds.height)).toBe(60);
  await failure.click();
  await expect(host.getByRole("button", { name: "逆时针旋转 90 度" })).toBeHidden();
  const content = await attrs(page);
  expect(content?.semloEditorImageRotation).toBe(0);
  expect(content?.width).toBeNull();
  expect(content?.height).toBeNull();
  expect(JSON.stringify(content)).not.toMatch(/NaN|Infinity/);
  await page.keyboard.press("Backspace");
  await expect(failure).toHaveCount(0);
  await host.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(failure).toBeVisible();

  await page.evaluate(() =>
    window.__semloRequireFixture("imageRotationEditor").setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "image", attrs: { src: "/tests/sample-image.svg", alt: "没有设置尺寸" } }],
        },
      ],
    }),
  );
  const image = host.locator(".semlo-editor-image-frame img");
  await expect.poll(() => image.evaluate((item) => (item as HTMLImageElement).naturalWidth)).toBe(600);
  await image.click();
  await host.getByRole("button", { name: "逆时针旋转 90 度" }).click();
  expect(await attrs(page)).toMatchObject({ semloEditorImageRotation: 270, width: 260, height: 600 });
});

test("dragging a rotated image resizes the visible frame and survives undo", async ({ page }) => {
  const { host, frame, image } = await mount(page);
  await host.getByRole("button", { name: "逆时针旋转 90 度" }).click();
  const handle = frame.getByRole("button", { name: "调整图片大小（右下）" });
  const start = (await handle.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2 + 40, start.y + start.height / 2 + 92, { steps: 5 });
  await expect.poll(async () => (await frame.boundingBox())!.width).toBeGreaterThan(160);
  await page.mouse.up();
  const changed = await attrs(page);
  expect(changed?.semloEditorImageRotation).toBe(270);
  expect(changed?.width).toBeGreaterThan(160);
  expect((changed?.height as number) / (changed?.width as number)).toBeCloseTo(300 / 130, 2);
  const frameRect = (await frame.boundingBox())!;
  const imageRect = (await image.boundingBox())!;
  expect(Math.abs(frameRect.width - imageRect.width)).toBeLessThan(1);
  expect(Math.abs(frameRect.height - imageRect.height)).toBeLessThan(1);
  await host.getByRole("button", { name: "撤销", exact: true }).click();
  expect(await attrs(page)).toMatchObject({ semloEditorImageRotation: 270, width: 130, height: 300 });
});

test("the image toolbar stays on one line for a narrow image and fits a phone viewport", async ({ page }) => {
  const { host, frame } = await mount(page);
  await host.getByRole("button", { name: "逆时针旋转 90 度" }).click();
  const toolbar = frame.getByRole("toolbar", { name: "图片格式" });
  const measure = async () =>
    toolbar.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const labels = Array.from(element.querySelectorAll<HTMLButtonElement>(":scope > button")).map((button) => {
        const bounds = button.getBoundingClientRect();
        return { y: bounds.y, height: bounds.height };
      });
      return { left: rect.left, right: rect.right, width: rect.width, labels };
    });
  let geometry = await measure();
  expect(geometry.width).toBeGreaterThan((await frame.boundingBox())!.width);
  expect(new Set(geometry.labels.map((label) => Math.round(label.y))).size).toBe(1);
  expect(geometry.labels.every((label) => label.height === 30)).toBe(true);
  await host.evaluate((element) => ((element as HTMLElement).style.width = "450px"));
  await expect.poll(async () => Math.abs((await measure()).left - (await frame.boundingBox())!.x)).toBeLessThan(2);
  await host.evaluate((element) => ((element as HTMLElement).style.width = "700px"));
  await expect.poll(async () => Math.abs((await measure()).left - (await frame.boundingBox())!.x)).toBeLessThan(2);
  await page.setViewportSize({ width: 320, height: 720 });
  await host.evaluate((element) => ((element as HTMLElement).style.width = "300px"));
  await expect
    .poll(async () => {
      const bounds = await measure();
      return bounds.left >= 0 && bounds.right <= 320;
    })
    .toBe(true);
  geometry = await measure();
  expect(geometry.left).toBeGreaterThanOrEqual(0);
  expect(new Set(geometry.labels.map((label) => Math.round(label.y))).size).toBe(1);
  expect(geometry.labels.every((label) => label.height === 30)).toBe(true);
  await host.getByRole("button", { name: "图片尺寸" }).click();
  const sizePanel = host.getByRole("dialog", { name: "图片尺寸" });
  await expect(sizePanel).toBeVisible();
  const sizeBounds = (await sizePanel.boundingBox())!;
  expect(sizeBounds.x).toBeGreaterThanOrEqual(0);
  expect(sizeBounds.x + sizeBounds.width).toBeLessThanOrEqual(320);
  await host.getByRole("button", { name: "图片样式" }).click();
  const styles = host.getByRole("menu", { name: "图片样式" });
  await expect(styles).toBeVisible();
  const styleBounds = (await styles.boundingBox())!;
  expect(styleBounds.x).toBeGreaterThanOrEqual(0);
  expect(styleBounds.x + styleBounds.width).toBeLessThanOrEqual(320);
  await host.getByRole("button", { name: "图片链接" }).click();
  const link = host.getByRole("dialog", { name: "图片链接" });
  await expect(link).toBeVisible();
  const linkBounds = (await link.boundingBox())!;
  expect(linkBounds.x).toBeGreaterThanOrEqual(0);
  expect(linkBounds.x + linkBounds.width).toBeLessThanOrEqual(320);
  await host.getByRole("button", { name: "图片链接" }).click();
  await host.getByRole("button", { name: "裁剪图片" }).click();
  await expect(frame.getByRole("group", { name: "图片裁剪区域" })).toBeVisible();
  await expect
    .poll(async () => {
      const bounds = await measure();
      return bounds.left >= 0 && bounds.right <= 320;
    })
    .toBe(true);
  await host.getByRole("button", { name: "裁剪图片" }).click();
  await host.getByRole("button", { name: "还原图片" }).click();
  expect(await attrs(page)).toMatchObject({
    semloEditorImageRotation: 0,
    semloEditorImageCrop: null,
    width: 300,
    height: 130,
  });
});
