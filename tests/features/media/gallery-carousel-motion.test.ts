import { expect, test, type Page } from "@rstest/playwright";

async function mount(page: Page, slowSecond = false) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'gallery-motion'
      document.body.prepend(host)
      createEditor({element:host,outline:false,content:{type:'doc',content:[
        {type:'semloEditorGallery',attrs:{data:{id:'motion',layout:'carousel',images:[
          {id:'a',src:'/tests/sample-image.svg?a',title:'甲',href:''},
          {id:'b',src:'${slowSecond ? "/slow-gallery-image.svg" : "/tests/sample-image.svg?b"}',title:'乙',href:''},
          {id:'c',src:'/tests/sample-image.svg?c',title:'丙',href:''}
        ]}}}, {type:'paragraph'}]}})
    `,
  });
  const host = page.locator("#gallery-motion");
  await expect(host.locator(".semlo-editor-gallery-stage img")).toHaveCount(1);
  return host;
}

test("pointer navigation slides, retargets on repeated selection and removes the old slide", async ({ page }) => {
  const host = await mount(page);
  await host.getByRole("button", { name: "第 2 张图片" }).click();
  const outgoing = host.locator(".semlo-editor-gallery-slide-out");
  await expect(outgoing).toHaveCount(1);
  await expect(outgoing).toHaveAttribute("aria-hidden", "true");
  expect(await outgoing.evaluate((element) => element.getAnimations()[0].effect?.getTiming().duration)).toBe(700);
  await host.getByRole("button", { name: "第 3 张图片" }).click();
  await expect(host.locator(".semlo-editor-gallery-stage img")).toHaveAttribute("src", "/tests/sample-image.svg?c");
  await expect(outgoing).toHaveCount(1);
  await expect(outgoing).toHaveCount(0, { timeout: 3000 });
});

test("reduced motion and keyboard selection switch without sliding", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const host = await mount(page);
  await host.getByRole("button", { name: "第 2 张图片" }).click();
  await expect(host.locator(".semlo-editor-gallery-slide-out")).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await host.getByRole("button", { name: "第 3 张图片" }).focus();
  await page.keyboard.press("Enter");
  await expect(host.locator(".semlo-editor-gallery-slide-out")).toHaveCount(0);
  await expect(host.locator(".semlo-editor-gallery-stage img")).toHaveAttribute("src", "/tests/sample-image.svg?c");
  await expect(host.getByRole("button", { name: "第 3 张图片" })).toBeFocused();
  await host.locator(".semlo-editor-gallery-surface").click({ position: { x: 5, y: 5 } });
  await host.getByRole("button", { name: "切换版式" }).click();
  const firstThumbnail = host.getByRole("button", { name: "查看第 1 张图片" });
  await firstThumbnail.focus();
  await page.keyboard.press("Enter");
  await expect(host.getByRole("button", { name: "查看第 1 张图片" })).toBeFocused();
});

test("enabling reduced motion during a slide immediately removes transitional content", async ({ page }) => {
  const host = await mount(page);
  await host.getByRole("button", { name: "第 2 张图片" }).click();
  await expect(host.locator(".semlo-editor-gallery-slide-out")).toHaveCount(1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(host.locator(".semlo-editor-gallery-slide-out")).toHaveCount(0);
  await expect(host.locator(".semlo-editor-gallery-stage img")).toHaveAttribute("src", "/tests/sample-image.svg?b");
  expect(
    await host
      .locator(".semlo-editor-gallery-stage .semlo-editor-gallery-image-wrap")
      .evaluate((element) => element.getAnimations().length),
  ).toBe(0);
});

for (const keyboard of [false, true]) {
  test(`a slow incoming image does not collapse the gallery (keyboard: ${keyboard})`, async ({ page }) => {
    let release: (() => void) | undefined;
    await page.route("**/slow-gallery-image.svg", async (route) => {
      await new Promise<void>((resolve) => (release = resolve));
      await route.fulfill({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="260"/>',
      });
    });
    const host = await mount(page, true);
    const stage = host.locator(".semlo-editor-gallery-stage");
    await expect
      .poll(() => stage.locator("img").evaluate((element) => (element as HTMLImageElement).naturalWidth))
      .toBe(600);
    const before = (await stage.boundingBox())!.height;
    const next = host.getByRole("button", { name: "第 2 张图片" });
    if (keyboard) {
      await next.focus();
      await page.keyboard.press("Enter");
    } else await next.click();
    await expect.poll(() => Boolean(release)).toBe(true);
    expect((await stage.boundingBox())!.height).toBeGreaterThanOrEqual(before - 1);
    expect(await stage.evaluate((element) => (element as HTMLElement).style.minHeight)).not.toBe("");
    release?.();
    await expect.poll(() => stage.evaluate((element) => (element as HTMLElement).style.minHeight)).toBe("");
  });
}
