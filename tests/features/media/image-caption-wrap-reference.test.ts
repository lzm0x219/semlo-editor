import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    imageCaptionWrapEditor?: EditorController;
  }
}

test("long unbroken image descriptions wrap within the image width", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'image-caption-wrap'
      host.style.width = '800px'
      document.body.prepend(host)
      window.imageCaptionWrapEditor = createEditor({ element: host, outline: false, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: '/tests/sample-image.svg', width: 160, height: 70, semloEditorCaption: 'a'.repeat(120), semloEditorCaptionVisible: true } }] }] } })`,
  });
  const host = page.locator("#image-caption-wrap");
  const dimensions = await host.locator(".semlo-editor-image-caption").evaluate((caption) => {
    const media = caption.closest(".semlo-editor-image-media")!;
    const image = media.querySelector("img")!;
    return {
      caption: caption.getBoundingClientRect().width,
      image: image.getBoundingClientRect().width,
      height: caption.getBoundingClientRect().height,
      scroll: caption.scrollWidth,
    };
  });
  expect(dimensions.caption).toBeLessThanOrEqual(dimensions.image + 1);
  expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.caption + 1);
  expect(dimensions.height).toBeGreaterThan(30);
  const exported = await page.evaluate(() => {
    const html = window.__semloRequireFixture("imageCaptionWrapEditor").getSnapshot().html;
    const container = document.createElement("div");
    container.style.width = "800px";
    container.innerHTML = html;
    document.body.append(container);
    const caption = container.querySelector<HTMLElement>("[data-semlo-editor-image-caption]")!;
    return {
      width: caption.getBoundingClientRect().width,
      image: container.querySelector("img")!.getBoundingClientRect().width,
    };
  });
  expect(exported.width).toBeLessThanOrEqual(exported.image + 1);
  const input = host.getByRole("textbox", { name: "图片描述内容" });
  await input.fill("");
  await input.evaluate((element) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", "第一行\n第二行");
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
  });
  await expect(input).toHaveValue("第一行 第二行");
  await input.press("End");
  await input.press("x");
  await input.press("Escape");
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("第一行 第二行x");
  await input.press("Enter");
  await expect(host.locator(".ProseMirror")).toBeFocused();
});
