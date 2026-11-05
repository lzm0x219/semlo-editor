import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    imageLinkReferenceEditor?: EditorController;
  }
}

test("unfinished image link text survives editing and round trips without becoming a link", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'image-link-reference'
      host.style.width = '800px'
      document.body.prepend(host)
      window.imageLinkReferenceEditor = createEditor({ element: host, outline: false, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '前文' }] }, { type: 'paragraph', content: [{ type: 'image', attrs: { src: '/tests/sample-image.svg', width: 320, height: 139 } }] }] } })`,
  });
  const host = page.locator("#image-link-reference");
  const frame = host.locator(".semlo-editor-image-frame");
  await frame.locator("img").click();
  await frame.getByRole("button", { name: "图片链接", exact: true }).click();
  const panel = frame.getByRole("dialog", { name: "图片链接" });
  const input = panel.getByRole("textbox", { name: "图片链接地址" });
  await input.fill("not a url");
  await input.press("Escape");
  await expect(panel).toBeVisible();
  await expect(input).toHaveValue("not a url");
  await input.press("Enter");
  await frame.getByRole("button", { name: "图片链接", exact: true }).click();
  await frame.getByRole("button", { name: "图片链接", exact: true }).click();
  await expect(input).toHaveValue("not a url");
  const saved = await page.evaluate(() => window.__semloRequireFixture("imageLinkReferenceEditor").getSnapshot());
  expect(saved.json.content?.[1].content?.[0].attrs?.semloEditorImageHref).toBe("not a url");
  expect(saved.html).toContain('data-semlo-editor-image-href="not a url"');
  expect(saved.html).not.toContain('<a href="not a url"');
  await input.fill("javascript:alert(1)");
  await input.press("Enter");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  for (const content of [saved.html, saved.json]) {
    await page.evaluate((value) => window.__semloRequireFixture("imageLinkReferenceEditor").setContent(value), content);
    const restored = await page.evaluate(() => window.__semloRequireFixture("imageLinkReferenceEditor").getSnapshot());
    expect(restored.json.content?.[1].content?.[0].attrs?.semloEditorImageHref).toBe("not a url");
  }
});
