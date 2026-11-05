import { expect, test, type Locator, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    codeSettingsEditor?: EditorController;
    otherCodeSettingsEditor?: EditorController;
  }
}

async function mount(page: Page, content = '<pre><code class="language-javascript">const n = 1</code></pre>') {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'code-settings-test'
      host.style.width = '800px'
      document.body.append(host)
      window.codeSettingsEditor = createEditor({ element: host, outline: false, content: ${JSON.stringify(content)} })
    `,
  });
  await page.waitForFunction(() => Boolean(window.codeSettingsEditor));
  return page.locator("#code-settings-test");
}

async function openSettings(page: Page, card: Locator) {
  await card.hover();
  const trigger = card.getByRole("button", { name: "代码块更多设置" });
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
  const menu = page.getByRole("menu", { name: "代码块设置" });
  await expect(menu).toBeVisible();
  return menu;
}

async function choose(page: Page, menu: Locator, group: string, value: string) {
  await menu.getByRole("menuitem", { name: group, exact: true }).click();
  const submenu = page.getByRole("menu", { name: group, exact: true });
  await submenu.getByRole("menuitemradio", { name: value, exact: true }).click();
  await expect(menu).toBeVisible();
  await expect(submenu).toBeVisible();
  await expect(submenu.getByRole("menuitemradio", { name: value, exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("automatic indentation from the menu keeps the selection and reports success", async ({ page }) => {
  const before = "function f(){\nlet x = 1;\nif(x){\nx++;\n}\n}";
  const host = await mount(page, `<pre><code class="language-javascript">${before}</code></pre>`);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("codeSettingsEditor").editor;
    const text = editor.state.doc.firstChild!.textContent;
    const from = text.indexOf("x++;") + 1;
    editor.commands.focus();
    editor.commands.setTextSelection({ from, to: from + 4 });
  });
  const card = host.locator(".semlo-editor-code-card");
  const menu = await openSettings(page, card);
  expect(await page.evaluate(() => window.__semloRequireFixture("codeSettingsEditor").editor.view.hasFocus())).toBe(
    true,
  );
  expect(
    await page.evaluate(() => {
      const { state } = window.__semloRequireFixture("codeSettingsEditor").editor;
      return state.doc.textBetween(state.selection.from, state.selection.to);
    }),
  ).toBe("x++;");
  await menu.getByRole("menuitem", { name: "自动缩进", exact: true }).click();
  await expect(menu).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("自动缩进成功");
  expect(await page.evaluate(() => window.__semloRequireFixture("codeSettingsEditor").editor.view.hasFocus())).toBe(
    true,
  );
  expect(
    await page.evaluate(() => {
      const { state } = window.__semloRequireFixture("codeSettingsEditor").editor;
      return state.doc.textBetween(state.selection.from, state.selection.to);
    }),
  ).toBe("x++;");
  expect(await card.locator("code").innerText()).toBe("function f(){\n  let x = 1;\n  if(x){\n    x++;\n  }\n}");
  expect(await page.evaluate(() => window.__semloRequireFixture("codeSettingsEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await card.locator("code").innerText()).toBe(before);
  await page.evaluate(() => window.__semloRequireFixture("codeSettingsEditor").destroy());
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("pointer-opening settings moves an outside caret into the target code block", async ({ page }) => {
  const first = "function first(){\nlet n=1;\n}";
  const targetText = "function target(){\nlet n=2;\n}";
  const host = await mount(
    page,
    `<p>outside</p><pre><code class="language-javascript">${first}</code></pre><pre><code class="language-javascript">${targetText}</code></pre>`,
  );
  const cards = host.locator(".semlo-editor-code-card");
  const target = cards.nth(1);
  for (const source of ["paragraph", "first-code"] as const) {
    await page.evaluate((kind) => {
      const editor = window.__semloRequireFixture("codeSettingsEditor").editor;
      let position = -1;
      editor.state.doc.descendants((node, pos) => {
        if (position >= 0) return;
        if (kind === "paragraph" ? node.type.name === "paragraph" : node.type.name === "codeBlock") position = pos;
      });
      editor.commands.setTextSelection(position + 2);
      editor.commands.focus();
    }, source);
    const menu = await openSettings(page, target);
    const selection = async () =>
      page.evaluate(() => {
        const editor = window.__semloRequireFixture("codeSettingsEditor").editor;
        const { selection } = editor.state;
        return {
          type: selection.$from.parent.type.name,
          text: selection.$from.parent.textContent,
          offset: selection.$from.parentOffset,
          size: selection.$from.parent.content.size,
          empty: selection.empty,
          focused: editor.view.hasFocus(),
        };
      });
    const opened = await selection();
    expect(opened).toMatchObject({ type: "codeBlock", empty: true, focused: true });
    expect(opened.text).toContain("target");
    expect(opened.offset).toBe(opened.size);
    await menu.getByRole("menuitem", { name: "自动缩进", exact: true }).click();
    await expect(menu).toBeVisible();
    const after = await selection();
    expect(after).toMatchObject({ type: "codeBlock", empty: true, focused: true });
    expect(after.text).toContain("target");
    expect(after.offset).toBe(after.size);
    await expect(cards.first().locator("code")).toHaveText(first);
    await target.getByRole("button", { name: "代码块更多设置" }).click();
    await expect(menu).toHaveCount(0);
  }
  await expect(target.locator("code")).toHaveText("function target(){\n  let n=2;\n}");
});

test("keyboard activation enters the settings menu with the target selection synchronized", async ({ page }) => {
  const host = await mount(
    page,
    '<p>outside</p><pre><code class="language-javascript">function target(){\nlet n=1;\n}</code></pre>',
  );
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("codeSettingsEditor").editor;
    editor.commands.setTextSelection(2);
    editor.commands.focus();
  });
  const card = host.locator(".semlo-editor-code-card");
  await card.hover();
  const trigger = card.getByRole("button", { name: "代码块更多设置" });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "代码块设置" });
  const first = menu.getByRole("menuitem", { name: "字号", exact: true });
  await expect(first).toBeFocused();
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("codeSettingsEditor").editor.state.selection.$from.parent.type.name,
    ),
  ).toBe("codeBlock");
  await page.keyboard.press("ArrowDown");
  await expect(menu.getByRole("menuitem", { name: "缩进模式", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(menu).toHaveCount(0);
});

test("settings and automatic indentation keep a collapsed code block collapsed", async ({ page }) => {
  const host = await mount(
    page,
    '<p>outside</p><pre data-collapsed="true"><code class="language-javascript">function f(){\nlet n=1;\n}</code></pre>',
  );
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("codeSettingsEditor").editor;
    editor.commands.setTextSelection(2);
    editor.commands.focus();
  });
  const card = host.locator(".semlo-editor-code-card");
  const trigger = card.getByRole("button", { name: "代码块更多设置" });
  const menu = await openSettings(page, card);
  await expect(trigger).toBeFocused();
  await expect(card).toHaveClass(/is-collapsed/);
  await menu.getByRole("menuitem", { name: "自动缩进", exact: true }).click();
  await expect(menu).toBeVisible();
  await expect(trigger).toBeFocused();
  await expect(card).toHaveClass(/is-collapsed/);
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("codeSettingsEditor").editor.state.doc.lastChild!.textContent,
    ),
  ).toBe("function f(){\n  let n=1;\n}");
});

test("feedback belongs to the editor that produced the latest message", async ({ page }) => {
  const first = await mount(page);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'other-code-settings-test'
      document.body.append(host)
      window.otherCodeSettingsEditor = createEditor({
        element: host,
        outline: false,
        content: '<pre><code>second</code></pre>',
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.otherCodeSettingsEditor));
  const firstCard = first.locator(".semlo-editor-code-card");
  await firstCard.locator("code").click();
  const firstMenu = await openSettings(page, firstCard);
  await firstMenu.getByRole("menuitem", { name: "自动缩进" }).click();
  await expect(page.getByRole("status")).toHaveText("自动缩进成功");
  const secondCard = page.locator("#other-code-settings-test .semlo-editor-code-card");
  await secondCard.locator("code").click();
  const secondMenu = await openSettings(page, secondCard);
  await secondMenu.getByRole("menuitem", { name: "隐藏全文代码块标题栏" }).click();
  await expect(page.getByRole("status")).toHaveText("成功");
  await page.evaluate(() => window.__semloRequireFixture("codeSettingsEditor").destroy());
  await expect(page.getByRole("status")).toHaveText("成功");
  await page.evaluate(() => window.__semloRequireFixture("otherCodeSettingsEditor").destroy());
  await expect(page.getByRole("status")).toHaveCount(0);
});

test("all settings stay keyboard-accessible in a short viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 250 });
  const host = await mount(page);
  const card = host.locator(".semlo-editor-code-card");
  await card.locator("code").click();
  const menu = await openSettings(page, card);
  await menu.getByRole("menuitem", { name: "字号" }).focus();
  await page.keyboard.press("ArrowRight");
  const submenu = page.getByRole("menu", { name: "字号", exact: true });
  await expect(submenu).toBeVisible();
  await page.keyboard.press("End");
  const lastFont = submenu.getByRole("menuitemradio", { name: "22px" });
  await expect(lastFont).toBeFocused();
  const submenuBounds = await submenu.boundingBox();
  const lastFontBounds = await lastFont.boundingBox();
  expect(lastFontBounds!.y).toBeGreaterThanOrEqual(submenuBounds!.y);
  expect(lastFontBounds!.y + lastFontBounds!.height).toBeLessThanOrEqual(submenuBounds!.y + submenuBounds!.height);
  await page.keyboard.press("Enter");
  await expect(card.locator("code")).toHaveCSS("font-size", "22px");
  await page.keyboard.press("ArrowLeft");
  await expect(submenu).toBeHidden();
  const last = menu.getByRole("menuitem", { name: "隐藏全文代码块标题栏" });
  await page.keyboard.press("End");
  await expect(last).toBeFocused();
  const menuBounds = await menu.boundingBox();
  const lastBounds = await last.boundingBox();
  expect(lastBounds!.y).toBeGreaterThanOrEqual(menuBounds!.y);
  expect(lastBounds!.y + lastBounds!.height).toBeLessThanOrEqual(menuBounds!.y + menuBounds!.height);
  await page.keyboard.press("Enter");
  await expect(card.locator(".semlo-editor-code-header")).toBeHidden();
  await expect(page.getByRole("status")).toHaveText("成功");
});

test("settings stay open, update the code, round-trip HTML and JSON, and undo independently", async ({ page }) => {
  const host = await mount(page);
  const card = host.locator(".semlo-editor-code-card");
  const menu = await openSettings(page, card);
  expect((await menu.boundingBox())!.width).toBeCloseTo(220, 0);
  await expect(menu.getByRole("menuitem", { name: "字号" })).toHaveCSS("min-height", "36px");
  for (const label of ["字号", "缩进模式", "缩进宽度"])
    await expect(menu.getByRole("menuitem", { name: label, exact: true })).toHaveText(label);
  await choose(page, menu, "字号", "16px");
  await expect(card.locator(".semlo-editor-code-body code")).toHaveCSS("font-size", "16px");
  await choose(page, menu, "缩进模式", "Tab");
  await choose(page, menu, "缩进宽度", "4");
  await expect(card.locator(".semlo-editor-code-body pre")).toHaveCSS("tab-size", "4");
  await menu.getByRole("menuitemcheckbox", { name: "自动换行" }).click();
  await menu.getByRole("menuitemcheckbox", { name: "行号" }).click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole("menuitemcheckbox", { name: "自动换行" })).toHaveAttribute("aria-checked", "true");
  await expect(card.locator(".semlo-editor-code-numbers")).toBeHidden();
  await expect(card.locator(".semlo-editor-code-body pre")).toHaveCSS("white-space", "pre-wrap");
  const saved = await page.evaluate(() => window.__semloRequireFixture("codeSettingsEditor").getSnapshot());
  const block = saved.json.content?.find((node) => node.type === "codeBlock");
  expect(block?.attrs).toMatchObject({
    codeFontSize: 16,
    indentMode: "tab",
    indentWidth: 4,
    wordWrap: true,
    showLineNumbers: false,
  });
  expect(saved.html).toContain('data-code-font-size="16"');
  expect(saved.html).toContain('data-code-indent-mode="tab"');
  expect(saved.html).toContain('data-code-indent-width="4"');
  expect(saved.html).toContain('data-code-wrap="true"');
  expect(saved.html).toContain('data-code-line-numbers="false"');

  expect(await page.evaluate(() => window.__semloRequireFixture("codeSettingsEditor").editor.commands.undo())).toBe(
    true,
  );
  await expect(card.locator(".semlo-editor-code-numbers")).toBeVisible();
  await expect(menu.getByRole("menuitemcheckbox", { name: "行号" })).toHaveAttribute("aria-checked", "true");
  expect(await page.evaluate(() => window.__semloRequireFixture("codeSettingsEditor").editor.commands.redo())).toBe(
    true,
  );
  await expect(card.locator(".semlo-editor-code-numbers")).toBeHidden();
  await page.evaluate((html) => window.__semloRequireFixture("codeSettingsEditor").setContent(html), saved.html);
  await expect(card.locator(".semlo-editor-code-body code")).toHaveCSS("font-size", "16px");
  await expect(card.locator(".semlo-editor-code-numbers")).toBeHidden();
  await page.evaluate((json) => window.__semloRequireFixture("codeSettingsEditor").setContent(json), saved.json);
  await expect(card.locator(".semlo-editor-code-body pre")).toHaveCSS("white-space", "pre-wrap");
  await expect(card.locator(".semlo-editor-code-numbers")).toBeHidden();

  const again = await openSettings(page, card);
  await choose(page, again, "字号", "跟随正文");
  await host.locator(".semlo-editor-prose").evaluate((prose) => ((prose as HTMLElement).style.fontSize = "19px"));
  await expect(card.locator(".semlo-editor-code-body code")).toHaveCSS("font-size", "19px");
  expect((await page.evaluate(() => window.__semloRequireFixture("codeSettingsEditor").getSnapshot())).html).toContain(
    'data-code-font-size="inherit"',
  );
});

test("wrapped logical lines keep their gutter numbers aligned when the editor is resized", async ({ page }) => {
  const long = "a".repeat(100);
  const host = await mount(page, `<pre><code>${long}\nsecond\nthird</code></pre>`);
  await host.evaluate((element) => ((element as HTMLElement).style.width = "420px"));
  const card = host.locator(".semlo-editor-code-card");
  const menu = await openSettings(page, card);
  await menu.getByRole("menuitemcheckbox", { name: "自动换行" }).click();
  const numbers = card.locator(".semlo-editor-code-numbers");
  await expect(numbers.locator(".semlo-editor-code-number-line")).toHaveCount(3);
  await expect(numbers).toHaveText("1\n2\n3");
  const before = await numbers
    .locator(".semlo-editor-code-number-line")
    .first()
    .evaluate((element) => element.clientHeight);
  expect(before).toBeGreaterThan(30);
  const alignment = await card.evaluate((element) => {
    const code = element.querySelector("code")!;
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    const first = walker.nextNode()!;
    const text = first.textContent!;
    const firstLine = document.createRange();
    firstLine.setStart(first, 0);
    firstLine.setEnd(first, 1);
    const secondLine = document.createRange();
    secondLine.setStart(first, text.indexOf("\n") + 1);
    secondLine.setEnd(first, text.indexOf("\n") + 2);
    const rows = element.querySelectorAll(".semlo-editor-code-number-line");
    return (
      rows[1].getBoundingClientRect().top -
      rows[0].getBoundingClientRect().top -
      (secondLine.getBoundingClientRect().top - firstLine.getBoundingClientRect().top)
    );
  });
  expect(Math.abs(alignment)).toBeLessThan(2);
  await host.evaluate((element) => ((element as HTMLElement).style.width = "700px"));
  await expect
    .poll(() =>
      numbers
        .locator(".semlo-editor-code-number-line")
        .first()
        .evaluate((element) => element.clientHeight),
    )
    .toBeLessThan(before);
});

test("sync keeps titles and can preserve language; its transaction is undoable", async ({ page }) => {
  const host = await mount(
    page,
    '<pre data-title="first" data-theme="dark" data-code-font-size="16" data-code-indent-mode="tab" data-code-indent-width="4" data-code-wrap="true" data-code-line-numbers="false"><code class="language-javascript">const first = 1</code></pre><p>middle</p><pre data-title="second" data-theme="light" data-collapsed="true"><code class="language-python">print(2)</code></pre>',
  );
  const cards = host.locator(".semlo-editor-code-card");
  const menu = await openSettings(page, cards.first());
  await expect(menu).toHaveCSS("background-color", "rgb(40, 45, 54)");
  await menu.getByRole("menuitem", { name: "同步样式到全文", exact: true }).click();
  await expect(menu).toBeVisible();
  let blocks = await page.evaluate(() =>
    window
      .__semloRequireFixture("codeSettingsEditor")
      .getSnapshot()
      .json.content!.filter((n) => n.type === "codeBlock"),
  );
  expect(blocks[1].attrs).toMatchObject({
    title: "second",
    language: "python",
    theme: "dark",
    codeFontSize: 16,
    indentMode: "tab",
    indentWidth: 4,
    wordWrap: true,
    showLineNumbers: false,
    collapsed: true,
  });
  expect(await page.evaluate(() => window.__semloRequireFixture("codeSettingsEditor").editor.commands.undo())).toBe(
    true,
  );
  blocks = await page.evaluate(() =>
    window
      .__semloRequireFixture("codeSettingsEditor")
      .getSnapshot()
      .json.content!.filter((n) => n.type === "codeBlock"),
  );
  expect(blocks[1].attrs).toMatchObject({ title: "second", language: "python", theme: "light", codeFontSize: 14 });
  expect(await page.evaluate(() => window.__semloRequireFixture("codeSettingsEditor").editor.commands.redo())).toBe(
    true,
  );
  await menu.getByRole("menuitem", { name: "同步样式与语言到全文", exact: true }).click();
  blocks = await page.evaluate(() =>
    window
      .__semloRequireFixture("codeSettingsEditor")
      .getSnapshot()
      .json.content!.filter((n) => n.type === "codeBlock"),
  );
  expect(blocks[1].attrs).toMatchObject({ title: "second", language: "javascript", theme: "dark" });
  expect(await page.evaluate(() => window.__semloRequireFixture("codeSettingsEditor").editor.commands.undo())).toBe(
    true,
  );
  blocks = await page.evaluate(() =>
    window
      .__semloRequireFixture("codeSettingsEditor")
      .getSnapshot()
      .json.content!.filter((n) => n.type === "codeBlock"),
  );
  expect(blocks[1].attrs).toMatchObject({ title: "second", language: "python", theme: "dark" });
});

test("new blocks inherit settings within one editor and stay isolated from another", async ({ page }) => {
  const host = await mount(page);
  const card = host.locator(".semlo-editor-code-card").first();
  const menu = await openSettings(page, card);
  await choose(page, menu, "字号", "19px");
  await choose(page, menu, "缩进模式", "Tab");
  await menu.getByRole("menuitemcheckbox", { name: "自动换行" }).click();
  await menu.press("Escape");
  await card.getByRole("button", { name: "代码主题" }).click();
  await page.getByRole("option", { name: "One Dark Pro", exact: true }).click();
  await card.getByRole("button", { name: "代码语言" }).click();
  await card.getByRole("combobox", { name: "搜索代码语言" }).fill("python");
  await page.getByRole("option", { name: "Python", exact: true }).click();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("codeSettingsEditor").editor;
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: "paragraph" });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.commands.toggleCodeBlock();
  });
  const blocks = await page.evaluate(() =>
    window
      .__semloRequireFixture("codeSettingsEditor")
      .getSnapshot()
      .json.content!.filter((n) => n.type === "codeBlock"),
  );
  expect(blocks[1].attrs).toMatchObject({
    codeFontSize: 19,
    indentMode: "tab",
    wordWrap: true,
    language: "python",
    theme: "dark",
  });
  await expect(host.locator(".semlo-editor-code-card").nth(1).locator(".semlo-editor-code-numbers")).toHaveText("1");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("codeSettingsEditor").editor;
    editor.commands.insertContentAt(editor.state.doc.content.size, { type: "paragraph" });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    editor.view.focus();
  });
  await page.keyboard.type("``` ");
  const inputRuleBlocks = await page.evaluate(() =>
    window
      .__semloRequireFixture("codeSettingsEditor")
      .getSnapshot()
      .json.content!.filter((node) => node.type === "codeBlock"),
  );
  expect(inputRuleBlocks).toHaveLength(3);
  expect(inputRuleBlocks[2].attrs).toMatchObject({
    codeFontSize: 19,
    indentMode: "tab",
    wordWrap: true,
    language: "python",
    theme: "dark",
  });
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'other-code-settings-test'
      document.body.append(host)
      window.otherCodeSettingsEditor = createEditor({ element: host, outline: false, content: '<p>other</p>' })
      window.otherCodeSettingsEditor.editor.commands.toggleCodeBlock()
    `,
  });
  await page.waitForFunction(() => Boolean(window.otherCodeSettingsEditor));
  const other = await page.evaluate(() =>
    window
      .__semloRequireFixture("otherCodeSettingsEditor")
      .getSnapshot()
      .json.content!.find((n) => n.type === "codeBlock"),
  );
  expect(other?.attrs).toMatchObject({
    codeFontSize: 14,
    indentMode: "space",
    indentWidth: 2,
    wordWrap: false,
    showLineNumbers: true,
  });
  const otherHost = page.locator("#other-code-settings-test");
  const otherCard = otherHost.locator(".semlo-editor-code-card");
  const otherMenu = await openSettings(page, otherCard);
  await otherMenu.getByRole("menuitemcheckbox", { name: "行号" }).click();
  expect(
    (await page.evaluate(() => window.__semloRequireFixture("codeSettingsEditor").getSnapshot())).json.content?.find(
      (node) => node.type === "codeBlock",
    )?.attrs?.showLineNumbers,
  ).toBe(true);
  const firstMenu = await openSettings(page, host.locator(".semlo-editor-code-card").first());
  await expect(otherCard.getByRole("button", { name: "代码块更多设置" })).toHaveAttribute("aria-expanded", "false");
  await page.evaluate(() => window.__semloRequireFixture("otherCodeSettingsEditor").destroy());
  await expect(firstMenu).toBeVisible();
});

test("menus fit small viewports and close on read-only transition or destruction", async ({ page }) => {
  await page.setViewportSize({ width: 480, height: 360 });
  const host = await mount(page);
  await host.evaluate((element) => ((element as HTMLElement).style.width = "460px"));
  const card = host.locator(".semlo-editor-code-card");
  const menu = await openSettings(page, card);
  const trigger = menu.getByRole("menuitem", { name: "缩进宽度" });
  await trigger.hover();
  const submenu = page.getByRole("menu", { name: "缩进宽度" });
  await expect(submenu).toBeVisible();
  for (const popup of [menu, submenu]) {
    const rect = (await popup.boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(7);
    expect(rect.x + rect.width).toBeLessThanOrEqual(473);
    expect(rect.y).toBeGreaterThanOrEqual(7);
    expect(rect.y + rect.height).toBeLessThanOrEqual(353);
  }
  await page.evaluate(() => window.__semloRequireFixture("codeSettingsEditor").setEditable(false));
  await expect(menu).toHaveCount(0);
  await expect(submenu).toHaveCount(0);
  await expect(card.getByRole("button", { name: "代码块更多设置" })).toBeDisabled();
  await page.evaluate(() => window.__semloRequireFixture("codeSettingsEditor").setEditable(true));
  await openSettings(page, card);
  await page.evaluate(() => window.__semloRequireFixture("codeSettingsEditor").destroy());
  await expect(page.locator(".semlo-editor-code-settings-menu, .semlo-editor-code-settings-submenu")).toHaveCount(0);
});

test("more control hides on blur and remains visible for keyboard and open menus", async ({ page }) => {
  const host = await mount(page);
  const card = host.locator(".semlo-editor-code-card");
  const more = card.locator(".semlo-editor-code-more");
  await page.mouse.move(1, 1);
  await expect(more).toHaveCSS("opacity", "0");
  await expect(more).toHaveCSS("pointer-events", "none");
  await card.getByRole("button", { name: "收起代码块" }).focus();
  await expect(more).toHaveCSS("opacity", "1");
  for (let index = 0; index < 5; index += 1) await page.keyboard.press("Tab");
  await expect(more).toBeFocused();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "代码块设置" });
  await expect(menu).toBeVisible();
  await page.mouse.move(1, 1);
  await expect(more).toHaveCSS("opacity", "1");
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await expect(more).toHaveCSS("opacity", "0");
});
