import { afterAll, beforeAll, expect, test } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/heading/heading-hardbreak-stale-fixture";
let origin = "",
  stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/heading/heading-hardbreak-stale-fixture.ts"));
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => installFixtureGuards(page));
for (const numbered of [false, true])
  for (const order of ["early", "late"] as const) {
    test(`${order} rejected hardBreak line end keeps freshly clicked ${numbered ? "numbered" : "ordinary"} caret`, async ({
      page,
    }) => {
      await page.goto(origin);
      await page.waitForFunction(() => typeof window.mountHardBreakStale === "function");
      const content: JSONContent = {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 3, semloEditorHeadingNumbering: numbered ? "mixed" : null },
            content: [{ type: "text", text: "alpha" }, { type: "hardBreak" }, { type: "text", text: "beta" }],
          },
          { type: "paragraph", content: [{ type: "text", text: "NEXT" }] },
        ],
      };
      await page.evaluate(({ content, order }) => window.__semloRequireFixture("mountHardBreakStale")(content, order), {
        content,
        order,
      });
      const start = await page.evaluate(async () => {
        const f = window.__semloRequireFixture("hardBreakStale"),
          e = f.controller.editor,
          v = e.view;
        const heading = v.dom.querySelector("h3")!,
          walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node && node.parentElement?.closest('[contenteditable="false"]')) node = walker.nextNode();
        if (!node?.textContent) throw new Error("missing heading text");
        const range = document.createRange();
        range.setStart(node, node.textContent.length - 1);
        range.setEnd(node, node.textContent.length);
        const r = range.getBoundingClientRect();
        const end = e.state.doc.content.size - 1;
        e.commands.setTextSelection(end);
        v.focus();
        await f.settle();
        f.arm("special");
        return { x: r.right + 2, y: (r.top + r.bottom) / 2, end, json: e.getJSON() };
      });
      await page.mouse.click(start.x, start.y);
      await page.keyboard.press("Shift+End");
      await page.keyboard.type("X");
      await page.evaluate(() => window.__semloRequireFixture("hardBreakStale").settle());
      const after = await page.evaluate(() => {
        const f = window.__semloRequireFixture("hardBreakStale"),
          e = f.controller.editor;
        return {
          keys: f.keys,
          trace: f.trace,
          events: f.events.map((event) => ({ trusted: event.isTrusted, prevented: event.defaultPrevented })),
          focusCalls: f.focusCalls(),
          first: e.state.doc.firstChild?.textContent,
          last: e.state.doc.lastChild?.textContent,
          focused: e.view.hasFocus(),
        };
      });
      expect(after.keys[0]).toMatchObject({ key: "End", native: 6, pm: start.end, trusted: true });
      expect(after.events).toEqual([{ trusted: true, prevented: true }]);
      expect(after.trace.some((entry) => entry.rejected && entry.preventHistory)).toBe(true);
      expect(after.focusCalls).toBe(0);
      expect(after.first).toBe("alphaXbeta");
      expect(after.last).toBe("NEXT");
      expect(after.focused).toBe(true);
      await page.keyboard.press("ControlOrMeta+z");
      expect(
        await page.evaluate(() => window.__semloRequireFixture("hardBreakStale").controller.editor.getJSON()),
      ).toEqual(start.json);
    });
  }

for (const numbered of [false, true])
  for (const order of ["early", "late"] as const) {
    test(`${order} host rejecting all selections protects ${numbered ? "numbered" : "ordinary"} caret`, async ({
      page,
    }) => {
      await page.goto(origin);
      await page.waitForFunction(() => typeof window.mountHardBreakStale === "function");
      const content: JSONContent = {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 3, semloEditorHeadingNumbering: numbered ? "mixed" : null },
            content: [{ type: "text", text: "alpha" }, { type: "hardBreak" }, { type: "text", text: "beta" }],
          },
          { type: "paragraph", content: [{ type: "text", text: "NEXT" }] },
        ],
      };
      await page.evaluate(({ content, order }) => window.__semloRequireFixture("mountHardBreakStale")(content, order), {
        content,
        order,
      });
      const start = await page.evaluate(async () => {
        const f = window.__semloRequireFixture("hardBreakStale"),
          e = f.controller.editor,
          v = e.view;
        const heading = v.dom.querySelector("h3")!,
          walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node && node.parentElement?.closest('[contenteditable="false"]')) node = walker.nextNode();
        if (!node?.textContent) throw new Error("missing heading text");
        const range = document.createRange();
        range.setStart(node, node.textContent.length - 1);
        range.setEnd(node, node.textContent.length);
        const r = range.getBoundingClientRect();
        const end = e.state.doc.content.size - 1;
        e.commands.setTextSelection(end);
        v.focus();
        await f.settle();
        f.arm("all");
        return { x: r.right + 2, y: (r.top + r.bottom) / 2, end, json: e.getJSON() };
      });
      await page.mouse.click(start.x, start.y);
      await page.keyboard.press("Shift+End");
      await page.evaluate(() => window.__semloRequireFixture("hardBreakStale").settle());
      const after = await page.evaluate(() => {
        const f = window.__semloRequireFixture("hardBreakStale"),
          e = f.controller.editor;
        return {
          keys: f.keys,
          trace: f.trace,
          events: f.events.map((event) => ({ trusted: event.isTrusted, prevented: event.defaultPrevented })),
          focusCalls: f.focusCalls(),
          first: e.state.doc.firstChild?.textContent,
          last: e.state.doc.lastChild?.textContent,
          focused: e.view.hasFocus(),
          pm: e.state.selection.toJSON(),
          native: (() => {
            const selection = document.getSelection();
            return selection?.anchorNode ? e.view.posAtDOM(selection.anchorNode, selection.anchorOffset) : null;
          })(),
          json: e.getJSON(),
        };
      });
      await page.keyboard.press("Backspace");
      await page.evaluate(() => window.__semloRequireFixture("hardBreakStale").settle());
      const afterBackspace = await page.evaluate(() => {
        const f = window.__semloRequireFixture("hardBreakStale"),
          e = f.controller.editor,
          selection = document.getSelection();
        return {
          json: e.getJSON(),
          pm: e.state.selection.toJSON(),
          native: selection?.anchorNode ? e.view.posAtDOM(selection.anchorNode, selection.anchorOffset) : null,
          trace: f.trace,
          first: e.state.doc.firstChild?.textContent,
          last: e.state.doc.lastChild?.textContent,
          focused: e.view.hasFocus(),
        };
      });
      expect(after.focusCalls).toBe(0);
      expect(after.pm).toMatchObject({ anchor: start.end, head: start.end });
      expect(after.native).toBe(start.end);
      expect(after.trace.filter((entry) => entry.rejected)).toHaveLength(2);
      expect(afterBackspace.json).toEqual(start.json);
      expect(afterBackspace.last).toBe("NEXT");
      expect(afterBackspace.native).toBe(afterBackspace.pm.anchor);
      expect(afterBackspace.trace.some((entry) => entry.docChanged && entry.rejected)).toBe(true);
      expect(afterBackspace.focused).toBe(true);
    });
  }
