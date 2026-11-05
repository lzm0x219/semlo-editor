import { readFileSync } from "node:fs";

import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { inlineMediaModules } from "../../fixtures/shared/media-inline-modules";

declare global {
  interface Window {
    cropRecoveryResult?: { x: number; y: number; width: number; height: number };
  }
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("a stage resizing during a drag restores the draft from before the drag", async ({ page }) => {
  await page.setContent('<div id="stage" style="position:relative;width:320px;height:200px"></div>');
  await page.addStyleTag({ content: readFileSync("packages/core/src/features/media/image/crop-control.css", "utf8") });
  const script = inlineMediaModules([
    "packages/core/src/features/media/shared/crop.ts",
    "packages/core/src/features/media/image/crop-control.ts",
  ]);
  await page.addScriptTag({
    type: "module",
    content: `${script}
      const stage = document.getElementById('stage')
      const control = createImageCropControl({doc:document,stage,initialRect:{x:.1,y:.1,width:.8,height:.8},onCommit:rect=>window.cropRecoveryResult=rect})
      stage.append(control.element)
    `,
  });
  const stage = page.locator("#stage");
  const selection = stage.getByRole("group", { name: "图片裁剪区域" });
  const initial = (await selection.boundingBox())!;
  await page.mouse.move(initial.x + 100, initial.y + 50);
  await page.mouse.down();
  await page.mouse.move(initial.x + 120, initial.y + 60);
  expect((await selection.boundingBox())!.x).toBeGreaterThan(initial.x);
  await stage.evaluate((element) => ((element as HTMLElement).style.width = "0px"));
  await page.mouse.move(initial.x + 125, initial.y + 60);
  await page.mouse.up();
  await stage.evaluate((element) => ((element as HTMLElement).style.width = "320px"));
  const restored = (await selection.boundingBox())!;
  expect(restored.x).toBeCloseTo(initial.x, 0);
  expect(restored.y).toBeCloseTo(initial.y, 0);
  await page.mouse.move(initial.x + 100, initial.y + 50);
  await page.mouse.down();
  await page.mouse.move(initial.x + 120, initial.y + 60);
  await stage.evaluate((element) => ((element as HTMLElement).style.width = "0px"));
  await page.mouse.up();
  await stage.evaluate((element) => ((element as HTMLElement).style.width = "320px"));
  expect((await selection.boundingBox())!.x).toBeCloseTo(initial.x, 0);
  await page.mouse.move(initial.x + 100, initial.y + 50);
  await page.mouse.down();
  await page.mouse.move(initial.x + 120, initial.y + 60);
  await stage.evaluate((element) => ((element as HTMLElement).style.width = "160px"));
  await page.mouse.move(initial.x + 125, initial.y + 60);
  await page.mouse.up();
  await stage.evaluate((element) => ((element as HTMLElement).style.width = "320px"));
  expect((await selection.boundingBox())!.x).toBeCloseTo(initial.x, 0);
  await selection.focus();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => window.__semloRequireFixture("cropRecoveryResult"))).toEqual({
    x: 0.1,
    y: 0.1,
    width: 0.8,
    height: 0.8,
  });
});
