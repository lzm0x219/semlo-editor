import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
for (const viewport of [320, 1000])
  for (const navigation of ["mouse", "keyboard"] as const) {
    test(`failed carousel navigation survives ${viewport}px viewport and ${navigation}`, async ({ page }) => {
      await page.setViewportSize({ width: viewport, height: 800 });
      let release: (() => void) | undefined;
      await page.route("**/landscape.svg", (route) =>
        route.fulfill({
          status: 200,
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="300"/>',
        }),
      );
      await page.route("**/portrait.svg", (route) =>
        route.fulfill({
          status: 200,
          contentType: "image/svg+xml",
          body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="1200"/>',
        }),
      );
      await page.route("**/delayed-broken.svg", async (route) => {
        await new Promise<void>((resolve) => (release = resolve));
        await route.fulfill({ status: 404, body: "missing" });
      });
      await installFixtureGuards(page);
      await page.goto(process.env.SEMLO_TEST_ORIGIN!);
      await page.addScriptTag({
        type: "module",
        content: `
   import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='failed-stage';document.body.prepend(host)
   createEditor({element:host,toolbar:false,outline:false,content:{type:'doc',content:[{type:'semloEditorGallery',attrs:{data:{id:'g',layout:'carousel',images:[{id:'a',src:'/landscape.svg',title:'横图',href:''},{id:'b',src:'/delayed-broken.svg',title:'加载失败图片',href:''},{id:'c',src:'/portrait.svg',title:'竖图',href:''}]}}},{type:'paragraph'}]}})
  `,
      });
      const host = page.locator("#failed-stage"),
        stage = host.locator(".semlo-editor-gallery-stage");
      await expect
        .poll(() => stage.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth))
        .toBe(1200);
      const before = (await stage.boundingBox())!.height;
      await host.getByRole("button", { name: "第 2 张图片" }).click();
      await expect.poll(() => Boolean(release)).toBe(true);
      expect((await stage.boundingBox())!.height).toBeGreaterThanOrEqual(before - 1);
      release!();
      await expect
        .poll(() =>
          stage
            .locator("img")
            .evaluate(
              (image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth === 0,
            ),
        )
        .toBe(true);
      await expect.poll(() => stage.evaluate((element) => (element as HTMLElement).style.minHeight)).toBe("");
      const dot = host.getByRole("button", { name: "第 3 张图片" });
      await expect(dot).toBeVisible();
      if (navigation === "mouse") await dot.click({ timeout: 3000 });
      else {
        await dot.focus();
        await page.keyboard.press("Enter");
      }
      await expect
        .poll(() => stage.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth))
        .toBe(300);
      await expect(stage).not.toHaveAttribute("data-image-failed", "true");
      const bounds = await stage.boundingBox();
      expect(bounds!.height).toBeGreaterThan(0);
    });
  }

test("initial failed image still permits mouse navigation to a good image", async ({ page }) => {
  await page.route("**/missing-first.svg", (route) => route.fulfill({ status: 404, body: "missing" }));
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
 import {createEditor} from '/dist/index.js';const host=document.createElement('div');host.id='failed-initial';document.body.prepend(host)
 createEditor({element:host,toolbar:false,outline:false,content:{type:'doc',content:[{type:'semloEditorGallery',attrs:{data:{id:'g',layout:'carousel',images:[{id:'a',src:'/missing-first.svg',title:'',href:''},{id:'b',src:'/tests/sample-image.svg',title:'正常图',href:''}]}}},{type:'paragraph'}]}})
 `,
  });
  const host = page.locator("#failed-initial"),
    stage = host.locator(".semlo-editor-gallery-stage");
  await expect
    .poll(() =>
      stage
        .locator("img")
        .evaluate((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth === 0),
    )
    .toBe(true);
  await host.getByRole("button", { name: "第 2 张图片" }).click({ timeout: 3000 });
  await expect.poll(() => stage.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBe(600);
});
