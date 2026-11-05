import { expect, test } from "@rstest/playwright";

import type { GalleryData } from "../../../packages/core/src/features/media/gallery/extension";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    galleryTouchEditor?: EditorController;
  }
}

test("touch ordering is undoable and survives JSON and HTML round trips", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'gallery-touch-integration'
      document.body.prepend(host)
      window.galleryTouchEditor = createEditor({element: host, outline: false, content: {
        type: 'doc', content: [{type:'semloEditorGallery', attrs:{data:{id:'gallery',layout:'grid',images:[
          {id:'a',src:'/tests/sample-image.svg?a',title:'甲',href:''},
          {id:'b',src:'/tests/sample-image.svg?b',title:'乙',href:''},
          {id:'c',src:'/tests/sample-image.svg?c',title:'丙',href:''}
        ]}}}, {type:'paragraph'}]
      }})
    `,
  });
  const host = page.locator("#gallery-touch-integration");
  await host.locator(".semlo-editor-gallery-surface").click({ position: { x: 5, y: 5 } });
  await host.getByRole("button", { name: "编辑图册" }).click();
  const panel = page.getByRole("dialog", { name: "图册设置" });
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  const firstImage = panel.getByRole("button", { name: "图片一", exact: true });
  const firstBox = (await firstImage.boundingBox())!;
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: firstBox.x + 30, y: firstBox.y + 30, id: 0 }],
  });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(firstImage).toBeFocused();
  const from = (await panel.getByRole("button", { name: "拖动图片一" }).boundingBox())!;
  const to = (await panel.getByRole("button", { name: "图片三", exact: true }).boundingBox())!;
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x: from.x + 10, y: from.y + 10, id: 0 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: to.x + to.width / 2, y: to.y + to.height / 2, id: 0 }],
  });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await panel.getByRole("button", { name: "确定", exact: true }).click();
  const snapshot = () => page.evaluate(() => window.__semloRequireFixture("galleryTouchEditor").getSnapshot());
  const order = async () => {
    const data = (await snapshot()).json.content?.[0]?.attrs?.data as GalleryData | undefined;
    return data?.images.map((image) => image.id);
  };
  expect(await order()).toEqual(["b", "c", "a"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryTouchEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await order()).toEqual(["a", "b", "c"]);
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryTouchEditor").editor.commands.redo())).toBe(
    true,
  );
  const saved = await snapshot();
  expect(await order()).toEqual(["b", "c", "a"]);
  for (const content of [saved.html, saved.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("galleryTouchEditor").setContent(value), content);
    expect(await order()).toEqual(["b", "c", "a"]);
  }
  await session.detach();
});
