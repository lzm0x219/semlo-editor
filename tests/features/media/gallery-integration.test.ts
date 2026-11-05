import { expect, test, type Page } from "@rstest/playwright";

import type { GalleryData } from "../../../packages/core/src/features/media/gallery/extension";
import type { EditorContent, EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    galleryIntegrationEditor?: EditorController;
    galleryIntegrationContent?: EditorContent;
    galleryIntegrationRequests?: Partial<Record<string, (url: string) => void>>;
    galleryIntegrationCalls?: string[];
  }
}

const emptyGallery: GalleryData = { id: "integration-gallery", layout: "carousel", images: [] };
const populatedGallery: GalleryData = {
  ...emptyGallery,
  images: [
    { id: "original", src: "/tests/sample-image.svg?original", title: "原图片", href: "https://example.com/original" },
  ],
};
const firstFile = { name: "first.png", mimeType: "image/png", buffer: Buffer.from("first") };
const secondFile = { name: "second.png", mimeType: "image/png", buffer: Buffer.from("second") };

function galleryDocument(data: GalleryData): EditorContent {
  return {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "第一段" }] },
      { type: "semloEditorGallery", attrs: { data } },
      { type: "paragraph", content: [{ type: "text", text: "第二段" }] },
    ],
  };
}

async function mount(page: Page, content: EditorContent = "<p>第一段</p><p>第二段</p>") {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => {
    window.galleryIntegrationContent = value;
    window.galleryIntegrationRequests = {};
    window.galleryIntegrationCalls = [];
  }, content);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'gallery-integration-test'
      document.body.prepend(host)
      window.galleryIntegrationEditor = createEditor({
        element: host,
        outline: false,
        content: window.galleryIntegrationContent,
        uploadImage: async file => '/tests/sample-image.svg?' + file.name,
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.galleryIntegrationEditor));
  return page.locator("#gallery-integration-test");
}

async function data(page: Page) {
  return page.evaluate(
    () =>
      window
        .__semloRequireFixture("galleryIntegrationEditor")
        .getSnapshot()
        .json.content?.find((node) => node.type === "semloEditorGallery")?.attrs?.data as GalleryData | undefined,
  );
}

async function openSettings(page: Page, host: ReturnType<Page["locator"]>) {
  await host.locator(".semlo-editor-gallery-surface").click({ position: { x: 5, y: 5 } });
  await host.getByRole("toolbar", { name: "图册操作" }).getByRole("button", { name: "编辑图册" }).click();
  const panel = page.getByRole("dialog", { name: "图册设置" });
  await expect(panel).toBeVisible();
  return panel;
}

async function insertFromToolbar(page: Page, host: ReturnType<Page["locator"]>) {
  await host.locator(".semlo-editor-prose p").first().click();
  await host.getByRole("button", { name: "插入内容" }).click();
  const menu = page.getByRole("dialog", { name: "插入内容" });
  await menu.getByLabel("搜索插入内容").fill("图册");
  await menu.locator('[data-command="gallery"]').click();
  await expect(host.locator(".semlo-editor-gallery")).toHaveCount(1);
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("the insertion toolbar creates a gallery without losing surrounding text", async ({ page }) => {
  const host = await mount(page);
  await insertFromToolbar(page, host);
  await expect(host.locator(".semlo-editor-gallery").getByRole("button", { name: "上传图片" })).toBeVisible();
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("galleryIntegrationEditor").getSnapshot());
  expect(snapshot.text).toContain("第一段");
  expect(snapshot.text).toContain("第二段");
  expect((await data(page))?.images).toEqual([]);
});

test("slash and insert-below place galleries at the selected blocks", async ({ page }) => {
  const host = await mount(page);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("galleryIntegrationEditor").editor;
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: "paragraph" });
  });
  await host.locator(".semlo-editor-prose p").last().click();
  await page.keyboard.type("/tc");
  const slash = page.getByRole("listbox", { name: "插入内容" });
  await expect(slash.getByRole("option", { name: /图册/ })).toBeVisible();
  await page.keyboard.press("Enter");
  await expect(host.locator(".semlo-editor-gallery")).toHaveCount(1);
  await host.locator(".semlo-editor-prose > p").first().hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "在下方添加" }).click();
  await page.getByRole("dialog", { name: "插入内容" }).locator('[data-command="gallery"]').click();
  await expect(host.locator(".semlo-editor-gallery")).toHaveCount(2);
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("galleryIntegrationEditor").getSnapshot());
  expect(snapshot.json.content?.map((node) => node.type)).toEqual([
    "paragraph",
    "semloEditorGallery",
    "paragraph",
    "semloEditorGallery",
  ]);
  expect(snapshot.text).toContain("第一段");
  expect(snapshot.text).toContain("第二段");
  expect(snapshot.text).not.toContain("/tc");
});

test("direct uploads use the latest callback and preserve selection order when responses finish out of order", async ({
  page,
}) => {
  const host = await mount(page, galleryDocument(emptyGallery));
  await page.evaluate(() => {
    window.__semloRequireFixture("galleryIntegrationEditor").setIntegrations({
      uploadImage: (file) =>
        new Promise((resolve) => {
          window.__semloRequireFixture("galleryIntegrationCalls").push("old:" + file.name);
          window.__semloRequireFixture("galleryIntegrationRequests")[file.name] = resolve;
        }),
    });
  });
  const dropFile = async (name: string) => {
    const transfer = await page.evaluateHandle((fileName) => {
      const value = new DataTransfer();
      value.items.add(new File([fileName], fileName, { type: "image/png" }));
      return value;
    }, name);
    await host.locator(".semlo-editor-gallery-surface").dispatchEvent("drop", { dataTransfer: transfer });
    await transfer.dispose();
  };
  await dropFile(firstFile.name);
  await page.waitForFunction(() => Boolean(window.__semloRequireFixture("galleryIntegrationRequests")["first.png"]));
  await page.evaluate(() => {
    window.__semloRequireFixture("galleryIntegrationEditor").setIntegrations({
      uploadImage: (file) =>
        new Promise((resolve) => {
          window.__semloRequireFixture("galleryIntegrationCalls").push("new:" + file.name);
          window.__semloRequireFixture("galleryIntegrationRequests")[file.name] = resolve;
        }),
    });
  });
  await dropFile(secondFile.name);
  await page.waitForFunction(() => Boolean(window.__semloRequireFixture("galleryIntegrationRequests")["second.png"]));
  expect(await page.evaluate(() => window.galleryIntegrationCalls)).toEqual(["old:first.png", "new:second.png"]);
  await page.evaluate(async () => {
    (
      window.__semloRequireFixture("galleryIntegrationRequests")["second.png"] ??
      (() => {
        throw new Error("Gallery upload second.png is not pending");
      })()
    )("/tests/sample-image.svg?second");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect((await data(page))?.images).toEqual([]);
  await host.locator(".semlo-editor-gallery-surface").click({ position: { x: 5, y: 5 } });
  await host.getByRole("toolbar", { name: "图册操作" }).getByRole("button", { name: "切换版式" }).click();
  expect((await data(page))?.layout).toBe("thumbnail");
  await page.evaluate(() =>
    (
      window.__semloRequireFixture("galleryIntegrationRequests")["first.png"] ??
      (() => {
        throw new Error("Gallery upload first.png is not pending");
      })()
    )("/tests/sample-image.svg?first"),
  );
  await expect
    .poll(async () => (await data(page))?.images.map((image) => image.src))
    .toEqual(["/tests/sample-image.svg?first", "/tests/sample-image.svg?second"]);
  await expect(host.locator(".semlo-editor-gallery-dots button")).toHaveCount(2);
  expect((await data(page))?.layout).toBe("thumbnail");
});

test("pasting over a gallery with the same ID does not receive the replaced gallery’s pending upload", async ({
  page,
}) => {
  const host = await mount(page, galleryDocument(emptyGallery));
  await page.evaluate(() => {
    window.__semloRequireFixture("galleryIntegrationEditor").setIntegrations({
      uploadImage: (file) =>
        new Promise((resolve) => (window.__semloRequireFixture("galleryIntegrationRequests")[file.name] = resolve)),
    });
  });
  await host.locator('input[aria-label="选择图册图片"]').setInputFiles(firstFile);
  await page.waitForFunction(() => Boolean(window.__semloRequireFixture("galleryIntegrationRequests")["first.png"]));
  await page.evaluate(() => {
    const controller = window.__semloRequireFixture("galleryIntegrationEditor");
    const source = document.createElement("div");
    source.innerHTML = controller.getSnapshot().html;
    const figure = source.querySelector("figure[data-semlo-editor-gallery]");
    if (!figure) throw new Error("Missing exported gallery");
    figure.setAttribute("data-layout", "grid");
    const clipboard = new DataTransfer();
    clipboard.setData("text/html", figure.outerHTML);
    let position = -1;
    controller.editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "semloEditorGallery") position = pos;
    });
    if (position < 0) throw new Error("Missing gallery node");
    controller.editor.commands.setNodeSelection(position);
    controller.editor.view.dom.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }),
    );
  });
  expect(await data(page)).toEqual({ id: "integration-gallery", layout: "grid", images: [] });
  await page.evaluate(async () => {
    (
      window.__semloRequireFixture("galleryIntegrationRequests")["first.png"] ??
      (() => {
        throw new Error("Gallery upload first.png is not pending");
      })()
    )("/tests/sample-image.svg?late");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(await data(page)).toEqual({ id: "integration-gallery", layout: "grid", images: [] });
});

test("undoing a gallery change cancels uploads started before the undo", async ({ page }) => {
  const host = await mount(page, galleryDocument(emptyGallery));
  await page.evaluate(() => {
    window.__semloRequireFixture("galleryIntegrationEditor").setIntegrations({
      uploadImage: (file) =>
        new Promise((resolve) => (window.__semloRequireFixture("galleryIntegrationRequests")[file.name] = resolve)),
    });
  });
  const transfer = await page.evaluateHandle(() => {
    const value = new DataTransfer();
    value.items.add(new File(["first"], "first.png", { type: "image/png" }));
    return value;
  });
  await host.locator(".semlo-editor-gallery-surface").dispatchEvent("drop", { dataTransfer: transfer });
  await transfer.dispose();
  await page.waitForFunction(() => Boolean(window.__semloRequireFixture("galleryIntegrationRequests")["first.png"]));
  await host.locator(".semlo-editor-gallery-surface").click({ position: { x: 5, y: 5 } });
  await host.getByRole("toolbar", { name: "图册操作" }).getByRole("button", { name: "切换版式" }).click();
  expect((await data(page))?.layout).toBe("thumbnail");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("galleryIntegrationEditor").editor.commands.undo()),
  ).toBe(true);
  expect((await data(page))?.layout).toBe("carousel");
  await page.evaluate(async () => {
    (
      window.__semloRequireFixture("galleryIntegrationRequests")["first.png"] ??
      (() => {
        throw new Error("Gallery upload first.png is not pending");
      })()
    )("/tests/sample-image.svg?late");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect((await data(page))?.images).toEqual([]);
});

test("settings cancel rolls back changes, while confirmation saves uploaded images and survives HTML and JSON", async ({
  page,
}) => {
  const host = await mount(page, galleryDocument(populatedGallery));
  const initial = await page.evaluate(
    () => window.__semloRequireFixture("galleryIntegrationEditor").getSnapshot().json,
  );
  let panel = await openSettings(page, host);
  await panel.getByRole("button", { name: "平铺" }).click();
  await panel.getByLabel("标题（图片一）").fill("不会保存");
  await panel.getByRole("button", { name: "图片一", exact: true }).hover();
  await panel.getByRole("button", { name: "删除图片一" }).click();
  await panel.getByRole("alertdialog", { name: "删除图片确认" }).getByRole("button", { name: "确定" }).click();
  await panel.getByRole("button", { name: "取消", exact: true }).click();
  expect(
    await page.evaluate(() => window.__semloRequireFixture("galleryIntegrationEditor").getSnapshot().json),
  ).toEqual(initial);

  panel = await openSettings(page, host);
  await panel.getByRole("button", { name: "平铺" }).click();
  await panel.getByLabel("标题（图片一）").fill("封面");
  await panel.getByLabel("链接（图片一）").fill("https://example.com/cover");
  await panel.locator('input[aria-label="选择图片文件"]').setInputFiles([firstFile, secondFile]);
  await expect(panel.getByRole("button", { name: "图片三", exact: true })).toBeVisible();
  await panel.getByRole("button", { name: "图片二", exact: true }).click();
  await panel.getByLabel("标题（图片二）").fill("第二张");
  await panel.getByRole("button", { name: "确定", exact: true }).click();
  await expect(panel).toHaveCount(0);
  await expect(host.locator(".semlo-editor-gallery-grid img")).toHaveCount(3);
  const saved = await page.evaluate(() => window.__semloRequireFixture("galleryIntegrationEditor").getSnapshot());
  const savedGallery = await data(page);
  expect(savedGallery?.layout).toBe("grid");
  expect(savedGallery?.images.map(({ src, title, href }) => ({ src, title, href }))).toEqual([
    { src: "/tests/sample-image.svg?original", title: "封面", href: "https://example.com/cover" },
    { src: "/tests/sample-image.svg?first.png", title: "第二张", href: "" },
    { src: "/tests/sample-image.svg?second.png", title: "", href: "" },
  ]);
  expect(saved.html).toContain("data-semlo-editor-gallery");
  for (const content of [saved.html, saved.json]) {
    await page.evaluate((value) => {
      window.__semloRequireFixture("galleryIntegrationEditor").setContent("<p>临时内容</p>");
      window.__semloRequireFixture("galleryIntegrationEditor").setContent(value);
    }, content);
    expect(
      (await page.evaluate(() => window.__semloRequireFixture("galleryIntegrationEditor").getSnapshot())).json,
    ).toEqual(saved.json);
    await expect(host.locator(".semlo-editor-gallery-grid img")).toHaveCount(3);
  }
});

test("cancelling gallery settings discards pending uploads and keeps the original images", async ({ page }) => {
  const host = await mount(page, galleryDocument(populatedGallery));
  await page.evaluate(() => {
    window.__semloRequireFixture("galleryIntegrationEditor").setIntegrations({
      uploadImage: (file) =>
        new Promise((resolve) => (window.__semloRequireFixture("galleryIntegrationRequests")[file.name] = resolve)),
    });
  });
  const original = await page.evaluate(
    () => window.__semloRequireFixture("galleryIntegrationEditor").getSnapshot().json,
  );
  let panel = await openSettings(page, host);
  await panel.locator('input[aria-label="选择图片文件"]').setInputFiles([firstFile, secondFile]);
  await page.waitForFunction(
    () =>
      Boolean(window.__semloRequireFixture("galleryIntegrationRequests")["first.png"]) &&
      Boolean(window.__semloRequireFixture("galleryIntegrationRequests")["second.png"]),
  );
  await expect(panel.getByRole("button", { name: "确定", exact: true })).toBeDisabled();
  await page.evaluate(() =>
    (
      window.__semloRequireFixture("galleryIntegrationRequests")["second.png"] ??
      (() => {
        throw new Error("Gallery upload second.png is not pending");
      })()
    )("/tests/sample-image.svg?second"),
  );
  await panel.getByRole("button", { name: "取消", exact: true }).click();
  await page.evaluate(async () => {
    (
      window.__semloRequireFixture("galleryIntegrationRequests")["first.png"] ??
      (() => {
        throw new Error("Gallery upload first.png is not pending");
      })()
    )("/tests/sample-image.svg?first");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(
    await page.evaluate(() => window.__semloRequireFixture("galleryIntegrationEditor").getSnapshot().json),
  ).toEqual(original);
  panel = await openSettings(page, host);
  await expect(panel.getByRole("button", { name: "图片一", exact: true })).toBeVisible();
  await expect(panel.getByRole("button", { name: "图片二", exact: true })).toHaveCount(0);
  await expect(panel.getByLabel("标题（图片一）")).toHaveValue("原图片");
});

for (const boundary of ["replace", "read-only"] as const) {
  test(`late direct uploads do not write after ${boundary}`, async ({ page }) => {
    const host = await mount(page, galleryDocument(emptyGallery));
    await page.evaluate(() => {
      window.__semloRequireFixture("galleryIntegrationEditor").setIntegrations({
        uploadImage: (file) =>
          new Promise((resolve) => (window.__semloRequireFixture("galleryIntegrationRequests")[file.name] = resolve)),
      });
    });
    await host.locator('input[aria-label="选择图册图片"]').setInputFiles(firstFile);
    await page.waitForFunction(() => Boolean(window.__semloRequireFixture("galleryIntegrationRequests")["first.png"]));
    if (boundary === "replace") {
      await page.evaluate((value) => {
        window.__semloRequireFixture("galleryIntegrationEditor").setContent("<p>替换内容</p>");
        window.__semloRequireFixture("galleryIntegrationEditor").setContent(value);
      }, galleryDocument(emptyGallery));
    } else {
      await page.evaluate(() => {
        window.__semloRequireFixture("galleryIntegrationEditor").setEditable(false);
        window.__semloRequireFixture("galleryIntegrationEditor").setEditable(true);
      });
    }
    const before = await page.evaluate(
      () => window.__semloRequireFixture("galleryIntegrationEditor").getSnapshot().json,
    );
    await page.evaluate(async () => {
      (
        window.__semloRequireFixture("galleryIntegrationRequests")["first.png"] ??
        (() => {
          throw new Error("Gallery upload first.png is not pending");
        })()
      )("/tests/sample-image.svg?late");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(
      await page.evaluate(() => window.__semloRequireFixture("galleryIntegrationEditor").getSnapshot().json),
    ).toEqual(before);
    expect((await data(page))?.images).toEqual([]);
    await expect(host.locator(".semlo-editor-gallery img")).toHaveCount(0);
  });
}

test("gallery images, layout, titles and links survive switching between Vue, React and SolidJS", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const host = page.locator("#editor-host");
  await insertFromToolbar(page, host);
  await host.locator('input[aria-label="选择图册图片"]').setInputFiles([firstFile, secondFile]);
  const panel = page.getByRole("dialog", { name: "图册设置" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "确定", exact: true })).toBeEnabled();
  await panel.getByRole("button", { name: "带缩略图的轮播" }).click();
  await panel.getByLabel("标题（图片一）").fill("封面");
  await panel.getByRole("button", { name: "图片二", exact: true }).click();
  await panel.getByLabel("标题（图片二）").fill("附图");
  await panel.getByLabel("链接（图片二）").fill("https://example.com/second");
  await panel.getByRole("button", { name: "确定", exact: true }).click();
  const thumbnails = host.locator(".semlo-editor-gallery-thumbnails button");
  await expect(thumbnails).toHaveCount(2);
  const sources = await thumbnails
    .locator("img")
    .evaluateAll((images) => images.map((image) => image.getAttribute("src")));
  expect(sources).toHaveLength(2);
  expect(sources[0]).toBeTruthy();
  expect(sources[1]).toBeTruthy();
  for (const framework of ["React", "SolidJS", "Vue"]) {
    await page.getByRole("group", { name: "框架切换" }).getByRole("button", { name: framework, exact: true }).click();
    await expect(thumbnails).toHaveCount(2);
    expect(
      await thumbnails.locator("img").evaluateAll((images) => images.map((image) => image.getAttribute("src"))),
    ).toEqual(sources);
    await thumbnails.nth(1).click();
    await expect(host.locator(".semlo-editor-gallery-stage img")).toHaveAttribute("alt", "附图");
    await expect(host.locator(".semlo-editor-gallery-stage a.semlo-editor-gallery-image")).toHaveAttribute(
      "href",
      "https://example.com/second",
    );
    await thumbnails.nth(0).click();
    await expect(host.locator(".semlo-editor-gallery-stage img")).toHaveAttribute("alt", "封面");
  }
});
