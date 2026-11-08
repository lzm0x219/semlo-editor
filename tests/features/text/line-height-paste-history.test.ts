import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";

declare global {
  interface Window {
    lineHeightPasteEditor?: EditorController;
    lineHeightPasteTarget?: EditorController;
    lineHeightPasteEvents?: boolean[];
    lineHeightPasteHost?: { openStart: number; firstHeight: string | null }[];
    lineHeightPasteReject?: "paste" | "format" | null;
    lineHeightPasteAppend?: boolean;
  }
}

const sample = '<p style="line-height:1.5">FIRST</p><p>MIDDLE</p><p style="line-height:2">LAST</p>';

async function mount(
  page: Page,
  content = "<p></p>",
  hostMode: "none" | "observe" | "early-takeover" | "late-takeover" = "none",
) {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor, Extension, Plugin } from '/dist/index.js';
      const host = document.createElement('div');
      host.id = 'line-height-paste';
      document.body.replaceChildren(host);
      window.lineHeightPasteEvents = [];
      window.lineHeightPasteHost = [];
      window.lineHeightPasteReject = null;
      window.lineHeightPasteAppend = false;
      const mode = ${JSON.stringify(hostMode)};
      const guard = Extension.create({
        name: 'lineHeightPasteHostGuard', priority: mode === 'late-takeover' ? 0 : 2000,
        addProseMirrorPlugins() {
          return [new Plugin({
            props: {
              handlePaste(view, event, slice) {
                if (mode === 'none') return false;
                window.lineHeightPasteHost.push({openStart: slice.openStart, firstHeight: slice.content.firstChild?.attrs.semloEditorLineHeight ?? null});
                if (!mode.endsWith('takeover')) return false;
                view.dispatch(view.state.tr.insertText('HOST'));
                return true;
              },
            },
            filterTransaction(transaction, state) {
              if (window.lineHeightPasteReject === 'paste' && transaction.getMeta('uiEvent') === 'paste') return false;
              if (window.lineHeightPasteReject === 'format' && transaction.docChanged && state.doc.childCount > 1 && transaction.doc.textContent === state.doc.textContent) return false;
              return true;
            },
            appendTransaction(transactions, oldState, newState) {
              if (!window.lineHeightPasteAppend || !transactions.some(transaction => transaction.getMeta('uiEvent') === 'paste')) return null;
              window.lineHeightPasteAppend = false;
              return newState.tr.insertText('!', newState.selection.from);
            },
          })];
        },
      });
      window.lineHeightPasteEditor = createEditor({element: host, outline: false, content: ${JSON.stringify(content)}, extensions: [guard]});
      window.lineHeightPasteEditor.editor.view.dom.addEventListener('paste', event => window.lineHeightPasteEvents.push(event.isTrusted));
    `,
  });
  await page.waitForFunction(() => Boolean(window.lineHeightPasteEditor));
  await page.evaluate(async (html) => {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob(["FIRST\nMIDDLE\nLAST"], { type: "text/plain" }),
      }),
    ]);
  }, sample);
  return page.locator("#line-height-paste .semlo-editor-prose");
}

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const controller = window.lineHeightPasteEditor;
    if (!controller) throw new Error("Editor not mounted");
    return controller.getSnapshot();
  });
}

for (const pause of [false, true]) {
  test(`real paste and line-height ${pause ? "after a pause stays separate" : "quickly undo as one action"}`, async ({
    page,
  }) => {
    const prose = await mount(page);
    const baseline = await snapshot(page);
    await prose.click();
    await page.keyboard.press("ControlOrMeta+v");
    await expect(prose.locator(":scope > p")).toHaveText(["FIRST", "MIDDLE", "LAST"]);
    expect(await page.evaluate(() => window.lineHeightPasteEvents)).toEqual([true]);
    const pasted = await snapshot(page);
    expect(pasted.json.content?.map((node) => node.attrs?.semloEditorLineHeight)).toEqual(["1.5", null, "2"]);
    if (pause) await page.waitForTimeout(2100);
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("ControlOrMeta+Alt+BracketLeft");
    const changed = await snapshot(page);
    expect(
      changed.json.content?.map((node) => node.attrs?.semloEditorLineHeight),
      JSON.stringify({ pasted, changed }),
    ).toEqual(["1.15", "1.15", "1.15"]);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await snapshot(page)).json).toEqual((pause ? pasted : baseline).json);
    await page.keyboard.press("ControlOrMeta+Shift+z");
    expect((await snapshot(page)).json).toEqual(changed.json);
  });
}

test("programmatic insertion does not join the subsequent line-height action", async ({ page }) => {
  const prose = await mount(page);
  await prose.click();
  await page.evaluate((html) => {
    const controller = window.lineHeightPasteEditor;
    if (!controller) throw new Error("Editor not mounted");
    controller.editor.commands.insertContent(html);
  }, sample);
  const inserted = await snapshot(page);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+Alt+BracketLeft");
  await page.keyboard.press("ControlOrMeta+z");
  expect((await snapshot(page)).json).toEqual(inserted.json);
});

test("a dispatched clipboard paste preserves formatting and groups its immediate line-height action", async ({
  page,
}) => {
  const prose = await mount(page);
  const before = await snapshot(page);
  await prose.click();
  await page.evaluate((html) => {
    const controller = window.lineHeightPasteEditor;
    if (!controller) throw new Error("Editor not mounted");
    const clipboard = new DataTransfer();
    clipboard.setData("text/html", html);
    clipboard.setData("text/plain", "FIRST\nMIDDLE\nLAST");
    controller.editor.view.dom.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: clipboard }),
    );
  }, sample);
  expect(await page.evaluate(() => window.lineHeightPasteEvents)).toEqual([false]);
  expect((await snapshot(page)).json.content?.map((node) => node.attrs?.semloEditorLineHeight)).toEqual([
    "1.5",
    null,
    "2",
  ]);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+Alt+BracketLeft");
  await page.keyboard.press("ControlOrMeta+z");
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("a host paste observer receives the original open slice before the default repair", async ({ page }) => {
  const prose = await mount(page, "<p></p>", "observe");
  await prose.click();
  await page.keyboard.press("ControlOrMeta+v");
  expect(await page.evaluate(() => window.lineHeightPasteHost)).toEqual([{ openStart: 1, firstHeight: "1.5" }]);
  expect((await snapshot(page)).json.content?.map((node) => node.attrs?.semloEditorLineHeight)).toEqual([
    "1.5",
    null,
    "2",
  ]);
});

for (const mode of ["early-takeover", "late-takeover"] as const) {
  test(`${mode} host paste handler retains control of its original slice`, async ({ page }) => {
    const prose = await mount(page, "<p></p>", mode);
    await prose.click();
    await page.keyboard.press("ControlOrMeta+v");
    expect(await page.evaluate(() => window.lineHeightPasteHost)).toEqual([{ openStart: 1, firstHeight: "1.5" }]);
    expect((await snapshot(page)).text).toBe("HOST");
  });
}

test("a host-rejected paste does not fall through to a second insertion", async ({ page }) => {
  const prose = await mount(page);
  const before = await snapshot(page);
  await prose.click();
  await page.evaluate(() => (window.lineHeightPasteReject = "paste"));
  await page.keyboard.press("ControlOrMeta+v");
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("a host-rejected line-height transaction does not close the paste history", async ({ page }) => {
  const prose = await mount(page);
  const before = await snapshot(page);
  await prose.click();
  await page.keyboard.press("ControlOrMeta+v");
  const pasted = await snapshot(page);
  await page.keyboard.press("ControlOrMeta+a");
  await page.evaluate(() => (window.lineHeightPasteReject = "format"));
  await page.keyboard.press("ControlOrMeta+Alt+BracketLeft");
  expect((await snapshot(page)).json).toEqual(pasted.json);
  await page.evaluate(() => (window.lineHeightPasteReject = null));
  await page.keyboard.press("ControlOrMeta+z");
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("a host append after paste prevents speculative history grouping", async ({ page }) => {
  const prose = await mount(page);
  await prose.click();
  await page.evaluate(() => (window.lineHeightPasteAppend = true));
  await page.keyboard.press("ControlOrMeta+v");
  const pasted = await snapshot(page);
  expect(pasted.text).toContain("LAST!");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+Alt+BracketLeft");
  await page.keyboard.press("ControlOrMeta+z");
  expect((await snapshot(page)).json).toEqual(pasted.json);
});

test("a nondefault empty paragraph retains its own alignment on paste", async ({ page }) => {
  const prose = await mount(page, '<p style="text-align:center"></p>');
  await prose.click();
  await page.keyboard.press("ControlOrMeta+v");
  expect((await snapshot(page)).json.content?.[0].attrs?.textAlign).toBe("center");
});

test("pasting into existing content leaves line-height as a separate undo action", async ({ page }) => {
  const prose = await mount(page, "<p>BEFORE</p>");
  await prose.click();
  await page.keyboard.press("End");
  await page.keyboard.press("ControlOrMeta+v");
  const pasted = await snapshot(page);
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+Alt+BracketLeft");
  await page.keyboard.press("ControlOrMeta+z");
  expect((await snapshot(page)).json).toEqual(pasted.json);
});

test("pasted first-paragraph formatting and links survive HTML and JSON reload", async ({ page }) => {
  const prose = await mount(page);
  await page.evaluate(async () => {
    const html =
      '<p style="line-height:1.5"><strong>Bold</strong><a href="https://example.com/">Link</a></p><p>TAIL</p>';
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob(["BoldLink\nTAIL"], { type: "text/plain" }),
      }),
    ]);
  });
  await prose.click();
  await page.keyboard.press("ControlOrMeta+v");
  const pasted = await snapshot(page);
  expect(pasted.json.content?.[0].attrs?.semloEditorLineHeight).toBe("1.5");
  expect(pasted.html).toContain("<strong>Bold</strong>");
  expect(pasted.html).toContain('href="https://example.com/"');
  for (const value of [pasted.json, pasted.html]) {
    await page.evaluate((content) => {
      const controller = window.lineHeightPasteEditor;
      if (!controller) throw new Error("Editor not mounted");
      controller.setContent("<p>临时内容</p>");
      controller.setContent(content);
    }, value);
    expect((await snapshot(page)).json).toEqual(pasted.json);
  }
});

test("destroying and remounting clears the previous paste provenance", async ({ page }) => {
  const prose = await mount(page);
  await prose.click();
  await page.keyboard.press("ControlOrMeta+v");
  await page.evaluate(() => window.lineHeightPasteEditor?.destroy());
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js';
      window.lineHeightPasteEditor = createEditor({element: document.getElementById('line-height-paste'), outline: false, content: ${JSON.stringify(sample)}});
    `,
  });
  const before = await snapshot(page);
  await prose.locator(":scope > p").first().click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+Alt+BracketLeft");
  await page.keyboard.press("ControlOrMeta+z");
  expect((await snapshot(page)).json).toEqual(before.json);
});

test("Semlo system copy preserves paragraph heights in a separate empty editor", async ({ page }) => {
  const source = await mount(page, sample);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js';
      const host = document.createElement('div');
      host.id = 'line-height-paste-target';
      document.body.append(host);
      window.lineHeightPasteTarget = createEditor({element: host, outline: false, content: '<p></p>'});
    `,
  });
  await page.waitForFunction(() => Boolean(window.lineHeightPasteTarget));
  const before = await snapshot(page);
  await source.locator(":scope > p").first().click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("ControlOrMeta+c");
  const target = page.locator("#line-height-paste-target .semlo-editor-prose");
  await target.click();
  await page.keyboard.press("ControlOrMeta+v");
  const targetSnapshot = await page.evaluate(() => {
    if (!window.lineHeightPasteTarget) throw new Error("Target not mounted");
    return window.lineHeightPasteTarget.getSnapshot();
  });
  expect(targetSnapshot.json.content?.map((node) => node.attrs?.semloEditorLineHeight)).toEqual(["1.5", null, "2"]);
  expect(targetSnapshot.text).toBe(before.text);
  expect((await snapshot(page)).json).toEqual(before.json);
  await page.keyboard.press("ControlOrMeta+z");
  expect(await page.evaluate(() => window.lineHeightPasteTarget?.getSnapshot().text)).toBe("");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expect(await page.evaluate(() => window.lineHeightPasteTarget?.getSnapshot().json)).toEqual(targetSnapshot.json);
});
