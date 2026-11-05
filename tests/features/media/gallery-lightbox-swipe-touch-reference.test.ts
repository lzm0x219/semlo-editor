import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

import { expect, test } from "@rstest/playwright";

const source = [
  "features/media/shared/crop.ts",
  "features/media/shared/modal-order.ts",
  "features/media/shared/transform.ts",
  "features/media/shared/lightbox.ts",
]
  .map((name) =>
    stripTypeScriptTypes(readFileSync(`packages/core/src/${name}`, "utf8")).replace(
      /^import[^\n]*from ['"][^'"]+['"];?\s*$/gm,
      "",
    ),
  )
  .join("\n");

test("a primary touch drag switches preview images and a cancelled drag does not", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setContent("<body></body>");
  await page.addStyleTag({ content: readFileSync("packages/core/src/features/media/shared/lightbox.css", "utf8") });
  await page.addScriptTag({
    type: "module",
    content: `${source}
      const src = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"/>'], {type:'image/svg+xml'}))
      openGalleryLightbox(document, [{id:'first', src, title:'第一张', href:''}, {id:'second', src, title:'第二张', href:''}], 0)`,
  });
  const viewer = page.getByRole("dialog", { name: "图册图片预览" });
  await expect(viewer.getByRole("img", { name: "第一张" })).toBeVisible();
  const stage = viewer.locator(".semlo-editor-gallery-lightbox-stage");
  const drag = (end: "pointerup" | "pointercancel") =>
    stage.evaluate((element, endType) => {
      const stage = element as HTMLElement;
      stage.setPointerCapture = () => {};
      const fire = (type: string, x: number) =>
        stage.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 1,
            isPrimary: true,
            pointerType: "touch",
            button: 0,
            clientX: x,
            clientY: 200,
          }),
        );
      fire("pointerdown", 200);
      fire("pointermove", 150);
      fire(endType, 150);
    }, end);
  await drag("pointercancel");
  await expect(viewer.getByRole("img", { name: "第一张" })).toBeVisible();
  await drag("pointerup");
  await expect(viewer.getByRole("img", { name: "第二张" })).toBeVisible();
});
