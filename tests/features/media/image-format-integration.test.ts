import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { imageNodes } from "../../fixtures/media/image-test-helpers";

declare global {
  interface Window {
    imageFormatEditor?: EditorController;
    imageFormatOther?: EditorController;
  }
}

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'image-format-test'
      host.style.width = '500px'
      document.body.prepend(host)
      window.imageFormatEditor = createEditor({
        element: host,
        outline: false,
        content: {
          type: 'doc',
          content: [
            { type: "paragraph", content: [{ type: 'image', attrs: { src: '/tests/sample-image.svg', alt: '示例图片', width: 300, height: 130 } }] },
            { type: 'paragraph', content: [{ type: 'text', text: '后续正文' }] },
          ],
        },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.imageFormatEditor));
  const host = page.locator("#image-format-test");
  const image = host.locator(".semlo-editor-image-frame > img");
  await expect.poll(() => image.evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(600);
  await image.click();
  return { host, image };
}

const snapshot = (page: Page) => page.evaluate(() => window.__semloRequireFixture("imageFormatEditor").getSnapshot());
const attrs = async (page: Page) => imageNodes((await snapshot(page)).json)[0]?.attrs;

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("description is editable, excluded from text and preserved when hidden or exported", async ({ page }) => {
  const { host } = await mount(page);
  const before = (await snapshot(page)).text;
  const toggle = host.getByRole("button", { name: "图片描述", exact: true });
  await toggle.click();
  const caption = host.getByLabel("图片描述内容");
  await expect(caption).toBeFocused();
  await caption.fill("图片下方的说明");
  await expect
    .poll(() => attrs(page))
    .toMatchObject({ semloEditorCaption: "图片下方的说明", semloEditorCaptionVisible: true });
  expect((await snapshot(page)).text).toBe(before);
  await toggle.click();
  await expect(caption).toBeHidden();
  expect(await attrs(page)).toMatchObject({ semloEditorCaption: "图片下方的说明", semloEditorCaptionVisible: false });
  const hiddenHTML = (await snapshot(page)).html;
  expect(hiddenHTML).toContain('data-semlo-editor-caption-visible="false"');
  expect(hiddenHTML).not.toContain("data-semlo-editor-image-caption");
  await toggle.click();
  await expect(caption).toHaveValue("图片下方的说明");
  await caption.press("Enter");
  await expect(host.locator(".semlo-editor-prose")).toBeFocused();
  await page.keyboard.type("续");
  const paragraph = (await snapshot(page)).json.content?.[0];
  expect(paragraph?.type).toBe("paragraph");
  expect(paragraph?.content?.map((node) => node.type)).toEqual(["image", "text"]);
  expect(paragraph?.content?.[1].text).toBe("续");
  await expect(host.locator(".semlo-editor-prose > p").nth(1)).toHaveText("后续正文");
  const visibleHTML = (await snapshot(page)).html;
  expect(visibleHTML).toContain("data-semlo-editor-image-caption");
  expect(visibleHTML).toContain("图片下方的说明");
  await page.evaluate((html) => window.__semloRequireFixture("imageFormatEditor").setContent(html), visibleHTML);
  expect(await attrs(page)).toMatchObject({ semloEditorCaption: "图片下方的说明", semloEditorCaptionVisible: true });
});

test("image link and alignment round trip together with description and visual style", async ({ page }) => {
  const { host } = await mount(page);
  await host.getByRole("button", { name: "图片链接" }).click();
  const link = host.getByRole("dialog", { name: "图片链接" });
  const input = link.getByLabel("图片链接地址");
  await input.fill("example.com/path");
  await input.press("Enter");
  await link.getByLabel("在当前页面打开").check();
  await expect
    .poll(() => attrs(page))
    .toMatchObject({
      semloEditorImageHref: "example.com/path",
      semloEditorImageOpenInCurrent: true,
    });
  await host.getByRole("button", { name: "图片对齐" }).click();
  await host.getByRole("menu", { name: "图片对齐" }).getByRole("menuitemradio", { name: "居中对齐" }).click();
  await expect(host.locator(".semlo-editor-prose > p").first()).toHaveCSS("text-align", "center");
  await host.getByRole("button", { name: "图片样式" }).click();
  await host.getByRole("menuitemradio", { name: "图片阴影" }).click();
  await host.getByRole("button", { name: "图片描述", exact: true }).click();
  await host.getByLabel("图片描述内容").fill("联合示例");
  await host.getByLabel("图片描述内容").press("Enter");
  const saved = await snapshot(page);
  expect(saved.html).toContain("data-semlo-editor-image=");
  expect(saved.html).toContain('href="https://example.com/path"');
  expect(saved.html).toContain('target="_self"');
  expect(saved.html).toContain('data-semlo-editor-image-style="shadow"');
  await page.evaluate((html) => {
    const editor = window.__semloRequireFixture("imageFormatEditor");
    editor.setContent("<p>临时文档</p>");
    editor.setContent(html);
  }, saved.html);
  const restored = await snapshot(page);
  expect(restored.json.content?.[0].attrs?.textAlign).toBe("center");
  expect(imageNodes(restored.json)[0]?.attrs).toMatchObject({
    src: "/tests/sample-image.svg",
    width: "300",
    height: "130",
    semloEditorImageStyle: "shadow",
    semloEditorCaption: "联合示例",
    semloEditorCaptionVisible: true,
    semloEditorImageHref: "example.com/path",
    semloEditorImageOpenInCurrent: true,
  });
  await page.evaluate(() => window.__semloRequireFixture("imageFormatEditor").setEditable(false));
  const readonlyLink = host.getByRole("link", { name: "打开图片链接" });
  await expect(readonlyLink).toHaveAttribute("href", "https://example.com/path");
  await expect(readonlyLink).toHaveAttribute("target", "_self");
  await expect(host.locator(".semlo-editor-image-caption")).toContainText("联合示例");
});

test("unsafe image links are not emitted or opened from injected JSON and HTML", async ({ page }) => {
  const { host } = await mount(page);
  await page.evaluate(() =>
    window.__semloRequireFixture("imageFormatEditor").setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "image", attrs: { src: "/tests/sample-image.svg", semloEditorImageHref: "javascript:alert(1)" } },
          ],
        },
      ],
    }),
  );
  let saved = await snapshot(page);
  expect(saved.html).not.toContain("javascript:");
  await page.evaluate(() => window.__semloRequireFixture("imageFormatEditor").setEditable(false));
  await expect(host.getByRole("link", { name: "打开图片链接" })).toHaveCount(0);
  await page.evaluate(() => window.__semloRequireFixture("imageFormatEditor").setEditable(true));
  await page.evaluate(() => window.__semloRequireFixture("imageFormatEditor").setContent("<p>清空</p>"));
  await page.evaluate(() =>
    window
      .__semloRequireFixture("imageFormatEditor")
      .setContent('<a href="javascript:alert(1)"><img src="/tests/sample-image.svg"></a>'),
  );
  saved = await snapshot(page);
  expect(saved.html).not.toContain("javascript:");
  expect(await attrs(page)).toMatchObject({ semloEditorImageHref: "" });
  await page.evaluate(() =>
    window
      .__semloRequireFixture("imageFormatEditor")
      .setContent('<a href="https://example.com/demo" target="_blank"><img src="/tests/sample-image.svg"></a>'),
  );
  expect(await attrs(page)).toMatchObject({
    semloEditorImageHref: "https://example.com/demo",
    semloEditorImageOpenInCurrent: false,
  });
  expect((await snapshot(page)).html).toContain('href="https://example.com/demo"');
});

test("preview retains image description and link when switching framework and read-only mode", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.getByRole("combobox", { name: "选择示例" }).selectOption("media");
  const host = page.locator("#editor-host");
  const frame = host.locator(".semlo-editor-image-node").nth(1);
  await frame.locator(".semlo-editor-image-frame > img").click();
  const caption = frame.getByLabel("图片描述内容");
  await caption.fill("跨框架保留描述");
  await caption.press("Enter");
  await frame.locator(".semlo-editor-image-frame > img").click();
  await frame.getByRole("button", { name: "图片链接" }).click();
  const dialog = frame.getByRole("dialog", { name: "图片链接" });
  await dialog.getByLabel("图片链接地址").fill("example.com/demo");
  await dialog.getByLabel("图片链接地址").press("Enter");
  await frame.getByRole("button", { name: "图片链接" }).click();
  for (const framework of ["React", "SolidJS", "原生 JS", "Vue"]) {
    await page.getByRole("group", { name: "框架切换" }).getByRole("button", { name: framework, exact: true }).click();
    await expect(frame.getByLabel("图片描述内容")).toHaveValue("跨框架保留描述");
    await expect(frame.locator(".semlo-editor-image-link")).toHaveAttribute("href", "https://example.com/demo");
  }
  await page.getByRole("button", { name: "只读预览" }).click();
  await expect(frame.getByRole("link", { name: "打开图片链接" })).toHaveAttribute("href", "https://example.com/demo");
  await expect(frame.locator(".semlo-editor-image-caption")).toContainText("跨框架保留描述");
});

test("description undo and a replacement during link editing cannot change the new image", async ({ page }) => {
  const { host } = await mount(page);
  await host.getByRole("button", { name: "图片描述", exact: true }).click();
  const caption = host.getByLabel("图片描述内容");
  await caption.fill("需要撤销的说明");
  await expect
    .poll(() => attrs(page))
    .toMatchObject({ semloEditorCaption: "需要撤销的说明", semloEditorCaptionVisible: true });
  await caption.press("Meta+z");
  await expect.poll(() => attrs(page)).toMatchObject({ semloEditorCaption: "", semloEditorCaptionVisible: true });
  await caption.fill("保留的说明");
  await caption.press("Enter");
  await host.locator(".semlo-editor-image-frame > img").click({ position: { x: 20, y: 20 } });
  await host.getByRole("button", { name: "图片链接" }).click();
  const dialog = host.getByRole("dialog", { name: "图片链接" });
  await dialog.getByLabel("图片链接地址").fill("example.com/not-committed");
  await page.evaluate(() =>
    window.__semloRequireFixture("imageFormatEditor").setContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "image", attrs: { src: "/tests/sample-image.svg", alt: "替换图片" } }] },
      ],
    }),
  );
  await expect(dialog).toHaveCount(0);
  expect(await attrs(page)).toMatchObject({ alt: "替换图片", semloEditorCaption: "", semloEditorImageHref: "" });
});

test("image editing remains isolated between editor instances", async ({ page }) => {
  const { host } = await mount(page);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'image-format-other'
      host.style.width = '500px'
      document.body.prepend(host)
      window.imageFormatOther = createEditor({
        element: host,
        outline: false,
        content: { type: 'doc', content: [
          { type: "paragraph", content: [{ type: 'image', attrs: { src: '/tests/sample-image.svg', alt: '另一张图片', width: 300, height: 130 } }] },
          { type: 'paragraph' },
        ] },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.imageFormatOther));
  await host.getByRole("button", { name: "图片链接" }).click();
  await host.getByRole("dialog", { name: "图片链接" }).getByLabel("图片链接地址").fill("example.com/first");

  const other = page.locator("#image-format-other");
  await other.locator(".semlo-editor-image-frame > img").click();
  await other.getByRole("button", { name: "图片描述", exact: true }).click();
  await other.getByLabel("图片描述内容").fill("第二个编辑器");
  await other.getByLabel("图片描述内容").press("Enter");

  await expect
    .poll(() => attrs(page))
    .toMatchObject({ semloEditorImageHref: "example.com/first", semloEditorCaption: "" });
  const otherAttrs = imageNodes(
    (await page.evaluate(() => window.__semloRequireFixture("imageFormatOther").getSnapshot())).json,
  )[0]?.attrs;
  expect(otherAttrs).toMatchObject({
    semloEditorImageHref: "",
    semloEditorCaption: "第二个编辑器",
    semloEditorCaptionVisible: true,
  });
  await page.evaluate(() => window.__semloRequireFixture("imageFormatEditor").setEditable(false));
  await expect(host.getByRole("link", { name: "打开图片链接" })).toHaveAttribute("href", "https://example.com/first");
  await expect(other.getByLabel("图片描述内容")).toHaveValue("第二个编辑器");
});
