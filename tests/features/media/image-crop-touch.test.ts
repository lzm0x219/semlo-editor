import { readFileSync } from "node:fs";

import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { inlineMediaModules } from "../../fixtures/shared/media-inline-modules";

declare global {
  interface Window {
    touchCropResult?: { width: number; height: number };
  }
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

const script = inlineMediaModules([
  "packages/core/src/features/media/shared/crop.ts",
  "packages/core/src/features/media/image/crop-control.ts",
]);
const styles = readFileSync("packages/core/src/features/media/image/crop-control.css", "utf8");

test("touch crop commits after release and restores its draft on gesture cancellation", async ({ page }) => {
  await page.setContent('<div id="stage" style="position:relative;width:320px;height:200px"></div>');
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({
    type: "module",
    content: `${script}
      const stage = document.getElementById('stage')
      const control = createImageCropControl({doc:document,stage,onCommit:rect => window.touchCropResult=rect})
      stage.append(control.element)
    `,
  });
  const stage = page.locator("#stage");
  const selection = stage.getByRole("group", { name: "图片裁剪区域" });
  const bounds = (await stage.boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const touch = (x: number, y: number) => [{ x, y, id: 0 }];
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: touch(bounds.x + 318, bounds.y + 198),
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: touch(bounds.x + 160, bounds.y + 100),
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  const first = (await selection.boundingBox())!;
  expect(first.width).toBeCloseTo(162, 0);
  expect(first.height).toBeCloseTo(102, 0);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: touch(bounds.x + 161, bounds.y + 101),
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: touch(bounds.x + 80, bounds.y + 50),
  });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  const restored = (await selection.boundingBox())!;
  expect(restored.width).toBeCloseTo(first.width, 0);
  expect(restored.height).toBeCloseTo(first.height, 0);
  await selection.focus();
  await page.keyboard.press("Enter");
  const result = await page.evaluate(() => window.__semloRequireFixture("touchCropResult"));
  expect(result.width).toBeCloseTo(162 / 320, 5);
  expect(result.height).toBeCloseTo(102 / 200, 5);
  await cdp.detach();
});
