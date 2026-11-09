import { writeFile } from "node:fs/promises";

import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/heading/heading-end-boundary-fixture";
type Sample = { name: string; content: JSONContent[]; mode?: "rtl" | "vertical" | "no-segmenter" };
const text = (value: string, marks?: JSONContent["marks"]): JSONContent => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const samples: Sample[] = [
  { name: "segmenter unavailable", content: [text("test ".repeat(25))], mode: "no-segmenter" },
  { name: "RTL wrapped", content: [text("אבג דהו ".repeat(20))], mode: "rtl" },
  { name: "Cyrillic wrapped", content: [text("Пример текст ".repeat(20))] },
  { name: "mixed bidi wrapped", content: [text("test אבג ".repeat(20))] },
  { name: "Arabic question mark wrapped", content: [text("test؟ tail ".repeat(20))] },
  { name: "Arabic tatweel wrapped", content: [text("testـ tail ".repeat(20))] },
  { name: "Indic Siyaq digit wrapped", content: [text("test𞱱 tail ".repeat(20))] },
  { name: "unsupported common character wrapped", content: [text("test€ tail ".repeat(20))] },
  { name: "vertical writing", content: [text("test ".repeat(25))], mode: "vertical" },
  {
    name: "inline node",
    content: [
      text("test ".repeat(8)),
      { type: "semloEditorStatus", attrs: { label: "status", color: 0 } },
      text("tail ".repeat(12)),
    ],
  },
  {
    name: "different inline size",
    content: [
      text("test "),
      text("BIG", [{ type: "textStyle", attrs: { fontSize: "32px" } }]),
      text("tail ".repeat(20)),
    ],
  },
];
test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    headingFallbackEvent?: { event?: KeyboardEvent };
  }
}

let origin: string;
let stop: (() => Promise<void>) | undefined;
const results: unknown[] = [];
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/heading/heading-end-boundary-fixture.ts"));
});
afterAll(async () => {
  const output = process.env.SEMLO_MULTILINE_DIAGNOSTICS;
  if (output) await writeFile(`${output}/heading-multiline-fallback-results.json`, JSON.stringify(results, null, 2));
  await stop?.();
});
async function run(page: Page, item: Sample, native: boolean) {
  const doc: JSONContent = {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 3 }, content: item.content },
      { type: "paragraph", content: [text("NEXT")] },
    ],
  };
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountHeadingEndBoundary === "function");
  await page.evaluate(
    ({ doc, native, mode }) => {
      window.__semloRequireFixture("mountHeadingEndBoundary")(doc, 260, native);
      const view = window.__semloRequireFixture("headingEndBoundary").controller.editor.view;
      if (mode === "rtl") view.dom.setAttribute("dir", "rtl");
      if (mode === "vertical") {
        const style = document.createElement("style");
        style.textContent = "#heading-end-boundary h3 { writing-mode: vertical-rl !important; }";
        document.head.append(style);
      }
      if (mode === "no-segmenter")
        Object.defineProperty(Intl, "Segmenter", { configurable: true, writable: true, value: undefined });
      const holder: { event?: KeyboardEvent } = {};
      window.headingFallbackEvent = holder;
      view.dom.addEventListener("keydown", (event) => {
        if (event.key === "End") holder.event = event;
      });
    },
    { doc, native, mode: item.mode },
  );
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const target = page.locator("#heading-end-boundary .semlo-editor-prose h3");
  if (item.mode === "vertical") await target.click();
  else await target.click({ position: { x: 100, y: 8 } });
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const before = await page.evaluate(() =>
    window.__semloRequireFixture("headingEndBoundary").controller.editor.getJSON(),
  );
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const after = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("headingEndBoundary").controller.editor;
    const dom = document.getSelection()!;
    const event = window.__semloRequireFixture("headingFallbackEvent").event;
    const heading = editor.view.dom.querySelector("h3")!;
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement?.closest('[contenteditable="false"]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const runs: Array<{ size: string; top: number; bottom: number }> = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getClientRects()[0];
      if (rect) runs.push({ size: getComputedStyle(node.parentElement!).fontSize, top: rect.top, bottom: rect.bottom });
    }
    const endpoint = (node: Node | null, offset: number) => ({
      node: node?.nodeName,
      parent: node?.parentElement?.tagName,
      offset,
    });
    return {
      json: editor.getJSON(),
      selected: dom.toString(),
      inHeading:
        !!dom.anchorNode && !!dom.focusNode && heading.contains(dom.anchorNode) && heading.contains(dom.focusNode),
      anchor: endpoint(dom.anchorNode, dom.anchorOffset),
      focus: endpoint(dom.focusNode, dom.focusOffset),
      pm: [editor.state.selection.anchor, editor.state.selection.head],
      prevented: event?.defaultPrevented,
      trusted: event?.isTrusted,
      focused: editor.view.hasFocus(),
      runs,
    };
  });
  return { ...after, before };
}
for (const item of samples)
  test(`unsupported layout stays intact: ${item.name}`, async ({ page }) => {
    const candidate = await run(page, item, false);
    results.push({
      name: item.name,
      selected: candidate.selected,
      anchor: candidate.anchor,
      focus: candidate.focus,
      pm: candidate.pm,
      prevented: candidate.prevented,
      runs: candidate.runs,
    });
    expect(candidate.json).toEqual(candidate.before);
    if (candidate.prevented) {
      expect(candidate.inHeading).toBe(true);
      expect(candidate.selected).not.toContain("NEXT");
    }
    expect(candidate.trusted).toBe(true);
    expect(candidate.focused).toBe(true);
    if (item.name === "different inline size") {
      expect(candidate.runs[0].size).not.toBe(candidate.runs[1].size);
      expect(candidate.runs[0].top).toBeLessThan(candidate.runs[1].bottom);
      expect(candidate.runs[1].top).toBeLessThan(candidate.runs[0].bottom);
    }
  });
