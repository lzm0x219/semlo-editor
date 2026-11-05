import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("image more menu stays open after Escape", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'image-copy-reference'
      host.style.width = '800px'
      document.body.prepend(host)
      createEditor({ element: host, outline: false, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '前文' }] }, { type: 'paragraph', content: [{ type: 'image', attrs: { src: '/tests/sample-image.svg', alt: '测试图片', width: 320, height: 139 } }] }] } })`,
  });
  const frame = page.locator("#image-copy-reference .semlo-editor-image-frame");
  await frame.locator("img").click();
  await frame.getByRole("button", { name: "图片更多操作" }).click();
  await page.keyboard.press("Escape");
  await expect(frame.getByRole("menuitem", { name: "复制图片" })).toBeVisible();
});
