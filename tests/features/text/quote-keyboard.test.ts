import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    quoteKeyboardEditor?: EditorController;
    quoteKeyboardSecond?: EditorController;
    quoteKeyboardReject?: "wrap" | "lift" | "selection" | "heading" | "delete" | "undo" | "redo" | null;
    quoteKeyboardForceStale?: boolean;
    quoteKeyboardAppendNext?: boolean;
    quoteKeyboardInputs?: Array<{ from: number; to: number; selection: number; text: string }>;
  }
}

async function mount(page: Page, content = "<p></p>", echo = false) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor, Extension, Plugin } from '/dist/index.js';
      const host = document.createElement('div');
      host.id = 'quote-keyboard-test';
      document.body.prepend(host);
      window.quoteKeyboardReject = null;
      window.quoteKeyboardInputs = [];
      window.quoteKeyboardForceStale = false;
      window.quoteKeyboardAppendNext = false;
      const hostGuard = Extension.create({
        name: 'quoteKeyboardHostGuard', priority: 2000,
        addProseMirrorPlugins() {
          return [new Plugin({
            props: {
              handleTextInput(view, from, to, text) {
                window.quoteKeyboardInputs.push({from, to, selection: view.state.selection.from, text});
                if (window.quoteKeyboardForceStale && text === ' ') {
                  window.quoteKeyboardForceStale = false;
                  const native = view.dom.ownerDocument.getSelection();
                  const anchor = native.anchorNode, offset = native.anchorOffset;
                  const end = view.state.doc.content.size - 1;
                  const selection = view.state.selection.constructor.create(view.state.doc, end);
                  view.dispatch(view.state.tr.setSelection(selection));
                  if (anchor?.isConnected) native.collapse(anchor, offset);
                  window.quoteKeyboardReject = 'selection';
                }
                return false;
              },
            },
            filterTransaction(transaction, state) {
              if (!transaction.docChanged)
                return !(window.quoteKeyboardReject === 'selection' && transaction.selectionSet);
              const before = state.doc.firstChild?.type.name;
              const after = transaction.doc.firstChild?.type.name;
              const beforeChild = state.doc.firstChild?.firstChild;
              const afterChild = transaction.doc.firstChild?.firstChild;
              if (window.quoteKeyboardReject === 'wrap' && before === 'paragraph' && after === 'blockquote') return false;
              if (window.quoteKeyboardReject === 'lift' && before === 'blockquote' && after === 'paragraph') return false;
              if (window.quoteKeyboardReject === 'heading' && beforeChild?.type.name === 'paragraph' && afterChild?.type.name === 'heading') return false;
              if (window.quoteKeyboardReject === 'delete' && beforeChild?.type.name === 'heading' && beforeChild.textContent && afterChild?.type.name === 'heading' && !afterChild.textContent) return false;
              if (window.quoteKeyboardReject === 'undo' && beforeChild?.type.name === 'heading' && after === 'paragraph' && !transaction.doc.textContent) return false;
              if (window.quoteKeyboardReject === 'redo' && before === 'paragraph' && !state.doc.textContent && afterChild?.type.name === 'heading' && !afterChild.textContent) return false;
              return true;
            },
            appendTransaction(transactions, oldState, newState) {
              if (!window.quoteKeyboardAppendNext || !transactions.some(transaction => transaction.docChanged)) return null;
              if (oldState.doc.firstChild?.type.name !== 'blockquote' || newState.doc.firstChild?.type.name !== 'blockquote') return null;
              window.quoteKeyboardAppendNext = false;
              return newState.tr.insertText('!', newState.selection.from);
            },
          })];
        },
      });
      window.quoteKeyboardEditor = createEditor({
        element: host, toolbar: false, outline: false, content: ${JSON.stringify(content)}, extensions: [hostGuard],
        onChange: snapshot => {
          if (${echo} && window.quoteKeyboardEditor) window.quoteKeyboardEditor.setContent(snapshot.json);
        },
      });
    `,
  });
  await page.waitForFunction(() => Boolean(window.quoteKeyboardEditor));
  return page.locator("#quote-keyboard-test .semlo-editor-prose");
}

async function html(page: Page) {
  return page.evaluate(() => window.__semloRequireFixture("quoteKeyboardEditor").getSnapshot().html);
}

async function history(page: Page, command: "undo" | "redo") {
  return page.evaluate((name) => window.__semloRequireFixture("quoteKeyboardEditor").editor.commands[name](), command);
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

for (const echo of [false, true]) {
  test(`typed empty quote returns to a blank paragraph on immediate Backspace with echo=${echo}`, async ({ page }) => {
    const prose = await mount(page, "<p></p>", echo);
    await prose.click();
    await page.keyboard.type(">");
    await page.keyboard.press("Space");
    expect(await html(page)).toBe("<blockquote><p></p></blockquote>");
    await page.keyboard.press("Backspace");
    expect(await html(page)).toBe("<p></p>");
    expect(await history(page, "undo")).toBe(true);
    expect(await html(page)).toBe("<p></p>");
    expect(await history(page, "redo")).toBe(true);
    expect(await html(page)).toBe("<p></p>");
  });

  test(`quick quote, heading and deletion undo and redo as one event with echo=${echo}`, async ({ page }) => {
    const prose = await mount(page, "<p></p>", echo);
    await prose.click();
    await page.keyboard.type("> test");
    await page.keyboard.press("ControlOrMeta+Alt+Digit3");
    await expect(prose.locator(":scope > blockquote > h3")).toHaveText("test");
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe("test");
    await page.keyboard.press("Delete");
    expect(await html(page)).toBe("<blockquote><h3></h3></blockquote>");
    expect(await history(page, "undo")).toBe(true);
    expect(await html(page)).toBe("<p></p>");
    expect(await history(page, "redo")).toBe(true);
    expect(await html(page)).toBe("<blockquote><h3></h3></blockquote>");
  });
}

test("a pause before clearing a newly typed quoted heading keeps deletion separate", async ({ page }) => {
  const prose = await mount(page);
  await prose.click();
  await page.keyboard.type("> test");
  await page.keyboard.press("ControlOrMeta+Alt+Digit3");
  await expect(prose.locator(":scope > blockquote > h3")).toHaveText("test");
  await page.waitForTimeout(2000);
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Delete");
  expect(await html(page)).toBe("<blockquote><h3></h3></blockquote>");
  expect(await history(page, "undo")).toBe(true);
  expect(await html(page)).toBe("<blockquote><h3>test</h3></blockquote>");
  expect(await history(page, "redo")).toBe(true);
  expect(await html(page)).toBe("<blockquote><h3></h3></blockquote>");
});

for (const source of ["programmatic", "appended"] as const) {
  test(`${source} content after quote creation does not join the keyboard-only history`, async ({ page }) => {
    const prose = await mount(page);
    await prose.click();
    await page.keyboard.type("> ");
    if (source === "programmatic") {
      await page.evaluate(() =>
        window.__semloRequireFixture("quoteKeyboardEditor").editor.commands.insertContent("test"),
      );
    } else {
      await page.evaluate(() => {
        window.quoteKeyboardAppendNext = true;
      });
      await page.keyboard.type("a");
    }
    const text = source === "programmatic" ? "test" : "a!";
    await page.keyboard.press("ControlOrMeta+Alt+Digit3");
    await expect(prose.locator(":scope > blockquote > h3")).toHaveText(text);
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.press("Delete");
    expect(await history(page, "undo")).toBe(true);
    expect(await html(page)).toBe(`<blockquote><h3>${text}</h3></blockquote>`);
  });
}

test("editing earlier in a new quote does not join the later heading deletion", async ({ page }) => {
  const prose = await mount(page);
  await prose.click();
  await page.keyboard.type("> ab");
  await page.keyboard.press("Home");
  await page.keyboard.type("X");
  await page.keyboard.press("End");
  await page.keyboard.press("ControlOrMeta+Alt+Digit3");
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Delete");
  expect(await history(page, "undo")).toBe(true);
  expect(await html(page)).toBe("<blockquote><h3>Xab</h3></blockquote>");
});

test("editing a loaded quote keeps heading deletion as a separate event", async ({ page }) => {
  const prose = await mount(page, "<blockquote><p>old</p></blockquote>");
  await prose.locator("blockquote p").click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  await page.keyboard.press("ControlOrMeta+Alt+Digit3");
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Delete");
  expect(await history(page, "undo")).toBe(true);
  expect(await html(page)).toBe("<blockquote><h3>old!</h3></blockquote>");
});

test("the grouped quote action survives undoing and redoing an older event", async ({ page }) => {
  const prose = await mount(page, "<p>A</p>");
  await prose.click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Backspace");
  expect(await html(page)).toBe("<p></p>");
  await page.waitForTimeout(700);
  await page.keyboard.type("> test");
  await page.keyboard.press("ControlOrMeta+Alt+Digit3");
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Delete");
  expect(await html(page)).toBe("<blockquote><h3></h3></blockquote>");
  expect(await history(page, "undo")).toBe(true);
  expect(await html(page)).toBe("<p></p>");
  expect(await history(page, "undo")).toBe(true);
  expect(await html(page)).toBe("<p>A</p>");
  expect(await history(page, "redo")).toBe(true);
  expect(await html(page)).toBe("<p></p>");
  expect(await history(page, "redo")).toBe(true);
  expect(await html(page)).toBe("<blockquote><h3></h3></blockquote>");
});

for (const rejected of ["heading", "delete", "undo", "redo"] as const) {
  test(`host rejection of ${rejected} preserves the current document and later history`, async ({ page }) => {
    const prose = await mount(page);
    await prose.click();
    await page.keyboard.type("> test");
    if (rejected === "heading") await page.evaluate(() => (window.quoteKeyboardReject = "heading"));
    await page.keyboard.press("ControlOrMeta+Alt+Digit3");
    if (rejected === "heading") {
      expect(await html(page)).toBe("<blockquote><p>test</p></blockquote>");
      await page.evaluate(() => (window.quoteKeyboardReject = null));
      await page.keyboard.type("!");
      expect(await html(page)).toBe("<blockquote><p>test!</p></blockquote>");
      return;
    }
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    if (rejected === "delete") await page.evaluate(() => (window.quoteKeyboardReject = "delete"));
    await page.keyboard.press("Delete");
    if (rejected === "delete") {
      expect(await html(page)).toBe("<blockquote><h3>test</h3></blockquote>");
      await page.evaluate(() => (window.quoteKeyboardReject = null));
      expect(await history(page, "undo")).toBe(true);
      expect(await html(page)).toBe("<p></p>");
      expect(await history(page, "redo")).toBe(true);
      expect(await html(page)).toBe("<blockquote><h3>test</h3></blockquote>");
      return;
    }
    if (rejected === "undo") await page.evaluate(() => (window.quoteKeyboardReject = "undo"));
    await history(page, "undo");
    if (rejected === "undo") {
      expect(await html(page)).toBe("<blockquote><h3></h3></blockquote>");
      await page.evaluate(() => (window.quoteKeyboardReject = null));
      expect(await history(page, "undo")).toBe(true);
    }
    expect(await html(page)).toBe("<p></p>");
    if (rejected === "redo") {
      await page.evaluate(() => (window.quoteKeyboardReject = "redo"));
      await history(page, "redo");
      expect(await html(page)).toBe("<p></p>");
      await page.evaluate(() => (window.quoteKeyboardReject = null));
    }
    expect(await history(page, "redo")).toBe(true);
    expect(await html(page)).toBe("<blockquote><h3></h3></blockquote>");
  });
}

test("a host append after grouped deletion participates in undo and redo", async ({ page }) => {
  const prose = await mount(page);
  await prose.click();
  await page.keyboard.type("> test");
  await page.keyboard.press("ControlOrMeta+Alt+Digit3");
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.evaluate(() => (window.quoteKeyboardAppendNext = true));
  await page.keyboard.press("Delete");
  expect(await html(page)).toBe("<blockquote><h3>!</h3></blockquote>");
  expect(await history(page, "undo")).toBe(true);
  expect(await html(page)).toBe("<p></p>");
  expect(await history(page, "redo")).toBe(true);
  expect(await html(page)).toBe("<blockquote><h3>!</h3></blockquote>");
});

test("a pause before leaving a typed quote gives its own undo and redo", async ({ page }) => {
  const prose = await mount(page);
  await prose.click();
  await page.keyboard.type(">");
  await page.keyboard.press("Space");
  await expect(prose.locator(":scope > blockquote")).toHaveCount(1);
  await page.waitForTimeout(2000);
  await page.keyboard.press("Backspace");
  expect(await html(page)).toBe("<p></p>");
  expect(await history(page, "undo")).toBe(true);
  expect(await html(page)).toBe("<blockquote><p></p></blockquote>");
  expect(await history(page, "redo")).toBe(true);
  expect(await html(page)).toBe("<p></p>");
});

test("a loaded empty quote keeps paragraph attributes when unwrapped and undo restores it", async ({ page }) => {
  const prose = await mount(page, '<blockquote><p style="text-align: center"></p></blockquote>');
  await prose.locator("blockquote p").click();
  const before = await html(page);
  await page.keyboard.press("Backspace");
  expect(await html(page)).toContain("text-align: center");
  expect(await html(page)).not.toContain("blockquote");
  expect(await history(page, "undo")).toBe(true);
  expect(await html(page)).toBe(before);
});

test("a new empty quote between paragraphs leaves both neighbors and groups its quick undo", async ({ page }) => {
  const prose = await mount(page, "<p>BEFORE</p><p></p><p>AFTER</p>");
  const before = await html(page);
  await prose.locator(":scope > p").nth(1).click();
  await page.keyboard.type(">");
  await page.keyboard.press("Space");
  expect(await html(page)).toBe("<p>BEFORE</p><blockquote><p></p></blockquote><p>AFTER</p>");
  await page.keyboard.press("Backspace");
  expect(await html(page)).toBe(before);
  expect(await history(page, "undo")).toBe(true);
  expect(await html(page)).toBe(before);
  expect(await history(page, "redo")).toBe(true);
  expect(await html(page)).toBe(before);
});

test("an existing marker between paragraphs is restored by undo after leaving the quote", async ({ page }) => {
  const prose = await mount(page, "<p>BEFORE</p><p>&gt;</p><p>AFTER</p>");
  const before = await html(page);
  await prose.locator(":scope > p").nth(1).click();
  await page.keyboard.press("End");
  await page.keyboard.press("Space");
  expect(await html(page)).toBe("<p>BEFORE</p><blockquote><p></p></blockquote><p>AFTER</p>");
  await page.keyboard.press("Backspace");
  expect(await html(page), JSON.stringify(await page.evaluate(() => window.quoteKeyboardInputs))).toBe(
    "<p>BEFORE</p><p></p><p>AFTER</p>",
  );
  expect(await history(page, "undo")).toBe(true);
  expect(await html(page)).toBe(before);
  expect(await history(page, "redo")).toBe(true);
  expect(await html(page)).toBe("<p>BEFORE</p><p></p><p>AFTER</p>");
});

test("a loaded empty quote between paragraphs can be unwrapped and restored", async ({ page }) => {
  const prose = await mount(page, "<p>BEFORE</p><blockquote><p></p></blockquote><p>AFTER</p>");
  const before = await html(page);
  await prose.locator("blockquote p").click();
  await page.keyboard.press("Backspace");
  expect(await html(page)).toBe("<p>BEFORE</p><p></p><p>AFTER</p>");
  expect(await history(page, "undo")).toBe(true);
  expect(await html(page)).toBe(before);
});

test("other input rules keep their existing Backspace behavior", async ({ page }) => {
  const prose = await mount(page);
  await prose.click();
  await page.keyboard.type("-");
  await page.keyboard.press("Space");
  await expect(prose.locator(":scope > ul")).toHaveCount(1);
  await page.keyboard.press("Backspace");
  expect(await html(page)).toBe('<p data-semlo-editor-preserve-tab="" style="white-space: pre-wrap;">- </p>');
});

test("a host can reject wrapping or leaving the quote without a fallback edit", async ({ page }) => {
  const prose = await mount(page);
  await prose.click();
  await page.evaluate(() => {
    window.quoteKeyboardReject = "wrap";
  });
  await page.keyboard.type(">");
  await page.keyboard.press("Space");
  expect(await html(page)).toBe("<p>&gt;</p>");
  await page.evaluate(() => {
    window.quoteKeyboardReject = null;
  });
  await page.keyboard.type("x");
  expect(await html(page)).toBe("<p>&gt;x</p>");

  await page.evaluate(() =>
    window.__semloRequireFixture("quoteKeyboardEditor").setContent("<blockquote><p></p></blockquote>"),
  );
  await prose.locator("blockquote p").click();
  await page.evaluate(() => {
    window.quoteKeyboardReject = "lift";
  });
  await page.keyboard.press("Backspace");
  expect(await html(page)).toBe("<blockquote><p></p></blockquote>");
  await page.evaluate(() => {
    window.quoteKeyboardReject = null;
  });
  await page.keyboard.type("x");
  expect(await html(page)).toBe("<blockquote><p>x</p></blockquote>");
});

test("a host rejection of selection synchronization prevents a fallback edit", async ({ page }) => {
  const prose = await mount(page, "<p>BEFORE</p><p>&gt;</p><p>AFTER</p>");
  const before = await html(page);
  await prose.locator(":scope > p").nth(1).click();
  await page.keyboard.press("End");
  await page.evaluate(() => {
    window.quoteKeyboardForceStale = true;
  });
  await page.keyboard.press("Space");
  expect(await html(page)).toBe(before);
  expect(
    await page.evaluate(
      () => window.__semloRequireFixture("quoteKeyboardEditor").editor.state.selection.$from.parent.textContent,
    ),
  ).toBe("AFTER");
  await page.evaluate(() => {
    window.quoteKeyboardReject = null;
  });
  await prose.locator(":scope > p").last().click();
  await page.keyboard.press("End");
  await page.keyboard.type("!");
  expect(await html(page)).toBe("<p>BEFORE</p><p>&gt;</p><p>AFTER!</p>");
});

test("separate editor instances do not share quote input or history", async ({ page }) => {
  const first = await mount(page);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js';
      const host = document.createElement('div');
      host.id = 'quote-keyboard-second';
      document.body.append(host);
      window.quoteKeyboardSecond = createEditor({element: host, toolbar: false, outline: false, content: '<p></p>'});
    `,
  });
  await page.waitForFunction(() => Boolean(window.quoteKeyboardSecond));
  const second = page.locator("#quote-keyboard-second .semlo-editor-prose");
  await first.click();
  await page.keyboard.type(">");
  await page.keyboard.press("Space");
  expect(await html(page)).toBe("<blockquote><p></p></blockquote>");
  expect(await page.evaluate(() => window.__semloRequireFixture("quoteKeyboardSecond").getSnapshot().html)).toBe(
    "<p></p>",
  );
  await second.click();
  await page.keyboard.type(">");
  await page.keyboard.press("Space");
  await page.keyboard.press("Backspace");
  expect(await page.evaluate(() => window.__semloRequireFixture("quoteKeyboardSecond").getSnapshot().html)).toBe(
    "<p></p>",
  );
  expect(await html(page)).toBe("<blockquote><p></p></blockquote>");
  await page.evaluate(() => window.__semloRequireFixture("quoteKeyboardEditor").destroy());
  await page.keyboard.type("x");
  expect(await page.evaluate(() => window.__semloRequireFixture("quoteKeyboardSecond").getSnapshot().html)).toBe(
    "<p>x</p>",
  );
});

test("a fresh quote in one editor cannot group history in another editor", async ({ page }) => {
  const first = await mount(page);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js';
      const host = document.createElement('div');
      host.id = 'quote-keyboard-second';
      document.body.append(host);
      window.quoteKeyboardSecond = createEditor({element: host, toolbar: false, outline: false, content: '<blockquote><p>test</p></blockquote>'});
    `,
  });
  await page.waitForFunction(() => Boolean(window.quoteKeyboardSecond));
  const second = page.locator("#quote-keyboard-second .semlo-editor-prose");
  await first.click();
  await page.keyboard.type("> test");
  await second.locator("blockquote p").click();
  await page.keyboard.press("End");
  await page.keyboard.press("ControlOrMeta+Alt+Digit3");
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Delete");
  expect(await page.evaluate(() => window.__semloRequireFixture("quoteKeyboardSecond").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("quoteKeyboardSecond").getSnapshot().html)).toBe(
    "<blockquote><h3>test</h3></blockquote>",
  );
  expect(await html(page)).toBe("<blockquote><p>test</p></blockquote>");
});
