import { expect, test, type Page } from "@rstest/playwright";

import type { EditorContent, EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { imageNodes } from "../../fixtures/media/image-test-helpers";

declare global {
  interface Window {
    inlineImageEditor?: EditorController;
    inlineImageClipboard?: ClipboardItem[];
    inlineImageContent?: EditorContent;
  }
}

const image = { type: "image", attrs: { src: "/tests/sample-image.svg", alt: "行内图片", width: 240, height: 104 } };
const mixedContent: EditorContent = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "图片前" }, image, { type: "text", text: "图片后" }] },
    { type: "paragraph", content: [{ type: "text", text: "下一段" }] },
  ],
};

async function mount(page: Page, content: EditorContent = mixedContent) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => (window.inlineImageContent = value), content);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'inline-image-interactions'
      host.style.width = '700px'
      document.body.prepend(host)
      window.inlineImageEditor = createEditor({ element: host, outline: false, content: window.inlineImageContent })
    `,
  });
  await page.waitForFunction(() => Boolean(window.inlineImageEditor));
  return page.locator("#inline-image-interactions");
}

const snapshot = (page: Page) => page.evaluate(() => window.__semloRequireFixture("inlineImageEditor").getSnapshot());

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("pasting an image between characters keeps one paragraph and backspace removes only the image", async ({
  page,
}) => {
  const host = await mount(page, {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: "甲乙" }] }],
  });
  const paragraph = host.locator(".semlo-editor-prose > p").first();
  await paragraph.click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await page.evaluate(() => {
    const transfer = new DataTransfer();
    transfer.setData("text/html", '<img src="/tests/sample-image.svg" alt="粘贴的图片" width="120" height="52">');
    window
      .__semloRequireFixture("inlineImageEditor")
      .editor.view.dom.dispatchEvent(
        new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
      );
  });
  await expect(host.locator(".semlo-editor-image-frame img")).toHaveCount(1);
  let saved = await snapshot(page);
  expect(saved.json.content).toHaveLength(1);
  expect(saved.json.content?.[0].content?.map((node) => node.type)).toEqual(["text", "image", "text"]);
  expect(saved.json.content?.[0].content?.[0].text).toBe("甲");
  expect(saved.json.content?.[0].content?.[2].text).toBe("乙");

  await page.keyboard.insertText("丙");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Backspace");
  await expect(host.locator(".semlo-editor-image-frame img")).toHaveCount(0);
  saved = await snapshot(page);
  expect(saved.json.content).toHaveLength(1);
  expect(saved.json.content?.[0].content?.map((node) => node.text).join("")).toBe("甲丙乙");
  await host.getByRole("button", { name: "撤销", exact: true }).click();
  saved = await snapshot(page);
  expect(saved.json.content?.[0].content?.map((node) => node.type)).toEqual(["text", "image", "text"]);
  expect(saved.json.content?.[0].content?.[0].text).toBe("甲");
  expect(saved.json.content?.[0].content?.[2].text).toBe("丙乙");
});

test("image alignment affects its whole paragraph and caption Enter inserts before adjacent text", async ({ page }) => {
  const host = await mount(page);
  const paragraph = host.locator(".semlo-editor-prose > p").first();
  const frame = paragraph.locator(".semlo-editor-image-frame");
  await frame.locator("img").click();
  await frame.getByRole("button", { name: "图片对齐" }).click();
  await frame.getByRole("menu", { name: "图片对齐" }).getByRole("menuitemradio", { name: "居中对齐" }).click();
  await expect(paragraph).toHaveCSS("text-align", "center");
  let saved = await snapshot(page);
  expect(saved.json.content?.[0].attrs?.textAlign).toBe("center");
  expect(saved.json.content?.[0].content?.map((node) => node.type)).toEqual(["text", "image", "text"]);

  const textBeforeCaption = saved.text;
  await frame.getByRole("button", { name: "图片描述", exact: true }).click();
  await paragraph.getByLabel("图片描述内容").fill("图例说明");
  const baselines = await paragraph.evaluate((element) => {
    const textNodes = Array.from(element.childNodes).filter(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
    );
    const bounds = textNodes.map((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect();
    });
    const image = element.querySelector(".semlo-editor-image-node")!.getBoundingClientRect();
    return { before: bounds[0].bottom, after: bounds.at(-1)!.bottom, image: image.bottom };
  });
  expect(Math.abs(baselines.before - baselines.after)).toBeLessThan(1);
  expect(Math.abs(baselines.before - baselines.image)).toBeLessThan(8);
  await paragraph.getByLabel("图片描述内容").press("Enter");
  expect((await snapshot(page)).text).toBe(textBeforeCaption);
  await page.keyboard.insertText("新增");
  saved = await snapshot(page);
  expect(saved.json.content?.[0].content?.[0].text).toBe("图片前");
  expect(saved.json.content?.[0].content?.[2].text).toBe("新增图片后");
  expect(saved.json.content?.[1].content?.[0].text).toBe("下一段");
  expect(imageNodes(saved.json)[0]?.attrs).toMatchObject({
    semloEditorCaption: "图例说明",
    semloEditorCaptionVisible: true,
  });
});

test("mixed text and transformed image survive HTML, rich copy, JSON and read-only preview", async ({ page }) => {
  const host = await mount(page);
  const frame = host.locator(".semlo-editor-image-frame").first();
  await frame.locator("img").click();
  await frame.getByRole("button", { name: "逆时针旋转 90 度" }).click();
  await frame.getByRole("button", { name: "裁剪图片" }).click();
  const bounds = (await frame.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width - 2, bounds.y + bounds.height - 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width - 22, bounds.y + bounds.height - 42, { steps: 5 });
  await page.mouse.up();
  await page.keyboard.press("Enter");
  const saved = await snapshot(page);
  const transformed = imageNodes(saved.json)[0]?.attrs;
  expect(transformed?.semloEditorImageRotation).toBe(270);
  expect(transformed?.semloEditorImageCrop).toBeTruthy();
  expect(saved.json.content?.[0].content?.map((node) => node.type)).toEqual(["text", "image", "text"]);
  expect(saved.html).toContain("data-semlo-editor-image-crop=");
  expect(saved.html).toContain('data-semlo-editor-image-rotation="270"');

  await page.evaluate(() =>
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write: async (items: ClipboardItem[]) => (window.inlineImageClipboard = items) },
    }),
  );
  await frame.locator("img").click();
  await frame.getByRole("button", { name: "图片更多操作" }).click();
  await frame.getByRole("menuitem", { name: "复制图片" }).click();
  const copied = await page.evaluate(async () =>
    (await window.__semloRequireFixture("inlineImageClipboard")[0].getType("text/html")).text(),
  );
  expect(copied).toContain("data-semlo-editor-image-crop=");
  expect(copied).toContain('data-semlo-editor-image-rotation="270"');

  for (const content of [saved.html, saved.json]) {
    await page.evaluate((value) => {
      window.__semloRequireFixture("inlineImageEditor").setContent("<p>临时内容</p>");
      window.__semloRequireFixture("inlineImageEditor").setContent(value);
    }, content);
    const restored = await snapshot(page);
    expect(restored.json.content?.[0].content?.map((node) => node.type)).toEqual(["text", "image", "text"]);
    expect(restored.json.content?.[0].content?.[0].text).toBe("图片前");
    expect(restored.json.content?.[0].content?.[2].text).toBe("图片后");
    expect(imageNodes(restored.json)[0]?.attrs).toMatchObject({
      semloEditorImageRotation: 270,
      semloEditorImageCrop: transformed?.semloEditorImageCrop,
    });
  }
  await page.evaluate(() => window.__semloRequireFixture("inlineImageEditor").setEditable(false));
  await frame.hover();
  await frame.getByRole("button", { name: "预览图片" }).click();
  const viewer = page.getByRole("dialog", { name: "图片预览" });
  await expect(viewer.getByRole("img", { name: "行内图片" })).toBeVisible();
  await expect(viewer.getByRole("img", { name: "行内图片" })).toHaveCSS("clip-path", /inset\(/);
});

for (const framework of ["react", "vue", "solid"] as const) {
  test(`${framework} keeps undo history when a controlled host repeats equivalent image content`, async ({ page }) => {
    const current: EditorContent = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "旧图前" }] },
        {
          type: "paragraph",
          content: [{ type: "image", attrs: { src: "/tests/sample-image.svg", alt: "图片", width: 300, height: 130 } }],
        },
        { type: "paragraph", content: [{ type: "text", text: "旧图后" }] },
      ],
    };
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN!}/tests/controlled.html`);
    await page.evaluate(
      async ({ name, content }) => {
        await window.__semloRequireFixture("mountDynamicEditor").bind(window)(name);
        window.__semloRequireFixture("dynamicEditor").setIntegrations({ content } as never);
      },
      { name: framework, content: current },
    );
    const host = page.locator("#dynamic-editor");
    const frame = host.locator(".semlo-editor-image-frame");
    await expect(frame.locator("img")).toHaveCount(1);
    await expect
      .poll(() => frame.locator("img").evaluate((element) => (element as HTMLImageElement).naturalWidth))
      .toBe(600);
    await frame.locator("img").click();
    await frame.getByRole("button", { name: "逆时针旋转 90 度" }).click();
    expect(
      await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").controller.editor.commands.undo()),
    ).toBe(true);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").controller.editor.can().redo()),
    ).toBe(true);

    await page.evaluate(async (content) => {
      window.__semloRequireFixture("dynamicEditor").setIntegrations({ content: structuredClone(content) } as never);
      await (window.__semloRequireFixture("dynamicEditor") as unknown as { settle(): Promise<void> }).settle();
    }, current);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").controller.editor.can().redo()),
    ).toBe(true);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").controller.editor.commands.redo()),
    ).toBe(true);
    const restored = await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").controller.getSnapshot());
    expect(restored.json.content?.[0].content?.[0].text).toBe("旧图前");
    expect(restored.json.content?.[2].content?.[0].text).toBe("旧图后");
    expect(imageNodes(restored.json)[0]?.attrs).toMatchObject({
      semloEditorImageRotation: 270,
      width: 130,
      height: 300,
    });
    await page.evaluate(() => window.__semloRequireFixture("dynamicEditor").destroy());
  });
}
