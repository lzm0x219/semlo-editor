import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

import { expect, test } from "@rstest/playwright";

import { inlineMediaModules } from "../../fixtures/shared/media-inline-modules";

const uploads = stripTypeScriptTypes(readFileSync("packages/core/src/features/media/gallery/uploads.ts", "utf8"));
const dialog = inlineMediaModules([
  "packages/core/src/features/media/shared/modal-order.ts",
  "packages/core/src/features/media/gallery/dialog.ts",
]);

test("gallery settings keep upload fixed while the image list scrolls and deletion remains usable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 500 });
  await page.setContent("<body></body>");
  await page.addStyleTag({ content: readFileSync("packages/core/src/features/media/gallery/dialog.css", "utf8") });
  await page.addScriptTag({
    type: "module",
    content: `${uploads}\n${dialog}
      openGalleryDialog(document, {id:'gallery',layout:'grid',images:Array.from({length:8},(_,i)=>({id:String(i),src:'/image.png',title:'图'+i,href:''}))}, {
        getUploadImage:()=>undefined, onCommit:()=>{}
      })`,
  });
  const panel = page.getByRole("dialog", { name: "图册设置" });
  const upload = panel.getByRole("button", { name: "上传图片" });
  const list = panel.locator(".semlo-editor-gallery-image-list");
  const tiles = list.locator(".semlo-editor-gallery-thumbnail");
  await expect(tiles).toHaveCount(8);
  await expect(list).toHaveCSS("flex-wrap", "nowrap");
  await expect(list).toHaveCSS("overflow-x", "auto");
  await expect.poll(() => list.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  const second = tiles.nth(1);
  const secondRemove = second.getByRole("button", { name: "删除图片二" });
  await expect(secondRemove).toHaveCSS("opacity", "0");
  await second.hover();
  await expect(secondRemove).toHaveCSS("opacity", "1");
  await secondRemove.click();
  await expect(panel.getByRole("alertdialog", { name: "删除图片确认" })).toBeVisible();
  await expect(tiles.nth(0).getByRole("button", { name: "图片一", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await panel.getByRole("alertdialog", { name: "删除图片确认" }).getByRole("button", { name: "取消" }).click();
  const uploadX = (await upload.boundingBox())!.x;
  await list.evaluate((element) => (element.scrollLeft = 250));
  expect((await upload.boundingBox())!.x).toBe(uploadX);
  await tiles.nth(4).getByRole("button", { name: "图片五", exact: true }).click();
  await expect(tiles.nth(4).getByRole("button", { name: "图片五", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(await list.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await panel.getByRole("button", { name: "删除图片五" }).click();
  const confirmation = panel.getByRole("alertdialog", { name: "删除图片确认" });
  await expect(confirmation).toBeVisible();
  const box = (await confirmation.boundingBox())!;
  const panelBox = (await panel.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(panelBox.x);
  expect(box.x + box.width).toBeLessThanOrEqual(panelBox.x + panelBox.width);
  await confirmation.getByRole("button", { name: "取消" }).click();
  await expect(confirmation).toHaveCount(0);
});

test("an unselected image can be reordered by dragging its thumbnail", async ({ page }) => {
  await page.setContent("<body></body>");
  await page.addStyleTag({ content: readFileSync("packages/core/src/features/media/gallery/dialog.css", "utf8") });
  await page.addScriptTag({
    type: "module",
    content: `${uploads}\n${dialog}
      openGalleryDialog(document, {id:'gallery',layout:'grid',images:Array.from({length:3},(_,i)=>({id:String(i),src:'/image.png',title:'图'+i,href:''}))}, {
        getUploadImage:()=>undefined, onCommit:()=>{}
      })`,
  });
  const panel = page.getByRole("dialog", { name: "图册设置" });
  const tiles = panel.locator(".semlo-editor-gallery-thumbnail");
  const from = (await tiles.nth(1).boundingBox())!;
  const to = (await tiles.nth(2).boundingBox())!;
  await page.mouse.move(from.x + 36, from.y + 50);
  await page.mouse.down();
  await page.mouse.move(from.x + 46, from.y + 50, { steps: 3 });
  await expect(tiles.nth(1)).toHaveCSS("opacity", "0.3");
  await page.mouse.move(to.x + 36, to.y + 50, { steps: 5 });
  await page.mouse.up();
  expect(
    await tiles.evaluateAll((elements) => elements.map((element) => element.getAttribute("data-gallery-image-id"))),
  ).toEqual(["0", "2", "1"]);
  await expect(tiles.nth(0).getByRole("button", { name: "图片一", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("layout choices use the reference size and selection border", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.setContent("<body></body>");
  await page.addStyleTag({ content: readFileSync("packages/core/src/features/media/gallery/dialog.css", "utf8") });
  await page.addScriptTag({
    type: "module",
    content: `${uploads}\n${dialog}
      openGalleryDialog(document, {id:'gallery',layout:'grid',images:[]}, {
        getUploadImage:()=>undefined, onCommit:()=>{}
      })`,
  });
  const choices = page.locator(".semlo-editor-gallery-layout");
  await expect(page.getByRole("dialog", { name: "图册设置" })).toHaveCSS("width", "535px");
  const close = page.getByRole("button", { name: "关闭图册设置" });
  await expect(close).toHaveCSS("width", "56px");
  await expect(close).toHaveCSS("height", "56px");
  await expect(close).toHaveCSS("color", "rgb(138, 143, 141)");
  await expect(page.locator(".semlo-editor-gallery-dialog-header")).toHaveCSS("height", "54px");
  await expect(page.locator(".semlo-editor-gallery-dialog-header h2")).toHaveCSS("font-weight", "500");
  await expect(choices).toHaveCount(3);
  for (const choice of await choices.all()) {
    const box = (await choice.boundingBox())!;
    expect(box.width).toBe(159);
    expect(box.height).toBe(94);
    await expect(choice).toHaveCSS("border-radius", "10px");
  }
  await expect(choices.first()).toHaveCSS("border-top-color", "rgba(0, 0, 0, 0)");
  await expect(choices.last()).toHaveCSS("border-top-color", "rgb(0, 185, 107)");
  const headings = page.locator(".semlo-editor-gallery-dialog-label");
  await expect(headings.first()).toHaveCSS("line-height", "24px");
  await expect(headings.first()).toHaveCSS("margin-bottom", "16px");
  await expect(headings.first()).toHaveCSS("color", "rgb(38, 38, 38)");
  await expect(headings.last()).toHaveCSS("margin-top", "40px");
  await expect(headings.last()).toHaveCSS("margin-bottom", "0px");
  await expect(page.locator(".semlo-editor-gallery-image-row")).toHaveCSS("padding-bottom", "12px");
  await expect(page.locator(".semlo-editor-gallery-image-row")).toHaveCSS("height", "125px");
  const field = page.locator(".semlo-editor-gallery-field").first();
  await expect(field).toHaveCSS("margin-top", "24px");
  await expect(field.locator("span")).toHaveCSS("margin-bottom", "16px");
  await expect(field.locator("span")).toHaveCSS("color", "rgb(88, 90, 90)");
  await expect(field.locator("input")).toHaveCSS("border-radius", "6px");
  await expect(field.locator("input")).toHaveCSS("line-height", "22px");
  await expect(field.locator("input")).toHaveCSS("background-color", "rgb(244, 245, 245)");
  await expect(page.locator(".semlo-editor-gallery-dialog-body")).toHaveCSS("padding", "24px");
  await expect(page.locator(".semlo-editor-gallery-dialog-footer")).toHaveCSS("padding", "16px");
  await expect(page.getByLabel("选择图片文件")).toHaveAttribute(
    "accept",
    ".svg,.png,.bmp,.jpg,.jpeg,.gif,.tif,.tiff,.emf,.webp,.heic",
  );
});
