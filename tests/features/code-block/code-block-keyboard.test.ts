import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    codeKeyboardEditor?: EditorController;
    codeKeyboardSecondEditor?: EditorController;
  }
}

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'code-keyboard-test'
      document.body.prepend(host)
      window.codeKeyboardEditor = createEditor({
        element: host,
        outline: false,
        content: {
          type: 'doc', content: [
            { type: 'paragraph', content: [{ type: 'text', text: 'before' }] },
            { type: 'codeBlock', content: [{ type: 'text', text: 'abc\\ndef\\nghi' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'after' }] },
          ],
        },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.codeKeyboardEditor));
  return page.locator("#code-keyboard-test");
}

async function selection(page: Page, from: number, to = from) {
  await page.evaluate(
    ({ from, to }) => {
      const editor = window.__semloRequireFixture("codeKeyboardEditor").editor;
      let start = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "codeBlock" && start < 0) start = pos + 1;
      });
      if (start < 0) throw new Error("Missing code block");
      editor.view.focus();
      editor.commands.setTextSelection({ from: start + from, to: start + to });
    },
    { from, to },
  );
}

async function state(page: Page) {
  return page.evaluate(() => {
    const editor = window.__semloRequireFixture("codeKeyboardEditor").editor;
    let start = -1;
    let text = "";
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "codeBlock" && start < 0) {
        start = pos + 1;
        text = node.textContent;
      }
    });
    const { from, to, anchor, head } = editor.state.selection;
    return { text, from: from - start, to: to - start, anchor: anchor - start, head: head - start };
  });
}

async function setIndent(page: Page, indentMode: "space" | "tab", indentWidth: 2 | 4 | 8) {
  await selection(page, 0);
  await page.evaluate(
    (attrs) => window.__semloRequireFixture("codeKeyboardEditor").editor.commands.updateAttributes("codeBlock", attrs),
    {
      indentMode,
      indentWidth,
    },
  );
}

async function setCode(
  page: Page,
  text: string,
  attrs: { language?: string; indentMode?: "space" | "tab"; indentWidth?: 2 | 4 | 8 } = {},
) {
  await page.evaluate(
    ({ text, attrs }) =>
      window.__semloRequireFixture("codeKeyboardEditor").editor.commands.setContent({
        type: "doc",
        content: [{ type: "codeBlock", attrs, content: text ? [{ type: "text", text }] : [] }],
      }),
    { text, attrs },
  );
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("Tab at a code cursor inserts a literal tab and remains undoable", async ({ page }) => {
  await mount(page);
  await selection(page, 2);
  await page.keyboard.press("Tab");
  expect(await state(page)).toMatchObject({ text: "ab\tc\ndef\nghi", from: 3, to: 3 });
  expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await state(page)).text).toBe("abc\ndef\nghi");
  expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.commands.redo())).toBe(
    true,
  );
  expect((await state(page)).text).toBe("ab\tc\ndef\nghi");
});

test("Tab and Shift+Tab indent selected lines while retaining their selected text", async ({ page }) => {
  await mount(page);
  await selection(page, 1, 2);
  await page.keyboard.press("Tab");
  expect(await state(page)).toMatchObject({ text: "  abc\ndef\nghi", from: 3, to: 4 });
  expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.commands.undo())).toBe(
    true,
  );

  await selection(page, 0, 11);
  await page.keyboard.press("Tab");
  expect(await state(page)).toMatchObject({ text: "  abc\n  def\n  ghi", from: 2, to: 17 });
  await page.keyboard.press("Shift+Tab");
  expect(await state(page)).toMatchObject({ text: "abc\ndef\nghi", from: 0, to: 11 });
  expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await state(page)).text).toBe("  abc\n  def\n  ghi");
  expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await state(page)).text).toBe("abc\ndef\nghi");
});

test("Shift+Tab at a cursor removes one tab or up to two leading spaces", async ({ page }) => {
  await mount(page);
  await page.evaluate(() =>
    window.__semloRequireFixture("codeKeyboardEditor").editor.commands.setContent({
      type: "doc",
      content: [{ type: "codeBlock", content: [{ type: "text", text: "\tabc\n  def\nghi" }] }],
    }),
  );
  await selection(page, 3);
  await page.keyboard.press("Shift+Tab");
  expect(await state(page)).toMatchObject({ text: "abc\n  def\nghi", from: 2, to: 2 });
  await selection(page, 7);
  await page.keyboard.press("Shift+Tab");
  expect(await state(page)).toMatchObject({ text: "abc\ndef\nghi", from: 5, to: 5 });
});

test("a selection ending at the next line start only indents the preceding line", async ({ page }) => {
  await mount(page);
  await selection(page, 0, 4);
  await page.keyboard.press("Tab");
  expect(await state(page)).toMatchObject({ text: "  abc\ndef\nghi", from: 2, to: 6 });
});

test("indent keeps the direction of a backward selection", async ({ page }) => {
  await mount(page);
  await selection(page, 7, 1);
  await page.keyboard.press("Tab");
  expect(await state(page)).toMatchObject({ text: "  abc\n  def\nghi", anchor: 11, head: 3 });
});

for (const width of [4, 8] as const) {
  test(`space mode indents and outdents selected lines by ${width} spaces`, async ({ page }) => {
    await mount(page);
    await setIndent(page, "space", width);
    await selection(page, 0, 11);
    await page.keyboard.press("Tab");
    const prefix = " ".repeat(width);
    const indented = `${prefix}abc\n${prefix}def\n${prefix}ghi`;
    expect(await state(page)).toMatchObject({ text: indented, from: width, to: 11 + width * 3 });
    await page.keyboard.press("Shift+Tab");
    expect((await state(page)).text).toBe("abc\ndef\nghi");
    expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await state(page)).text).toBe(indented);
    expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.commands.redo())).toBe(
      true,
    );
    expect((await state(page)).text).toBe("abc\ndef\nghi");
  });
}

test("tab mode indents selected lines with tabs and a cursor still inserts one tab", async ({ page }) => {
  await mount(page);
  await setIndent(page, "tab", 8);
  await selection(page, 0, 11);
  await page.keyboard.press("Tab");
  expect(await state(page)).toMatchObject({ text: "\tabc\n\tdef\n\tghi", from: 1, to: 14 });
  await page.keyboard.press("Shift+Tab");
  expect((await state(page)).text).toBe("abc\ndef\nghi");
  await selection(page, 2);
  await page.keyboard.press("Tab");
  expect((await state(page)).text).toBe("ab\tc\ndef\nghi");
});

test("code settings menu changes actual selection indentation and keeps it undoable", async ({ page }) => {
  const host = await mount(page);
  const more = host.getByRole("button", { name: "代码块更多设置" });
  const choose = async (group: "缩进模式" | "缩进宽度", value: string) => {
    await host.locator(".semlo-editor-code-card").hover();
    await more.click();
    const menu = page.getByRole("menu", { name: "代码块设置" });
    await menu.getByRole("menuitem", { name: group }).click();
    const choices = page.getByRole("menu", { name: group });
    await choices.getByRole("menuitemradio", { name: value, exact: true }).click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  };

  await choose("缩进宽度", "4");
  await selection(page, 0, 11);
  await page.keyboard.press("Tab");
  expect((await state(page)).text).toBe("    abc\n    def\n    ghi");
  expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await state(page)).text).toBe("abc\ndef\nghi");

  await choose("缩进模式", "Tab");
  await selection(page, 0, 11);
  await page.keyboard.press("Tab");
  expect((await state(page)).text).toBe("\tabc\n\tdef\n\tghi");
  expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.commands.undo())).toBe(
    true,
  );
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.getJSON());
  expect(snapshot.content?.find((node) => node.type === "codeBlock")?.attrs).toMatchObject({
    indentMode: "tab",
    indentWidth: 4,
  });
  expect((await state(page)).text).toBe("abc\ndef\nghi");
});

for (const mode of ["space", "tab"] as const) {
  test(`${mode} mode outdents mixed tabs and spaces consistently`, async ({ page }) => {
    await mount(page);
    await page.evaluate(() =>
      window.__semloRequireFixture("codeKeyboardEditor").editor.commands.setContent({
        type: "doc",
        content: [{ type: "codeBlock", content: [{ type: "text", text: "\tabc\n  def\n ghi\nnop" }] }],
      }),
    );
    await setIndent(page, mode, 2);
    await selection(page, 0, 19);
    await page.keyboard.press("Shift+Tab");
    expect((await state(page)).text).toBe("abc\ndef\nghi\nnop");
  });
}

test("three Enters at the end stay in the code block", async ({ page }) => {
  await mount(page);
  await selection(page, 11);
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  expect((await state(page)).text).toBe("abc\ndef\nghi\n\n\n");
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("codeKeyboardEditor").editor.state.selection.$from.parent.type.name,
    ),
  ).toBe("codeBlock");
  expect(
    await page.evaluate(() =>
      window
        .__semloRequireFixture("codeKeyboardEditor")
        .editor.getJSON()
        .content?.map((node) => node.type),
    ),
  ).toEqual(["paragraph", "codeBlock", "paragraph"]);
});

test("JavaScript Enter indents, splits matching brackets, and removes whitespace from empty lines", async ({
  page,
}) => {
  await mount(page);
  await setCode(page, "if (x) {}", { language: "javascript", indentMode: "space", indentWidth: 2 });
  await selection(page, 8);
  await page.keyboard.press("Enter");
  expect(await state(page)).toMatchObject({ text: "if (x) {\n  \n}", from: 11, to: 11 });
  expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await state(page)).toMatchObject({ text: "if (x) {}", from: 8, to: 8 });
  expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.commands.redo())).toBe(
    true,
  );
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  expect(await state(page)).toMatchObject({ text: "if (x) {\n\n\n  \n}", from: 13, to: 13 });
});

test("Enter uses the selected language and configured indentation, rather than counting braces in strings", async ({
  page,
}) => {
  await mount(page);
  await setCode(page, "if (x) {", { language: "javascript", indentMode: "tab", indentWidth: 4 });
  await selection(page, 8);
  await page.keyboard.press("Enter");
  expect(await state(page)).toMatchObject({ text: "if (x) {\n\t", from: 10 });

  await setCode(page, 'const brace = "{"', { language: "javascript", indentMode: "space", indentWidth: 4 });
  await selection(page, 17);
  await page.keyboard.press("Enter");
  expect((await state(page)).text).toBe('const brace = "{"\n');

  await setCode(page, "if ready:", { language: "python", indentMode: "space", indentWidth: 4 });
  await selection(page, 9);
  await page.keyboard.press("Enter");
  expect(await state(page)).toMatchObject({ text: "if ready:\n    ", from: 14 });
});

test("Enter replaces a selection in code and respects UTF-16 positions", async ({ page }) => {
  await mount(page);
  await setCode(page, "if (x) {\n  😀value\n}", { language: "javascript" });
  await selection(page, 11, 18);
  await page.keyboard.press("Enter");
  expect(await state(page)).toMatchObject({ text: "if (x) {\n  \n  \n}", from: 14, to: 14 });
  expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await state(page)).text).toBe("if (x) {\n  😀value\n}");
});

test("JSON, Rust and unknown languages keep code and place the cursor after Enter", async ({ page }) => {
  await mount(page);
  for (const [language, text, caret, expected, next] of [
    ["json", "{}", 1, "{\n  \n}", 4],
    ["rust", "fn main() {}", 11, "fn main() {\n  \n}", 14],
    ["unknown-language", "{}", 1, "{\n\n}", 2],
  ] as const) {
    await setCode(page, text, { language });
    await selection(page, caret);
    await page.keyboard.press("Enter");
    expect(await state(page)).toMatchObject({ text: expected, from: next, to: next });
    expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await state(page)).text).toBe(text);
  }
});

test("plain text Enter preserves existing indentation and splits paired brackets", async ({ page }) => {
  await mount(page);
  await setCode(page, "    alpha", { language: "plaintext", indentMode: "space", indentWidth: 2 });
  await selection(page, 9);
  await page.keyboard.press("Enter");
  expect(await state(page)).toMatchObject({ text: "    alpha\n    ", from: 14, to: 14 });

  await setCode(page, "\talpha", { language: "plaintext", indentMode: "space", indentWidth: 2 });
  await selection(page, 6);
  await page.keyboard.press("Enter");
  expect(await state(page)).toMatchObject({ text: "\talpha\n  ", from: 9, to: 9 });

  await setCode(page, "if (x) {}", { language: "plaintext" });
  await selection(page, 8);
  await page.keyboard.press("Enter");
  expect(await state(page)).toMatchObject({ text: "if (x) {\n\n}", from: 9, to: 9 });
});

test("plain text automatic indentation follows the observed first-line rule", async ({ page }) => {
  await mount(page);
  await setCode(page, "    alpha\n      beta", { language: "plaintext", indentMode: "space", indentWidth: 2 });
  await selection(page, 9);
  await page.keyboard.press("ControlOrMeta+Shift+F");
  expect((await state(page)).text).toBe("alpha\n      beta");
  await expect(page.getByText("自动缩进成功", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await state(page)).text).toBe("    alpha\n      beta");
});

test("automatic indentation shortcut reformats the whole block, preserves a backward selection and undoes atomically", async ({
  page,
}) => {
  const host = await mount(page);
  const original = "function foo(){\nlet x=1;\nif(x){\nconsole.log(x);\n}\n}";
  const formatted = "function foo(){\n  let x=1;\n  if(x){\n    console.log(x);\n  }\n}";
  await setCode(page, original, { language: "javascript", indentMode: "space", indentWidth: 2 });
  const from = original.indexOf("console");
  await selection(page, from + "console".length, from);
  await page.keyboard.press("ControlOrMeta+Shift+F");
  const result = await state(page);
  expect(result.text).toBe(formatted);
  expect(result.anchor).toBeGreaterThan(result.head);
  expect(result.text.slice(result.head, result.anchor)).toBe("console");
  await expect(page.getByText("自动缩进成功", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await state(page)).text).toBe(original);
  expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.commands.redo())).toBe(
    true,
  );
  expect((await state(page)).text).toBe(formatted);
  await expect(host.locator(".semlo-editor-code-card")).toHaveCount(1);
});

test("destroying an editor only removes its own keyboard feedback", async ({ page }) => {
  await mount(page);
  await setCode(page, "if (x) {\nrun()\n}", { language: "javascript" });
  await selection(page, 0);
  await page.keyboard.press("ControlOrMeta+Shift+F");
  await expect(page.getByText("自动缩进成功", { exact: true })).toBeVisible();
  await page
    .locator(".semlo-editor-code-feedback")
    .evaluate((element) => element.setAttribute("data-first-editor", "yes"));
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'code-keyboard-second'
      document.body.append(host)
      window.codeKeyboardSecondEditor = createEditor({
        element: host,
        outline: false,
        content: { type: 'doc', content: [{ type: 'codeBlock', content: [{ type: 'text', text: 'abc' }] }] },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.codeKeyboardSecondEditor));
  await page.locator("#code-keyboard-second .semlo-editor-prose").click();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("codeKeyboardSecondEditor").editor;
    editor.commands.setTextSelection(1);
  });
  await page.keyboard.press("ControlOrMeta+Shift+F");
  await expect(page.getByText("自动缩进成功", { exact: true })).toHaveCount(1);
  await expect(page.locator(".semlo-editor-code-feedback")).not.toHaveAttribute("data-first-editor", "yes");
  await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").destroy());
  await expect(page.getByText("自动缩进成功", { exact: true })).toBeVisible();
  await page.evaluate(() => window.__semloRequireFixture("codeKeyboardSecondEditor").destroy());
  await expect(page.getByText("自动缩进成功", { exact: true })).toHaveCount(0);
});

test("automatic indentation uses a complete syntax tree beyond CodeMirror's initial parse window", async ({ page }) => {
  await mount(page);
  const original = "if (x) {\nconsole.log(x);\n}\n".repeat(250);
  await setCode(page, original, { language: "javascript" });
  await selection(page, original.length);
  await page.keyboard.press("ControlOrMeta+Shift+F");
  await expect.poll(async () => (await state(page)).text).toBe("if (x) {\n  console.log(x);\n}\n".repeat(250));
  expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await state(page)).text).toBe(original);
});

test("Enter and automatic indentation preserve existing code text-style marks", async ({ page }) => {
  await mount(page);
  await page.evaluate(() =>
    window.__semloRequireFixture("codeKeyboardEditor").editor.commands.setContent({
      type: "doc",
      content: [
        {
          type: "codeBlock",
          attrs: { language: "javascript" },
          content: [
            {
              type: "text",
              text: "if (x) {\nconsole.log(x)\n}",
              marks: [{ type: "textStyle", attrs: { color: "#123456" } }],
            },
          ],
        },
      ],
    }),
  );
  await selection(page, 8);
  await page.keyboard.press("ControlOrMeta+Shift+F");
  await selection(page, 8);
  await page.keyboard.press("Enter");
  const content = await page.evaluate(
    () => window.__semloRequireFixture("codeKeyboardEditor").editor.getJSON().content?.[0]?.content ?? [],
  );
  const marked = content.filter(
    (node) => "text" in node && typeof node.text === "string" && node.text.includes("console.log"),
  );
  expect(marked).toHaveLength(1);
  expect(marked[0].marks?.find((mark) => mark.type === "textStyle")?.attrs?.color).toBe("#123456");
});

test("composition, mixed-node selections and read-only state do not alter code on Tab", async ({ page }) => {
  const host = await mount(page);
  await selection(page, 2);
  await host
    .locator(".semlo-editor-prose")
    .evaluate((element) =>
      element.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true, isComposing: true }),
      ),
    );
  expect((await state(page)).text).toBe("abc\ndef\nghi");

  await page.evaluate(() => {
    window.__semloRequireFixture("codeKeyboardEditor").editor.commands.focus();
    window.__semloRequireFixture("codeKeyboardEditor").editor.commands.setTextSelection({ from: 2, to: 12 });
  });
  const before = await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.getJSON());
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.getJSON())).toEqual(
    before,
  );

  await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").setEditable(false));
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.getJSON())).toEqual(
    before,
  );
});

test("composition and read-only states do not handle code Enter or the indentation shortcut", async ({ page }) => {
  const host = await mount(page);
  await setCode(page, "if (x) {}", { language: "javascript" });
  await selection(page, 8);
  const before = await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.getJSON());
  for (const key of ["Enter", "F"]) {
    const wasNotPrevented = await host.locator(".semlo-editor-prose").evaluate(
      (element, key) =>
        element.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
            isComposing: true,
            metaKey: key === "F",
            shiftKey: key === "F",
          }),
        ),
      key,
    );
    expect(wasNotPrevented).toBe(true);
  }
  expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.getJSON())).toEqual(
    before,
  );
  await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").setEditable(false));
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+Shift+F");
  expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.getJSON())).toEqual(
    before,
  );
});

test("PHP tagged nested Enter matches Yuque", async ({ page }) => {
  await installFixtureGuards(page);
  const host = await mount(page);
  const input = "<?php\nif (true) {\nif (true) {";
  await page.evaluate(
    (text) =>
      window.__semloRequireFixture("codeKeyboardEditor").setContent({
        type: "doc",
        content: [{ type: "codeBlock", attrs: { language: "php" }, content: [{ type: "text", text }] }],
      }),
    input,
  );
  await selection(page, input.length);
  await page.keyboard.press("Enter");
  await expect(host.locator("code")).toHaveText(`${input}\n  `);
});

test("active composition with unflagged keys leaves the code unchanged", async ({ page }) => {
  const host = await mount(page);
  await setCode(page, "if (x) {}", { language: "javascript" });
  await selection(page, 8);
  const before = await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.getJSON());
  const result = await host.locator(".semlo-editor-prose").evaluate((element) => {
    // Synthetic composition verifies event routing; it does not emulate an OS input method.
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const composing = window.__semloRequireFixture("codeKeyboardEditor").editor.view.composing;
    const unprevented = ["Enter", "Tab", "F"].map((key) =>
      element.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          bubbles: true,
          cancelable: true,
          metaKey: key === "F",
          shiftKey: key === "F",
        }),
      ),
    );
    element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    return { unprevented, composing };
  });
  expect(result.composing).toBe(true);
  expect(result.unprevented).toEqual([true, true, true]);
  expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.getJSON())).toEqual(
    before,
  );
});

test("IME keyCode 229 does not invoke code shortcuts", async ({ page }) => {
  const host = await mount(page);
  await setCode(page, "if (x) {}", { language: "javascript" });
  await selection(page, 8);
  const before = await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.getJSON());
  const result = await host.locator(".semlo-editor-prose").evaluate((element) =>
    ["Enter", "Tab", "F"].map((key) => {
      const event = new KeyboardEvent("keydown", {
        key,
        keyCode: 229,
        bubbles: true,
        cancelable: true,
        metaKey: key === "F",
        shiftKey: key === "F",
      });
      return { keyCode: event.keyCode, unprevented: element.dispatchEvent(event) };
    }),
  );
  expect(result).toEqual(Array.from({ length: 3 }, () => ({ keyCode: 229, unprevented: true })));
  expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.getJSON())).toEqual(
    before,
  );
});

test("destroy during indentation update does not raise an error", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mount(page);
  await selection(page, 2);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("codeKeyboardEditor").editor;
    editor.on("update", () => editor.destroy());
  });
  await page.keyboard.press("Tab");
  expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.isDestroyed)).toBe(true);
  expect(errors).toEqual([]);
});

test("controller cleanup after reentrant code editor destruction", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mount(page);
  await selection(page, 2);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("codeKeyboardEditor").editor;
    editor.on("update", () => editor.destroy());
  });
  await page.keyboard.press("Tab");
  const result = await page.evaluate(() => {
    const controller = window.__semloRequireFixture("codeKeyboardEditor");
    const wasDestroyed = controller.editor.isDestroyed;
    try {
      controller.destroy();
      return { wasDestroyed, outcome: "ok" };
    } catch (error) {
      return { wasDestroyed, outcome: String(error) };
    }
  });
  expect(result.wasDestroyed).toBe(true);
  expect(result.outcome).toBe("ok");
  expect(errors).toEqual([]);
});

test("Markdown Enter continues lists, tasks and quotes like the reference editor", async ({ page }) => {
  await mount(page);
  const samples = [
    { source: "- first item", position: 12, expected: "- first item\n- ", expectedPosition: 15 },
    { source: "+ item", position: 6, expected: "+ item\n+ ", expectedPosition: 9 },
    { source: "* item", position: 6, expected: "* item\n* ", expectedPosition: 9 },
    { source: "1. first", position: 8, expected: "1. first\n2. ", expectedPosition: 12 },
    { source: "3) third", position: 8, expected: "3) third\n4) ", expectedPosition: 12 },
    { source: "> quote", position: 7, expected: "> quote\n> ", expectedPosition: 10 },
    { source: "> - nested", position: 10, expected: "> - nested\n> - ", expectedPosition: 15 },
    { source: "- [x] task", position: 10, expected: "- [x] task\n- [ ] ", expectedPosition: 17 },
    { source: "- first\n- ", position: 10, expected: "- first\n\n- ", expectedPosition: 11 },
    { source: "- parent\n  - child", position: 18, expected: "- parent\n  - child\n  - ", expectedPosition: 23 },
    { source: "plain paragraph", position: 15, expected: "plain paragraph\n", expectedPosition: 16 },
    { source: "```js\nconst x = 1\n```", position: 17, expected: "```js\nconst x = 1\n\n```", expectedPosition: 18 },
  ];
  for (const sample of samples) {
    await setCode(page, sample.source, { language: "markdown", indentMode: "space", indentWidth: 4 });
    await selection(page, sample.position);
    await page.keyboard.press("Enter");
    expect(await state(page)).toMatchObject({
      text: sample.expected,
      anchor: sample.expectedPosition,
      head: sample.expectedPosition,
    });
    expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await state(page)).text).toBe(sample.source);
  }
});

test("Markdown Backspace removes list and quote markup like the reference editor", async ({ page }) => {
  await mount(page);
  const samples = [
    { source: "- item", position: 2, expected: "item", expectedPosition: 0 },
    { source: "1. item", position: 3, expected: "item", expectedPosition: 0 },
    { source: "> quote", position: 2, expected: "quote", expectedPosition: 0 },
    { source: "> - nested", position: 4, expected: "> nested", expectedPosition: 2 },
    { source: "- [ ] task", position: 6, expected: "task", expectedPosition: 0 },
    { source: "- parent\n  - child", position: 13, expected: "- parent\n  child", expectedPosition: 11 },
    { source: "plain text", position: 5, expected: "plai text", expectedPosition: 4 },
  ];
  for (const sample of samples) {
    await setCode(page, sample.source, { language: "markdown", indentMode: "space", indentWidth: 4 });
    await selection(page, sample.position);
    await page.keyboard.press("Backspace");
    expect(await state(page)).toMatchObject({
      text: sample.expected,
      anchor: sample.expectedPosition,
      head: sample.expectedPosition,
    });
    if (sample.source !== "plain text") {
      expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.commands.undo())).toBe(
        true,
      );
      expect((await state(page)).text).toBe(sample.source);
    }
  }
});

test("Markdown Backspace leaves selection deletion and IME composition to the editor", async ({ page }) => {
  await mount(page);
  await setCode(page, "- item", { language: "markdown" });
  await selection(page, 0, 2);
  await page.keyboard.press("Backspace");
  expect((await state(page)).text).toBe("item");
  await setCode(page, "- item", { language: "markdown" });
  await selection(page, 2);
  const prevented = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("codeKeyboardEditor").editor;
    return !editor.view.dom.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Backspace", isComposing: true, bubbles: true, cancelable: true }),
    );
  });
  expect(prevented).toBe(false);
  expect((await state(page)).text).toBe("- item");
});

test("code Backspace follows reference indentation and Unicode boundaries", async ({ page }) => {
  await mount(page);
  const samples = [
    { language: "javascript", source: "    x", position: 4, expected: "x", expectedPosition: 0 },
    { language: "javascript", source: "      x", position: 6, expected: "    x", expectedPosition: 4 },
    { language: "javascript", source: "  x", position: 2, expected: "x", expectedPosition: 0 },
    { language: "javascript", source: "\tx", position: 1, expected: "x", expectedPosition: 0 },
    { language: "javascript", source: "  \t  x", position: 5, expected: "  \tx", expectedPosition: 3 },
    { language: "javascript", source: "foo    x", position: 7, expected: "foo   x", expectedPosition: 6 },
    { language: "markdown", source: "    x", position: 4, expected: "x", expectedPosition: 0 },
    { language: "javascript", source: "a👨‍👩‍👧‍👦b", position: 12, expected: "ab", expectedPosition: 1 },
    { language: "javascript", source: "a🇨🇳b", position: 5, expected: "ab", expectedPosition: 1 },
    { language: "javascript", source: "a👍🏽b", position: 5, expected: "a👍b", expectedPosition: 3 },
    { language: "javascript", source: "aéb", position: 3, expected: "aeb", expectedPosition: 2 },
    { language: "javascript", source: "a😀b", position: 3, expected: "ab", expectedPosition: 1 },
    { language: "javascript", source: "abc", position: 2, expected: "ac", expectedPosition: 1 },
  ];
  for (const sample of samples) {
    await setCode(page, sample.source, { language: sample.language, indentMode: "space", indentWidth: 4 });
    await selection(page, sample.position);
    await page.keyboard.press("Backspace");
    expect(await state(page)).toMatchObject({
      text: sample.expected,
      anchor: sample.expectedPosition,
      head: sample.expectedPosition,
    });
  }
  for (const width of [2, 4, 8] as const) {
    await setCode(page, "        x", { language: "javascript", indentMode: "space", indentWidth: width });
    await selection(page, 8);
    await page.keyboard.press("Backspace");
    expect(await state(page)).toMatchObject({ text: " ".repeat(8 - width) + "x", anchor: 8 - width });
    expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await state(page)).text).toBe("        x");
  }
});

test("modifier-only deletion can be undone as one code edit", async ({ page }) => {
  await mount(page);
  await setCode(page, "a👍🏽b", { language: "javascript" });
  await selection(page, 5);
  await page.keyboard.press("Backspace");
  expect(await state(page)).toMatchObject({ text: "a👍b", anchor: 3, head: 3 });
  expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await state(page)).text).toBe("a👍🏽b");
});

test("code Backspace respects the reference 200-column indentation boundary", async ({ page }) => {
  await mount(page);
  for (const [length, deleted] of [
    [199, 3],
    [200, 1],
  ] as const) {
    const source = "line before\n" + " ".repeat(length) + "x";
    await setCode(page, source, { language: "javascript", indentMode: "space", indentWidth: 4 });
    await selection(page, "line before\n".length + length);
    await page.keyboard.press("Backspace");
    expect((await state(page)).text).toBe("line before\n" + " ".repeat(length - deleted) + "x");
  }
});

test("consecutive indentation Backspaces group in history but other edits start a new group", async ({ page }) => {
  await mount(page);
  const source = "        x";
  const modifier = await page.evaluate(() => (/Mac|iPhone|iPad|iPod/.test(navigator.platform) ? "Meta" : "Control"));
  await setCode(page, source, { language: "javascript", indentWidth: 4 });
  await selection(page, 8);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  expect((await state(page)).text).toBe("x");
  await page.keyboard.press(`${modifier}+z`);
  expect(await state(page)).toMatchObject({ text: source, anchor: 8 });
  await page.keyboard.press(`${modifier}+Shift+z`);
  expect((await state(page)).text).toBe("x");

  await setCode(page, source, { language: "javascript", indentWidth: 4 });
  await selection(page, 8);
  await page.keyboard.press("Backspace");
  await page.keyboard.type("y");
  expect((await state(page)).text).toBe("    yx");
  await page.keyboard.press(`${modifier}+z`);
  expect((await state(page)).text).toBe("    x");
  await page.keyboard.press(`${modifier}+z`);
  expect((await state(page)).text).toBe(source);

  await setCode(page, source, { language: "javascript", indentWidth: 4 });
  await selection(page, 8);
  await page.keyboard.press("Backspace");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Backspace");
  expect((await state(page)).text).toBe(" x");
  await page.keyboard.press(`${modifier}+z`);
  expect((await state(page)).text).toBe("    x");
  await page.keyboard.press(`${modifier}+z`);
  expect((await state(page)).text).toBe(source);

  await setCode(page, source, { language: "javascript", indentWidth: 4 });
  await selection(page, 8);
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(650);
  await page.keyboard.press("Backspace");
  await page.keyboard.press(`${modifier}+z`);
  expect((await state(page)).text).toBe("    x");
});

test("grouped code deletion history stays local to its editor", async ({ page }) => {
  await mount(page);
  await setCode(page, "        x", { language: "javascript", indentWidth: 4 });
  await selection(page, 8);
  await page.keyboard.press("Backspace");
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host=document.createElement('div');host.id='code-keyboard-history-second';document.body.append(host)
      window.codeKeyboardSecondEditor=createEditor({element:host,outline:false,content:{type:'doc',content:[{type:'codeBlock',content:[{type:'text',text:'abc'}]}]}})
    `,
  });
  await page.waitForFunction(() => Boolean(window.codeKeyboardSecondEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("codeKeyboardSecondEditor").editor;
    editor.view.focus();
    editor.commands.setTextSelection(4);
  });
  await page.keyboard.type("y");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("codeKeyboardSecondEditor").editor.commands.undo()),
  ).toBe(true);
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("codeKeyboardSecondEditor").editor.state.doc.firstChild?.textContent,
    ),
  ).toBe("abc");
  expect(await page.evaluate(() => window.__semloRequireFixture("codeKeyboardEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await state(page)).text).toBe("        x");
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("codeKeyboardSecondEditor").editor.state.doc.firstChild?.textContent,
    ),
  ).toBe("abc");
});
