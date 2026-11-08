import { expect, test } from "@rstest/playwright";

import { openFontToolbar } from "../../fixtures/browser/font-toolbar";

test("font menu ignores Escape while the editor view is composing", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'font-composition'; document.body.append(host)
      window.fontComposition = createEditor({ element: host, outline: false, content: '<p>文字</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "fontComposition")));
  const host = page.locator("#font-composition"),
    prose = host.locator(".semlo-editor-prose");
  await openFontToolbar(host);
  const menu = page.getByRole("dialog", { name: "选择字体" });
  await expect(menu).toBeVisible();
  await prose.evaluate((element) => element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
  expect(await page.evaluate(() => Reflect.get(window, "fontComposition").editor.view.composing)).toBe(true);
  const prevented = await prose.evaluate(
    (element) =>
      !element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })),
  );
  expect(prevented).toBe(false);
  await expect(menu).toBeVisible();
  await prose.evaluate((element) => element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
  await page.waitForFunction(() => !Reflect.get(window, "fontComposition").editor.view.composing);
  await prose.evaluate((element) =>
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })),
  );
  await expect(menu).toHaveCount(0);
  await page.evaluate(() => Reflect.get(window, "fontComposition").destroy());
});

test("font menu keyboard handling remains safe after the editor view unmounts", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'font-unmounted'; document.body.append(host)
      window.fontUnmounted = createEditor({ element: host, outline: false, content: '<p>文字</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "fontUnmounted")));
  await openFontToolbar(page.locator("#font-unmounted"));
  const menu = page.getByRole("dialog", { name: "选择字体" });
  await expect(menu).toBeVisible();
  await page
    .locator("#font-unmounted .semlo-editor-prose")
    .evaluate((element) => element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
  expect(await page.evaluate(() => Reflect.get(window, "fontUnmounted").editor.view.composing)).toBe(true);
  await page.evaluate(() => Reflect.get(window, "fontUnmounted").editor.unmount());
  if (await menu.count())
    await menu.evaluate((element) =>
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })),
    );
  await expect(menu).toHaveCount(0);
  expect(errors).toEqual([]);
});
