import { expect, test, type Page } from "@rstest/playwright";

import type { EditorContent, EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { imageNodes } from "../../fixtures/media/image-test-helpers";

declare global {
  interface Window {
    imagePreviewEditor?: EditorController;
    imagePreviewOtherEditor?: EditorController;
    imagePreviewContent?: EditorContent;
    imagePreviewClipboard?: ClipboardItem[];
  }
}

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate(() => {
    window.imagePreviewContent = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "前文" }] },
        {
          type: "paragraph",
          content: [
            { type: "image", attrs: { src: "/tests/sample-image.svg", alt: "第一张", width: 320, height: 139 } },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "image", attrs: { src: "/tests/sample-image.svg", alt: "第二张", width: 320, height: 139 } },
          ],
        },
        { type: "paragraph", content: [{ type: "image", attrs: { src: "", alt: "空图片" } }] },
        { type: "paragraph", content: [{ type: "text", text: "后文" }] },
      ],
    };
  });
  await page.addScriptTag({
    type: "module",
    content: [
      "import { createEditor } from '/dist/index.js'",
      "const first = document.createElement('div')",
      "first.id = 'image-preview-test'",
      "first.style.width = '800px'",
      "const second = document.createElement('div')",
      "second.id = 'image-preview-other'",
      "document.body.prepend(first, second)",
      "window.imagePreviewEditor = createEditor({ element: first, outline: false, content: window.imagePreviewContent })",
      "window.imagePreviewOtherEditor = createEditor({ element: second, outline: false, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'image', attrs: { src: '/tests/sample-image.svg?other', alt: '另一编辑器' } }] }] } })",
    ].join("\n"),
  });
  await page.waitForFunction(() => Boolean(window.imagePreviewEditor && window.imagePreviewOtherEditor));
  return page.locator("#image-preview-test");
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("image preview follows document order, distinguishes repeated addresses, and stays within its editor", async ({
  page,
}) => {
  const host = await mount(page);
  const frames = host.locator(".semlo-editor-image-frame");
  await expect(frames).toHaveCount(3);
  const initial = (await page.evaluate(() => window.__semloRequireFixture("imagePreviewEditor").getSnapshot())).json;
  expect(initial.content?.map((node) => node.type)).toEqual([
    "paragraph",
    "paragraph",
    "paragraph",
    "paragraph",
    "paragraph",
  ]);
  expect(initial.content?.[0].content?.[0].text).toBe("前文");
  expect(initial.content?.[4].content?.[0].text).toBe("后文");
  expect(imageNodes(initial).map((node) => node.attrs?.alt)).toEqual(["第一张", "第二张", "空图片"]);
  const firstImage = frames.nth(0).locator("img");
  await firstImage.click();
  await firstImage.dblclick();
  await expect(page.getByRole("dialog", { name: "图片预览" })).toHaveCount(0);
  await expect(frames.nth(2).getByRole("button", { name: "预览图片" })).toBeDisabled();

  await frames.nth(1).hover();
  const opener = frames.nth(1).getByRole("button", { name: "预览图片" });
  await opener.click();
  const viewer = page.getByRole("dialog", { name: "图片预览" });
  await expect(viewer).toBeVisible();
  await expect(viewer.getByRole("toolbar", { name: "图片预览工具" })).toContainText("2 / 2");
  await expect(viewer.getByRole("img", { name: "第二张" })).toBeVisible();
  await viewer.getByRole("button", { name: "下一张" }).click();
  await expect(viewer.getByRole("toolbar", { name: "图片预览工具" })).toContainText("1 / 2");
  await expect(viewer.getByRole("img", { name: "第一张" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("read-only images can be previewed and replacement or destruction closes the viewer", async ({ page }) => {
  const host = await mount(page);
  await page.evaluate(() => window.__semloRequireFixture("imagePreviewEditor").setEditable(false));
  await expect(host.getByRole("button", { name: "删除图片" })).toHaveCount(0);
  await expect(host.getByRole("menuitem", { name: "复制图片" })).toHaveCount(0);
  const frame = host.locator(".semlo-editor-image-frame").first();
  await frame.hover();
  await frame.getByRole("button", { name: "预览图片" }).click();
  const viewer = page.getByRole("dialog", { name: "图片预览" });
  await expect(viewer.getByRole("img", { name: "第一张" })).toBeVisible();
  await page.evaluate(() =>
    window.__semloRequireFixture("imagePreviewEditor").setContent(window.__semloRequireFixture("imagePreviewContent")),
  );
  // Controlled adapters routinely send equal content; the editor treats it as a no-op.
  await expect(viewer).toBeVisible();
  await page.evaluate(() =>
    window.__semloRequireFixture("imagePreviewEditor").setContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "新文" }] },
        {
          type: "paragraph",
          content: [
            { type: "image", attrs: { src: "/tests/sample-image.svg", alt: "第一张", width: 320, height: 139 } },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "image", attrs: { src: "/tests/sample-image.svg", alt: "第二张", width: 320, height: 139 } },
          ],
        },
        { type: "paragraph", content: [{ type: "image", attrs: { src: "", alt: "空图片" } }] },
        { type: "paragraph", content: [{ type: "text", text: "后文" }] },
      ],
    }),
  );
  await expect(viewer).toHaveCount(0);

  await frame.hover();
  await frame.getByRole("button", { name: "预览图片" }).click();
  await expect(viewer).toBeVisible();
  await page.evaluate(() => window.__semloRequireFixture("imagePreviewEditor").destroy());
  await expect(viewer).toHaveCount(0);
  await expect(page.locator("#image-preview-other .semlo-editor-image-frame")).toHaveCount(1);
});

test("an interrupted resize cannot write old dimensions into a replacement image", async ({ page }) => {
  const host = await mount(page);
  const first = host.locator(".semlo-editor-image-frame").first();
  await first.locator("img").click();
  const handle = first.getByRole("button", { name: "调整图片大小（右下）" });
  const bounds = (await handle.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 - 80, bounds.y + bounds.height / 2 - 35, { steps: 5 });
  await page.evaluate(() => {
    window.__semloRequireFixture("imagePreviewEditor").setContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "前文" }] },
        {
          type: "paragraph",
          content: [
            {
              type: "image",
              attrs: { src: "/tests/sample-image.svg?replacement", alt: "新图", width: 200, height: 87 },
            },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "后文" }] },
      ],
    });
  });
  await page.mouse.up();
  const replacement = imageNodes(
    (await page.evaluate(() => window.__semloRequireFixture("imagePreviewEditor").getSnapshot())).json,
  )[0]?.attrs;
  expect(replacement).toMatchObject({ src: "/tests/sample-image.svg?replacement", width: 200, height: 87 });

  const next = host.locator(".semlo-editor-image-frame").first();
  await next.locator("img").click();
  const nextHandle = next.getByRole("button", { name: "调整图片大小（右下）" });
  const nextBounds = (await nextHandle.boundingBox())!;
  await page.mouse.move(nextBounds.x + nextBounds.width / 2, nextBounds.y + nextBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(nextBounds.x + nextBounds.width / 2 - 40, nextBounds.y + nextBounds.height / 2 - 18);
  await page.evaluate(() => window.__semloRequireFixture("imagePreviewEditor").setEditable(false));
  await page.mouse.up();
  expect(
    imageNodes((await page.evaluate(() => window.__semloRequireFixture("imagePreviewEditor").getSnapshot())).json)[0]
      ?.attrs,
  ).toMatchObject({
    width: 200,
    height: 87,
  });
});

test("selecting the first image from outside the editor keeps its controls visible", async ({ page }) => {
  const host = await mount(page);
  await page.evaluate(() => {
    window.__semloRequireFixture("imagePreviewEditor").setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "image", attrs: { src: "/tests/sample-image.svg", alt: "首图", width: 300, height: 130 } }],
        },
        { type: "paragraph", content: [{ type: "text", text: "后文" }] },
      ],
    });
    const focusTarget = document.createElement("button");
    focusTarget.textContent = "编辑器外部";
    document.body.prepend(focusTarget);
    focusTarget.focus();
  });
  await host.locator(".semlo-editor-image-frame img").click();
  // Chromium may emit a delayed selectionchange when the editor first receives focus.
  await page.waitForTimeout(400);
  await expect(host.locator(".semlo-editor-image-frame")).toHaveClass(/is-selected/);
  await expect(host.getByRole("button", { name: "图片尺寸" })).toBeVisible();
});

test("image styles survive JSON and HTML round trips and reject unknown style names", async ({ page }) => {
  const host = await mount(page);
  await page.evaluate(() =>
    window.__semloRequireFixture("imagePreviewEditor").setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "image",
              attrs: { src: "/tests/sample-image.svg", alt: "带阴影", semloEditorImageStyle: "shadow" },
            },
          ],
        },
      ],
    }),
  );
  const image = host.locator(".semlo-editor-image-frame img");
  await expect(image).toHaveCSS("box-shadow", "rgba(0, 0, 0, 0.12) 0px 3px 6px 0px");
  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write: async (items: ClipboardItem[]) => (window.imagePreviewClipboard = items) },
    }),
  );
  await image.click();
  await host.getByRole("button", { name: "图片更多操作" }).click();
  await host.getByRole("menuitem", { name: "复制图片" }).click();
  const copied = await page.evaluate(async () =>
    (await window.__semloRequireFixture("imagePreviewClipboard")[0].getType("text/html")).text(),
  );
  expect(copied).toContain('data-semlo-editor-image-style="shadow"');
  const original = await page.evaluate(() => window.__semloRequireFixture("imagePreviewEditor").getSnapshot());
  expect(original.html).toContain('data-semlo-editor-image-style="shadow"');
  for (const content of [original.html, original.json]) {
    await page.evaluate((value) => {
      window.__semloRequireFixture("imagePreviewEditor").setContent("<p>临时内容</p>");
      window.__semloRequireFixture("imagePreviewEditor").setContent(value);
    }, content);
    const restored = await page.evaluate(() => window.__semloRequireFixture("imagePreviewEditor").getSnapshot());
    expect(imageNodes(restored.json)[0]?.attrs?.semloEditorImageStyle).toBe("shadow");
    await expect(host.locator(".semlo-editor-image-frame img")).toHaveCSS(
      "box-shadow",
      "rgba(0, 0, 0, 0.12) 0px 3px 6px 0px",
    );
  }
  await page.evaluate(() =>
    window
      .__semloRequireFixture("imagePreviewEditor")
      .setContent('<img src="/tests/sample-image.svg" data-semlo-editor-image-style="unexpected" alt="无效样式">'),
  );
  expect(
    imageNodes((await page.evaluate(() => window.__semloRequireFixture("imagePreviewEditor").getSnapshot())).json)[0]
      ?.attrs?.semloEditorImageStyle,
  ).toBe("none");
  await expect(host.locator(".semlo-editor-image-frame img")).toHaveCSS("box-shadow", "none");
});
