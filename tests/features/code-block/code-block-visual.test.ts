import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { readEditorStyles } from "../../fixtures/shared/editor-styles";

declare global {
  interface Window {
    codeVisualEditor?: EditorController;
  }
}

async function mount(page: Page, width = 800, withoutReset = false) {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  if (withoutReset) {
    await page.evaluate(() => {
      for (const element of document.querySelectorAll('style, link[rel="stylesheet"]')) element.remove();
    });
    await page.addStyleTag({ content: readEditorStyles() });
  }
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      document.body.style.margin = '0'
      const host = document.createElement('div')
      host.id = 'code-visual-test'
      host.style.width = '${width}px'
      document.body.append(host)
      window.codeVisualEditor = createEditor({
        element: host,
        outline: false,
        content: {
          type: 'doc',
          content: [
            { type: 'codeBlock', attrs: { language: 'javascript', title: '', theme: 'light', collapsed: false },
              content: [{ type: 'text', text: 'const total = 42;\\n  return total;\\n// 一条注释' }] },
            { type: 'paragraph', content: [{ type: 'text', text: '代码块后的正文' }] },
          ],
        },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.codeVisualEditor));
  return page.locator("#code-visual-test");
}

test("the light code block follows the measured typography, header and gutter geometry", async ({ page }) => {
  const host = await mount(page);
  const card = host.locator(".semlo-editor-code-card");
  const header = card.locator(".semlo-editor-code-header");
  const numbers = card.locator(".semlo-editor-code-numbers");
  const code = card.locator("pre code");
  await expect(card).toHaveCSS("background-color", "rgb(250, 250, 250)");
  await expect(card).toHaveCSS("border-radius", "4px");
  await expect(header).toHaveCSS("background-color", "rgb(245, 245, 245)");
  await expect(header).toHaveCSS("font-size", "14px");
  expect((await header.boundingBox())!.height).toBe(38);
  await expect(code).toHaveCSS("font-size", "14px");
  await expect(code).toHaveCSS("line-height", "20.3px");
  await expect(numbers).toHaveCSS("line-height", "20.3px");
  expect((await numbers.boundingBox())!.width).toBe(44);
  await expect(card.locator(".semlo-editor-code-body")).toHaveCSS("padding-top", "1px");
  await expect(card.locator("pre")).toHaveCSS("padding", "4px 6px");
  await expect(numbers).toHaveText("1\n2\n3");
  const alignment = await card.evaluate((element) => {
    const pre = element.querySelector("pre")!.getBoundingClientRect();
    const numbersBox = element.querySelector(".semlo-editor-code-numbers")!.getBoundingClientRect();
    return { top: pre.top - numbersBox.top, height: pre.height - numbersBox.height };
  });
  expect(alignment.top).toBe(0);
  expect(Math.abs(alignment.height)).toBeLessThan(1);
  await card.hover();
  await expect(card.getByLabel("代码块名称")).toHaveAttribute("placeholder", "请输入代码块名称");
  await expect(card.getByLabel("代码语言")).toBeVisible();
  await expect(card.getByLabel("代码主题")).toBeVisible();
  await expect(card.getByRole("button", { name: /收起代码块/ })).toBeVisible();
  await expect(card.getByRole("button", { name: "复制代码" })).toBeVisible();
  await expect(card.locator(".semlo-editor-code-copy svg")).toHaveCount(1);

  await code.locator(".hljs-keyword").first().click();
  await expect(card).toHaveCSS("border-top-color", "rgb(64, 150, 255)");
  await page.waitForTimeout(600);
  await expect(card).toHaveCSS("border-top-color", "rgb(64, 150, 255)");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("新增行");
  await expect(code).toContainText("新增行");
  await expect(numbers).toHaveText("1\n2\n3\n4");
});

test("narrow editors keep the code scrollable and header controls reachable without a host reset", async ({ page }) => {
  const host = await mount(page, 180, true);
  const card = host.locator(".semlo-editor-code-card");
  const header = card.locator(".semlo-editor-code-header");
  const body = card.locator(".semlo-editor-code-body");
  const code = card.locator("pre code");
  const numbers = card.locator(".semlo-editor-code-numbers");
  expect((await header.boundingBox())!.height).toBe(38);
  expect((await numbers.boundingBox())!.width).toBe(44);
  await expect(code).toHaveCSS("line-height", "20.3px");
  const metrics = await body.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(metrics.scrollWidth).toBeGreaterThan(metrics.clientWidth);
  await body.evaluate((element) => (element.scrollLeft = 50));
  const [gutter, viewport] = await Promise.all([numbers.boundingBox(), body.boundingBox()]);
  expect(gutter!.x).toBeCloseTo(viewport!.x, 0);
  await card.hover();
  await card.getByLabel("代码块名称").fill("窄屏标题");
  await expect(card.getByLabel("代码块名称")).toHaveValue("窄屏标题");
  const collapse = card.getByRole("button", { name: /收起代码块/ });
  await collapse.click();
  await expect(body).toBeHidden();
  await card.getByRole("button", { name: /展开代码块/ }).click();
  await expect(body).toBeVisible();
  await card.locator(".semlo-editor-code-copy").click();
  const [copy, headerBox] = await Promise.all([
    card.locator(".semlo-editor-code-copy").boundingBox(),
    header.boundingBox(),
  ]);
  expect(copy!.x).toBeGreaterThanOrEqual(headerBox!.x);
  expect(copy!.x + copy!.width).toBeLessThanOrEqual(headerBox!.x + headerBox!.width);
});

test("line numbers stay aligned with logical lines before and after toggling wrapping", async ({ page }) => {
  const host = await mount(page, 420);
  const card = host.locator(".semlo-editor-code-card");
  const numbers = card.locator(".semlo-editor-code-numbers");
  const pre = card.locator(".semlo-editor-code-body pre");
  const content = (lines: string[]) => ({
    type: "doc",
    content: [
      {
        type: "codeBlock",
        attrs: { language: null, wordWrap: false, showLineNumbers: true },
        content: [{ type: "text", text: lines.join("\n") }],
      },
    ],
  });
  const alignments = () =>
    card.evaluate((element) => {
      const numberColumn = element.querySelector(".semlo-editor-code-numbers")!;
      const code = element.querySelector("pre code")!;
      const tops = (root: Element) => {
        const nodes: Text[] = [];
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
        const text = nodes.map((node) => node.data).join("");
        let offset = 0;
        return text.split("\n").map((line) => {
          let left = offset;
          let found: number | undefined;
          for (const node of nodes) {
            if (left < node.length) {
              const range = document.createRange();
              range.setStart(node, left);
              range.setEnd(node, left + 1);
              found = range.getBoundingClientRect().top;
              break;
            }
            left -= node.length;
          }
          offset += line.length + 1;
          if (found === undefined) throw new Error("Missing rendered line");
          return found;
        });
      };
      return { numbers: tops(numberColumn), code: tops(code) };
    });
  const checkAlignment = async (count: number) => {
    await expect(numbers).toHaveText(Array.from({ length: count }, (_, index) => index + 1).join("\n"));
    const rendered = await alignments();
    expect(rendered.numbers).toHaveLength(count);
    expect(rendered.code).toHaveLength(count);
    for (const index of Array.from({ length: count }, (_, value) => value))
      expect(Math.abs(rendered.numbers[index] - rendered.code[index]), `line ${index + 1}`).toBeLessThan(2);
    return rendered;
  };

  await page.evaluate(
    (value) => window.__semloRequireFixture("codeVisualEditor").setContent(value),
    content(["first", "second"]),
  );
  await expect(card).toHaveAttribute("data-code-wrap", "false");
  await expect(pre).toHaveCSS("white-space", "pre");
  await expect(numbers).toHaveCSS("white-space", "pre");
  const two = await checkAlignment(2);
  expect(two.numbers[1] - two.numbers[0]).toBeCloseTo(20.3, 0);

  const long = ["x".repeat(100), ...Array.from({ length: 11 }, (_, index) => `line_${index + 2}`)];
  await page.evaluate((value) => window.__semloRequireFixture("codeVisualEditor").setContent(value), content(long));
  await checkAlignment(12);
  await card.hover();
  await card.getByRole("button", { name: "代码块更多设置" }).click();
  const wrap = page.getByRole("menuitemcheckbox", { name: "自动换行" });
  await wrap.click();
  await expect(card).toHaveAttribute("data-code-wrap", "true");
  await expect(pre).toHaveCSS("white-space", "pre-wrap");
  await expect(numbers.locator(".semlo-editor-code-number-line")).toHaveCount(12);
  const wrapped = await checkAlignment(12);
  expect(wrapped.code[1] - wrapped.code[0]).toBeGreaterThan(40);

  await wrap.click();
  await expect(card).toHaveAttribute("data-code-wrap", "false");
  await expect(pre).toHaveCSS("white-space", "pre");
  await expect(numbers.locator(".semlo-editor-code-number-line")).toHaveCount(0);
  await expect(numbers).toHaveCSS("white-space", "pre");
  const restored = await checkAlignment(12);
  expect(restored.code[1] - restored.code[0]).toBeCloseTo(20.3, 0);
});

test("language and theme arrows remain visible and usable in narrow, dark and read-only states", async ({ page }) => {
  const host = await mount(page, 180);
  const card = host.locator(".semlo-editor-code-card");
  const language = card.getByRole("button", { name: "代码语言" });
  const theme = card.getByRole("button", { name: "代码主题" });
  await card.hover();
  const arrow = (button: typeof language) =>
    button.evaluate((element) => {
      const style = getComputedStyle(element);
      const marker = getComputedStyle(element, "::after");
      return {
        content: marker.content,
        position: marker.position,
        width: marker.width,
        height: marker.height,
        right: marker.right,
        borderRight: marker.borderRightWidth,
        borderBottom: marker.borderBottomWidth,
        arrowColor: marker.borderRightColor,
        textColor: style.color,
        transform: marker.transform,
        paddingRight: style.paddingRight,
      };
    });
  const checkArrow = async (button: typeof language) => {
    const result = await arrow(button);
    expect(result).toMatchObject({
      content: '""',
      position: "absolute",
      width: "6px",
      height: "6px",
      right: "9px",
      borderRight: "1px",
      borderBottom: "1px",
      paddingRight: "22px",
    });
    expect(result.arrowColor).toBe(result.textColor);
    expect(result.transform).not.toBe("none");
  };
  await checkArrow(language);
  await checkArrow(theme);

  const languageWidth = (await language.boundingBox())!.width;
  await language.click();
  const search = card.getByRole("combobox", { name: "搜索代码语言" });
  await expect(search).toBeVisible();
  expect((await search.boundingBox())!.width).toBeCloseTo(languageWidth, 0);
  expect(await search.evaluate((element) => getComputedStyle(element, "::after").content)).toBe("none");
  await search.fill("typescript");
  await search.press("Escape");
  await expect(language).toBeVisible();
  await checkArrow(language);

  await theme.click();
  await page.getByRole("option", { name: "Bracket Lights Pro", exact: true }).click();
  await expect(theme).toHaveText("Bracket Lights Pro");
  await checkArrow(theme);
  await theme.click();
  await page.getByRole("option", { name: "One Dark Pro", exact: true }).click();
  await expect(card).toHaveAttribute("data-theme", "dark");
  await checkArrow(language);
  await checkArrow(theme);
  await page.evaluate(() => window.__semloRequireFixture("codeVisualEditor").setEditable(false));
  await card.hover();
  await expect(language).toBeDisabled();
  await expect(theme).toBeDisabled();
  await checkArrow(language);
  await checkArrow(theme);
});

test("inactive code blocks keep titles visible and reveal controls for hover, keyboard and open menus", async ({
  page,
}) => {
  const host = await mount(page, 360);
  await page.evaluate(() =>
    window.__semloRequireFixture("codeVisualEditor").setContent({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "javascript", title: "已有的代码块标题", theme: "light", collapsed: false },
          content: [{ type: "text", text: "const first = 1" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "中间的正文" }] },
        {
          type: "codeBlock",
          attrs: { language: "javascript", title: "", theme: "dark", collapsed: false },
          content: [{ type: "text", text: "const second = 2" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "后面的正文" }] },
      ],
    }),
  );
  const first = host.locator(".semlo-editor-code-card").nth(0);
  const second = host.locator(".semlo-editor-code-card").nth(1);
  const title = (card: typeof first) => card.getByLabel("代码块名称");
  const language = (card: typeof first) => card.getByRole("button", { name: "代码语言" });
  const theme = (card: typeof first) => card.getByRole("button", { name: "代码主题" });
  const copy = (card: typeof first) => card.getByRole("button", { name: "复制代码" });
  const collapse = (card: typeof first) => card.getByRole("button", { name: "收起代码块" });
  const expectControls = async (card: typeof first, opacity: string) => {
    for (const button of [language(card), theme(card), copy(card)]) await expect(button).toHaveCSS("opacity", opacity);
  };
  await page.mouse.click(1000, 500);
  await expectControls(first, "0");
  await expectControls(second, "0");
  await expect(language(first)).toHaveCSS("pointer-events", "none");
  await expect(theme(second)).toHaveCSS("pointer-events", "none");
  await expect(title(first)).toHaveCSS("opacity", "1");
  await expect(title(first)).toHaveValue("已有的代码块标题");
  await expect(title(second)).toHaveCSS("opacity", "0");
  await expect(collapse(first)).toHaveCSS("opacity", "1");
  await expect(collapse(second)).toHaveCSS("opacity", "1");

  await second.hover();
  await expectControls(second, "1");
  await expect(language(second)).toHaveCSS("pointer-events", "auto");
  await expect(title(second)).toHaveCSS("opacity", "1");
  await expectControls(first, "0");
  await page.mouse.move(1000, 500);
  await expectControls(second, "0");
  await expect(title(second)).toHaveCSS("opacity", "0");

  await collapse(second).focus();
  await page.keyboard.press("Tab");
  await expect(title(second)).toBeFocused();
  await expectControls(second, "1");
  await page.keyboard.press("Tab");
  await expect(language(second)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(theme(second)).toBeFocused();
  await page.keyboard.press("Enter");
  const popup = page.getByRole("dialog", { name: "代码主题选项" });
  await expect(popup).toBeVisible();
  await page.mouse.move(1000, 500);
  await expect(theme(second)).toHaveAttribute("aria-expanded", "true");
  await expectControls(second, "1");
  await popup.getByRole("listbox").press("Escape");
  await expect(theme(second)).toBeFocused();
  await expectControls(second, "1");

  await page.mouse.click(1000, 500);
  await expectControls(second, "0");
  await page.evaluate(() => {
    const editor = window.codeVisualEditor;
    if (!editor) throw new Error("codeVisualEditor is not initialized");
    editor.editor.commands.setNodeSelection(0);
    editor.editor.view.focus();
  });
  await expect(first).toHaveClass(/ProseMirror-selectednode/);
  await expectControls(first, "1");
  await page.mouse.click(1000, 500);
  await expectControls(first, "0");

  await page.evaluate(() => window.__semloRequireFixture("codeVisualEditor").setEditable(false));
  await expect(title(first)).toHaveValue("已有的代码块标题");
  await expect(title(first)).toHaveCSS("opacity", "1");
  await expect(title(second)).toHaveCSS("opacity", "0");
  await second.hover();
  await expectControls(second, "1");
  await expect(language(second)).toBeDisabled();
  await expect(theme(second)).toBeDisabled();
  await collapse(second).focus();
  await page.keyboard.press("Tab");
  await expect(copy(second)).toBeFocused();
});

test("touch can reveal inactive controls in editing and read-only views", async ({ page }) => {
  const context = await page
    .context()
    .browser()!
    .newContext({ hasTouch: true, isMobile: true, viewport: { width: 320, height: 700 } });
  try {
    const touch = await context.newPage();
    const host = await mount(touch, 320);
    const card = host.locator(".semlo-editor-code-card");
    const theme = card.getByRole("button", { name: "代码主题" });
    await card.locator(".hljs-keyword").first().tap();
    await expect(theme).toHaveCSS("opacity", "1");
    await theme.tap();
    await expect(touch.getByRole("dialog", { name: "代码主题选项" })).toBeVisible();
    await touch.getByRole("option", { name: "One Dark Pro", exact: true }).tap();
    await expect(card).toHaveAttribute("data-theme", "dark");
    await touch.evaluate(() => window.__semloRequireFixture("codeVisualEditor").setEditable(false));
    await card.locator(".hljs-keyword").first().tap();
    await expect(theme).toHaveCSS("opacity", "1");
    await card.getByRole("button", { name: "复制代码" }).tap();
  } finally {
    await context.close();
  }
});

test("all theme values preserve readable code and legacy light and dark content", async ({ page }) => {
  const host = await mount(page);
  const themes = ["light-pro", "light", "bracket-lights-pro", "dark", "night-owl", "darcula"];
  const measured: Record<string, [string, string, string, string]> = {
    "light-pro": ["rgb(255, 255, 255)", "rgb(245, 245, 245)", "rgb(38, 44, 49)", "rgb(108, 108, 108)"],
    "bracket-lights-pro": ["rgb(253, 253, 253)", "rgb(248, 248, 248)", "rgb(54, 54, 54)", "rgb(108, 108, 108)"],
    dark: ["rgb(39, 44, 53)", "rgb(36, 41, 51)", "rgb(169, 178, 192)", "rgb(204, 204, 204)"],
    "night-owl": ["rgb(0, 22, 40)", "rgb(0, 12, 24)", "rgb(212, 222, 236)", "rgb(204, 204, 204)"],
    darcula: ["rgb(43, 43, 43)", "rgb(34, 34, 34)", "rgb(204, 204, 204)", "rgb(204, 204, 204)"],
  };
  const colors = new Map<string, string>();
  for (const theme of themes) {
    await page.evaluate(
      (themeName) =>
        window.__semloRequireFixture("codeVisualEditor").setContent({
          type: "doc",
          content: [
            {
              type: "codeBlock",
              attrs: { language: "javascript", title: "测试", theme: themeName, collapsed: false },
              content: [{ type: "text", text: 'const value = "hello";' }],
            },
          ],
        }),
      theme,
    );
    const card = host.locator(".semlo-editor-code-card");
    await expect(card).toHaveAttribute("data-theme", theme);
    await expect(card.locator("pre code")).toHaveCSS("font-size", "14px");
    const appearance = await card.evaluate((element) => {
      const parse = (value: string) =>
        value
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number);
      const bg = getComputedStyle(element).backgroundColor;
      const fg = getComputedStyle(element.querySelector("pre")!).color;
      const luminance = (value: string) => {
        const values = parse(value).map((channel) => {
          const v = channel / 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * values[0] + 0.7152 * values[1] + 0.0722 * values[2];
      };
      const [light, dark] = [luminance(bg), luminance(fg)].sort((a, b) => b - a);
      return { bg, contrast: (light + 0.05) / (dark + 0.05) };
    });
    expect(appearance.contrast, theme).toBeGreaterThan(4.5);
    colors.set(theme, appearance.bg);
    if (measured[theme]) {
      const [background, header, text, gutter] = measured[theme];
      expect(appearance.bg).toBe(background);
      await expect(card.locator(".semlo-editor-code-header")).toHaveCSS("background-color", header);
      await expect(card.locator("pre")).toHaveCSS("color", text);
      await expect(card.locator(".semlo-editor-code-numbers")).toHaveCSS("color", gutter);
    }
    expect(
      (await page.evaluate(() => window.__semloRequireFixture("codeVisualEditor").getSnapshot().json)).content?.[0]
        .attrs?.theme,
    ).toBe(theme);
    await expect(card.locator(".hljs-keyword").first()).toBeVisible();
  }
  expect(colors.get("light")).not.toBe(colors.get("dark"));
  expect(new Set([colors.get("dark"), colors.get("night-owl"), colors.get("darcula")]).size).toBe(3);
});
