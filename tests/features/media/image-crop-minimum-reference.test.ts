import { readFileSync } from "node:fs";

import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { inlineMediaModules } from "../../fixtures/shared/media-inline-modules";

declare global {
  interface Window {
    cropResult?: { x: number; y: number; width: number; height: number };
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

test("crop corner stops at the observed 28 pixel minimum and commits on Enter", async ({ page }) => {
  await page.setContent('<div id="stage" style="position:relative;width:320px;height:200px"></div>');
  await page.addStyleTag({ content: styles });
  await page.addScriptTag({
    type: "module",
    content: `${script}
      const stage = document.getElementById('stage')
      const control = createImageCropControl({ doc:document, stage, onCommit:rect => window.cropResult = rect })
      stage.append(control.element)
    `,
  });
  const stage = page.locator("#stage");
  const bounds = (await stage.boundingBox())!;
  await page.mouse.move(bounds.x + 319, bounds.y + 199);
  await page.mouse.down();
  await page.mouse.move(bounds.x, bounds.y, { steps: 5 });
  await page.mouse.up();
  const selection = page.getByRole("group", { name: "图片裁剪区域" });
  const crop = (await selection.boundingBox())!;
  expect(crop.width).toBeCloseTo(28, 0);
  expect(crop.height).toBeCloseTo(28, 0);
  await selection.focus();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => window.__semloRequireFixture("cropResult"))).toEqual({
    x: 0,
    y: 0,
    width: 0.0875,
    height: 0.14,
  });
});
