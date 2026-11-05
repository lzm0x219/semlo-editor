import { expect, test, type Locator } from "@rstest/playwright";

async function selectText(target: Locator) {
  await target.click();
  await target.evaluate((element) => {
    const selection = element.ownerDocument.getSelection();
    if (!selection) throw new Error("浏览器选区不可用");
    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  });
}

test("顶部选区的浮动工具栏不遮挡自定义主工具栏", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.getByRole("combobox", { name: "选择示例" }).selectOption("custom-toolbar");
  const host = page.locator("#editor-host");
  const editor = host.locator(".semlo-editor-prose");
  const toolbar = host.getByRole("toolbar", { name: "自定义工具栏" });
  const heading = editor.locator("h1").first();
  await heading.click();
  await editor.evaluate((root) => {
    const heading = root.querySelector("h1")!;
    const text = Array.from(heading.childNodes).find((node) => node.nodeType === Node.TEXT_NODE)!;
    const paragraph = root.querySelector("p")!.firstChild!;
    root.ownerDocument.getSelection()!.setBaseAndExtent(text, 0, paragraph, paragraph.textContent!.length);
  });
  const bubble = host.getByRole("toolbar", { name: "选中文字格式" });
  await expect(bubble).toBeVisible();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const bounds = await page.evaluate(() => {
    const toolbar = document.querySelector("#editor-host .demo-custom-toolbar")!.getBoundingClientRect();
    const bubble = document.querySelector("#editor-host .semlo-editor-bubble")!.getBoundingClientRect();
    const selection = document.getSelection()!.getRangeAt(0).getBoundingClientRect();
    return {
      overlap:
        bubble.left < toolbar.right &&
        bubble.right > toolbar.left &&
        bubble.top < toolbar.bottom &&
        bubble.bottom > toolbar.top,
      toolbar: { top: toolbar.top, bottom: toolbar.bottom },
      bubble: { top: bubble.top, bottom: bubble.bottom },
      horizontalOffset: Math.abs((bubble.left + bubble.right - selection.left - selection.right) / 2),
    };
  });
  expect(bounds.overlap, JSON.stringify(bounds)).toBe(false);
  expect(bounds.horizontalOffset).toBeLessThan(2);
  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(() =>
      host.evaluate((element) => {
        const main = element.querySelector(".demo-custom-toolbar")!.getBoundingClientRect();
        const bubble = element.querySelector(".semlo-editor-bubble")!.getBoundingClientRect();
        return (
          bubble.top >= main.bottom ||
          bubble.bottom <= main.top ||
          bubble.right <= main.left ||
          bubble.left >= main.right
        );
      }),
    )
    .toBe(true);
  await toolbar.getByRole("button", { name: "加粗", exact: true }).click({ timeout: 2500 });
  await expect(heading.locator("strong")).toHaveCount(0);
  await expect(editor.locator("p").first().locator("strong")).toHaveText("选中这段文字，试试加粗或添加链接。");
});

test("窄屏顶部选区可触屏使用主工具栏并通过键盘撤销", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.getByRole("combobox", { name: "选择示例" }).selectOption("custom-toolbar");
    const host = page.locator("#editor-host");
    const editor = host.locator(".semlo-editor-prose");
    const toolbar = host.getByRole("toolbar", { name: "自定义工具栏" });
    await editor.locator("h1").first().tap();
    await editor.evaluate((root) => {
      const text = Array.from(root.querySelector("h1")!.childNodes).find((node) => node.nodeType === Node.TEXT_NODE)!;
      const paragraph = root.querySelector("p")!.firstChild!;
      root.ownerDocument.getSelection()!.setBaseAndExtent(text, 0, paragraph, paragraph.textContent!.length);
    });
    const bubble = host.getByRole("toolbar", { name: "选中文字格式" });
    await expect(bubble).toBeVisible();
    await expect
      .poll(() =>
        host.evaluate((element) => {
          const main = element.querySelector(".demo-custom-toolbar")!.getBoundingClientRect();
          const bubble = element.querySelector(".semlo-editor-bubble")!.getBoundingClientRect();
          return (
            bubble.top >= main.bottom ||
            bubble.bottom <= main.top ||
            bubble.right <= main.left ||
            bubble.left >= main.right
          );
        }),
      )
      .toBe(true);
    await toolbar.getByRole("button", { name: "加粗", exact: true }).tap({ timeout: 2500 });
    await expect(editor.locator("h1 strong")).toHaveCount(0);
    await expect(editor.locator("p").first().locator("strong")).toHaveText("选中这段文字，试试加粗或添加链接。");
    await editor.focus();
    await page.keyboard.press("Meta+z");
    await expect(editor.locator("p").first().locator("strong")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test("体验页的自定义工具栏在各框架中编辑真实文档并保留内容", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.getByRole("combobox", { name: "选择示例" }).selectOption("custom-toolbar");
  const host = page.locator("#editor-host");
  const editor = host.getByRole("textbox", { name: "文档内容" });
  const toolbar = host.getByRole("toolbar", { name: "自定义工具栏" });
  const frameworks = ["Vue", "React", "SolidJS", "原生 JS"];

  for (let index = 0; index < frameworks.length; index++) {
    if (index) {
      await page
        .getByRole("group", { name: "框架切换" })
        .getByRole("button", { name: frameworks[index], exact: true })
        .click();
      await expect(toolbar).toBeVisible();
      await expect(editor.locator("h2").filter({ hasText: "把这一段变成二级标题。" })).toHaveCount(1);
      await expect(editor.locator('a[href="https://example.com/notes"]')).toHaveText(
        "选中这段文字，试试加粗或添加链接。",
      );
      await expect(editor.locator("ol li")).toContainText("把这一段变成列表。");
      await page.getByRole("button", { name: "恢复示例" }).click();
    }
    await expect(toolbar).toBeVisible();
    await expect(host.getByRole("toolbar", { name: "文本格式", exact: true })).toHaveCount(0);

    const text = editor.locator("p").filter({ hasText: "选中这段文字，试试加粗或添加链接。" });
    await selectText(text);
    await toolbar.getByRole("button", { name: "加粗", exact: true }).click();
    const bold = text.locator("strong");
    await expect(bold).toHaveText("选中这段文字，试试加粗或添加链接。");
    await expect(toolbar.getByRole("button", { name: "加粗", exact: true })).toHaveAttribute("aria-pressed", "true");

    await selectText(bold);
    const link = toolbar.getByRole("button", { name: "链接", exact: true });
    await expect(link).toBeEnabled();
    await link.click();
    const form = toolbar.getByRole("form", { name: "链接设置" });
    const address = form.getByRole("textbox", { name: "链接地址" });
    const formId = await form.getAttribute("id");
    expect(formId).toBeTruthy();
    await expect(link).toHaveAttribute("aria-controls", formId!);
    await expect(link).toHaveAttribute("aria-expanded", "true");
    await expect(address).toBeFocused();
    await address.fill("javascript:alert(1)");
    await form.getByRole("button", { name: "应用链接" }).click();
    await expect(address).toHaveAttribute("aria-invalid", "true");
    await expect(form.getByRole("status")).toContainText("请输入有效的链接地址");
    const pending = text.locator("a[data-semlo-editor-link-placeholder]");
    await expect(pending).toHaveCount(1);
    await expect(pending).not.toHaveAttribute("href");
    await address.fill("https://example.com/notes");
    await expect(address).not.toHaveAttribute("aria-invalid", "true");
    await expect(form.locator(".demo-toolbar-link-error")).toBeEmpty();
    await form.getByRole("button", { name: "应用链接" }).click();
    await expect(form).toBeHidden();
    await expect(link).toHaveAttribute("aria-expanded", "false");
    await expect(editor.locator('a[href="https://example.com/notes"]')).toHaveText(
      "选中这段文字，试试加粗或添加链接。",
    );

    await editor.locator("p").filter({ hasText: "把这一段变成二级标题。" }).click();
    await toolbar.getByRole("button", { name: "二级标题" }).click();
    await expect(editor.locator("h2").filter({ hasText: "把这一段变成二级标题。" })).toHaveCount(1);
    await expect(toolbar.getByRole("button", { name: "二级标题" })).toHaveAttribute("aria-pressed", "true");

    await editor.locator("p").filter({ hasText: "把这一段变成列表。" }).click();
    await toolbar.getByRole("button", { name: "无序列表" }).click();
    await expect(editor.locator("ul li")).toContainText("把这一段变成列表。");
    await expect(toolbar.getByRole("button", { name: "无序列表" })).toHaveAttribute("aria-pressed", "true");
    await toolbar.getByRole("button", { name: "有序列表" }).click();
    await expect(editor.locator("ol li")).toContainText("把这一段变成列表。");
    await expect(toolbar.getByRole("button", { name: "有序列表" })).toHaveAttribute("aria-pressed", "true");
    await editor.focus();
    await page.keyboard.press("Meta+z");
    await expect(editor.locator("ol li")).toHaveCount(0);
    await page.keyboard.press("Meta+Shift+z");
    await expect(editor.locator("ol li")).toContainText("把这一段变成列表。");

    await page.getByRole("button", { name: "只读预览" }).click();
    for (const name of ["二级标题", "加粗", "无序列表", "有序列表", "链接"]) {
      await expect(toolbar.getByRole("button", { name, exact: true })).toBeDisabled();
    }
    await page.getByRole("button", { name: "继续编辑" }).click();
    await expect(toolbar.getByRole("button", { name: "加粗", exact: true })).toBeEnabled();
  }
  expect(errors).toEqual([]);
});

test("体验页自定义工具栏在各框架中保留标题加粗规则", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.getByRole("combobox", { name: "选择示例" }).selectOption("custom-toolbar");
  const editor = page.locator("#editor-host .semlo-editor-prose");
  const toolbar = page.getByRole("toolbar", { name: "自定义工具栏" });
  const bold = toolbar.getByRole("button", { name: "加粗", exact: true });
  for (const framework of ["Vue", "React", "SolidJS", "原生 JS"]) {
    await page.getByRole("group", { name: "框架切换" }).getByRole("button", { name: framework, exact: true }).click();
    await page.getByRole("button", { name: "恢复示例" }).click();
    await editor.locator("p").filter({ hasText: "把这一段变成二级标题。" }).click();
    await toolbar.getByRole("button", { name: "二级标题" }).click();
    const heading = editor.locator("h2").filter({ hasText: "把这一段变成二级标题。" });
    const paragraph = editor.locator("p").filter({ hasText: "把这一段变成列表。" });
    await heading.click();
    await editor.evaluate((root) => {
      const heading = root.querySelector("h2")!;
      const title = Array.from(heading.childNodes).find((node) => node.nodeType === Node.TEXT_NODE)!;
      const paragraph = Array.from(root.querySelectorAll("p")).find(
        (node) => node.textContent === "把这一段变成列表。",
      )!.firstChild!;
      root.ownerDocument.getSelection()!.setBaseAndExtent(title, 0, paragraph, paragraph.textContent!.length);
    });
    await expect(bold).toBeEnabled();
    await bold.click();
    await expect(heading.locator("strong")).toHaveCount(0);
    await expect(paragraph.locator("strong")).toHaveText("把这一段变成列表。");
    await heading.click();
    await expect(bold).toBeDisabled();
  }
});

test("自定义链接复用默认占位、相对地址校验及撤销重做规则", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.getByRole("combobox", { name: "选择示例" }).selectOption("custom-toolbar");
  const editor = page.locator("#editor-host .semlo-editor-prose");
  const toolbar = page.getByRole("toolbar", { name: "自定义工具栏" });
  const text = "选中这段文字，试试加粗或添加链接。";
  const paragraph = editor.locator("p").filter({ hasText: text });
  await selectText(paragraph);
  await toolbar.getByRole("button", { name: "链接", exact: true }).click();
  const form = toolbar.getByRole("form", { name: "链接设置" });
  const placeholder = paragraph.locator("a[data-semlo-editor-link-placeholder]");
  await expect(placeholder).toHaveText(text);
  const address = form.getByRole("textbox", { name: "链接地址" });
  await address.fill("javascript:alert(1)");
  await form.getByRole("button", { name: "应用链接" }).click();
  await expect(address).toHaveAttribute("aria-invalid", "true");
  await expect(placeholder).not.toHaveAttribute("href");
  await address.fill("#section");
  await form.getByRole("button", { name: "应用链接" }).click();
  await expect(paragraph.locator("a")).toHaveAttribute("href", "#section");
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(placeholder).toHaveText(text);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(paragraph.locator("a")).toHaveCount(0);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(placeholder).toHaveText(text);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(paragraph.locator("a")).toHaveAttribute("href", "#section");
});

test("自定义链接支持空光标，取消保留可撤销占位", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.getByRole("combobox", { name: "选择示例" }).selectOption("custom-toolbar");
  const editor = page.locator("#editor-host .semlo-editor-prose");
  const toolbar = page.getByRole("toolbar", { name: "自定义工具栏" });
  const paragraph = editor.locator("p").filter({ hasText: "把这一段变成列表。" });
  await paragraph.click();
  await page.keyboard.press("End");
  const link = toolbar.getByRole("button", { name: "链接", exact: true });
  await expect(link).toBeEnabled();
  await link.click();
  const placeholder = paragraph.locator("a[data-semlo-editor-link-placeholder]");
  await expect(placeholder).toHaveText("链接");
  await toolbar.getByRole("form", { name: "链接设置" }).getByRole("button", { name: "取消" }).click();
  await expect(placeholder).toHaveText("链接");
  await expect(editor).toBeFocused();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(paragraph.locator("a")).toHaveCount(0);
});

test("体验页标题切换使用默认段落样式规则并保留撤销重做", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.getByRole("combobox", { name: "选择示例" }).selectOption("custom-toolbar");
  const editor = page.locator("#editor-host .semlo-editor-prose");
  const toolbar = page.getByRole("toolbar", { name: "自定义工具栏" });
  const text = "把这一段变成二级标题。";
  const paragraph = editor.locator("p").filter({ hasText: text });
  await selectText(paragraph);
  await toolbar.getByRole("button", { name: "加粗", exact: true }).click();
  await expect(paragraph.locator("strong")).toHaveText(text);
  await toolbar.getByRole("button", { name: "二级标题" }).click();
  const heading = editor.locator("h2").filter({ hasText: text });
  await expect(heading).toHaveCount(1);
  await expect(heading.locator("strong")).toHaveCount(0);
  await expect(toolbar.getByRole("button", { name: "二级标题" })).toHaveAttribute("aria-pressed", "true");
  await editor.focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(paragraph.locator("strong")).toHaveText(text);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(heading.locator("strong")).toHaveCount(0);
  await expect(heading).toHaveCount(1);
  await toolbar.getByRole("button", { name: "二级标题" }).click();
  await expect(paragraph).toHaveText(text);
  await expect(toolbar.getByRole("button", { name: "二级标题" })).toHaveAttribute("aria-pressed", "false");
});

test("窄屏键盘可操作工具栏，选区变化或只读切换关闭链接设置", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.getByRole("combobox", { name: "选择示例" }).selectOption("custom-toolbar");
  const host = page.locator("#editor-host");
  const editor = host.getByRole("textbox", { name: "文档内容" });
  const toolbar = host.getByRole("toolbar", { name: "自定义工具栏" });
  await expect(toolbar).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const titleParagraph = editor.locator("p").filter({ hasText: "把这一段变成二级标题。" });
  await titleParagraph.click();
  const heading = toolbar.getByRole("button", { name: "二级标题" });
  for (let index = 0; index < 5; index++) await page.keyboard.press("Shift+Tab");
  await expect(heading).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(editor.locator("h2").filter({ hasText: "把这一段变成二级标题。" })).toHaveCount(1);
  const paragraph = editor.locator("p").filter({ hasText: "选中这段文字，试试加粗或添加链接。" });
  await selectText(paragraph);
  const link = toolbar.getByRole("button", { name: "链接", exact: true });
  await expect(link).toBeEnabled();
  await link.focus();
  await page.keyboard.press("Enter");
  const form = toolbar.getByRole("form", { name: "链接设置" });
  await expect(form).toBeVisible();
  await expect(form.getByRole("textbox", { name: "链接地址" })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(form).toBeHidden();
  await selectText(paragraph);
  await expect(link).toBeEnabled();
  await link.click();
  await expect(form).toBeVisible();
  await editor.locator("p").filter({ hasText: "把这一段变成列表。" }).click();
  await expect(form).toBeHidden();
  await selectText(paragraph);
  await expect(link).toBeEnabled();
  await link.click();
  await expect(form).toBeVisible();
  await page.getByRole("group", { name: "框架切换" }).getByRole("button", { name: "React", exact: true }).click();
  await expect(toolbar).toBeVisible();
  await expect(form).toBeHidden();
  await selectText(paragraph);
  await expect(link).toBeEnabled();
  await link.click();
  await expect(form).toBeVisible();
  await page.getByRole("button", { name: "只读预览" }).click();
  await expect(form).toBeHidden();
  await expect(link).toBeDisabled();
});

test("触屏下工具栏可编辑标题和列表", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.getByRole("combobox", { name: "选择示例" }).selectOption("custom-toolbar");
    const editor = page.locator("#editor-host").getByRole("textbox", { name: "文档内容" });
    const toolbar = page.getByRole("toolbar", { name: "自定义工具栏" });
    await editor.locator("p").filter({ hasText: "把这一段变成二级标题。" }).tap();
    await toolbar.getByRole("button", { name: "二级标题" }).tap();
    await expect(editor.locator("h2").filter({ hasText: "把这一段变成二级标题。" })).toHaveCount(1);
    await editor.locator("p").filter({ hasText: "把这一段变成列表。" }).tap();
    await toolbar.getByRole("button", { name: "无序列表" }).tap();
    await expect(editor.locator("ul li")).toContainText("把这一段变成列表。");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await context.close();
  }
});

test("触屏窄屏下自定义链接可使用相对地址", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });
  try {
    const page = await context.newPage();
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.getByRole("combobox", { name: "选择示例" }).selectOption("custom-toolbar");
    const editor = page.locator("#editor-host .semlo-editor-prose");
    const toolbar = page.getByRole("toolbar", { name: "自定义工具栏" });
    const paragraph = editor.locator("p").filter({ hasText: "选中这段文字，试试加粗或添加链接。" });
    await paragraph.tap();
    await paragraph.evaluate((element) => {
      const selection = element.ownerDocument.getSelection()!;
      const range = element.ownerDocument.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      element.ownerDocument.dispatchEvent(new Event("selectionchange"));
    });
    await toolbar.getByRole("button", { name: "链接", exact: true }).tap();
    const form = toolbar.getByRole("form", { name: "链接设置" });
    await expect(form).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await form.getByRole("textbox", { name: "链接地址" }).fill("./mobile");
    await form.getByRole("button", { name: "应用链接" }).tap();
    await expect(paragraph.locator('a[href="./mobile"]')).toHaveText("选中这段文字，试试加粗或添加链接。");
  } finally {
    await context.close();
  }
});
