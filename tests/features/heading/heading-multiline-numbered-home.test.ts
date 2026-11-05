import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/heading/heading-end-boundary-fixture";
import type {} from "../../fixtures/heading/heading-end-host-fixture";

type KeyTrace = {
  event: KeyboardEvent;
  native: { text: string; empty: boolean; from: number | null; to: number | null };
  pm: { empty: boolean; from: number; to: number };
};
declare global {
  interface Window {
    headingNumberedHomeTrace?: KeyTrace[];
    headingNumberedHomeUpdates?: number;
  }
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});
let origin: string;
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/heading/heading-multiline-numbered-home-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = () => server.close();
});
afterAll(async () => stop?.());

const title = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".repeat(5);
type Sample = { style: "mixed" | "decimal" | "chinese"; line: 0 | 1; bold: boolean };
function documentFor(sample: Sample): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 3, semloEditorHeadingNumbering: sample.style },
        content: [{ type: "text", text: title, ...(sample.bold ? { marks: [{ type: "bold" }] } : {}) }],
      },
      { type: "paragraph", content: [{ type: "text", text: "NEXT" }] },
    ],
  };
}

async function mount(page: Page, sample: Sample) {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountHeadingEndBoundary === "function");
  await page.evaluate(
    (content) => window.__semloRequireFixture("mountHeadingEndBoundary")(content, 260),
    documentFor(sample),
  );
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
}

async function geometry(page: Page, visualLine: number) {
  return page.evaluate((line) => {
    const view = window.__semloRequireFixture("headingEndBoundary").controller.editor.view;
    const heading = view.dom.querySelector("h3");
    if (!heading) throw new Error("Missing heading");
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement?.closest('[contenteditable="false"]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const node = walker.nextNode() as Text | null;
    if (!node || walker.nextNode()) throw new Error("Expected a single title text node");
    const lineHeight = Number.parseFloat(getComputedStyle(heading).lineHeight);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) throw new Error("Missing heading line height");
    const chars = [...node.data].map((character, index) => {
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + character.length);
      const rect = range.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) throw new Error("Missing character geometry");
      return {
        from: index,
        to: index + character.length,
        text: character,
        x: (rect.left + rect.right) / 2,
        y: (rect.top + rect.bottom) / 2,
        top: rect.top,
      };
    });
    const top = chars[0].top;
    const rows = new Map<number, typeof chars>();
    for (const char of chars) {
      const index = Math.round((char.top - top) / lineHeight);
      const row = rows.get(index) ?? [];
      row.push(char);
      rows.set(index, row);
    }
    const row = rows.get(line);
    if (!row || rows.size < 2) throw new Error("Expected multiple visual lines");
    const target = row[Math.floor(row.length / 2)];
    const from = row[0].from;
    const to = row[row.length - 1].to;
    const doc = view.state.doc;
    const model = doc.firstChild;
    if (!model || model.type.name !== "heading") throw new Error("Missing model heading");
    const replacement = model.copy(model.content.cut(0, from).append(model.content.cut(to)));
    return {
      from,
      to,
      text: row.map((char) => char.text).join(""),
      x: target.x,
      y: target.y,
      expected: doc.copy(doc.content.replaceChild(0, replacement)).toJSON(),
    };
  }, visualLine);
}

async function inspect(page: Page) {
  return page.evaluate(() => {
    const editor = window.__semloRequireFixture("headingEndBoundary").controller.editor;
    const selection = editor.state.selection;
    const native = document.getSelection();
    const fragment = native?.rangeCount ? native.getRangeAt(0).cloneContents() : null;
    fragment
      ?.querySelectorAll('[contenteditable="false"], .semlo-editor-heading-number')
      .forEach((node) => node.remove());
    return {
      json: editor.getJSON(),
      selection: { from: selection.from, to: selection.to, empty: selection.empty },
      dom: { text: fragment?.textContent ?? "", empty: native?.isCollapsed ?? true },
      focused: editor.view.hasFocus(),
      updates: window.__semloRequireFixture("headingNumberedHomeUpdates"),
    };
  });
}

async function capture(page: Page) {
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("headingEndBoundary").controller.editor;
    const traces: KeyTrace[] = [];
    window.headingNumberedHomeTrace = traces;
    window.headingNumberedHomeUpdates = 0;
    editor.on("update", () => {
      window.headingNumberedHomeUpdates = window.__semloRequireFixture("headingNumberedHomeUpdates") + 1;
    });
    editor.view.dom.addEventListener(
      "keydown",
      (event) => {
        if (!["Home", "End", "Backspace"].includes(event.key)) return;
        const native = document.getSelection();
        const range = native?.rangeCount ? native.getRangeAt(0) : null;
        const fragment = range?.cloneContents();
        fragment
          ?.querySelectorAll('[contenteditable="false"], .semlo-editor-heading-number')
          .forEach((node) => node.remove());
        const selection = editor.state.selection;
        traces.push({
          event,
          native: {
            text: fragment?.textContent ?? "",
            empty: native?.isCollapsed ?? true,
            from: range ? editor.view.posAtDOM(range.startContainer, range.startOffset) : null,
            to: range ? editor.view.posAtDOM(range.endContainer, range.endOffset) : null,
          },
          pm: { empty: selection.empty, from: selection.from, to: selection.to },
        });
      },
      true,
    );
  });
}

const samples: Sample[] = [
  ...(["mixed", "decimal", "chinese"] as const).flatMap((style) =>
    ([0, 1] as const).map((line) => ({ style, line, bold: false })),
  ),
  { style: "mixed", line: 0, bold: true },
  { style: "mixed", line: 1, bold: true },
];
for (const sample of samples) {
  for (const immediate of [false, true]) {
    test(`safety: ${sample.style} ${sample.bold ? "bold " : ""}numbered visual line ${sample.line + 1}, ${immediate ? "immediate" : "stepped"}`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await mount(page, sample);
      const line = await geometry(page, sample.line);
      await capture(page);
      const before = await inspect(page);
      await page.mouse.click(line.x, line.y);
      await page.keyboard.press("Home");
      if (!immediate) {
        await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
        expect((await inspect(page)).selection).toEqual({ from: 1 + line.from, to: 1 + line.from, empty: true });
      }
      await page.keyboard.press("Shift+End");
      if (!immediate) {
        await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
        expect((await inspect(page)).selection).toEqual({ from: 1 + line.from, to: 1 + line.to, empty: false });
      }
      await page.keyboard.press("Backspace");
      await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
      const events = await page.evaluate(() =>
        window.__semloRequireFixture("headingNumberedHomeTrace").map(({ event, native, pm }) => ({
          key: event.key,
          prevented: event.defaultPrevented,
          trusted: event.isTrusted,
          native,
          pm,
        })),
      );
      expect(events.map((event) => event.key)).toEqual(["Home", "End", "Backspace"]);
      expect(events.every((event) => event.trusted)).toBe(true);
      // The wrapped-line safeguard now consumes Home after establishing the
      // verified visual line; the selection/content checks below remain unchanged.
      expect(events[0].prevented).toBe(true);
      expect(events[1].prevented).toBe(true);
      expect(events[2].native).toEqual({ empty: false, text: line.text, from: 1 + line.from, to: 1 + line.to });
      expect(events[2].pm).toEqual({ empty: false, from: 1 + line.from, to: 1 + line.to });
      const removed = await inspect(page);
      expect(removed.json).toEqual(line.expected);
      expect(removed.focused).toBe(true);
      expect(removed.updates).toBe(1);
      expect(removed.selection).toEqual({ from: 1 + line.from, to: 1 + line.from, empty: true });
      await page.keyboard.press("ControlOrMeta+z");
      await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
      const undone = await inspect(page);
      expect(undone.json).toEqual(before.json);
      expect(undone.selection).toEqual({ from: 1 + line.from, to: 1 + line.to, empty: false });
      expect(undone.dom).toEqual({ text: line.text, empty: false });
      expect(undone.focused).toBe(true);
      expect(undone.updates).toBe(2);
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
      const redone = await inspect(page);
      expect(redone.json).toEqual(line.expected);
      expect(redone.focused).toBe(true);
      expect(redone.updates).toBe(3);
      expect(errors).toEqual([]);
    });
  }
}

for (const order of ["early", "late"] as const) {
  test(`safety: ${order} host rejects numbered multiline Home without changing focus, selection or content`, async ({
    page,
  }) => {
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountHeadingEndHost === "function");
    await page.evaluate(
      ({ content, order }) => {
        window.__semloRequireFixture("mountHeadingEndHost")(content, "reject-home", order);
        const host = document.querySelector<HTMLElement>("#heading-end-host");
        if (!host) throw new Error("Missing host");
        host.style.width = "260px";
      },
      { content: documentFor({ style: "mixed", line: 0, bold: false }), order },
    );
    await page.evaluate(() => window.__semloRequireFixture("headingEndHost").settle());
    const before = await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("headingEndHost");
      const editor = fixture.controller.editor;
      editor.view.focus();
      editor.commands.setTextSelection(4);
      const start = editor.view.coordsAtPos(1, 1);
      const caret = editor.view.coordsAtPos(4, 1);
      return {
        json: editor.getJSON(),
        selection: [editor.state.selection.anchor, editor.state.selection.head],
        sameLine: caret.top < start.bottom && caret.bottom > start.top,
        changes: fixture.changes,
      };
    });
    expect(before.sameLine).toBe(true);
    await page.keyboard.press("Home");
    await page.evaluate(() => window.__semloRequireFixture("headingEndHost").settle());
    const after = await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("headingEndHost");
      const editor = fixture.controller.editor;
      const native = document.getSelection();
      return {
        json: editor.getJSON(),
        selection: [editor.state.selection.anchor, editor.state.selection.head],
        dom: native?.anchorNode ? editor.view.posAtDOM(native.anchorNode, native.anchorOffset) : null,
        focused: editor.view.hasFocus(),
        prevented: fixture.lastHomePrevented(),
        changes: fixture.changes,
        trace: fixture.trace,
      };
    });
    expect(after.json).toEqual(before.json);
    expect(after.selection).toEqual(before.selection);
    expect(after.dom).toBe(before.selection[0]);
    expect(after.focused).toBe(true);
    expect(after.prevented).toBe(true);
    expect(after.changes).toBe(before.changes);
    expect(after.trace.filter((item) => item.phase === "home-filter")).toHaveLength(1);
  });
}
