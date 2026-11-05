import { expect, test, type Page } from "@rstest/playwright";

import type { GalleryData } from "../../../packages/core/src/features/media/gallery/extension";
import type { EditorContent, EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    galleryFidelityEditor?: EditorController;
    gallerySecondEditor?: EditorController;
    galleryErrors?: string[];
    galleryFixtureContent?: EditorContent;
  }
}

test("gallery preserves opaque fields and hidden unsafe images across edits, undo and HTML", async ({ page }) => {
  const data = {
    id: "gallery-preserve",
    layout: "grid" as const,
    extra: { source: "导入", nested: [1, { keep: true }] },
    images: [
      {
        id: "safe",
        src: "/tests/sample-image.svg",
        title: "原始标题",
        href: "javascript:alert(1)",
        extra: { author: "作者" },
      },
      { id: "unsafe", src: "javascript:alert(2)", title: "不显示", href: "", extra: [3] },
      null,
    ],
  };
  const host = await mount(page, data as unknown as GalleryData);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js';
      const host = document.createElement('div'); host.id = 'gallery-second'; document.body.append(host);
      window.gallerySecondEditor = createEditor({ element: host, outline: false, content: window.galleryFixtureContent });
    `,
  });
  const initial = await page.evaluate(() => window.__semloRequireFixture("galleryFidelityEditor").getSnapshot());
  expect(initial.json.content?.[1].attrs?.data).toEqual(data);
  expect(initial.html).not.toContain("javascript:");
  await expect(host.locator(".semlo-editor-gallery img")).toHaveCount(1);
  await expect(host.locator(".semlo-editor-gallery a")).toHaveCount(0);

  await host.locator(".semlo-editor-gallery-surface").click({ position: { x: 5, y: 5 } });
  await host.getByRole("button", { name: "切换版式" }).click();
  const changed = await page.evaluate(() => window.__semloRequireFixture("galleryFidelityEditor").getSnapshot());
  expect(changed.json.content?.[1].attrs?.data).toEqual({ ...data, layout: "carousel" });
  expect((await page.evaluate(() => window.__semloRequireFixture("gallerySecondEditor").getSnapshot())).json).toEqual(
    initial.json,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryFidelityEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("galleryFidelityEditor").getSnapshot())).json).toEqual(
    initial.json,
  );

  await host.locator(".semlo-editor-gallery-surface").click({ position: { x: 5, y: 5 } });
  await host.getByRole("button", { name: "编辑图册" }).click();
  const dialog = page.getByRole("dialog", { name: "图册设置" });
  await dialog.getByLabel("标题（图片一）").fill("修改后的标题");
  await dialog.getByRole("button", { name: "确定", exact: true }).click();
  const edited = await page.evaluate(() => window.__semloRequireFixture("galleryFidelityEditor").getSnapshot());
  expect(edited.json.content?.[1].attrs?.data).toEqual({
    ...data,
    images: [{ ...data.images[0], title: "修改后的标题" }, data.images[1], null],
  });
  await page.evaluate((html) => window.__semloRequireFixture("galleryFidelityEditor").setContent(html), edited.html);
  expect((await page.evaluate(() => window.__semloRequireFixture("galleryFidelityEditor").getSnapshot())).json).toEqual(
    edited.json,
  );
  await page.evaluate(() => {
    window.__semloRequireFixture("galleryFidelityEditor").destroy();
    window.__semloRequireFixture("gallerySecondEditor").destroy();
  });
});

test("gallery rejects damaged encoded HTML and invalid identifiers without replacing content", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js';
      const host = document.createElement('div'); host.id = 'gallery-fidelity-test'; document.body.append(host);
      window.galleryErrors = [];
      window.galleryFidelityEditor = createEditor({ element: host, outline: false,
        onError: error => window.galleryErrors.push(error.message),
        content: { type:'doc', content:[{ type:'semloEditorGallery', attrs:{ data:{ id:'无效 id', layout:'grid', images:[] } } }] }
      });
    `,
  });
  await page.waitForFunction(() => Boolean(window.galleryFidelityEditor));
  const initial = await page.evaluate(() => window.__semloRequireFixture("galleryFidelityEditor").getSnapshot());
  const host = page.locator("#gallery-fidelity-test");
  await host.locator(".semlo-editor-gallery-surface").click({ position: { x: 5, y: 5 } });
  await host.getByRole("button", { name: "切换版式" }).click();
  await expect(host.getByRole("status")).toContainText("图册标识无效");
  expect((await page.evaluate(() => window.__semloRequireFixture("galleryFidelityEditor").getSnapshot())).json).toEqual(
    initial.json,
  );
  await page.evaluate(() =>
    window
      .__semloRequireFixture("galleryFidelityEditor")
      .setContent('<figure data-semlo-editor-gallery data-semlo-gallery-json="%broken"></figure>'),
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("galleryFidelityEditor").getSnapshot())).json).toEqual(
    initial.json,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryErrors"))).toEqual([
    expect.stringContaining("图册标识无效"),
    expect.stringContaining("图册数据无法解析"),
  ]);
  await page.evaluate(() => window.__semloRequireFixture("galleryFidelityEditor").destroy());
});

const emptyGallery: GalleryData = { id: "gallery-empty", layout: "carousel", images: [] };
const imageGallery: GalleryData = {
  id: "gallery-images",
  layout: "carousel",
  images: [
    { id: "first", src: "/tests/sample-image.svg?first", title: "第一张", href: "https://example.com/first" },
    { id: "second", src: "/tests/sample-image.svg?second", title: "第二张", href: "" },
  ],
};

async function mount(page: Page, data: GalleryData) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => {
    window.galleryFixtureContent = {
      type: "doc",
      content: [{ type: "paragraph" }, { type: "semloEditorGallery", attrs: { data: value } }, { type: "paragraph" }],
    };
  }, data);
  await page.addScriptTag({
    type: "module",
    content: [
      "import { createEditor } from '/dist/index.js'",
      "const host = document.createElement('div')",
      "host.id = 'gallery-fidelity-test'",
      "document.body.prepend(host)",
      "window.galleryFidelityEditor = createEditor({ element: host, outline: false, content: window.galleryFixtureContent })",
    ].join("\n"),
  });
  await page.waitForFunction(() => Boolean(window.galleryFidelityEditor));
  return page.locator("#gallery-fidelity-test");
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("empty gallery selects, cycles layouts, respects read-only and supports deletion undo", async ({ page }) => {
  const host = await mount(page, emptyGallery);
  const card = host.locator(".semlo-editor-gallery");
  const surface = card.locator(".semlo-editor-gallery-surface");
  await expect(surface).toHaveCSS("height", "240px");
  await expect(surface).toHaveCSS("background-color", "rgb(250, 250, 250)");
  await expect(surface).toHaveCSS("border-style", "dashed");
  await expect(surface).toHaveCSS("border-color", "rgb(231, 233, 232)");
  await expect(surface).toHaveCSS("border-radius", "8px");
  await expect(card.getByText("在此上传或拖入多张图片")).toBeVisible();
  const upload = card.getByRole("button", { name: "上传图片" });
  await expect(upload.locator('svg[aria-hidden="true"]')).toHaveCount(1);
  await expect(upload).toHaveCSS("width", "102px");
  await expect(upload).toHaveCSS("height", "32px");
  await surface.click({ position: { x: 5, y: 5 } });
  const toolbar = card.getByRole("toolbar", { name: "图册操作" });
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toHaveText("切换版式编辑图册");
  await expect(toolbar.locator('button svg[aria-hidden="true"]')).toHaveCount(2);
  const toolbarBox = await toolbar.boundingBox();
  const surfaceBox = await surface.boundingBox();
  if (!toolbarBox || !surfaceBox) throw new Error("Missing gallery toolbar geometry");
  expect(toolbarBox.width).toBe(218);
  expect(toolbarBox.height).toBe(40);
  expect(Math.abs(toolbarBox.x + toolbarBox.width / 2 - (surfaceBox.x + surfaceBox.width / 2))).toBeLessThan(1);
  expect(surfaceBox.y - (toolbarBox.y + toolbarBox.height)).toBe(6);
  await expect(surface).toHaveClass(/is-selected/);
  const data = () =>
    page.evaluate(
      () =>
        window.__semloRequireFixture("galleryFidelityEditor").getSnapshot().json.content?.[1].attrs
          ?.data as GalleryData,
    );
  await toolbar.getByRole("button", { name: "切换版式" }).click();
  expect((await data()).layout).toBe("thumbnail");
  await toolbar.getByRole("button", { name: "切换版式" }).click();
  expect((await data()).layout).toBe("grid");
  await toolbar.getByRole("button", { name: "切换版式" }).click();
  expect((await data()).layout).toBe("carousel");
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryFidelityEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await data()).layout).toBe("grid");

  await page.evaluate(() => window.__semloRequireFixture("galleryFidelityEditor").setEditable(false));
  await expect(toolbar).toBeHidden();
  await expect(card.getByRole("button", { name: "上传图片" })).toBeDisabled();
  await page.evaluate(() => window.__semloRequireFixture("galleryFidelityEditor").setEditable(true));
  await surface.click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("Backspace");
  await expect(card).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryFidelityEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(card).toHaveCount(1);
});

test("carousel, thumbnails and grid display the same images and retain titles and links", async ({ page }) => {
  const host = await mount(page, imageGallery);
  const card = host.locator(".semlo-editor-gallery");
  const stage = card.locator(".semlo-editor-gallery-stage");
  await expect(stage.locator("img")).toHaveAttribute("src", imageGallery.images[0].src);
  await expect(stage.locator(".semlo-editor-gallery-caption > span")).toHaveText("第一张");
  await card.getByRole("button", { name: "第 2 张图片" }).click();
  await expect(stage.locator("img")).toHaveAttribute("src", imageGallery.images[1].src);
  await expect(stage.locator(".semlo-editor-gallery-caption > span")).toHaveText("第二张");
  await card.locator(".semlo-editor-gallery-surface").click({ position: { x: 5, y: 5 } });
  const toolbar = card.getByRole("toolbar", { name: "图册操作" });
  await toolbar.getByRole("button", { name: "切换版式" }).click();
  const thumbs = card.locator(".semlo-editor-gallery-thumbnails");
  await expect(thumbs.locator("button")).toHaveCount(2);
  await expect(thumbs.locator("button").first()).toHaveCSS("width", "106px");
  await expect(thumbs.locator("button").first()).toHaveCSS("height", "80px");
  await thumbs.getByRole("button", { name: "查看第 1 张图片" }).click();
  await expect(stage.locator("img")).toHaveAttribute("src", imageGallery.images[0].src);
  await toolbar.getByRole("button", { name: "切换版式" }).click();
  const grid = card.locator(".semlo-editor-gallery-grid");
  await expect(grid.locator("img")).toHaveCount(2);
  const boxes = await grid.locator("img").evaluateAll((images) =>
    images.map((image) => {
      const rect = image.getBoundingClientRect();
      return { x: rect.x, width: rect.width };
    }),
  );
  expect(Math.abs(boxes[0].width - boxes[1].width)).toBeLessThan(1);
  expect(Math.abs(boxes[1].x - boxes[0].x - boxes[0].width - 10)).toBeLessThan(1);
  await expect(card.locator(".semlo-editor-gallery-caption")).toHaveCount(0);
  await expect(grid.locator("a.semlo-editor-gallery-image")).toHaveAttribute("href", "https://example.com/first");
  await page.evaluate(() => window.__semloRequireFixture("galleryFidelityEditor").setEditable(false));
  await expect(grid.locator("a.semlo-editor-gallery-image")).toBeVisible();
  await expect(toolbar).toBeHidden();
});

test("image data survives HTML and JSON round trips and rejects dangerous URLs", async ({ page }) => {
  const host = await mount(page, imageGallery);
  await page.evaluate((data) => {
    window.__semloRequireFixture("galleryFidelityEditor").setContent({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "正文" }] },
        { type: "semloEditorGallery", attrs: { data } },
        { type: "paragraph", content: [{ type: "text", text: "后文" }] },
      ],
    });
  }, imageGallery);
  const original = await page.evaluate(() => window.__semloRequireFixture("galleryFidelityEditor").getSnapshot());
  expect(original.html).toContain("data-semlo-editor-gallery");
  expect(original.html).toContain("第一张");
  expect(original.html).toContain("第二张");
  expect(original.text.replace(/\s/g, "")).toBe("正文后文");
  expect(
    (original.json.content?.[1].attrs?.data as GalleryData | undefined)?.images.map((image) => image.title),
  ).toEqual(["第一张", "第二张"]);
  for (const content of [original.html, original.json]) {
    await page.evaluate((value) => {
      window.__semloRequireFixture("galleryFidelityEditor").setContent("<p>临时</p>");
      window.__semloRequireFixture("galleryFidelityEditor").setContent(value);
    }, content);
    const restored = await page.evaluate(() => window.__semloRequireFixture("galleryFidelityEditor").getSnapshot());
    expect(restored.json).toEqual(original.json);
    expect(restored.text.replace(/\s/g, "")).toBe("正文后文");
    await expect(host.locator(".semlo-editor-gallery-stage img")).toHaveAttribute("src", imageGallery.images[0].src);
  }
  await page.evaluate(() =>
    window.__semloRequireFixture("galleryFidelityEditor").setContent({
      type: "doc",
      content: [
        {
          type: "semloEditorGallery",
          attrs: {
            data: {
              id: "unsafe",
              layout: "grid",
              images: [
                { id: "bad", src: "javascript:alert(1)", title: "bad", href: "javascript:alert(2)" },
                { id: "safe", src: "/tests/sample-image.svg", title: "safe", href: "javascript:alert(3)" },
              ],
            },
          },
        },
      ],
    }),
  );
  await expect(host.locator(".semlo-editor-gallery img")).toHaveCount(1);
  const html = (await page.evaluate(() => window.__semloRequireFixture("galleryFidelityEditor").getSnapshot())).html;
  expect(html).not.toContain("javascript:");
  expect(html).not.toContain("<a ");
  await host.locator(".semlo-editor-gallery-surface").click({ position: { x: 5, y: 5 } });
  await host.getByRole("button", { name: "编辑图册" }).click();
  await expect(page.getByRole("dialog", { name: "图册设置" })).toBeVisible();
  await page.evaluate(
    (data) =>
      window.__semloRequireFixture("galleryFidelityEditor").setContent({
        type: "doc",
        content: [{ type: "semloEditorGallery", attrs: { data } }],
      }),
    imageGallery,
  );
  await expect(page.getByRole("dialog", { name: "图册设置" })).toHaveCount(0);
  await expect(host.locator(".semlo-editor-gallery")).toHaveCount(1);
  await page.evaluate(() => window.__semloRequireFixture("galleryFidelityEditor").destroy());
});

test("image preview preserves the carousel and deleting individual images supports undo", async ({ page }) => {
  const host = await mount(page, imageGallery);
  const card = host.locator(".semlo-editor-gallery");
  const stage = card.locator(".semlo-editor-gallery-stage");
  await stage.hover();
  const actions = stage.locator(".semlo-editor-gallery-image-actions");
  await expect(actions.getByRole("link", { name: "打开图片链接" })).toHaveAttribute(
    "href",
    "https://example.com/first",
  );
  await actions.getByRole("button", { name: "放大图片" }).click();
  const preview = page.getByRole("dialog", { name: "图册图片预览" });
  await expect(preview).toBeVisible();
  await preview.getByRole("button", { name: "下一张" }).click();
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(stage.locator("img")).toHaveAttribute("src", imageGallery.images[0].src);
  await card.getByRole("button", { name: "第 2 张图片" }).click();
  await expect(stage.locator("img")).toHaveAttribute("src", imageGallery.images[1].src);
  await stage.hover();
  await expect(actions.getByRole("link", { name: "打开图片链接" })).toHaveCount(0);
  await expect(actions.locator("button")).toHaveCount(2);
  await actions.getByRole("button", { name: "删除当前图片" }).click();
  await expect(card.locator(".semlo-editor-gallery-dots button")).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const data = window.__semloRequireFixture("galleryFidelityEditor").getSnapshot().json.content?.[1].attrs
        ?.data as GalleryData;
      return data.images.map((image) => image.id);
    }),
  ).toEqual(["first"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryFidelityEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(card.locator(".semlo-editor-gallery-dots button")).toHaveCount(2);
  await stage.hover();
  await actions.getByRole("button", { name: "放大图片" }).click();
  await page.evaluate(() => window.__semloRequireFixture("galleryFidelityEditor").setContent("<p>替换</p>"));
  await expect(page.getByRole("dialog", { name: "图册图片预览" })).toHaveCount(0);
});

test("the empty card uses the current image upload integration for multiple files", async ({ page }) => {
  const host = await mount(page, emptyGallery);
  await page.evaluate(() => {
    window.__semloRequireFixture("galleryFidelityEditor").setIntegrations({
      uploadImage: async (file) => "/tests/sample-image.svg?" + file.name,
      uploadAttachment: undefined,
      searchMentions: undefined,
    });
  });
  const card = host.locator(".semlo-editor-gallery");
  const fileChooser = page.waitForEvent("filechooser");
  await card.getByRole("button", { name: "上传图片" }).click();
  const chooser = await fileChooser;
  expect(chooser.isMultiple()).toBe(true);
  await chooser.setFiles([
    { name: "one.png", mimeType: "image/png", buffer: Buffer.from("one") },
    { name: "two.png", mimeType: "image/png", buffer: Buffer.from("two") },
  ]);
  const panel = page.getByRole("dialog", { name: "图册设置" });
  await expect(panel).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (
          window.__semloRequireFixture("galleryFidelityEditor").getSnapshot().json.content?.[1].attrs?.data as
            | GalleryData
            | undefined
        )?.images,
    ),
  ).toEqual([]);
  const confirm = panel.getByRole("button", { name: "确定", exact: true });
  await expect(confirm).toBeEnabled();
  await confirm.click();
  await expect(card.locator(".semlo-editor-gallery-dots button")).toHaveCount(2);
  const images = await page.evaluate(
    () =>
      (
        window.__semloRequireFixture("galleryFidelityEditor").getSnapshot().json.content?.[1].attrs?.data as
          | GalleryData
          | undefined
      )?.images ?? [],
  );
  expect(images.map((image) => image.src)).toEqual([
    "/tests/sample-image.svg?one.png",
    "/tests/sample-image.svg?two.png",
  ]);
  expect(new Set(images.map((image) => image.id)).size).toBe(2);
  const dropped = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["three"], "three.png", { type: "image/png" }));
    return transfer;
  });
  await card.locator(".semlo-editor-gallery-surface").dispatchEvent("drop", { dataTransfer: dropped });
  await expect(card.locator(".semlo-editor-gallery-dots button")).toHaveCount(3);
  await page.evaluate(() => window.__semloRequireFixture("galleryFidelityEditor").setEditable(false));
  await card.locator(".semlo-editor-gallery-surface").dispatchEvent("drop", { dataTransfer: dropped });
  await expect(card.locator(".semlo-editor-gallery-dots button")).toHaveCount(3);
  await dropped.dispose();
});
