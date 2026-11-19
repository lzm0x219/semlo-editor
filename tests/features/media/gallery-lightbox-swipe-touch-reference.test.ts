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

test("touch swipes and taps work without a synthesized click", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setContent(
    '<button style="position:fixed;inset:0" onclick="this.dataset.clicked=\'true\'">预览下方的按钮</button>',
  );
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
    const tap = async () => {
      await start();
      await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    await viewer.getByRole("button", { name: "放大" }).click();
    await expect.poll(async () => (await second.boundingBox())?.width).toBeGreaterThan(bounds.width);
    await tap();
    await expect.poll(async () => (await second.boundingBox())?.width).toBe(bounds.width);

    // Linux Chromium 可能只发出触屏手势事件，在其他平台拦截兼容 click 以复现同一路径。
    await page.evaluate(() => {
      document.addEventListener(
        "click",
        (event) => {
          if ((event.target as Element).closest(".semlo-editor-gallery-lightbox")) event.stopImmediatePropagation();
        },
        true,
      );
    });
    await tap();
    await expect(viewer).toHaveCount(0);
    expect(await page.getByRole("button", { name: "预览下方的按钮" }).getAttribute("data-clicked")).toBeNull();
  } finally {
    await client.detach();
  }
});
