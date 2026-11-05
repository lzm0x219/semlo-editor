import { expect, test } from "@rstest/playwright";

test("an empty details title disables block-level toolbar controls while retaining text formatting", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.locator("#example-select").selectOption("blocks");
  const host = page.locator("#editor-host");
  const summary = host.locator('.semlo-editor-prose [data-type="details"] summary').first();
  await summary.click();
  await summary.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await page.keyboard.press("Backspace");
  await expect(summary).toHaveText("");
  const toolbar = host.getByRole("toolbar", { name: "文本格式" });
  for (const name of [
    "插入内容",
    "段落样式",
    "字号",
    "文本对齐",
    "无序列表",
    "有序列表",
    "有序列表样式",
    "缩进调整",
    "行高调整",
  ]) {
    await expect(toolbar.getByRole("button", { name, exact: true }), name).toBeDisabled();
  }
  for (const name of [
    "加粗",
    "斜体",
    "删除线",
    "下划线",
    "上下标",
    "应用文字颜色",
    "文字颜色",
    "应用高亮颜色",
    "高亮颜色",
  ]) {
    await expect(toolbar.getByRole("button", { name, exact: true }), name).toBeEnabled();
  }
});

test("a same-card title/body selection keeps size enabled while block controls stay disabled", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.locator("#example-select").selectOption("blocks");
  const host = page.locator("#editor-host");
  const card = host.locator('.semlo-editor-prose [data-type="details"]').first();
  const summary = card.locator("summary");
  const body = card.locator('[data-type="detailsContent"] p').first();
  await summary.click();
  const toolbar = host.getByRole("toolbar", { name: "文本格式" });
  await expect(toolbar.getByRole("button", { name: "字号" })).toBeDisabled();
  await card.evaluate((element) => {
    const summary = element.querySelector("summary")!;
    const paragraph = element.querySelector('[data-type="detailsContent"] p')!;
    const range = document.createRange();
    range.setStart(summary.firstChild!, 0);
    range.setEnd(paragraph.firstChild!, paragraph.textContent!.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await expect(toolbar.getByRole("button", { name: "字号" })).toBeEnabled();
  for (const name of [
    "插入内容",
    "段落样式",
    "文本对齐",
    "无序列表",
    "有序列表",
    "有序列表样式",
    "缩进调整",
    "行高调整",
  ]) {
    await expect(toolbar.getByRole("button", { name, exact: true }), name).toBeDisabled();
  }
  await body.click();
  for (const name of [
    "插入内容",
    "段落样式",
    "字号",
    "文本对齐",
    "无序列表",
    "有序列表",
    "有序列表样式",
    "缩进调整",
    "行高调整",
  ]) {
    await expect(toolbar.getByRole("button", { name, exact: true }), name).toBeEnabled();
  }
});

test("details-title formatting and undo work while disabled controls remain disabled in overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.locator("#example-select").selectOption("blocks");
  const host = page.locator("#editor-host");
  const summary = host.locator('.semlo-editor-prose [data-type="details"] summary').first();
  await summary.click();
  await summary.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  const toolbar = host.getByRole("toolbar", { name: "文本格式" });
  await toolbar.getByRole("button", { name: "加粗", exact: true }).click();
  await expect(summary.locator("strong")).toHaveCount(1);
  await toolbar.getByRole("button", { name: "应用文字颜色" }).click();
  await expect(summary.locator("span[style*='color']")).toHaveCount(1);
  await host.locator(".semlo-editor-prose").press("ControlOrMeta+z");
  await expect(summary.locator("span[style*='color']")).toHaveCount(0);
  await expect(summary.locator("strong")).toHaveCount(1);
  await toolbar.evaluate((element) => ((element as HTMLElement).style.width = "200px"));
  await toolbar.getByRole("button", { name: "更多" }).click();
  const overflow = page.getByRole("toolbar", { name: "更多工具" });
  await expect(overflow.getByRole("button", { name: "文本对齐" })).toBeDisabled();
  await expect(overflow.getByRole("button", { name: "有序列表样式" })).toBeDisabled();
  await expect(overflow.getByRole("button", { name: "应用高亮颜色" })).toBeEnabled();
});

test("a slash in a details title remains text without opening the insert menu", async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.locator("#example-select").selectOption("blocks");
  const host = page.locator("#editor-host");
  const summary = host.locator('.semlo-editor-prose [data-type="details"] summary').first();
  await summary.click();
  await summary.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  });
  await page.keyboard.type("/zdk");
  await expect(summary).toHaveText("/zdk");
  await expect(page.getByRole("listbox", { name: "插入内容" })).toHaveCount(0);
});
