import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("gallery hover controls match measured geometry and keep their actions", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'gallery-action-reference'
      document.body.prepend(host)
      createEditor({ element: host, outline: false, content: { type: 'doc', content: [
        { type: 'semloEditorGallery', attrs: { data: { id: 'gallery-actions', layout: 'carousel', images: [
          { id: 'one', src: '/tests/sample-image.svg?one', title: '第一张', href: '' },
          { id: 'two', src: '/tests/sample-image.svg?two', title: '第二张', href: '' }
        ] } } }
      ] } })`,
  });
  const content = page.locator("#gallery-action-reference .semlo-editor-gallery-content");
  await expect(content).toHaveCSS("border-radius", "4px");
  const stage = page.locator("#gallery-action-reference .semlo-editor-gallery-stage");
  await expect(stage.locator("img")).toBeVisible();
  const dot = stage.getByRole("button", { name: "第 1 张图片" });
  await expect(dot).toHaveCSS("width", "12px");
  expect(await dot.evaluate((element) => getComputedStyle(element, "::before").width)).toBe("6px");
  await stage.hover();
  const actions = stage.locator(".semlo-editor-gallery-image-actions");
  const zoom = actions.getByRole("button", { name: "放大图片" });
  const remove = actions.getByRole("button", { name: "删除当前图片" });
  const bounds = (await actions.boundingBox())!;
  expect(bounds.width).toBe(57);
  expect(bounds.height).toBe(28);
  await expect(actions).toHaveCSS("background-color", "rgba(38, 38, 38, 0.6)");
  await expect(actions).toHaveCSS("border-radius", "8px");
  await expect(zoom.locator("svg")).toHaveCSS("width", "16px");
  await zoom.click();
  await expect(page.getByRole("dialog", { name: "图册图片预览" })).toBeVisible();
  await page.keyboard.press("Escape");
  await stage.hover();
  await remove.click();
  const single = page.locator("#gallery-action-reference .semlo-editor-gallery-grid .semlo-editor-gallery-image-wrap");
  await expect(single).toHaveCSS("border-radius", "4px");
  await expect(single).toHaveCSS("overflow", "hidden");
  await expect(single.locator(".semlo-editor-gallery-grid-title")).toHaveCSS("font-size", "40px");
  await expect(single.locator(".semlo-editor-gallery-grid-title")).toHaveCSS("opacity", "0.9");
  await page.setViewportSize({ width: 375, height: 667 });
  await expect(single.locator(".semlo-editor-gallery-grid-title")).toHaveCSS("font-size", "40px");
  await expect(page.locator("#gallery-action-reference .semlo-editor-gallery-grid img")).toHaveAttribute(
    "src",
    "/tests/sample-image.svg?two",
  );
});
