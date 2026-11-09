import { writeFile } from "node:fs/promises";

import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/heading/heading-end-boundary-fixture";

declare global {
  interface Window {
    headingMultiTiming?: { elapsed?: number; prevented?: boolean; trusted?: boolean; coordsCalls?: number };
  }
}

type Sample = {
  name: string;
  content: JSONContent[];
  expected?: string;
  textNode?: string;
  width?: number;
  before?: boolean;
  indent?: number;
  clickOffset?: number;
};
const txt = (text: string, marks?: JSONContent["marks"]): JSONContent => ({
  type: "text",
  text,
  ...(marks ? { marks } : {}),
});
const emoji = "a🇨🇳é👨‍👩‍👧‍👦 ";
const samples: Sample[] = [
  {
    name: "hard-break-first",
    content: [txt("test"), { type: "hardBreak" }, txt("TAIL")],
    expected: "test",
    textNode: "test",
  },
  {
    name: "hard-break-second",
    content: [txt("test"), { type: "hardBreak" }, txt("TAIL")],
    expected: "TAIL",
    textNode: "TAIL",
  },
  { name: "soft-wrap-first", content: [txt("test ".repeat(25))], width: 260 },
  {
    name: "soft-wrap-second",
    content: [txt("test ".repeat(25))],
    width: 260,
    clickOffset: 25,
  },
  {
    name: "preceding-block",
    content: [txt("test ".repeat(25))],
    width: 260,
    before: true,
  },
  { name: "indented-heading", content: [txt("test ".repeat(25))], width: 260, indent: 1 },
  { name: "emoji-wrap", content: [txt(emoji.repeat(18))], width: 260 },
  {
    name: "cross-mark-combining",
    content: [
      txt("test ".repeat(3)),
      txt("a", [{ type: "bold" }]),
      txt("\u0301", [{ type: "italic" }]),
      txt(" tail ".repeat(14)),
    ],
    width: 260,
  },
  {
    name: "cross-mark-zwj",
    content: [
      txt("test ".repeat(3)),
      txt("👨", [{ type: "bold" }]),
      txt("\u200d👩\u200d", [{ type: "italic" }]),
      txt("👧\u200d👦"),
      txt(" tail ".repeat(14)),
    ],
    width: 260,
  },
  {
    name: "cross-mark-surrogate",
    content: [
      txt("test ".repeat(3)),
      txt("\ud83d", [{ type: "bold" }]),
      txt("\ude00", [{ type: "italic" }]),
      txt(" tail ".repeat(14)),
    ],
    width: 260,
  },
  {
    name: "hard-break-cross-mark",
    content: [txt("a", [{ type: "bold" }]), txt("\u0301", [{ type: "italic" }]), { type: "hardBreak" }, txt("TAIL")],
    expected: "á",
    textNode: "a",
  },
  {
    name: "marked-wrap",
    content: [txt("test ".repeat(10), [{ type: "bold" }]), txt("tail ".repeat(10), [{ type: "italic" }])],
    width: 260,
  },
  { name: "long-wrap", content: [txt("test ".repeat(800))], width: 850 },
];
test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

let origin: string;
let stop: (() => Promise<void>) | undefined;
const results: unknown[] = [];
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/heading/heading-end-boundary-fixture.ts"));
});
afterAll(async () => {
  const output = process.env.SEMLO_MULTILINE_DIAGNOSTICS;
  if (output) await writeFile(`${output}/heading-multiline-probe-results.json`, JSON.stringify(results, null, 2));
  await stop?.();
});
async function mount(page: Page, item: Sample) {
  const doc: JSONContent = {
    type: "doc",
    content: [
      ...(item.before ? [{ type: "paragraph", content: [txt("FIRST")] }] : []),
      {
        type: "heading",
        attrs: { level: 3, ...(item.indent ? { semloEditorIndent: item.indent } : {}) },
        content: item.content,
      },
      { type: "paragraph", content: [txt("NEXT")] },
    ],
  };
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountHeadingEndBoundary === "function");
  await page.evaluate(({ doc, width }) => window.__semloRequireFixture("mountHeadingEndBoundary")(doc, width), {
    doc,
    width: item.width ?? 850,
  });
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  await page.evaluate(() => {
    let start = 0;
    const result: { elapsed?: number; prevented?: boolean; trusted?: boolean; coordsCalls?: number } = {};
    window.headingMultiTiming = result;
    const view = window.__semloRequireFixture("headingEndBoundary").controller.editor.view;
    const originalCoords = view.coordsAtPos.bind(view);
    let coordsCalls = 0;
    view.coordsAtPos = (position, side) => {
      coordsCalls++;
      return originalCoords(position, side);
    };
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === "End" && event.shiftKey) {
          start = performance.now();
          coordsCalls = 0;
        }
      },
      true,
    );
    view.dom.addEventListener("keydown", (event) => {
      if (event.key === "End" && event.shiftKey) {
        result.elapsed = performance.now() - start;
        result.prevented = event.defaultPrevented;
        result.trusted = event.isTrusted;
        result.coordsCalls = coordsCalls;
      }
    });
  });
  if (item.textNode || item.clickOffset !== undefined) {
    const point = await page.evaluate(
      ({ content, offset }) => {
        const heading = window
          .__semloRequireFixture("headingEndBoundary")
          .controller.editor.view.dom.querySelector("h3")!;
        const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT, {
          acceptNode: (node) =>
            node.parentElement?.closest('[contenteditable="false"]')
              ? NodeFilter.FILTER_REJECT
              : NodeFilter.FILTER_ACCEPT,
        });
        let node: Node | null;
        while ((node = walker.nextNode()))
          if ((content && node.textContent === content) || (!content && node.textContent?.includes("test"))) {
            const range = document.createRange();
            range.setStart(node, offset ?? 1);
            range.collapse(true);
            const rect = range.getBoundingClientRect();
            return { x: rect.left, y: (rect.top + rect.bottom) / 2 };
          }
        throw new Error("Missing target text");
      },
      { content: item.textNode, offset: item.clickOffset },
    );
    await page.mouse.click(point.x, point.y);
  } else
    await page
      .locator("#heading-end-boundary .semlo-editor-prose h3")
      .first()
      .click({ position: { x: 100, y: 8 } });
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
}
async function snapshot(page: Page) {
  return page.evaluate(() => {
    const editor = window.__semloRequireFixture("headingEndBoundary").controller.editor;
    const selection = editor.state.selection;
    return {
      json: editor.getJSON() as JSONContent,
      text: document.getSelection()?.toString(),
      anchorType: selection.$anchor.parent.type.name,
      headType: selection.$head.parent.type.name,
      anchorOffset: selection.$anchor.parentOffset,
      headOffset: selection.$head.parentOffset,
      nativeAnchor: {
        parent: document.getSelection()?.anchorNode?.parentElement?.tagName,
        offset: document.getSelection()?.anchorOffset,
      },
      nativeFocus: {
        parent: document.getSelection()?.focusNode?.parentElement?.tagName,
        offset: document.getSelection()?.focusOffset,
      },
      focused: editor.view.hasFocus(),
    };
  });
}
for (const item of samples) {
  test(item.name, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mount(page, item);
    const initial = await snapshot(page);
    await page.keyboard.press("Home");
    const home = await snapshot(page);
    const expectedLine =
      item.name.startsWith("soft-wrap") || item.name === "preceding-block"
        ? await page
            .locator("#heading-end-boundary .semlo-editor-prose h3")
            .first()
            .evaluate((heading, start) => {
              const node = Array.from(heading.childNodes).find((child) => child.nodeType === Node.TEXT_NODE);
              if (!node?.textContent) throw new Error("Missing heading text");
              const range = document.createRange();
              let top: number | undefined;
              let end = start;
              for (let i = start; i < node.textContent.length; i++) {
                range.setStart(node, i);
                range.setEnd(node, i + 1);
                const rect = range.getBoundingClientRect();
                top ??= rect.top;
                if (Math.abs(rect.top - top) > 1) break;
                end = i + 1;
              }
              return node.textContent.slice(start, end);
            }, home.anchorOffset)
        : item.expected;
    if (item.name === "hard-break-second")
      expect(home).toMatchObject({
        anchorOffset: 5,
        headOffset: 5,
        text: "",
        focused: true,
      });
    await page.keyboard.press("Shift+End");
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    const selected = await snapshot(page);
    const visual = await page.evaluate(() => {
      const view = window.__semloRequireFixture("headingEndBoundary").controller.editor.view;
      const selection = view.state.selection;
      if (!selection.$anchor.sameParent(selection.$head) || selection.$anchor.parent.type.name !== "heading")
        return null;
      const heading = selection.$anchor.parent;
      const full = heading.textBetween(0, heading.content.size, "", "\n");
      const offsets = [
        0,
        ...Array.from(
          new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(full),
          (part) => part.index + part.segment.length,
        ),
      ];
      const next = offsets.find((value) => value > selection.$head.parentOffset);
      const lineStart = view.coordsAtPos(selection.anchor, 1);
      const lineEnd = view.coordsAtPos(selection.head, -1);
      const nextEnd = next === undefined ? null : view.coordsAtPos(selection.$head.start() + next, -1);
      return {
        lineStart: { top: lineStart.top, bottom: lineStart.bottom },
        lineEnd: { top: lineEnd.top, bottom: lineEnd.bottom },
        nextEnd: nextEnd && { top: nextEnd.top, bottom: nextEnd.bottom },
      };
    });
    const timing = await page.evaluate(() => window.__semloRequireFixture("headingMultiTiming"));
    const result = {
      name: item.name,
      home: { anchor: home.nativeAnchor, pm: home.anchorOffset },
      selected: {
        text: selected.text,
        anchor: selected.nativeAnchor,
        focus: selected.nativeFocus,
        from: selected.anchorOffset,
        to: selected.headOffset,
      },
      visual,
      following: undefined as string | undefined,
      undo: false,
      immediate: false,
      timing,
    };
    results.push(result);
    expect(timing.trusted).toBe(true);
    expect(timing.prevented).toBe(true);
    expect(selected.anchorType).toBe("heading");
    expect(selected.headType).toBe("heading");
    if (!visual) throw new Error("Selection crosses outside heading");
    const center = (visual.lineStart.top + visual.lineStart.bottom) / 2;
    expect(visual.lineEnd.top).toBeLessThanOrEqual(center);
    expect(visual.lineEnd.bottom).toBeGreaterThanOrEqual(center);
    if (visual.nextEnd) expect(visual.nextEnd.top).toBeGreaterThan(center);
    expect(selected.text).not.toContain("NEXT");
    if (expectedLine !== undefined) {
      expect(expectedLine.length).toBeGreaterThan(0);
      expect(selected.text).toBe(expectedLine);
    }
    if (item.name === "emoji-wrap" || item.name.startsWith("cross-mark") || item.name === "hard-break-cross-mark") {
      const full = item.content.map((node) => (node.type === "hardBreak" ? "\n" : (node.text ?? ""))).join("");
      const boundaries = new Set([
        0,
        ...Array.from(
          new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(full),
          (part) => part.index + part.segment.length,
        ),
      ]);
      expect(boundaries.has(selected.anchorOffset)).toBe(true);
      expect(boundaries.has(selected.headOffset)).toBe(true);
      expect(selected.text?.length).toBeGreaterThan(0);
      expect(selected.text?.length).toBeLessThan(full.length);
    }
    if (item.name === "long-wrap") {
      expect(selected.text?.length).toBeGreaterThan(0);
      expect(selected.text?.length).toBeLessThan(200);
      expect(timing.coordsCalls).toBeLessThan(40);
    }
    await page.keyboard.press("Backspace");
    const after = await snapshot(page);
    result.following = after.json.content?.at(-1)?.content?.[0].text;
    expect(after.json.content?.at(-1)?.content?.[0].text).toBe("NEXT");
    expect(after.focused).toBe(true);
    await page.keyboard.press("ControlOrMeta+z");
    const undone = await snapshot(page);
    expect(undone.json).toEqual(initial.json);
    result.undo = JSON.stringify(undone.json) === JSON.stringify(initial.json);
    await mount(page, item);
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.press("Backspace");
    const immediate = await snapshot(page);
    expect(immediate.json).toEqual(after.json);
    result.immediate = true;
    await page.keyboard.press("ControlOrMeta+z");
    expect((await snapshot(page)).json).toEqual(initial.json);
    expect(errors).toEqual([]);
  });
}
