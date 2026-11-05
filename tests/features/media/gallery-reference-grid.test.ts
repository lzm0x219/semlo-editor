import { expect, test } from "@rstest/playwright";

import type { GalleryData } from "../../../packages/core/src/features/media/gallery/extension";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    referenceGridEditor?: EditorController;
  }
}

test("new galleries default to grid and switch to carousel", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'gallery-reference-grid'
      document.body.prepend(host)
      window.referenceGridEditor = createEditor({element:host,outline:false,content:'<p>正文</p>'})
    `,
  });
  const host = page.locator("#gallery-reference-grid");
  await host.locator(".semlo-editor-prose p").click();
  await host.getByRole("button", { name: "插入内容" }).click();
  await page.getByRole("dialog", { name: "插入内容" }).getByLabel("搜索插入内容").fill("图册");
  await page.locator('[data-command="gallery"]').click();
  const data = () =>
    page.evaluate(
      () =>
        window
          .__semloRequireFixture("referenceGridEditor")
          .getSnapshot()
          .json.content?.find((node) => node.type === "semloEditorGallery")?.attrs?.data as GalleryData,
    );
  expect((await data()).layout).toBe("grid");
  await host.locator(".semlo-editor-gallery-surface").click({ position: { x: 5, y: 5 } });
  await host.getByRole("button", { name: "切换版式" }).click();
  expect((await data()).layout).toBe("carousel");
  expect(await page.evaluate(() => window.__semloRequireFixture("referenceGridEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await data()).layout).toBe("grid");
});

test("grid captions appear only when their image is hovered and survive serialization", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'gallery-reference-grid'
      document.body.prepend(host)
      window.referenceGridEditor = createEditor({element:host,outline:false,content:{type:'doc',content:[
        {type:'semloEditorGallery',attrs:{data:{id:'grid',layout:'grid',images:[
          {id:'a',src:'/tests/sample-image.svg?a',title:'第一张',href:''},
          {id:'b',src:'/tests/sample-image.svg?b',title:'',href:''}
        ]}}}, {type:'paragraph'}]}})
    `,
  });
  const host = page.locator("#gallery-reference-grid");
  const titles = host.locator(".semlo-editor-gallery-grid-title");
  await expect(titles).toHaveCount(1);
  await page.mouse.move(0, 0);
  await expect(titles).toBeHidden();
  await host.locator(".semlo-editor-gallery-grid .semlo-editor-gallery-image-wrap").first().hover();
  await expect(titles).toBeVisible();
  await expect(titles).toHaveText("第一张");
  await expect(titles).toHaveCSS("font-size", "16px");
  const saved = await page.evaluate(() => window.__semloRequireFixture("referenceGridEditor").getSnapshot());
  for (const content of [saved.html, saved.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("referenceGridEditor").setContent(value), content);
    await host.locator(".semlo-editor-gallery-grid .semlo-editor-gallery-image-wrap").first().hover();
    await expect(titles).toHaveText("第一张");
    await expect(titles).toBeVisible();
  }
});

test("one to five equal-ratio images use the observed grid columns", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'gallery-reference-grid'
      host.style.width = '800px'
      document.body.prepend(host)
      window.referenceGridEditor = createEditor({element:host,outline:false,content:'<p></p>'})
    `,
  });
  await page.waitForFunction(() => Boolean(window.referenceGridEditor));
  const grid = page.locator("#gallery-reference-grid .semlo-editor-gallery-grid");
  for (const count of [1, 2, 3, 4, 5]) {
    await page.evaluate((size) => {
      window.__semloRequireFixture("referenceGridEditor").setContent({
        type: "doc",
        content: [
          {
            type: "semloEditorGallery",
            attrs: {
              data: {
                id: "grid",
                layout: "grid",
                images: Array.from({ length: size }, (_, index) => ({
                  id: `image-${index}`,
                  src: `/tests/sample-image.svg?${index}`,
                  title: index === 0 ? "第一张测试图的长标题用于检查文字是否换行省略以及显示范围" : "",
                  href: "",
                })),
              },
            },
          },
          { type: "paragraph" },
        ],
      });
    }, count);
    await expect(grid).toHaveAttribute("data-columns", String(Math.min(count, 3)));
    await expect
      .poll(() =>
        grid
          .locator("img")
          .evaluateAll((items) => items.every((image) => (image as HTMLImageElement).naturalWidth > 0)),
      )
      .toBe(true);
    if (count === 1) {
      await page.mouse.move(0, 0);
      const title = grid.locator(".semlo-editor-gallery-grid-title");
      await expect(title).toBeVisible();
      expect(await title.evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThan(24);
    }
    const positions = await grid.locator(".semlo-editor-gallery-image-wrap").evaluateAll((items) =>
      items.map((item) => {
        const box = item.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width };
      }),
    );
    expect(positions).toHaveLength(count);
    if (count >= 3) {
      expect(positions[0].y).toBeCloseTo(positions[2].y, 0);
      expect(positions[2].x).toBeGreaterThan(positions[1].x);
      await grid.locator(".semlo-editor-gallery-image-wrap").first().hover();
      const title = grid.locator(".semlo-editor-gallery-grid-title");
      await expect(title).toHaveCSS("font-size", "14px");
      const height = (await title.boundingBox())!.height;
      expect(height).toBeGreaterThan(35);
    }
    if (count >= 4) {
      expect(positions[3].y).toBeGreaterThan(positions[0].y);
      expect(positions[3].x).toBeCloseTo(positions[0].x, 0);
    }
    if (count === 5) {
      expect(positions[4].x).toBeCloseTo(positions[1].x, 0);
    }
    const bounds = (await grid.boundingBox())!;
    expect(positions[0].width).toBeCloseTo((bounds.width - 10 * (Math.min(count, 3) - 1)) / Math.min(count, 3), 0);
  }
});

test("a one-image gallery uses the same single-image presentation in all three layouts", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'gallery-single-layout'
      document.body.prepend(host)
      window.referenceGridEditor = createEditor({element:host,outline:false,content:{type:'doc',content:[
        {type:'semloEditorGallery',attrs:{data:{id:'single',layout:'grid',images:[
          {id:'a',src:'/tests/sample-image.svg',title:'单图标题',href:''}
        ]}}},{type:'paragraph'}]}})
    `,
  });
  const host = page.locator("#gallery-single-layout");
  await host.locator(".semlo-editor-gallery-surface").click({ position: { x: 5, y: 5 } });
  const snapshots: ReturnType<EditorController["getSnapshot"]>[] = [];
  for (const layout of ["carousel", "thumbnail", "grid"]) {
    await host.getByRole("button", { name: "切换版式" }).click();
    const snapshot = await page.evaluate(() => window.__semloRequireFixture("referenceGridEditor").getSnapshot());
    const data = snapshot.json.content?.[0]?.attrs?.data as GalleryData | undefined;
    expect(data?.layout).toBe(layout);
    snapshots.push(snapshot);
    await expect(host.locator('.semlo-editor-gallery-grid[data-columns="1"]')).toHaveCount(1);
    await expect(host.locator(".semlo-editor-gallery-grid-title")).toHaveText("单图标题");
    await expect(host.locator(".semlo-editor-gallery-grid-title")).toBeVisible();
    await expect(host.locator(".semlo-editor-gallery-dots, .semlo-editor-gallery-thumbnails")).toHaveCount(0);
  }
  for (const snapshot of snapshots) {
    for (const content of [snapshot.html, snapshot.json]) {
      await page.evaluate((value) => window.__semloRequireFixture("referenceGridEditor").setContent(value), content);
      const restored = await page.evaluate(() => window.__semloRequireFixture("referenceGridEditor").getSnapshot());
      expect(restored.json.content?.[0]?.attrs?.data).toEqual(snapshot.json.content?.[0]?.attrs?.data);
      await expect(host.locator('.semlo-editor-gallery-grid[data-columns="1"]')).toHaveCount(1);
      await expect(host.locator(".semlo-editor-gallery-dots, .semlo-editor-gallery-thumbnails")).toHaveCount(0);
    }
  }
});
