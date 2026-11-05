import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("size preset remains on the saved size until a draft is submitted", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'image-size-draft-reference'
      host.style.width = '800px'
      document.body.prepend(host)
      createEditor({ element: host, outline: false, content: { type: 'doc', content: [
        {type:'paragraph', content:[{type:'text', text:'前文'}]},
        {type:'paragraph', content:[{type:'image', attrs:{src:'/tests/sample-image.svg', width:300, height:130}}]}
      ]} })`,
  });
  const frame = page.locator("#image-size-draft-reference .semlo-editor-image-frame");
  await frame.locator("img").click();
  await frame.getByRole("button", { name: "图片尺寸" }).click();
  const panel = frame.getByRole("dialog", { name: "图片尺寸" });
  const width = panel.getByLabel("图片宽度");
  const fifty = panel.getByRole("radio", { name: "50%" });
  await expect(fifty).toHaveAttribute("aria-checked", "true");
  await width.fill("450");
  await expect(panel.getByLabel("图片高度")).toHaveValue("195");
  await expect(fifty).toHaveAttribute("aria-checked", "true");
  await width.press("Escape");
  await expect(panel).toBeVisible();
  await expect(width).toHaveValue("450");
  await width.press("Enter");
  const seventyFive = panel.getByRole("radio", { name: "75%" });
  await expect(seventyFive).toHaveAttribute("aria-checked", "true");
  await seventyFive.focus();
  await page.keyboard.press("Escape");
  await expect(panel).toBeVisible();
  await width.fill("");
  await width.press("Enter");
  await expect(width).toHaveValue("");
  await expect(panel.getByLabel("图片高度")).toHaveValue("");
  await frame.getByRole("button", { name: "图片尺寸" }).click();
  await frame.getByRole("button", { name: "图片尺寸" }).click();
  await expect(width).toHaveValue("450");
  await width.fill("0");
  await expect(panel.getByLabel("图片高度")).toHaveValue("20");
  await width.press("Enter");
  await expect(width).toHaveValue("1");
  await expect(panel.getByLabel("图片高度")).toHaveValue("1");
  await width.fill("300");
  await width.press("Enter");
  const height = panel.getByLabel("图片高度");
  await width.fill("150.5");
  await expect(height).toHaveValue("");
  await width.press("Enter");
  await expect(width).toHaveValue("150.5");
  await expect(frame.locator("img")).toHaveCSS("width", "300px");
  await width.fill("150.0");
  await expect(height).toHaveValue("65");
  await width.fill("300");
  await width.press("Enter");
  await height.fill("-10");
  await expect(width).toHaveValue("30");
  await height.press("Enter");
  await expect(height).toHaveValue("1");
  await expect(width).toHaveValue("2");
  await width.fill("300");
  await width.press("Enter");
  await width.fill("-10");
  await width.press("Enter");
  await expect(width).toHaveValue("1");
  await expect(panel.getByLabel("图片高度")).toHaveValue("1");
  await frame.getByRole("button", { name: "图片样式" }).click();
  const style = frame.getByRole("menu", { name: "图片样式" });
  await page.keyboard.press("Escape");
  await expect(style).toBeVisible();
  await frame.getByRole("button", { name: "图片对齐", exact: true }).click();
  const align = frame.getByRole("menu", { name: "图片对齐" });
  await page.keyboard.press("Escape");
  await expect(align).toBeVisible();
});

test("rotated image drafts use source ratio while submission uses rotated ratio", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'rotated-size-draft'
      document.body.prepend(host)
      createEditor({ element: host, outline: false, content: { type: 'doc', content: [
        {type:'paragraph', content:[{type:'image', attrs:{src:'/tests/sample-image.svg', width:130, height:300, semloEditorImageRotation:270}}]}
      ]} })`,
  });
  const frame = page.locator("#rotated-size-draft .semlo-editor-image-frame");
  await frame.locator("img").click();
  await frame.getByRole("button", { name: "图片尺寸" }).click();
  const panel = frame.getByRole("dialog", { name: "图片尺寸" });
  const width = panel.getByLabel("图片宽度");
  const height = panel.getByLabel("图片高度");
  await width.fill("120");
  await expect(height).toHaveValue("52");
  await width.press("Enter");
  await expect(width).toHaveValue("120");
  await expect(height).toHaveValue("277");
});

test("cropped image drafts use source ratio while submission uses cropped ratio", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'cropped-size-draft'
      document.body.prepend(host)
      createEditor({ element: host, outline: false, content: { type: 'doc', content: [
        {type:'paragraph', content:[{type:'image', attrs:{src:'/tests/sample-image.svg', width:150, height:130, semloEditorImageCrop:{x:0,y:0,width:0.5,height:1}}}]}
      ]} })`,
  });
  const frame = page.locator("#cropped-size-draft .semlo-editor-image-frame");
  await frame.click();
  await frame.getByRole("button", { name: "图片尺寸" }).click();
  const panel = frame.getByRole("dialog", { name: "图片尺寸" });
  const width = panel.getByLabel("图片宽度");
  const height = panel.getByLabel("图片高度");
  await width.fill("120");
  await expect(height).toHaveValue("52");
  await width.press("Enter");
  await expect(width).toHaveValue("120");
  await expect(height).toHaveValue("104");
});
