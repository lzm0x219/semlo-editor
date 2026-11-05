import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/heading/heading-rtl-singleline-fixture";

// Local engineering safety expectations; no Yuque RTL comparison is available.
let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/heading/heading-rtl-singleline-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = () => server.close();
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => installFixtureGuards(page));

type Sample = {
  name: string;
  text: string;
  direction?: "ltr" | "rtl";
  width?: number;
  numbered?: boolean;
  mark?: "bold" | "italic";
  editable?: boolean;
  level?: 1 | 2 | 3 | 4 | 5 | 6;
  container?: "quote" | "details";
  zoom?: number;
};
async function mount(page: Page, sample: Sample, anchor = 0, head = anchor, native = false) {
  const blocks: JSONContent[] = [
    {
      type: "heading",
      attrs: { level: sample.level ?? 3, ...(sample.numbered ? { semloEditorHeadingNumbering: "mixed" } : {}) },
      content: [{ type: "text", text: sample.text, ...(sample.mark ? { marks: [{ type: sample.mark }] } : {}) }],
    },
    { type: "paragraph", content: [{ type: "text", text: "NEXT" }] },
  ];
  const content: JSONContent =
    sample.container === "quote"
      ? { type: "doc", content: [{ type: "blockquote", content: blocks }] }
      : sample.container === "details"
        ? {
            type: "doc",
            content: [
              {
                type: "details",
                attrs: { open: true },
                content: [{ type: "detailsSummary" }, { type: "detailsContent", content: blocks }],
              },
            ],
          }
        : { type: "doc", content: blocks };
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.setupRtlSingleLine === "function");
  await page.evaluate(
    ({ content, sample, anchor, head, native }) => {
      window.__semloRequireFixture("setupRtlSingleLine")(
        content,
        sample.direction ?? "rtl",
        sample.width ?? 850,
        native,
      );
      const fixture = window.__semloRequireFixture("headingEndBoundary");
      if (sample.zoom) fixture.controller.editor.view.dom.style.setProperty("zoom", String(sample.zoom));
      fixture.select(sample.text, anchor, head);
      if (sample.editable === false) fixture.controller.editor.setEditable(false);
    },
    { content, sample, anchor, head, native },
  );
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
}

for (const zoom of [0.5, 1.5, 2]) {
  test(`local RTL real keyboard preserves NEXT at CSS zoom ${zoom}`, async ({ page }) => {
    await mount(page, { name: "zoom", text: "אבג דהו", zoom });
    const before = await page.evaluate(() => window.__semloRequireFixture("rtlSingleLineProbe").inspect());
    await page.locator("#heading-end-boundary .semlo-editor-prose h3").click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.press("Backspace");
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    const after = await page.evaluate(() => window.__semloRequireFixture("rtlSingleLineProbe").inspect());
    const expected = structuredClone(before.json) as JSONContent;
    delete expected.content![0].content;
    expect(after.json).toEqual(expected);
    expect(after.focused).toBe(true);
  });
}

for (const item of [
  ...([1, 2, 3, 4, 5, 6] as const).map((level) => ({ name: `root H${level}`, level, container: undefined })),
  { name: "quote H3", level: 3 as const, container: "quote" as const },
  { name: "details H3", level: 3 as const, container: "details" as const },
]) {
  test(`local RTL real keyboard preserves NEXT for ${item.name}`, async ({ page }) => {
    const text = "אבג דהו";
    await mount(page, { ...item, text });
    const before = await page.evaluate(() => window.__semloRequireFixture("rtlSingleLineProbe").inspect());
    await page.locator(`#heading-end-boundary .semlo-editor-prose h${item.level}`).click();
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.press("Backspace");
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    const after = await page.evaluate(() => window.__semloRequireFixture("rtlSingleLineProbe").inspect());
    const expected = structuredClone(before.json) as JSONContent;
    const blocks =
      item.container === "quote"
        ? expected.content![0].content!
        : item.container === "details"
          ? expected.content![0].content![1].content!
          : expected.content!;
    delete blocks[0].content;
    expect(after.json).toEqual(expected);
    expect(after.focused).toBe(true);
    await page.keyboard.press("ControlOrMeta+z");
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    expect((await page.evaluate(() => window.__semloRequireFixture("rtlSingleLineProbe").inspect())).json).toEqual(
      before.json,
    );
  });
}

const nativeFallbacks = [
  { name: "middle cursor", text: "אבג דהו", anchor: 2, head: 2 },
  { name: "forward selection", text: "אבג דהו", anchor: 1, head: 3 },
  { name: "reverse selection", text: "אבג דהו", anchor: 3, head: 1 },
  { name: "mixed scripts", text: "אבג abc דהו", anchor: 0, head: 0 },
  { name: "directional isolate", text: "אבג\u2067דהו\u2069", anchor: 0, head: 0 },
  { name: "marked text", text: "אבג דהו", anchor: 0, head: 0, mark: "bold" as const },
  { name: "wrapped", text: "אבג דהו זחט יכל מנס עפצ קרש תאב דהו זחט יכל", anchor: 16, head: 16, width: 240 },
];
for (const item of nativeFallbacks) {
  test(`local RTL actual keyboard leaves ${item.name} identical to native`, async ({ page }) => {
    async function run(native: boolean) {
      await mount(page, item, item.anchor, item.head, native);
      await page.keyboard.press("Shift+End");
      await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
      const snapshot = await page.evaluate(() => window.__semloRequireFixture("rtlSingleLineProbe").inspect());
      return { json: snapshot.json, dom: snapshot.dom, pm: snapshot.pm, focused: snapshot.focused };
    }
    expect(await run(false)).toEqual(await run(true));
  });
}

for (const text of ["אבג דהו", "مرحبا بالعالم"]) {
  for (const initial of ["click", "start", "middle", "end"] as const) {
    test(`local RTL single line ${text} ${initial}: consecutive keyboard deletion preserves NEXT`, async ({ page }) => {
      const offset = initial === "middle" ? Math.floor(text.length / 2) : initial === "end" ? text.length : 0;
      await mount(page, { name: "plain", text }, offset);
      if (initial === "click") await page.locator("#heading-end-boundary .semlo-editor-prose h3").click();
      const before = await page.evaluate(() => window.__semloRequireFixture("rtlSingleLineProbe").inspect());
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+End");
      await page.keyboard.press("Backspace");
      await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
      const result = await page.evaluate(() => ({
        after: window.__semloRequireFixture("rtlSingleLineProbe").inspect(),
        events: window.__semloRequireFixture("rtlSingleLineProbe").events,
      }));
      const backspace = result.events.find((event) => event.phase === "keydown" && event.key === "Backspace")!;
      const expected = structuredClone(before.json) as JSONContent;
      delete expected.content![0].content;
      expect(result.after.json).toEqual(expected);
      expect(result.after.focused).toBe(true);
      expect(backspace.snapshot.dom).toMatchObject({ text, collapsed: false });
      expect(backspace.snapshot.pm).toMatchObject({ text, empty: false, anchor: 1, head: text.length + 1 });
      await page.keyboard.press("ControlOrMeta+z");
      await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
      const undo = await page.evaluate(() => window.__semloRequireFixture("rtlSingleLineProbe").inspect());
      expect(undo.json).toEqual(before.json);
      expect(undo.pm).toMatchObject({ text, empty: false, anchor: 1, head: text.length + 1 });
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
      const redo = await page.evaluate(() => window.__semloRequireFixture("rtlSingleLineProbe").inspect());
      expect(redo.json).toEqual(expected);
    });
  }
}

for (const text of ["א", "ת", "ء", "غ", "ف", "ي"]) {
  test(`local RTL accepts verified strong letter boundary ${text}`, async ({ page }) => {
    await mount(page, { name: "boundary", text });
    const result = await page.evaluate(() => {
      const editor = window.__semloRequireFixture("headingEndBoundary").controller.editor;
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "End", shiftKey: true });
      editor.view.dom.dispatchEvent(event);
      return {
        prevented: event.defaultPrevented,
        anchor: editor.state.selection.anchor,
        head: editor.state.selection.head,
      };
    });
    expect(result).toEqual({ prevented: true, anchor: 1, head: 2 });
  });
}

const excluded: Sample[] = [
  { name: "mixed scripts", text: "אבג abc דהו" },
  { name: "mixed strong RTL scripts", text: "אבג مرحبا" },
  { name: "Hebrew digits", text: "אבג 123" },
  { name: "Hebrew punctuation", text: "אבג, דהו" },
  { name: "Hebrew combining marks", text: "אָבג" },
  { name: "Arabic combining marks", text: "مَرْحبا" },
  { name: "Arabic letter mark", text: "مرحبا\u061cبالعالم" },
  { name: "Arabic-Indic digits", text: "مرحبا ١٢٣" },
  { name: "Hebrew boundary punctuation", text: "אבג\u05eb" },
  { name: "extended Arabic letter", text: "مرحبا\u0671" },
  { name: "unpaired surrogate", text: "אבג\ud800" },
  { name: "directional isolate", text: "אבג\u2067דהו\u2069" },
  { name: "leading neutral", text: " אבג" },
  { name: "trailing neutral", text: "אבג " },
  { name: "trailing newline", text: "אבג\n" },
  { name: "numbered", text: "אבג דהו", numbered: true },
  { name: "marked", text: "אבג דהו", mark: "bold" },
  { name: "LTR direction", text: "אבג דהו", direction: "ltr" },
  { name: "too long", text: "א".repeat(129) },
  { name: "wrapped", text: "אבג דהו זחט יכל מנס עפצ קרש תאב דהו זחט יכל", width: 240 },
  { name: "read only", text: "אבג דהו", editable: false },
];
for (const sample of excluded) {
  test(`local RTL guard leaves ${sample.name} to native behavior`, async ({ page }) => {
    await mount(page, sample);
    const observed = await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("headingEndBoundary");
      const editor = fixture.controller.editor;
      const selection = document.getSelection()!;
      const native = () => ({
        anchor: editor.view.posAtDOM(selection.anchorNode!, selection.anchorOffset),
        head: editor.view.posAtDOM(selection.focusNode!, selection.focusOffset),
        text: selection.toString(),
      });
      const before = {
        doc: editor.getJSON(),
        anchor: editor.state.selection.anchor,
        head: editor.state.selection.head,
        native: native(),
      };
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "End", shiftKey: true });
      editor.view.dom.dispatchEvent(event);
      return {
        before,
        after: {
          doc: editor.getJSON(),
          anchor: editor.state.selection.anchor,
          head: editor.state.selection.head,
          native: native(),
        },
        prevented: event.defaultPrevented,
      };
    });
    expect(observed.prevented).toBe(false);
    expect(observed.after).toEqual(observed.before);
  });
}

for (const layout of [
  "transform",
  "individual-rotate",
  "outer-transform",
  "columns",
  "flex",
  "vertical",
  "bidi-override",
  "fold-static",
  "wrapped-text-node",
] as const) {
  test(`local RTL guard rejects ${layout} geometry without changing native selection`, async ({ page }) => {
    await mount(page, { name: "plain", text: "אבג דהו" });
    const result = await page.evaluate((layout) => {
      const editor = window.__semloRequireFixture("headingEndBoundary").controller.editor;
      const heading = editor.view.dom.querySelector("h3")!;
      if (layout === "transform") heading.style.transform = "rotate(12deg)";
      if (layout === "individual-rotate") heading.style.rotate = "12deg";
      if (layout === "outer-transform") document.body.style.transform = "rotate(12deg)";
      if (layout === "columns") heading.style.columnWidth = "80px";
      if (layout === "flex") heading.style.display = "flex";
      if (layout === "vertical") heading.style.writingMode = "vertical-rl";
      if (layout === "bidi-override") heading.style.unicodeBidi = "bidi-override";
      if (layout === "fold-static") {
        const fold = heading.querySelector<HTMLElement>(".semlo-editor-heading-fold-toggle");
        if (!fold) throw new Error("Missing fold button");
        fold.style.position = "static";
      }
      if (layout === "wrapped-text-node") {
        const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) =>
            node.parentElement?.closest('[contenteditable="false"]')
              ? NodeFilter.FILTER_REJECT
              : NodeFilter.FILTER_ACCEPT,
        });
        const text = walker.nextNode()!;
        const span = document.createElement("span");
        text.parentNode!.replaceChild(span, text);
        span.appendChild(text);
        document.getSelection()!.setBaseAndExtent(text, 0, text, 0);
      }
      const selection = document.getSelection()!;
      const native = () => ({
        anchor: editor.view.posAtDOM(selection.anchorNode!, selection.anchorOffset),
        head: editor.view.posAtDOM(selection.focusNode!, selection.focusOffset),
        text: selection.toString(),
      });
      const before = {
        json: editor.getJSON(),
        anchor: editor.state.selection.anchor,
        head: editor.state.selection.head,
        native: native(),
      };
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "End", shiftKey: true });
      editor.view.dom.dispatchEvent(event);
      return {
        prevented: event.defaultPrevented,
        before,
        after: {
          json: editor.getJSON(),
          anchor: editor.state.selection.anchor,
          head: editor.state.selection.head,
          native: native(),
        },
      };
    }, layout);
    expect(result.prevented).toBe(false);
    expect(result.after).toEqual(result.before);
  });
}

for (const failure of ["throw", "non-finite"] as const) {
  test(`local RTL ${failure} geometry fails closed without mutating selection`, async ({ page }) => {
    await mount(page, { name: "plain", text: "אבג דהו" });
    const result = await page.evaluate((failure) => {
      const editor = window.__semloRequireFixture("headingEndBoundary").controller.editor;
      const selection = document.getSelection()!;
      const native = () => ({
        anchor: editor.view.posAtDOM(selection.anchorNode!, selection.anchorOffset),
        head: editor.view.posAtDOM(selection.focusNode!, selection.focusOffset),
      });
      const before = {
        json: editor.getJSON(),
        anchor: editor.state.selection.anchor,
        head: editor.state.selection.head,
        native: native(),
      };
      const original = Range.prototype.getClientRects;
      try {
        Range.prototype.getClientRects = function () {
          if (failure === "throw") throw new Error("geometry unavailable");
          return [{ left: NaN, right: NaN, top: 0, bottom: 20, width: NaN, height: 20 }] as unknown as DOMRectList;
        };
        const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "End", shiftKey: true });
        editor.view.dom.dispatchEvent(event);
        return {
          prevented: event.defaultPrevented,
          before,
          after: {
            json: editor.getJSON(),
            anchor: editor.state.selection.anchor,
            head: editor.state.selection.head,
            native: native(),
          },
        };
      } finally {
        Range.prototype.getClientRects = original;
      }
    }, failure);
    expect(result.prevented).toBe(false);
    expect(result.after).toEqual(result.before);
  });
}

test("local RTL geometry work is bounded at the 128-character limit", async ({ page }) => {
  for (const length of [128, 129, 512]) {
    await mount(page, { name: `length ${length}`, text: "א".repeat(length), width: 8000 });
    const measured = await page.evaluate(() => {
      const editor = window.__semloRequireFixture("headingEndBoundary").controller.editor;
      const plugin = editor.state.plugins.find((item) =>
        (item as unknown as { key: string }).key.startsWith("semloEditorHeadingEndSelection$"),
      )!;
      const handler = plugin.props.handleKeyDown!;
      const original = Range.prototype.getClientRects;
      let calls = 0;
      Range.prototype.getClientRects = function () {
        calls++;
        return original.call(this);
      };
      const handled: boolean[] = [];
      const prevented: boolean[] = [];
      const unchanged: boolean[] = [];
      const reads: number[] = [];
      try {
        for (let i = 0; i < 20; i++) {
          editor.commands.setTextSelection(1);
          editor.view.focus();
          const before = window.__semloRequireFixture("rtlSingleLineProbe").inspect();
          // The latter half also forces a fresh layout before the synchronous guard.
          if (i >= 10) editor.view.dom.querySelector("h3")!.style.letterSpacing = i % 2 ? "0.01px" : "0.02px";
          calls = 0;
          const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "End", shiftKey: true });
          handled.push(Boolean(handler.call(plugin, editor.view, event)));
          reads.push(calls);
          prevented.push(event.defaultPrevented);
          unchanged.push(
            JSON.stringify(before) === JSON.stringify(window.__semloRequireFixture("rtlSingleLineProbe").inspect()),
          );
        }
      } finally {
        Range.prototype.getClientRects = original;
      }
      return { handled, prevented, unchanged, reads };
    });
    expect(measured.handled).toEqual(Array(20).fill(length === 128));
    expect(measured.prevented).toEqual(Array(20).fill(length === 128));
    expect(Math.max(...measured.reads)).toBeLessThanOrEqual(260);
    if (length > 128) {
      // The existing multiline path makes a bounded coordsAtPos read before
      // rejecting RTL. Check its result, rather than requiring zero reads.
      expect(Math.max(...measured.reads)).toBeLessThanOrEqual(8);
      expect(measured.unchanged).toEqual(Array(20).fill(true));
    }
  }
});

for (const scenario of [
  "middle",
  "selected",
  "reverse",
  "composition",
  "viewComposing",
  "keyCode229",
  "plainEnd",
  "home",
  "alt",
  "altGraph",
  "ctrl",
  "meta",
] as const) {
  test(`local RTL guard does not capture ${scenario}`, async ({ page }) => {
    const [anchor, head] =
      scenario === "middle" ? [2, 2] : scenario === "selected" ? [1, 3] : scenario === "reverse" ? [3, 1] : [0, 0];
    await mount(page, { name: "plain", text: "אבג דהו" }, anchor, head);
    const observed = await page.evaluate((scenario) => {
      const editor = window.__semloRequireFixture("headingEndBoundary").controller.editor;
      if (scenario === "viewComposing")
        editor.view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      const viewComposing = editor.view.composing;
      const selection = document.getSelection()!;
      const native = () => ({
        anchor: editor.view.posAtDOM(selection.anchorNode!, selection.anchorOffset),
        head: editor.view.posAtDOM(selection.focusNode!, selection.focusOffset),
        text: selection.toString(),
      });
      const before = {
        doc: editor.getJSON(),
        anchor: editor.state.selection.anchor,
        head: editor.state.selection.head,
        native: native(),
      };
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: scenario === "home" ? "Home" : "End",
        shiftKey: scenario !== "plainEnd" && scenario !== "home",
        altKey: scenario === "alt",
        ctrlKey: scenario === "ctrl",
        metaKey: scenario === "meta",
        isComposing: scenario === "composition",
        keyCode: scenario === "keyCode229" ? 229 : 0,
      });
      if (scenario === "altGraph")
        Object.defineProperty(event, "getModifierState", { value: (name: string) => name === "AltGraph" });
      editor.view.dom.dispatchEvent(event);
      return {
        before,
        after: {
          doc: editor.getJSON(),
          anchor: editor.state.selection.anchor,
          head: editor.state.selection.head,
          native: native(),
        },
        prevented: event.defaultPrevented,
        keyCode: event.keyCode,
        viewComposing,
        modifiers: {
          alt: event.altKey,
          ctrl: event.ctrlKey,
          meta: event.metaKey,
          altGraph: event.getModifierState("AltGraph"),
        },
      };
    }, scenario);
    if (scenario === "keyCode229") expect(observed.keyCode).toBe(229);
    if (scenario === "viewComposing") expect(observed.viewComposing).toBe(true);
    if (scenario === "altGraph")
      expect(observed.modifiers).toEqual({ alt: false, ctrl: false, meta: false, altGraph: true });
    expect(observed.prevented).toBe(false);
    expect(observed.after).toEqual(observed.before);
  });
}

for (const kind of ["single", "wrapped"] as const) {
  test(`LTR AltGraph retains existing ${kind} heading selection`, async ({ page }) => {
    const text = kind === "single" ? "abcdef" : "alpha beta gamma delta epsilon zeta theta iota kappa lambda";
    await mount(page, { name: `LTR ${kind}`, text, direction: "ltr", width: kind === "single" ? 850 : 240 });
    const observed = await page.evaluate(() => {
      const editor = window.__semloRequireFixture("headingEndBoundary").controller.editor;
      const before = editor.getJSON();
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "End", shiftKey: true });
      Object.defineProperty(event, "getModifierState", { value: (name: string) => name === "AltGraph" });
      editor.view.dom.dispatchEvent(event);
      return {
        before,
        after: editor.getJSON(),
        prevented: event.defaultPrevented,
        anchor: editor.state.selection.anchor,
        head: editor.state.selection.head,
        selected: document.getSelection()?.toString() ?? "",
      };
    });
    expect(observed.prevented).toBe(true);
    expect(observed.after).toEqual(observed.before);
    expect(observed.anchor).toBe(1);
    expect(observed.head).toBeGreaterThan(1);
    expect(text.startsWith(observed.selected)).toBe(true);
    expect(observed.selected).toHaveLength(observed.head - 1);
    if (kind === "single") expect(observed.selected).toBe(text);
    else expect(observed.selected.length).toBeLessThan(text.length);
  });
}
