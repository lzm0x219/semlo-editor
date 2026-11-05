import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { imageNodes } from "../../fixtures/media/image-test-helpers";

declare global {
  interface Window {
    imageSizeEditor?: EditorController;
  }
}

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'image-size-test'
      host.style.width = '450px'
      document.body.prepend(host)
      window.imageSizeEditor = createEditor({
        element: host,
        outline: false,
        content: {
          type: 'doc',
          content: [
            { type: "paragraph", content: [{ type: 'image', attrs: { src: '/tests/sample-image.svg', alt: '尺寸示例', width: 300, height: 130 } }] },
            { type: 'paragraph', content: [{ type: 'text', text: '图片后的正文' }] },
          ],
        },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.imageSizeEditor));
  const host = page.locator("#image-size-test");
  const image = host.locator(".semlo-editor-image-frame > img");
  await expect.poll(() => image.evaluate((item) => (item as HTMLImageElement).naturalWidth)).toBe(600);
  await image.click();
  const toggle = host.getByRole("button", { name: "图片尺寸" });
  await expect(toggle).toBeVisible();
  await toggle.click();
  const panel = host.getByRole("dialog", { name: "图片尺寸" });
  await expect(panel).toBeVisible();
  return { host, image, toggle, panel };
}

const attrs = async (page: Page) =>
  imageNodes((await page.evaluate(() => window.__semloRequireFixture("imageSizeEditor").getSnapshot())).json)[0]?.attrs;

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("image size presets and input keep proportions, persist and undo", async ({ page }) => {
  const { host, image, toggle, panel } = await mount(page);
  const width = panel.getByLabel("图片宽度");
  const height = panel.getByLabel("图片高度");
  await expect(width).toHaveValue("300");
  await expect(height).toHaveValue("130");
  await expect(panel.getByRole("radio", { name: "50%" })).toHaveAttribute("aria-checked", "true");

  await panel.getByRole("radio", { name: "25%" }).click();
  await expect(width).toHaveValue("150");
  await expect(height).toHaveValue("65");
  expect(await attrs(page)).toMatchObject({ width: 150, height: 65 });
  await expect(panel.getByRole("radio", { name: "25%" })).toHaveAttribute("aria-checked", "true");

  await width.fill("450");
  await expect(height).toHaveValue("195");
  expect(await attrs(page)).toMatchObject({ width: 150, height: 65 });
  await width.press("Enter");
  expect(await attrs(page)).toMatchObject({ width: 450, height: 195 });
  await expect(panel.getByRole("radio", { name: "75%" })).toHaveAttribute("aria-checked", "true");

  await width.fill("1000");
  await expect(height).toHaveValue("433");
  await width.press("Enter");
  expect(await attrs(page)).toMatchObject({ width: 1000, height: 433 });
  await expect(width).toHaveValue("1000");
  for (const percent of ["25%", "50%", "75%", "100%"])
    await expect(panel.getByRole("radio", { name: percent })).toHaveAttribute("aria-checked", "false");
  expect((await image.boundingBox())!.width).toBeLessThan(1000);

  await width.fill("0");
  await width.press("Enter");
  expect(await attrs(page)).toMatchObject({ width: 1, height: 1 });
  await expect(width).toHaveValue("1");
  await page.keyboard.press("Escape");
  await expect(panel).toBeVisible();
  await toggle.click();
  await expect(panel).toBeHidden();
  await host.getByRole("button", { name: "撤销", exact: true }).click();
  expect(await attrs(page)).toMatchObject({ width: 1000, height: 433 });
  await toggle.click();
  await height.fill("-10");
  await height.press("Enter");
  expect(await attrs(page)).toMatchObject({ width: 2, height: 1 });
  await toggle.click();
  await host.getByRole("button", { name: "撤销", exact: true }).click();
  expect(await attrs(page)).toMatchObject({ width: 1000, height: 433 });
});

test("Escape keeps the draft open, which cannot affect a replacement or read-only document", async ({ page }) => {
  const { host, image, toggle, panel } = await mount(page);
  const width = panel.getByLabel("图片宽度");
  const height = panel.getByLabel("图片高度");
  await width.fill("420");
  await expect(height).toHaveValue("182");
  await page.keyboard.press("Escape");
  await expect(panel).toBeVisible();
  await expect(width).toHaveValue("420");
  expect(await attrs(page)).toMatchObject({ width: 300, height: 130 });
  await toggle.click();
  await expect(panel).toBeHidden();
  await toggle.click();
  await expect(width).toHaveValue("300");
  await width.fill("360");
  await page.evaluate(() => window.__semloRequireFixture("imageSizeEditor").setEditable(false));
  await expect(toggle).toBeHidden();
  await expect(panel).toBeHidden();
  expect(await attrs(page)).toMatchObject({ width: 300, height: 130 });

  await page.evaluate(() => window.__semloRequireFixture("imageSizeEditor").setEditable(true));
  await image.click();
  await toggle.click();
  await width.fill("500");
  await page.evaluate(() =>
    window.__semloRequireFixture("imageSizeEditor").setContent({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "image", attrs: { src: "/tests/sample-image.svg", alt: "替换图", width: 120, height: 52 } },
          ],
        },
      ],
    }),
  );
  await expect(panel).toBeHidden();
  expect(await attrs(page)).toMatchObject({ alt: "替换图", width: 120, height: 52 });
  await host.locator(".semlo-editor-image-frame > img").click({ position: { x: 12, y: 42 } });
  await host.getByRole("button", { name: "图片尺寸" }).click();
  await expect(host.getByLabel("图片宽度")).toHaveValue("120");
});

test("image styles close the menu, undo independently and survive HTML round trips", async ({ page }) => {
  const { host, image, toggle, panel } = await mount(page);
  await toggle.click();
  await expect(panel).toBeHidden();
  const styleToggle = host.getByRole("button", { name: "图片样式" });
  await styleToggle.click();
  const menu = host.getByRole("menu", { name: "图片样式" });
  await expect(menu.getByRole("menuitemradio", { name: "无样式" })).toHaveAttribute("aria-checked", "true");
  await menu.getByRole("menuitemradio", { name: "图片阴影" }).click();
  await expect(menu).toBeHidden();
  expect(await attrs(page)).toMatchObject({ semloEditorImageStyle: "shadow" });
  await expect(image).toHaveCSS("box-shadow", "rgba(0, 0, 0, 0.12) 0px 3px 6px 0px");

  await styleToggle.click();
  await expect(menu.getByRole("menuitemradio", { name: "图片阴影" })).toHaveAttribute("aria-checked", "true");
  await menu.getByRole("menuitemradio", { name: "图片描边" }).click();
  expect(await attrs(page)).toMatchObject({ semloEditorImageStyle: "border" });
  await expect(image).toHaveCSS("border-color", "rgb(231, 233, 232)");
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("imageSizeEditor").getSnapshot());
  expect(snapshot.html).toContain('data-semlo-editor-image-style="border"');
  await host.getByRole("button", { name: "撤销", exact: true }).click();
  expect(await attrs(page)).toMatchObject({ semloEditorImageStyle: "shadow" });
  await page.evaluate((html) => window.__semloRequireFixture("imageSizeEditor").setContent(html), snapshot.html);
  expect(await attrs(page)).toMatchObject({ semloEditorImageStyle: "border" });
});
