import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";

import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    pageKeys?: string[];
  }
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

const script = [
  "packages/core/src/features/media/shared/crop.ts",
  "packages/core/src/features/media/shared/modal-order.ts",
  "packages/core/src/features/media/shared/transform.ts",
  "packages/core/src/features/media/shared/lightbox.ts",
]
  .map((path) =>
    stripTypeScriptTypes(readFileSync(path, "utf8")).replace(/^import[^\n]*from ['"][^'"]+['"];?\s*$/gm, ""),
  )
  .join("\n");

test("preview arrow keys switch images without reaching the underlying page", async ({ page }) => {
  await page.setContent('<button id="opener">打开</button>');
  await page.addScriptTag({
    type: "module",
    content: `${script}
      window.pageKeys = []
      document.body.addEventListener('keydown', event => window.pageKeys.push(event.key))
      document.querySelector('#opener').focus()
      openGalleryLightbox(document, [
        { id: 'a', src: '/a', title: '第一张', href: '' },
        { id: 'b', src: '/b', title: '第二张', href: '' },
      ], 0)
    `,
  });
  const viewer = page.getByRole("dialog", { name: "图册图片预览" });
  await expect(viewer).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(viewer.getByRole("toolbar")).toContainText("2 / 2");
  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByRole("toolbar")).toContainText("1 / 2");
  expect(await page.evaluate(() => window.__semloRequireFixture("pageKeys"))).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(page.locator("#opener")).toBeFocused();
  await page.keyboard.press("ArrowRight");
  expect(await page.evaluate(() => window.__semloRequireFixture("pageKeys"))).toEqual(["ArrowRight"]);
});
