import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

import { expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { inlineMediaModules } from "../../fixtures/shared/media-inline-modules";

declare global {
  interface Window {
    galleryTouchCommits?: { images: { id: string }[] }[];
  }
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

const uploads = stripTypeScriptTypes(readFileSync("packages/core/src/features/media/gallery/uploads.ts", "utf8"));
const dialog = inlineMediaModules([
  "packages/core/src/features/media/shared/modal-order.ts",
  "packages/core/src/features/media/gallery/dialog.ts",
]);
const styles = readFileSync("packages/core/src/features/media/gallery/dialog.css", "utf8");

async function mount(page: Page) {
  await page.setContent('<button id="opener">打开</button>');
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({
    type: "module",
    content: `${uploads}\n${dialog}
      window.galleryTouchCommits = []
      openGalleryDialog(document, { id: 'gallery', layout: 'carousel', images: [
        {id:'a',src:'/a',title:'甲',href:''},
        {id:'b',src:'/b',title:'乙',href:''},
        {id:'c',src:'/c',title:'丙',href:''},
      ]}, {getUploadImage: () => undefined, onCommit: data => window.galleryTouchCommits.push(data)})
    `,
  });
  return page.getByRole("dialog", { name: "图册设置" });
}

test("touch reorders the selected image and confirmation commits its title and order", async ({ page }) => {
  const panel = await mount(page);
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
  const handle = panel.getByRole("button", { name: "拖动图片一" });
  const target = panel.getByRole("button", { name: "图片三", exact: true });
  const from = (await handle.boundingBox())!;
  const to = (await target.boundingBox())!;
  const point = (x: number, y: number) => [{ x, y, id: 0 }];
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(from.x + 10, from.y + 10) });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: point(to.x + to.width / 2, to.y + to.height / 2),
  });
  await expect(panel.locator('[data-gallery-image-id="c"]')).toHaveClass(/is-touch-drop-target/);
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await expect(panel.getByRole("button", { name: "图片三", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(panel.getByLabel("标题（图片三）")).toHaveValue("甲");
  await panel.getByRole("button", { name: "确定", exact: true }).click();
  const commits = await page.evaluate(() => window.__semloRequireFixture("galleryTouchCommits"));
  expect(commits[0].images.map((image) => image.id)).toEqual(["b", "c", "a"]);
  await session.detach();
});

test("cancelling a touch gesture and cancelling the dialog do not change the gallery", async ({ page }) => {
  const panel = await mount(page);
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
  await expect(panel.locator('[data-gallery-image-id="c"]')).toHaveClass(/is-touch-drop-target/);
  await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  await expect(panel.locator(".is-touch-drop-target")).toHaveCount(0);
  await expect(panel.getByLabel("标题（图片一）")).toHaveValue("甲");
  await panel.getByRole("button", { name: "取消", exact: true }).click();
  expect(await page.evaluate(() => window.__semloRequireFixture("galleryTouchCommits"))).toEqual([]);
  await session.detach();
});

test("releasing outside thumbnails does not reorder using a stale hover target", async ({ page }) => {
  const panel = await mount(page);
  await panel.getByRole("button", { name: "图片一", exact: true }).focus();
  await panel.getByRole("button", { name: "拖动图片一" }).evaluate((element) => {
    const third = document.querySelector<HTMLElement>('[data-gallery-image-id="c"]')!.getBoundingClientRect();
    const start = element.getBoundingClientRect();
    const event = (type: string, x: number, y: number) =>
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerType: "touch",
        pointerId: 1,
        isPrimary: true,
        button: 0,
        clientX: x,
        clientY: y,
      });
    element.dispatchEvent(event("pointerdown", start.x + 10, start.y + 10));
    document.dispatchEvent(event("pointermove", third.x + third.width / 2, third.y + third.height / 2));
    document.dispatchEvent(event("pointerup", 0, 0));
  });
  await expect(panel.getByLabel("标题（图片一）")).toHaveValue("甲");
  await panel.getByRole("button", { name: "确定", exact: true }).click();
  const commits = await page.evaluate(() => window.__semloRequireFixture("galleryTouchCommits"));
  expect(commits[0].images.map((image) => image.id)).toEqual(["a", "b", "c"]);
});
