import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("empty gallery follows measured content geometry", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'empty-gallery-reference'
      document.body.prepend(host)
      createEditor({ element: host, outline: false, content: { type:'doc', content:[
        {type:'semloEditorGallery', attrs:{data:{id:'empty',layout:'grid',images:[]}}}
      ]}})`,
  });
  const card = page.locator("#empty-gallery-reference .semlo-editor-gallery-surface");
  const icon = card.locator(".semlo-editor-gallery-empty-icon");
  const label = card.locator(".semlo-editor-gallery-empty-label");
  const upload = card.getByRole("button", { name: "上传图片" });
  await expect(upload).toBeVisible();
  const bounds = await card.boundingBox();
  const iconBounds = await icon.boundingBox();
  const labelBounds = await label.boundingBox();
  const uploadBounds = await upload.boundingBox();
  expect(iconBounds!.width).toBe(40);
  expect(iconBounds!.height).toBe(40);
  expect(iconBounds!.y - bounds!.y).toBe(69);
  expect(labelBounds!.y - bounds!.y).toBe(117);
  expect(uploadBounds!.y - bounds!.y).toBe(155);
  expect(uploadBounds!.width).toBe(102);
  await expect(upload.locator("svg")).toHaveCSS("width", "14px");
  await expect(upload).toHaveCSS("gap", "0px");
  await expect(upload).toHaveCSS("font-size", "14px");
  await expect(upload).toHaveCSS("border-radius", "8px");
  await card.hover({ position: { x: 10, y: 10 } });
  await expect(card).toHaveCSS("background-color", "rgb(244, 245, 245)");
  await card.evaluate((element) => {
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(new File(["test"], "test.png", { type: "image/png" }));
    element.dispatchEvent(new DragEvent("dragover", { dataTransfer, bubbles: true, cancelable: true }));
  });
  await expect(card).toHaveCSS("border-top-color", "rgb(0, 185, 107)");
  await expect(card).toHaveCSS("background-color", "rgb(244, 245, 245)");
});
