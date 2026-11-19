import { expect, test } from "@rstest/playwright";

test("the real toolbar updates its alignment icon and retains labelled controls", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const host = page.locator("#editor-host");
  await host.locator(".semlo-editor-prose").click();
  const alignment = host.getByRole("button", { name: "文本对齐" });
  await expect(alignment).toHaveAttribute("data-value", "left");
  await expect(alignment.locator("svg")).toHaveCount(1);
  await expect(alignment.locator("svg line").first()).toHaveAttribute("x1", "2");
  await alignment.click();
  await page.getByRole("menuitemradio", { name: "居中" }).click();
  await expect(alignment).toHaveAttribute("data-value", "center");
  await expect(alignment.locator("svg line").first()).toHaveAttribute("x1", "4");
  await alignment.click();
  await page.getByRole("menuitemradio", { name: "右对齐" }).click();
  await expect(alignment).toHaveAttribute("data-value", "right");
  await expect(alignment.locator("svg line").first()).toHaveAttribute("x1", "6");
  await expect(host.getByRole("button", { name: "缩进调整" }).locator("svg")).toHaveCount(1);
  await expect(host.getByRole("button", { name: "行高调整" }).locator("svg")).toHaveCount(1);
});

test("alignment menu preserves selection and remains usable from overflow with the keyboard", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const host = page.locator("#editor-host");
  const paragraph = host.locator(".semlo-editor-prose p").first();
  await paragraph.click();
  const text = await paragraph.innerText();
  await paragraph.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await host.getByRole("button", { name: "文本对齐" }).click();
  const menu = page.getByRole("menu", { name: "对齐方式" });
  await menu.getByRole("menuitemradio", { name: "居中" }).click();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(text);
  const toolbar = host.getByRole("toolbar", { name: "文本格式" });
  await toolbar.evaluate((element) => ((element as HTMLElement).style.width = "200px"));
  await toolbar.getByRole("button", { name: "更多" }).click();
  const overflow = page.getByRole("toolbar", { name: "更多工具" });
  const alignment = overflow.getByRole("button", { name: "文本对齐" });
  await alignment.scrollIntoViewIfNeeded();
  await alignment.focus();
  await page.keyboard.press("Enter");
  await expect(menu.getByRole("menuitemradio", { name: "居中" })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(alignment).toHaveAttribute("data-value", "right");
  await expect(overflow).toBeVisible();
  await expect(paragraph).toHaveCSS("text-align", "right");
});

for (const width of [1280, 390]) {
  test(`focusing the alignment button immediately uses the current text selection at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(process.env.SEMLO_FIXTURE_URL!);
    await page.addScriptTag({
      type: "module",
      content: `
        import { createEditor } from '/dist/index.js';
        createEditor({ element: document.body.appendChild(document.createElement('main')), outline: false,
          content: '<p>选中这段</p><p>保留后文</p>' });
      `,
    });
    const prose = page.getByRole("textbox", { name: "文档内容" });
    const paragraphs = prose.locator(":scope > p");
    await paragraphs.last().click();
    const toolbar = page.getByRole("toolbar", { name: "文本格式" });
    const alignment = page.getByRole("button", { name: "文本对齐", exact: true });
    if (width === 390) {
      await toolbar.getByRole("button", { name: "更多", exact: true }).click();
      await expect(
        page.getByRole("toolbar", { name: "更多工具" }).getByRole("button", { name: "文本对齐" }),
      ).toBeVisible();
    }
    await alignment.evaluate((button) => {
      const paragraph = document.querySelector(".semlo-editor-prose > p")!;
      const text = paragraph.firstChild!;
      document.getSelection()!.setBaseAndExtent(text, 0, text, text.textContent!.length);
      button.focus();
    });
    await page.keyboard.press("Enter");
    const menu = page.getByRole("menu", { name: "对齐方式" });
    await expect(menu.getByRole("menuitemradio", { name: "左对齐" })).toBeFocused();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(paragraphs.first()).toHaveCSS("text-align", "center");
    await expect(paragraphs.last()).not.toHaveCSS("text-align", "center");
    await expect(prose).toBeFocused();
    expect(await page.evaluate(() => document.getSelection()?.toString())).toBe("选中这段");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(paragraphs.first()).not.toHaveCSS("text-align", "center");
  });
}
