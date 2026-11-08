import { afterAll, beforeAll, expect, test } from "@rstest/playwright";

import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/media/gallery-compatibility-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/media/gallery-compatibility-fixture.ts"));
});
afterAll(async () => stop?.());

test("explicit gallery HTML edits override the corresponding projection while retaining opaque data", async ({
  page,
}) => {
  await page.goto(origin);
  await page.waitForFunction(() => !!window.galleryCompatibility);
  const data = {
    id: "gallery-original",
    layout: "carousel",
    extra: { keep: "图册元数据" },
    images: [
      { id: "first", src: "/first.png", title: "第一张\r\n原文", href: "javascript:alert(1)", extra: { keep: 1 } },
      { id: "hidden", src: "javascript:alert(2)", title: "隐藏", href: "", extra: { keep: 2 } },
      { id: "second", src: "/second.png", title: "第二张", href: "", extra: { keep: 3 } },
    ],
  };
  await page.evaluate((value) => window.galleryCompatibility!.mount(value), data);
  const before = await page.evaluate(() => window.galleryCompatibility!.editor!.getSnapshot());
  await page.evaluate((html) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const figure = doc.querySelector("figure[data-semlo-editor-gallery]")!;
    figure.setAttribute("data-gallery-id", "gallery-renamed");
    figure.setAttribute("data-layout", "grid");
    const images = figure.querySelectorAll<HTMLImageElement>("img[data-gallery-image]");
    images[1].setAttribute("data-image-id", "second-renamed");
    images[1].setAttribute("src", "/replacement.png");
    images[1].setAttribute("data-title", "修改后的标题");
    images[1].setAttribute("data-href", "javascript:alert(3)");
    window.galleryCompatibility!.editor!.setContent(figure.outerHTML);
  }, before.html);
  const after = await page.evaluate(() => window.galleryCompatibility!.editor!.getSnapshot());
  expect(after.json.content?.[0].attrs?.data).toEqual({
    ...data,
    id: "gallery-renamed",
    layout: "grid",
    images: [
      data.images[0],
      data.images[1],
      {
        ...data.images[2],
        id: "second-renamed",
        src: "/replacement.png",
        title: "修改后的标题",
        href: "javascript:alert(3)",
      },
    ],
  });
  expect(after.html).not.toContain("javascript:");
  await expect(page.locator("#gallery-compatibility .semlo-editor-gallery img")).toHaveCount(2);
  await expect(page.locator("#gallery-compatibility .semlo-editor-gallery a")).toHaveCount(0);
  expect(await page.evaluate(() => window.galleryCompatibility!.errors)).toEqual([]);
  await page.evaluate(() => window.galleryCompatibility!.editor!.destroy());
});

test("pasting a gallery with the same ID honors an edited layout and keeps opaque metadata", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => !!window.galleryCompatibility);
  await page.evaluate(() =>
    window.galleryCompatibility!.mount({ id: "same", layout: "carousel", images: [], extra: { preserve: true } }),
  );
  await page.evaluate(() => {
    const controller = window.galleryCompatibility!.editor!;
    const document = new DOMParser().parseFromString(controller.getSnapshot().html, "text/html");
    const figure = document.querySelector("figure[data-semlo-editor-gallery]")!;
    figure.setAttribute("data-layout", "grid");
    const clipboard = new DataTransfer();
    clipboard.setData("text/html", figure.outerHTML);
    controller.editor.commands.setNodeSelection(0);
    controller.editor.view.dom.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }),
    );
  });
  expect(
    (await page.evaluate(() => window.galleryCompatibility!.editor!.getSnapshot())).json.content?.[0].attrs?.data,
  ).toEqual({
    id: "same",
    layout: "grid",
    images: [],
    extra: { preserve: true },
  });
  expect(await page.evaluate(() => window.galleryCompatibility!.errors)).toEqual([]);
  await page.evaluate(() => window.galleryCompatibility!.editor!.destroy());
});
