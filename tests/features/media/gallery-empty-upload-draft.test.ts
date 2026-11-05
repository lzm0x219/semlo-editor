import { expect, test } from "@rstest/playwright";

import type { GalleryData } from "../../../packages/core/src/features/media/gallery/extension";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    galleryDraftEditor?: EditorController;
    galleryDraftResolves?: Array<(url: string) => void>;
    galleryDraftErrors?: string[];
  }
}

test("selecting images in an empty gallery stages uploads until confirmation", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'gallery-upload-draft'
      document.body.prepend(host)
      window.galleryDraftResolves = []
      window.galleryDraftEditor = createEditor({element:host,outline:false,content:{type:'doc',content:[
        {type:'semloEditorGallery',attrs:{data:{id:'draft',layout:'grid',images:[]}}},{type:'paragraph'}
      ]}, uploadImage:()=>new Promise(resolve=>window.galleryDraftResolves.push(resolve))})
    `,
  });
  const host = page.locator("#gallery-upload-draft");
  const upload = host.locator('input[aria-label="选择图册图片"]');
  const file = { name: "test.png", mimeType: "image/png", buffer: Buffer.from([1, 2, 3]) };
  const data = () =>
    page.evaluate(
      () =>
        window.__semloRequireFixture("galleryDraftEditor").getSnapshot().json.content?.[0]?.attrs?.data as GalleryData,
    );

  await upload.setInputFiles(file);
  let panel = page.getByRole("dialog", { name: "图册设置" });
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("button", { name: "确定", exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.__semloRequireFixture("galleryDraftResolves").length)).toBe(1);
  expect((await data()).images).toEqual([]);
  await panel.getByRole("button", { name: "取消", exact: true }).click();
  await page.evaluate(() =>
    window.__semloRequireFixture("galleryDraftResolves")[0]("/tests/sample-image.svg?cancelled"),
  );
  await expect(panel).toHaveCount(0);
  expect((await data()).images).toEqual([]);

  const second = { name: "second.png", mimeType: "image/png", buffer: Buffer.from([4, 5, 6]) };
  await upload.setInputFiles([file, second]);
  panel = page.getByRole("dialog", { name: "图册设置" });
  await expect.poll(() => page.evaluate(() => window.__semloRequireFixture("galleryDraftResolves").length)).toBe(3);
  await page.evaluate(() => window.__semloRequireFixture("galleryDraftResolves")[2]("/tests/sample-image.svg?second"));
  await expect(panel.getByRole("button", { name: "确定", exact: true })).toBeDisabled();
  await page.evaluate(() =>
    window.__semloRequireFixture("galleryDraftResolves")[1]("/tests/sample-image.svg?accepted"),
  );
  await expect(panel.getByRole("button", { name: "确定", exact: true })).toBeEnabled();
  await panel.getByLabel("标题（图片一）").fill("第一张");
  expect((await data()).images).toEqual([]);
  await panel.getByRole("button", { name: "确定", exact: true }).click();
  expect((await data()).images).toMatchObject([
    { src: "/tests/sample-image.svg?accepted", title: "第一张" },
    { src: "/tests/sample-image.svg?second" },
  ]);
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryDraftEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await data()).images).toEqual([]);
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryDraftEditor").editor.commands.redo())).toBe(
    true,
  );
  const saved = await page.evaluate(() => window.__semloRequireFixture("galleryDraftEditor").getSnapshot());
  for (const content of [saved.html, saved.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("galleryDraftEditor").setContent(value), content);
    expect((await data()).images).toMatchObject([
      { src: "/tests/sample-image.svg?accepted", title: "第一张" },
      { src: "/tests/sample-image.svg?second" },
    ]);
  }
  await page.evaluate(() =>
    window.__semloRequireFixture("galleryDraftEditor").setContent({
      type: "doc",
      content: [
        { type: "semloEditorGallery", attrs: { data: { id: "draft-two", layout: "grid", images: [] } } },
        { type: "paragraph" },
      ],
    }),
  );
  await upload.setInputFiles(file);
  await expect.poll(() => page.evaluate(() => window.__semloRequireFixture("galleryDraftResolves").length)).toBe(4);
  await page.evaluate(() => window.__semloRequireFixture("galleryDraftEditor").setEditable(false));
  await expect(page.getByRole("dialog", { name: "图册设置" })).toHaveCount(0);
  await page.evaluate(() =>
    window.__semloRequireFixture("galleryDraftResolves")[3]("/tests/sample-image.svg?late-readonly"),
  );
  expect((await data()).images).toEqual([]);
});

test("a failed draft upload reports its error without leaving a stale message after cancellation", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'gallery-failed-draft'
      document.body.prepend(host)
      window.galleryDraftErrors = []
      createEditor({element:host,outline:false,content:{type:'doc',content:[
        {type:'semloEditorGallery',attrs:{data:{id:'draft',layout:'grid',images:[]}}},{type:'paragraph'}
      ]},uploadImage:()=>Promise.reject(new Error('模拟上传失败')),onError:error=>window.galleryDraftErrors.push(error.message)})
    `,
  });
  const host = page.locator("#gallery-failed-draft");
  await host.locator('input[aria-label="选择图册图片"]').setInputFiles({
    name: "test.png",
    mimeType: "image/png",
    buffer: Buffer.from([1, 2, 3]),
  });
  const panel = page.getByRole("dialog", { name: "图册设置" });
  await expect(panel.getByRole("status")).toHaveText("模拟上传失败");
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryDraftErrors"))).toEqual(["模拟上传失败"]);
  await panel.getByRole("button", { name: "取消", exact: true }).click();
  await expect(host.locator(".semlo-editor-gallery-status")).toBeHidden();
  await expect(host.locator(".semlo-editor-gallery-empty")).toBeVisible();
});
