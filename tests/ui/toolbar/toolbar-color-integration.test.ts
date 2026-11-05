import { expect, test } from "@rstest/playwright";

test("split colors apply and remember palette choices in the real editor and overflow", async ({ page }) => {
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
  await host.getByRole("button", { name: "应用文字颜色" }).click();
  const colored = paragraph.locator("span[style*='color']").first();
  await expect(colored).toHaveCSS("color", "rgb(223, 42, 63)");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(text);
  await host.getByRole("button", { name: "文字颜色", exact: true }).click();
  const palette = page.getByRole("dialog", { name: "选择颜色", exact: true });
  await palette.getByRole("button", { name: "浅蓝 #117cee" }).click();
  await expect(colored).toHaveCSS("color", "rgb(17, 124, 238)");
  await host.getByRole("button", { name: "文字颜色", exact: true }).click();
  await palette.getByRole("button", { name: "默认文字颜色" }).click();
  await expect(host.locator(".semlo-editor-prose span[style*='color']")).toHaveCount(0);
  await host.getByRole("button", { name: "应用高亮颜色" }).click();
  await expect(host.locator(".semlo-editor-prose mark").first()).toHaveCSS("background-color", "rgb(251, 222, 40)");
  const toolbar = host.getByRole("toolbar", { name: "文本格式" });
  await toolbar.evaluate((element) => ((element as HTMLElement).style.width = "200px"));
  await toolbar.getByRole("button", { name: "更多" }).click();
  const overflow = page.getByRole("toolbar", { name: "更多工具" });
  const apply = overflow.getByRole("button", { name: "应用高亮颜色" });
  await apply.scrollIntoViewIfNeeded();
  await apply.click();
  await expect(host.locator(".semlo-editor-prose mark").first()).toHaveCSS("background-color", "rgb(251, 222, 40)");
  await expect(overflow).toBeVisible();
  await host.locator(".semlo-editor-prose").press("ControlOrMeta+z");
  await expect(host.locator(".semlo-editor-prose mark")).toHaveCount(0);
});

test("custom color preview updates the editor and remembered swatch and can be undone", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const host = page.locator("#editor-host");
  const paragraph = host.locator(".semlo-editor-prose p").first();
  await paragraph.click();
  await paragraph.evaluate((element) => {
    const node = document.createTreeWalker(element, NodeFilter.SHOW_TEXT).nextNode()!;
    const range = document.createRange();
    range.setStart(node, 0);
    range.setEnd(node, 4);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await host.getByRole("button", { name: "文字颜色", exact: true }).click();
  await page.getByRole("dialog", { name: "选择颜色" }).getByRole("button", { name: "更多颜色" }).click();
  const custom = page.getByRole("dialog", { name: "自定义颜色" });
  await custom.getByLabel("HEX", { exact: true }).fill("#0a78cc");
  await expect(paragraph.locator("span[style*='color']").first()).toHaveCSS("color", "rgb(10, 120, 204)");
  await expect(host.locator(".semlo-editor-toolbar-color-swatch").first()).toHaveCSS(
    "background-color",
    "rgb(10, 120, 204)",
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await host.locator(".semlo-editor-prose").press("ControlOrMeta+z");
  await expect(paragraph.locator("span[style*='color']")).toHaveCount(0);
});
