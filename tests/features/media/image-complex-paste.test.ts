import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    imageComplexPasteEditor?: EditorController;
  }
}

test("mixed linked text and images paste without losing content and survive undo and round trips", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'image-complex-paste'
      document.body.prepend(host)
      window.imageComplexPasteEditor = createEditor({element:host,outline:false,content:'<p>原文</p>'})
    `,
  });
  const host = page.locator("#image-complex-paste");
  await host.locator(".semlo-editor-prose p").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.setData(
      "text/html",
      '<p>前<strong>粗体<img src="/tests/sample-image.svg?a" alt="图一" width="160" height="100">后</strong><a href="https://example.com">链接<img src="/tests/sample-image.svg?b" alt="图二" width="80" height="50">尾</a></p><p>第二段</p>',
    );
    window
      .__semloRequireFixture("imageComplexPasteEditor")
      .editor.view.dom.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
  });
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("imageComplexPasteEditor").getSnapshot());
  const saved = await snapshot();
  const images = saved.json.content?.[0]?.content?.filter((node) => node.type === "image");
  expect(images).toHaveLength(2);
  expect(images?.[1].attrs?.semloEditorImageHref).toBe("https://example.com");
  expect(saved.text).toContain("第二段");
  expect(saved.html).toContain("https://example.com");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("imageComplexPasteEditor").editor.commands.undo()),
  ).toBe(true);
  expect((await snapshot()).text).toBe("原文");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("imageComplexPasteEditor").editor.commands.redo()),
  ).toBe(true);
  for (const content of [saved.html, saved.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("imageComplexPasteEditor").setContent(value), content);
    const restored = await snapshot();
    const restoredImages = restored.json.content?.[0]?.content?.filter((node) => node.type === "image");
    expect(restoredImages).toHaveLength(2);
    expect(restoredImages?.[1].attrs?.semloEditorImageHref).toBe("https://example.com");
    expect(restored.html).toContain("https://example.com");
    expect(restored.text).toContain("第二段");
  }
});
