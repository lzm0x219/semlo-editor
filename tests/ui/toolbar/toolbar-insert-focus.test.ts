import { expect, test, type Page } from "@rstest/playwright";

async function selectParagraph(page: Page) {
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
  return { host, text };
}

test("mouse opening keeps the text selection and typing in the editor", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const { host, text } = await selectParagraph(page);
  const prose = host.locator(".semlo-editor-prose");
  await host.getByRole("button", { name: "插入内容" }).click();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await expect(panel).toBeVisible();
  await expect(prose).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(text);
  await page.keyboard.type("insert-test");
  await expect(prose).toContainText("insert-test");
  await expect(panel.getByRole("textbox", { name: "搜索插入内容" })).toHaveValue("");
  await expect(panel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeVisible();
  await panel.getByRole("textbox", { name: "搜索插入内容" }).focus();
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(prose).toBeFocused();
});

test("keyboard opening focuses search; mouse opening from overflow retains the editor selection", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const { host, text } = await selectParagraph(page);
  const trigger = host.getByRole("button", { name: "插入内容" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await expect(panel.getByRole("textbox", { name: "搜索插入内容" })).toBeFocused();
  await page.keyboard.press("Escape");
  const { text: selected } = await selectParagraph(page);
  expect(selected).toBe(text);
  const toolbar = host.getByRole("toolbar", { name: "文本格式" });
  await toolbar.evaluate((element) => ((element as HTMLElement).style.width = "80px"));
  await toolbar.getByRole("button", { name: "更多" }).click();
  const overflow = page.getByRole("toolbar", { name: "更多工具" });
  await overflow.getByRole("button", { name: "插入内容" }).click();
  await expect(panel).toBeVisible();
  await expect(host.locator(".semlo-editor-prose")).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(text);
  await expect(overflow).toBeVisible();
});

test("searching and inserting a quote preserves a multi-paragraph selection and supports undo", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'insert-quote-selection-test'
      document.body.prepend(host)
      createEditor({ element: host, content: '<p>第一段</p><p>第二段</p><p>第三段</p>' })
    `,
  });

  const host = page.locator("#insert-quote-selection-test");
  const prose = host.locator(".semlo-editor-prose");
  const first = prose.locator("p").first();
  await first.click();
  await page.keyboard.press("Home");
  await page.keyboard.down("Shift");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.up("Shift");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("第一段\n\n第二段");
  await host.getByRole("button", { name: "插入内容" }).click();
  const panel = page.getByRole("dialog", { name: "插入内容" });
  await panel.getByRole("textbox", { name: "搜索插入内容" }).fill("引用");
  await page.keyboard.press("Enter");

  await expect(panel).toHaveCount(0);
  await expect(prose).toBeFocused();
  await expect(prose.locator(":scope > blockquote > p")).toHaveText(["第一段", "第二段"]);
  await expect(prose.locator(":scope > p")).toHaveText(["第三段"]);

  await page.keyboard.press("ControlOrMeta+z");
  await expect(prose.locator(":scope > blockquote")).toHaveCount(0);
  await expect(prose.locator(":scope > p")).toHaveText(["第一段", "第二段", "第三段"]);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(prose.locator(":scope > blockquote > p")).toHaveText(["第一段", "第二段"]);
  await expect(prose.locator(":scope > p")).toHaveText(["第三段"]);
});
