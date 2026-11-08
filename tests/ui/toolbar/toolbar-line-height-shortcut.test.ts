import { expect, test } from "@rstest/playwright";

test("line-height shortcuts step down and up from the default in an ordered list item", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.locator("#example-select").selectOption("lists");
  const item = page.locator("#editor-host .semlo-editor-prose ol li p").first();
  await item.click();
  const text = await item.innerText();
  await item.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await page.keyboard.press("Alt+ControlOrMeta+BracketLeft");
  await expect(item).toHaveAttribute("data-semlo-editor-line-height", "1.5");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(text);
  await page.keyboard.press("Alt+ControlOrMeta+BracketLeft");
  await expect(item).toHaveAttribute("data-semlo-editor-line-height", "1.15");
  await page.keyboard.press("Alt+ControlOrMeta+BracketRight");
  await expect(item).toHaveAttribute("data-semlo-editor-line-height", "1.5");
  await page.getByRole("button", { name: "行高调整" }).click();
  await page.getByRole("menuitem", { name: "默认" }).click();
  await page.keyboard.press("Alt+ControlOrMeta+BracketRight");
  await expect(item).toHaveAttribute("data-semlo-editor-line-height", "2");
  await page.keyboard.press("Alt+ControlOrMeta+BracketRight");
  await expect(item).toHaveAttribute("data-semlo-editor-line-height", "2.5");
});

test("line-height shortcut steps down from default for selected ordinary text", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const paragraph = page.locator("#editor-host .semlo-editor-prose p").first();
  await paragraph.click();
  await paragraph.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(paragraph).not.toHaveAttribute("data-semlo-editor-line-height");
  await page.keyboard.press("Alt+ControlOrMeta+BracketLeft");
  await expect(paragraph).toHaveAttribute("data-semlo-editor-line-height", "1.5");
});

test("line-height shortcut steps both selected ordered items down from default", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.locator("#example-select").selectOption("lists");
  const list = page.locator("#editor-host .semlo-editor-prose ol").first();
  const items = list.locator(":scope > li > p");
  await items.first().click();
  await list.evaluate((element) => {
    const paragraphs = element.querySelectorAll(":scope > li > p");
    const range = document.createRange();
    range.setStart(paragraphs[0], 0);
    range.setEnd(paragraphs[1], paragraphs[1].childNodes.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  const selected = await page.evaluate(() => window.getSelection()?.toString());
  await page.keyboard.press("Alt+ControlOrMeta+BracketLeft");
  await expect(items.nth(0)).toHaveAttribute("data-semlo-editor-line-height", "1.5");
  await expect(items.nth(1)).toHaveAttribute("data-semlo-editor-line-height", "1.5");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
});

test("line-height shortcut steps both selected unordered items down from default", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.locator("#example-select").selectOption("lists");
  const list = page.locator("#editor-host .semlo-editor-prose ul").first();
  const items = list.locator(":scope > li > p");
  await items.first().click();
  await list.evaluate((element) => {
    const paragraphs = element.querySelectorAll(":scope > li > p");
    const range = document.createRange();
    range.setStart(paragraphs[0], 0);
    range.setEnd(paragraphs[1], paragraphs[1].childNodes.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  const selected = await page.evaluate(() => window.getSelection()?.toString());
  await page.keyboard.press("Alt+ControlOrMeta+BracketLeft");
  await expect(items.nth(0)).toHaveAttribute("data-semlo-editor-line-height", "1.5");
  await expect(items.nth(1)).toHaveAttribute("data-semlo-editor-line-height", "1.5");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
});

test("line-height shortcut steps two selected adjacent paragraphs down from default", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.locator("#example-select").selectOption("text");
  const paragraphs = page.locator("#editor-host .semlo-editor-prose > p");
  const first = paragraphs.nth(1);
  const second = paragraphs.nth(2);
  await first.click();
  await page.locator("#editor-host .semlo-editor-prose").evaluate((editor) => {
    const paragraphs = editor.querySelectorAll(":scope > p");
    const range = document.createRange();
    range.setStart(paragraphs[1], 0);
    range.setEnd(paragraphs[2], paragraphs[2].childNodes.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  const selected = await page.evaluate(() => window.getSelection()?.toString());
  await expect(first).not.toHaveAttribute("data-semlo-editor-line-height");
  await expect(second).not.toHaveAttribute("data-semlo-editor-line-height");
  await page.keyboard.press("Alt+ControlOrMeta+BracketLeft");
  await expect(first).toHaveAttribute("data-semlo-editor-line-height", "1.5");
  await expect(second).toHaveAttribute("data-semlo-editor-line-height", "1.5");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
});

for (const kind of ["paragraph", "ordered item"] as const) {
  test(`line-height shortcut preserves the collapsed cursor in a ${kind}`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    if (kind === "ordered item") await page.locator("#example-select").selectOption("lists");
    const item =
      kind === "paragraph"
        ? page.locator("#editor-host .semlo-editor-prose p").first()
        : page.locator("#editor-host .semlo-editor-prose ol li p").first();
    await item.click();
    await page.getByRole("button", { name: "行高调整" }).click();
    await page.getByRole("menuitem", { name: "默认" }).click();
    await expect(item).not.toHaveAttribute("data-semlo-editor-line-height");
    expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
    await page.keyboard.press("Alt+ControlOrMeta+BracketLeft");
    await expect(item).toHaveAttribute("data-semlo-editor-line-height", "1.5");
    expect(await page.evaluate(() => window.getSelection()?.isCollapsed)).toBe(true);
    await expect(page.locator("#editor-host .semlo-editor-prose")).toBeFocused();
  });
}

for (const kind of ["paragraph", "unordered item", "heading"] as const) {
  test(`line-height shortcut immediately applies to a partial ${kind} selection`, async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.locator("#example-select").selectOption(kind === "unordered item" ? "lists" : "text");
    const item =
      kind === "unordered item"
        ? page.locator("#editor-host .semlo-editor-prose ul li p").first()
        : kind === "heading"
          ? page.locator("#editor-host .semlo-editor-prose h2").first()
          : page.locator("#editor-host .semlo-editor-prose > p").first();
    await item.click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+ArrowRight");
    const selected = await page.evaluate(() => window.getSelection()?.toString());
    expect(selected?.length).toBeGreaterThan(0);
    await page.keyboard.press("Alt+ControlOrMeta+BracketLeft");
    await expect(item).toHaveAttribute("data-semlo-editor-line-height", "1.5");
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
  });
}

test("line-height menu immediately applies to the paragraph selected with the mouse", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.locator("#example-select").selectOption("text");
  const item = page.locator("#editor-host .semlo-editor-prose > p").first();
  const rect = (await item.boundingBox())!;
  await page.mouse.move(rect.x + 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(rect.x + 38, rect.y + rect.height / 2, { steps: 4 });
  await page.mouse.up();
  const selected = await page.evaluate(() => window.getSelection()?.toString());
  expect(selected?.length).toBeGreaterThan(0);
  await page.getByRole("button", { name: "行高调整" }).click();
  await page.getByRole("menuitem", { name: "2", exact: true }).click();
  await expect(item).toHaveAttribute("data-semlo-editor-line-height", "2");
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selected);
});
