import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/heading/heading-end-boundary-fixture";

declare global {
  interface Window {
    endEvent?: KeyboardEvent;
  }
}

let origin = "";
let stop: (() => Promise<void>) | undefined;
const title = "alpha beta gamma delta epsilon zeta eta theta ".repeat(8);
const content = (numbered: boolean, text = title): JSONContent => ({
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 3, semloEditorHeadingNumbering: numbered ? "mixed" : null },
      content: [{ type: "text", text }],
    },
    { type: "paragraph", content: [{ type: "text", text: "NEXT" }] },
  ],
});

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/heading/heading-end-boundary-fixture.ts"));
});
afterAll(async () => stop?.());

async function mount(page: Page, numbered: boolean, native: boolean, text = title, width = 260) {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountHeadingEndBoundary === "function");
  await page.evaluate(
    ({ document, native, width }) => {
      window.__semloRequireFixture("mountHeadingEndBoundary")(document, width, native);
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
    { document: content(numbered, text), native, width },
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
        expect(selected.prevented).toBe(true);
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

for (const sample of [
  { name: "Chinese", text: "标题正文测试中文内容测试换行位置".repeat(12), width: 240 },
  { name: "graphemes", text: "cafe\u0301 emoji👩‍💻 alpha ".repeat(15), width: 260 },
  { name: "spaces", text: "alpha   beta gamma    delta ".repeat(14), width: 280 },
]) {
  for (const numbered of [false, true]) {
    for (const line of [0, 1] as const) {
      test(`${sample.name} soft wrap selects the clicked visual line: ${numbered ? "numbered" : "ordinary"} ${line}`, async ({
        page,
      }) => {
        await mount(page, numbered, false, sample.text, sample.width);
        const point = await clickBoundary(page, line);
        await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
        const before = await snapshot(page);
        expect(before.ambiguous).toBe(true);
        await page.keyboard.press("Shift+End");
        const after = await snapshot(page);
        expect(after.prevented).toBe(true);
        if (line === 0) expect(after.text).toBe("");
        else {
          expect(after.text).not.toContain("NEXT");
          expect(after.visibleRects.length).toBeGreaterThan(0);
          for (const rect of after.visibleRects) {
            expect(rect.top).toBeLessThanOrEqual(point.y);
            expect(rect.bottom).toBeGreaterThanOrEqual(point.y);
          }
          await page.keyboard.press("Backspace");
          await page.keyboard.press("ControlOrMeta+z");
          expect((await snapshot(page)).json).toEqual(before.json);
        }
      });
    }
  }
}

for (const numbered of [false, true]) {
  test(`typing immediately after upper boundary Shift+End inserts at the caret: ${numbered ? "numbered" : "ordinary"}`, async ({
    page,
  }) => {
    await mount(page, numbered, false);
    await clickBoundary(page, 0);
    const before = await snapshot(page);
    expect(before.ambiguous).toBe(true);
    const offset = before.dom.anchor! - 1;
    await page.keyboard.press("Shift+End");
    await page.keyboard.type("X");
    const after = await snapshot(page);
    const expected = structuredClone(before.json) as JSONContent;
    const node = expected.content![0].content![0];
    node.text = node.text!.slice(0, offset) + "X" + node.text!.slice(offset);
    expect(after.json).toEqual(expected);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await snapshot(page)).json).toEqual(before.json);
  });
}

test("a failed native line probe leaves no destructive selection", async ({ page }) => {
  await mount(page, false, false);
  await clickBoundary(page, 1);
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  await page.evaluate(() => {
    const selection = document.getSelection()!;
    if (!selection.anchorNode) throw new Error("Missing native selection");
    const view = window.__semloRequireFixture("headingEndBoundary").controller.editor.view;
    const pos = view.posAtDOM(selection.anchorNode, selection.anchorOffset);
    view.dispatch(
      view.state.tr.setSelection(
        (view.state.selection.constructor as typeof import("@tiptap/pm/state").TextSelection).create(
          view.state.doc,
          pos + 1,
        ),
      ),
    );
    view.dispatch(
      view.state.tr.setSelection(
        (view.state.selection.constructor as typeof import("@tiptap/pm/state").TextSelection).create(
          view.state.doc,
          pos,
        ),
      ),
    );
    const original = selection.modify.bind(selection);
    selection.modify = (...args) => {
      original(...args);
      throw new Error("fixture: line probe failed");
    };
  });
  const before = await snapshot(page);
  await page.keyboard.press("Shift+End");
  const after = await snapshot(page);
  expect(after.prevented).toBe(true);
  expect(after.json).toEqual(before.json);
  expect(after.dom).toMatchObject({ anchor: before.dom.anchor, focus: before.dom.focus, collapsed: true });
  expect(after.text).toBe("");
});

test("a host write during the native probe owns the final document and selection", async ({ page }) => {
  await mount(page, false, false);
  await clickBoundary(page, 1);
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("headingEndBoundary");
    const editor = fixture.controller.editor;
    const selection = document.getSelection()!;
    if (!selection.anchorNode) throw new Error("Missing native selection");
    const pos = editor.view.posAtDOM(selection.anchorNode, selection.anchorOffset);
    editor.commands.setTextSelection(pos + 1);
    editor.commands.setTextSelection(pos);
    const original = selection.modify.bind(selection);
    selection.modify = (...args) => {
      original(...args);
      editor.commands.insertContentAt(editor.state.doc.content.size - 1, "HOST");
    };
  });
  await page.keyboard.press("Shift+End");
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const after = await snapshot(page);
  expect(after.prevented).toBe(true);
  expect((after.json as JSONContent).content?.[1].content?.[0].text).toBe("NEXTHOST");
  expect(after.pm).toMatchObject({ anchor: after.dom.anchor, head: after.dom.focus });
});

test("Backspace after upper-boundary Shift+End deletes only the preceding character", async ({ page }) => {
  await mount(page, true, false);
  await clickBoundary(page, 0);
  const before = await snapshot(page);
  const offset = before.dom.anchor! - 1;
  await page.keyboard.press("Shift+End");
  expect((await snapshot(page)).text).toBe("");
  await page.keyboard.press("Backspace");
  const expected = structuredClone(before.json) as JSONContent;
  const node = expected.content![0].content![0];
  node.text = node.text!.slice(0, offset - 1) + node.text!.slice(offset);
  expect((await snapshot(page)).json).toEqual(expected);
  await page.keyboard.press("ControlOrMeta+z");
  expect((await snapshot(page)).json).toEqual(before.json);
});
