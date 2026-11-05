import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

import { expect, test } from "@rstest/playwright";

const script = [
  "packages/core/src/features/media/shared/crop.ts",
  "packages/core/src/features/media/shared/modal-order.ts",
  "packages/core/src/features/media/shared/transform.ts",
  "packages/core/src/features/media/shared/lightbox.ts",
]
  .map((path) =>
    stripTypeScriptTypes(readFileSync(path, "utf8")).replace(/^import[^\n]*from ['"][^'"]+['"];?\s*$/gm, ""),
  )
  .join("\n");

test("a second touch cannot take over or terminate the active preview pan", async ({ page }) => {
  await page.setContent("<main></main>");
  await page.addStyleTag({ content: readFileSync("packages/core/src/features/media/shared/lightbox.css", "utf8") });
  await page.addScriptTag({
    type: "module",
    content: `${script}
      const src = URL.createObjectURL(new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000"><rect width="2000" height="1000" fill="red"/></svg>'],{type:'image/svg+xml'}))
      openGalleryLightbox(document,[{id:'a',src,title:'测试图',href:''}],0)
    `,
  });
  const preview = page.getByRole("dialog", { name: "图册图片预览" });
  await expect(preview.getByRole("img")).toBeVisible();
  await preview.getByRole("button", { name: "原始大小" }).click();
  const stage = preview.locator(".semlo-editor-gallery-lightbox-stage");
  await expect(stage).toHaveClass(/can-pan/);
  const result = await stage.evaluate((element) => {
    const stage = element as HTMLElement;
    stage.setPointerCapture = () => {};
    const fire = (type: string, pointerId: number, primary: boolean, x: number) =>
      stage.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          pointerId,
          isPrimary: primary,
          pointerType: "touch",
          button: 0,
          clientX: x,
          clientY: 200,
        }),
      );
    const start = stage.scrollLeft;
    fire("pointerdown", 1, true, 200);
    fire("pointerdown", 2, false, 300);
    fire("pointerup", 2, false, 300);
    stage.dispatchEvent(
      new PointerEvent("click", { bubbles: true, pointerId: 2, isPrimary: false, pointerType: "touch" }),
    );
    const activeAfterSecond = stage.classList.contains("panning");
    const visibleAfterSecond = stage.isConnected;
    fire("pointermove", 1, true, 100);
    const afterMove = stage.scrollLeft;
    fire("pointercancel", 1, true, 100);
    const activeAfterCancel = stage.classList.contains("panning");
    stage.dispatchEvent(
      new PointerEvent("click", { bubbles: true, pointerId: 2, isPrimary: false, pointerType: "touch" }),
    );
    const visibleAfterSecondaryClick = stage.isConnected;
    fire("pointerdown", 3, true, 200);
    fire("lostpointercapture", 3, true, 200);
    return {
      start,
      activeAfterSecond,
      visibleAfterSecond,
      afterMove,
      activeAfterCancel,
      visibleAfterSecondaryClick,
      activeAfterLostCapture: stage.classList.contains("panning"),
    };
  });
  expect(result.activeAfterSecond).toBe(true);
  expect(result.visibleAfterSecond).toBe(true);
  expect(result.afterMove).toBeGreaterThan(result.start);
  expect(result.activeAfterCancel).toBe(false);
  expect(result.visibleAfterSecondaryClick).toBe(true);
  expect(result.activeAfterLostCapture).toBe(false);
});
