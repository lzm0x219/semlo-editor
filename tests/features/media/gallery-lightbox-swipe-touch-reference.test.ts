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
  const first = viewer.getByRole("img", { name: "第一张" });
  await expect(first).toBeVisible();
  const client = await page.context().newCDPSession(page);
  await client.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
  await page.evaluate(() => {
    const trace: unknown[] = [];
    for (const type of ["pointerdown", "pointerup", "pointercancel", "lostpointercapture", "click", "touchend"]) {
      document.addEventListener(
        type,
        (event) => {
          const pointer = event as PointerEvent;
          const target = event.target as HTMLElement;
          trace.push([
            type,
            pointer.pointerId,
            pointer.isPrimary,
            pointer.pointerType,
            pointer.clientX,
            pointer.clientY,
            target.className,
          ]);
          document.body.dataset.previewTestTrace = JSON.stringify(trace);
        },
        true,
      );
    }
  });
  try {
    const bounds = (await first.boundingBox())!;
    const x = Math.round(bounds.x + bounds.width / 2);
    const y = Math.round(bounds.y + bounds.height / 2);
    const start = () => client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 0 }] });
    const drag = async (end: "touchEnd" | "touchCancel") => {
      await start();
      await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x - 70, y, id: 0 }] });
      await client.send("Input.dispatchTouchEvent", { type: end, touchPoints: [] });
    };
    await drag("touchCancel");
    await expect(first).toBeVisible();
    await drag("touchEnd");
    const second = viewer.getByRole("img", { name: "第二张" });
    await expect.poll(async () => (await second.boundingBox())?.x).toBeCloseTo(bounds.x, 0);
    await start();
    await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    try {
      await expect(viewer).toHaveCount(0);
    } catch (error) {
      throw new Error(`[DEBUG-29-TOUCH] ${await page.locator("body").getAttribute("data-preview-test-trace")}`, {
        cause: error,
      });
    }
  } finally {
    await client.detach();
  }
});
