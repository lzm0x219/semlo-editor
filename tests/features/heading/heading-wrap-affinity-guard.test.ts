import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/heading/heading-end-boundary-fixture";

declare global {
  interface Window {
    endEvent?: KeyboardEvent;
  }
}

let origin = "";
let stop: (() => Promise<void>) | undefined;
const title = "alpha beta gamma delta epsilon zeta eta theta ".repeat(8);
const content = (numbered: boolean): JSONContent => ({
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 3, semloEditorHeadingNumbering: numbered ? "mixed" : null },
      content: [{ type: "text", text: title }],
    },
    { type: "paragraph", content: [{ type: "text", text: "NEXT" }] },
  ],
});

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});
beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/heading/heading-end-boundary-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const server = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${server.port}`;
  stop = () => server.server.close();
});
afterAll(async () => stop?.());

async function mount(page: Page, numbered: boolean, native: boolean) {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountHeadingEndBoundary === "function");
  await page.evaluate(
    ({ document, native }) => {
      window.__semloRequireFixture("mountHeadingEndBoundary")(document, 260, native);
      const editor = window.__semloRequireFixture("headingEndBoundary").controller.editor;
      window.endEvent = undefined;
      editor.view.dom.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "End" && event.shiftKey) window.endEvent = event;
        },
        true,
      );
    },
    { document: content(numbered), native },
  );
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
}

async function clickBoundary(page: Page, line: 0 | 1) {
  const point = await page.evaluate((line) => {
    const heading = document.querySelector("#heading-end-boundary h3");
    if (!heading) throw new Error("Missing heading");
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && node.parentElement?.closest('[contenteditable="false"]')) node = walker.nextNode();
    if (!node?.textContent) throw new Error("Missing text");
    const range = document.createRange();
    const first: DOMRect[] = [];
    let next: DOMRect | undefined;
    for (let offset = 0; offset < node.textContent.length; offset++) {
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      const r = range.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (first.length && r.top > first[0].top + 1) {
        next = r;
        break;
      }
      first.push(r);
    }
    if (!next || !first.length) throw new Error("Expected two visual lines");
    if (line === 1) return { x: next.left + Math.min(1, next.width / 4), y: (next.top + next.bottom) / 2 };
    const last = first.at(-1)!;
    return { x: Math.min(heading.getBoundingClientRect().right - 1, last.right + 4), y: (last.top + last.bottom) / 2 };
  }, line);
  await page.mouse.click(point.x, point.y);
  return point;
}

async function snapshot(page: Page) {
  return page.evaluate(() => {
    const editor = window.__semloRequireFixture("headingEndBoundary").controller.editor;
    const selection = document.getSelection();
    const anchor = selection?.anchorNode ? editor.view.posAtDOM(selection.anchorNode, selection.anchorOffset) : null;
    const focus = selection?.focusNode ? editor.view.posAtDOM(selection.focusNode, selection.focusOffset) : null;
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null;
    const view = editor.view;
    const before = anchor === null ? null : view.coordsAtPos(anchor, -1);
    const after = anchor === null ? null : view.coordsAtPos(anchor, 1);
    return {
      json: editor.getJSON(),
      text: selection?.toString(),
      dom: { anchor, focus, collapsed: selection?.isCollapsed },
      pm: editor.state.selection.toJSON(),
      prevented: window.endEvent?.defaultPrevented ?? null,
      ambiguous:
        !!before &&
        !!after &&
        (after.top > (before.top + before.bottom) / 2 || after.bottom < (before.top + before.bottom) / 2),
      rectCount: range ? Array.from(range.getClientRects()).filter((rect) => rect.height > 0).length : 0,
      visibleRects: range
        ? Array.from(range.getClientRects())
            .filter((rect) => rect.height > 0 && rect.width > 0)
            .map((rect) => ({ top: rect.top, bottom: rect.bottom }))
        : [],
    };
  });
}

for (const numbered of [false, true]) {
  for (const line of [0, 1] as const) {
    for (const immediate of [false, true]) {
      test(`ambiguous soft wrap ${numbered ? "numbered" : "ordinary"} line ${line + 1} ${immediate ? "immediate" : "settled"} is not guessed`, async ({
        page,
      }) => {
        await mount(page, numbered, false);
        const point = await clickBoundary(page, line);
        if (!immediate) await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
        const before = await snapshot(page);
        expect(before.dom.collapsed).toBe(true);
        expect(before.ambiguous).toBe(true);
        expect(before.rectCount).toBeGreaterThanOrEqual(2);
        await page.keyboard.press("Shift+End");
        await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
        const selected = await snapshot(page);
        expect(selected.json).toEqual(before.json);
        // If a future implementation can prove the click's visual side, it may
        // handle the key, but must never choose text from a different line.
        if (selected.prevented) {
          if (line === 0) {
            expect(selected.dom.collapsed).toBe(true);
            expect(selected.text).toBe("");
          } else {
            expect(selected.dom.collapsed).toBe(false);
            expect(selected.visibleRects.length).toBeGreaterThan(0);
            expect(selected.text).not.toContain("NEXT");
            for (const rect of selected.visibleRects) {
              expect(rect.top).toBeLessThanOrEqual(point.y);
              expect(rect.bottom).toBeGreaterThanOrEqual(point.y);
            }
          }
        }
      });
    }
  }
}
