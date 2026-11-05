import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    inlineImageEditor?: EditorController;
  }
}

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'inline-image-test'
      host.style.width = '700px'
      document.body.prepend(host)
      window.inlineImageEditor = createEditor({ element: host, outline: false, content: { type: 'doc', content: [
        { type: 'paragraph', content: [
          { type: 'text', text: '图片前' },
          { type: 'image', attrs: { src: '/tests/sample-image.svg', alt: '示例图片', width: 240, height: 104 } },
          { type: 'text', text: '图片后' }
        ] },
        { type: 'paragraph', content: [{ type: 'text', text: '下一段' }] }
      ] } })
    `,
  });
  await page.waitForFunction(() => Boolean(window.inlineImageEditor));
  const host = page.locator("#inline-image-test");
  const paragraph = host.locator(".semlo-editor-prose > p").first();
  const frame = paragraph.locator(".semlo-editor-image-frame");
  await expect.poll(() => frame.locator("img").evaluate((item) => (item as HTMLImageElement).naturalWidth)).toBe(600);
  return { host, paragraph, frame, image: frame.locator("img") };
}

async function imagePosition(page: Page) {
  return page.evaluate(() => {
    let position = -1;
    window.__semloRequireFixture("inlineImageEditor").editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "image" && position < 0) position = pos;
    });
    return position;
  });
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("inline images share their text block and the image alignment menu moves the whole paragraph", async ({
  page,
}) => {
  const { host, paragraph, frame, image } = await mount(page);
  const bounds = await paragraph.evaluate((element) => {
    const content = Array.from(element.childNodes);
    const before = content.find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes("图片前"))!;
    const after = content.find((node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes("图片后"))!;
    const measure = (node: Node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      return { left: rect.left, right: rect.right, bottom: rect.bottom };
    };
    const picture = element.querySelector(".semlo-editor-image-frame")!.getBoundingClientRect();
    return {
      before: measure(before),
      after: measure(after),
      image: { left: picture.left, right: picture.right, bottom: picture.bottom },
    };
  });
  expect(bounds.before.right).toBeLessThanOrEqual(bounds.image.left + 2);
  expect(bounds.after.left).toBeGreaterThanOrEqual(bounds.image.right - 2);
  expect(Math.abs(bounds.before.bottom - bounds.after.bottom)).toBeLessThan(2);
  expect(Math.abs(bounds.before.bottom - bounds.image.bottom)).toBeLessThan(1);

  await image.click();
  await host.getByRole("button", { name: "图片对齐" }).click();
  await host.getByRole("menuitemradio", { name: "居中对齐" }).click();
  await expect(paragraph).toHaveCSS("text-align", "center");
  await expect(frame).toHaveClass(/is-selected/);
  expect(
    (await page.evaluate(() => window.__semloRequireFixture("inlineImageEditor").getSnapshot())).json.content?.[0].attrs
      ?.textAlign,
  ).toBe("center");
  await host.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(paragraph).not.toHaveCSS("text-align", "center");
});

test("description Enter places the caret after the image and before existing text", async ({ page }) => {
  const { host, paragraph, image } = await mount(page);
  const before = await page.evaluate(() => window.__semloRequireFixture("inlineImageEditor").getSnapshot().text);
  expect(before).toContain("示例图片");
  await image.click();
  await host.getByRole("button", { name: "图片描述", exact: true }).click();
  const caption = host.getByLabel("图片描述内容");
  await caption.fill("图片说明");
  await expect(caption).toHaveCSS("font-size", "14px");
  await expect(caption).toHaveCSS("line-height", "22px");
  expect(await page.evaluate(() => window.__semloRequireFixture("inlineImageEditor").getSnapshot().text)).toBe(before);
  const baseline = await paragraph.evaluate((element) => {
    const after = Array.from(element.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes("图片后"),
    )!;
    const range = document.createRange();
    range.selectNodeContents(after);
    return {
      text: range.getBoundingClientRect().bottom,
      picture: element.querySelector(".semlo-editor-image-node")!.getBoundingClientRect().bottom,
    };
  });
  expect(Math.abs(baseline.text - baseline.picture)).toBeLessThan(1);
  await caption.press("Enter");
  await page.keyboard.insertText("新文字");
  const result = await page.evaluate(() => window.__semloRequireFixture("inlineImageEditor").getSnapshot().json);
  expect(result.content?.[0].content?.map((node) => node.type)).toEqual(["text", "image", "text"]);
  expect(result.content?.[0].content?.[2].text).toBe("新文字图片后");
  expect(result.content?.[1].content?.[0].text).toBe("下一段");
  await expect(paragraph.locator(".semlo-editor-image-caption")).toContainText("图片说明");
});

test("description focus distinguishes pointer activation from keyboard navigation", async ({ page }) => {
  const { host, image } = await mount(page);
  await image.click();
  await host.getByRole("button", { name: "图片描述", exact: true }).click();
  const caption = host.getByLabel("图片描述内容");
  await expect(caption).toBeFocused();
  await expect(caption).toHaveCSS("outline-style", "none");
  await caption.fill("图例");
  await caption.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(caption).toBeFocused();
  await expect(caption).toHaveCSS("outline-style", "solid");
});

test("image toolbar operations preserve the selected image and focused inputs", async ({ page }) => {
  const { host, paragraph, frame, image } = await mount(page);
  await image.click();
  await host.getByRole("button", { name: "逆时针旋转 90 度" }).click();
  await expect(frame).toHaveClass(/is-selected/);
  await host.getByRole("button", { name: "裁剪图片" }).click();
  const crop = frame.getByRole("group", { name: "图片裁剪区域" });
  await expect(crop).toBeVisible();
  const corner = (await crop.getByRole("button", { name: "调整裁剪右下边界" }).boundingBox())!;
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await page.mouse.down();
  await page.mouse.move(corner.x + corner.width / 2 - 20, corner.y + corner.height / 2 - 20, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.press("Enter");
  await expect(crop).toHaveCount(0);
  await expect(frame).toHaveClass(/is-selected/);

  await host.getByRole("button", { name: "图片样式" }).click();
  await host.getByRole("menuitemradio", { name: "图片阴影" }).click();
  await expect(frame).toHaveClass(/is-selected/);
  await host.getByRole("button", { name: "图片对齐" }).click();
  await host.getByRole("menuitemradio", { name: "居中对齐" }).click();
  await expect(paragraph).toHaveCSS("text-align", "center");
  await expect(frame).toHaveClass(/is-selected/);

  await host.getByRole("button", { name: "图片尺寸" }).click();
  const width = host.getByRole("dialog", { name: "图片尺寸" }).getByLabel("图片宽度");
  await width.fill("75");
  await width.press("Enter");
  await expect(width).toBeFocused();
  await expect(frame).toHaveClass(/is-selected/);
  await host.getByRole("button", { name: "图片尺寸" }).click();

  await host.getByRole("button", { name: "图片链接" }).click();
  const link = host.getByRole("dialog", { name: "图片链接" }).getByLabel("图片链接地址");
  await link.fill("https://example.com/");
  await expect(link).toBeFocused();
  await expect(frame).toHaveClass(/is-selected/);
  await host.getByRole("button", { name: "图片描述", exact: true }).click();
  const caption = host.getByLabel("图片描述内容");
  await caption.fill("保留焦点");
  await expect(caption).toBeFocused();
  await expect(frame).toHaveClass(/is-selected/);
  await caption.press("Enter");
  await expect(frame).not.toHaveClass(/is-selected/);
});

test("inline image HTML round trips its surrounding text and visual properties", async ({ page }) => {
  const { host, paragraph } = await mount(page);
  await page.evaluate(() => {
    window.__semloRequireFixture("inlineImageEditor").setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "right" },
          content: [
            { type: "text", text: "甲" },
            {
              type: "image",
              attrs: {
                src: "/tests/sample-image.svg",
                alt: "混排图片",
                width: 78,
                height: 150,
                semloEditorImageRotation: 270,
                semloEditorImageCrop: { x: 0.2, y: 0.1, width: 0.5, height: 0.8 },
                semloEditorImageStyle: "shadow",
                semloEditorCaption: "图下描述",
                semloEditorCaptionVisible: true,
                semloEditorImageHref: "https://example.com/image",
                semloEditorImageOpenInCurrent: true,
              },
            },
            { type: "text", text: "乙" },
          ],
        },
      ],
    });
  });
  const saved = await page.evaluate(() => window.__semloRequireFixture("inlineImageEditor").getSnapshot());
  expect(saved.text).toContain("混排图片");
  expect(saved.text).not.toContain("图下描述");
  expect(saved.html).toContain("data-semlo-editor-image=");
  expect(saved.html).toContain("data-semlo-editor-image-caption=");
  expect(saved.html).not.toContain("<figure");
  const htmlShape = await page.evaluate((html) => {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const paragraph = parsed.querySelector("p");
    return {
      paragraphs: parsed.querySelectorAll("p").length,
      image: paragraph?.querySelector("span[data-semlo-editor-image] img")?.getAttribute("src"),
      text: paragraph?.textContent,
    };
  }, saved.html);
  expect(htmlShape).toEqual({ paragraphs: 1, image: "/tests/sample-image.svg", text: "甲图下描述乙" });
  const htmlBaseline = await page.evaluate((html) => {
    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    const paragraph = host.querySelector("p")!;
    const after = Array.from(paragraph.childNodes).find(
      (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.includes("乙"),
    )!;
    const range = document.createRange();
    range.selectNodeContents(after);
    const result = {
      text: range.getBoundingClientRect().bottom,
      picture: paragraph.querySelector("span[data-semlo-editor-image]")!.getBoundingClientRect().bottom,
    };
    host.remove();
    return result;
  }, saved.html);
  expect(Math.abs(htmlBaseline.text - htmlBaseline.picture)).toBeLessThan(1);
  await page.evaluate((html) => window.__semloRequireFixture("inlineImageEditor").setContent(html), saved.html);
  const restored = await page.evaluate(() => window.__semloRequireFixture("inlineImageEditor").getSnapshot().json);
  expect(restored.content).toHaveLength(1);
  expect(restored.content?.[0].attrs?.textAlign).toBe("right");
  expect(restored.content?.[0].content?.map((node) => node.type)).toEqual(["text", "image", "text"]);
  expect(restored.content?.[0].content?.[1].attrs).toMatchObject({
    semloEditorImageRotation: 270,
    semloEditorImageCrop: { x: 0.2, y: 0.1, width: 0.5, height: 0.8 },
    semloEditorImageStyle: "shadow",
    semloEditorCaption: "图下描述",
    semloEditorCaptionVisible: true,
    semloEditorImageHref: "https://example.com/image",
    semloEditorImageOpenInCurrent: true,
  });
  await expect(paragraph).toHaveCSS("text-align", "right");
  await expect(host.locator(".semlo-editor-image-frame img")).toHaveCSS("clip-path", /inset\(/);
});

test("one Backspace or Delete removes an adjacent image without deleting its surrounding text", async ({ page }) => {
  const { paragraph, frame } = await mount(page);
  const position = await imagePosition(page);
  await page.evaluate((pos) => {
    window.__semloRequireFixture("inlineImageEditor").editor.view.focus();
    window.__semloRequireFixture("inlineImageEditor").editor.commands.setTextSelection(pos + 1);
  }, position);
  await expect
    .poll(() => page.evaluate(() => window.__semloRequireFixture("inlineImageEditor").editor.state.selection.from))
    .toBe(position + 1);
  await page.keyboard.press("Backspace");
  await expect(frame).toHaveCount(0);
  await expect(paragraph).toHaveText("图片前图片后");
  await page.evaluate(() => window.__semloRequireFixture("inlineImageEditor").editor.commands.undo());
  await expect(frame).toHaveCount(1);
  const restored = await imagePosition(page);
  await page.evaluate((pos) => {
    window.__semloRequireFixture("inlineImageEditor").editor.view.focus();
    window.__semloRequireFixture("inlineImageEditor").editor.commands.setTextSelection(pos);
  }, restored);
  await expect
    .poll(() => page.evaluate(() => window.__semloRequireFixture("inlineImageEditor").editor.state.selection.from))
    .toBe(restored);
  await page.keyboard.press("Delete");
  await expect(frame).toHaveCount(0);
  await expect(paragraph).toHaveText("图片前图片后");
});

test("cropped unrotated images resize during drag and cancellation restores the original size", async ({ page }) => {
  const { host, frame } = await mount(page);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("inlineImageEditor").editor;
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "image" && position < 0) position = pos;
    });
    const image = editor.state.doc.nodeAt(position)!;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(position, undefined, {
        ...image.attrs,
        width: 120,
        height: 83,
        semloEditorImageCrop: { x: 0.1, y: 0.1, width: 0.5, height: 0.8 },
      }),
    );
  });
  await frame.locator("img").click();
  const handle = frame.getByRole("button", { name: "调整图片大小（右下）" });
  const start = (await handle.boundingBox())!;
  const x = start.x + start.width / 2;
  const y = start.y + start.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 45, y + 30, { steps: 5 });
  await expect.poll(async () => (await frame.boundingBox())!.width).toBeGreaterThan(150);
  await expect(frame.locator("img")).toHaveCSS("clip-path", /inset\(/);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect.poll(async () => Math.round((await frame.boundingBox())!.width)).toBe(120);
  await expect(host.locator(".semlo-editor-image-frame img")).toHaveCSS("clip-path", /inset\(/);
});

test("failed images remain selectable, retain surrounding text and recover when the source loads", async ({ page }) => {
  const { host, paragraph, frame } = await mount(page);
  const position = await imagePosition(page);
  await page.evaluate((pos) => {
    const editor = window.__semloRequireFixture("inlineImageEditor").editor;
    const image = editor.state.doc.nodeAt(pos)!;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, {
        ...image.attrs,
        src: "/missing-image.png",
        alt: "",
        width: null,
        height: null,
      }),
    );
  }, position);
  const failed = frame.getByRole("img", { name: "图片加载失败" });
  await expect(failed).toBeVisible();
  await expect.poll(async () => (await failed.boundingBox())?.width).toBe(100);
  await expect.poll(async () => (await failed.boundingBox())?.height).toBe(60);
  await expect(failed).toHaveCSS("background-color", "rgb(244, 245, 245)");
  await failed.click();
  await expect
    .poll(() =>
      page.evaluate(() => window.__semloRequireFixture("inlineImageEditor").editor.state.selection.toJSON().type),
    )
    .toBe("node");
  await expect(frame.getByRole("toolbar", { name: "图片格式" })).toBeHidden();
  await expect(frame.locator(".semlo-editor-image-toolbar")).toBeHidden();
  await page.keyboard.press("Backspace");
  await expect(frame).toHaveCount(0);
  await expect(paragraph).toHaveText("图片前图片后");
  await host.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(failed).toBeVisible();
  const restored = await imagePosition(page);
  await page.evaluate((pos) => {
    const editor = window.__semloRequireFixture("inlineImageEditor").editor;
    const image = editor.state.doc.nodeAt(pos)!;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, { ...image.attrs, alt: "失败示例", width: 160, height: 100 }),
    );
  }, restored);
  await expect.poll(async () => (await failed.boundingBox())?.width).toBe(160);
  await expect.poll(async () => (await failed.boundingBox())?.height).toBe(60);
  await expect(failed).toHaveText("图片加载失败");
  await page.evaluate((pos) => {
    const editor = window.__semloRequireFixture("inlineImageEditor").editor;
    const image = editor.state.doc.nodeAt(pos)!;
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(pos, undefined, { ...image.attrs, src: "/tests/sample-image.svg" }),
    );
  }, restored);
  const image = frame.locator("img");
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(600);
  await expect(image).toBeVisible();
  await expect(failed).toBeHidden();
  await image.click({ position: { x: 2, y: 2 } });
  await expect(frame.getByRole("button", { name: "逆时针旋转 90 度" })).toBeEnabled();
});
