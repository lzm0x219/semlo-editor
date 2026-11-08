import { afterAll, beforeAll, expect, test } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type { HostMode } from "../../fixtures/heading/heading-end-host-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/heading/heading-end-host-fixture.ts"));
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => installFixtureGuards(page));

for (const order of ["early", "late"] as const) {
  for (const mode of [
    "reject",
    "append-meta",
    "append-selection",
    "append-doc",
  ] as const satisfies readonly HostMode[]) {
    for (const sample of [
      { name: "plain", text: "אבג דהו", numbered: false, dir: "rtl", bold: false },
      { name: "numbered mixed", text: "אבג abc דהו", numbered: true, dir: "rtl", bold: false },
      { name: "bold numbered LTR mixed", text: "标题 אבג 正文", numbered: true, dir: "ltr", bold: true },
    ])
      test(`local ${sample.name} ${order} host ${mode} owns the final selection`, async ({ page }) => {
        const content: JSONContent = {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 3, ...(sample.numbered ? { semloEditorHeadingNumbering: "mixed" } : {}) },
              content: [{ type: "text", text: sample.text, ...(sample.bold ? { marks: [{ type: "bold" }] } : {}) }],
            },
            { type: "paragraph", content: [{ type: "text", text: "NEXT" }] },
          ],
        };
        await page.goto(origin);
        await page.waitForFunction(() => typeof window.mountHeadingEndHost === "function");
        await page.evaluate(
          ({ content, mode, order, dir }) => {
            window.__semloRequireFixture("mountHeadingEndHost")(content, mode, order);
            const editor = window.__semloRequireFixture("headingEndHost").controller.editor;
            editor.view.dom.setAttribute("dir", dir);
            editor.view.focus();
            editor.commands.setTextSelection(1);
          },
          { content, mode, order, dir: sample.dir },
        );
        await page.evaluate(() => window.__semloRequireFixture("headingEndHost").settle());
        await page.keyboard.press("Shift+End");
        await page.evaluate(() => window.__semloRequireFixture("headingEndHost").settle());
        const actual = await page.evaluate(() => {
          const fixture = window.__semloRequireFixture("headingEndHost");
          const editor = fixture.controller.editor;
          const selection = document.getSelection()!;
          return {
            json: editor.getJSON() as JSONContent,
            selection: { anchor: editor.state.selection.anchor, head: editor.state.selection.head },
            text: document.getSelection()?.toString(),
            native: {
              anchor: editor.view.posAtDOM(selection.anchorNode!, selection.anchorOffset),
              head: editor.view.posAtDOM(selection.focusNode!, selection.focusOffset),
              collapsed: selection.isCollapsed,
            },
            prevented: fixture.lastEndPrevented(),
            trace: fixture.trace,
            changes: fixture.changes,
          };
        });
        expect(actual.prevented).toBe(true);
        expect(actual.trace.filter((entry) => entry.phase === "filter")).toHaveLength(1);
        expect(actual.selection).toEqual(
          mode === "reject" || mode === "append-selection"
            ? { anchor: 1, head: 1 }
            : { anchor: 1, head: 1 + sample.text.length },
        );
        expect(actual.native).toEqual(
          mode === "reject" || mode === "append-selection"
            ? { anchor: 1, head: 1, collapsed: true }
            : { anchor: 1, head: 1 + sample.text.length, collapsed: false },
        );
        expect(actual.json.content?.[1].content?.[0].text).toBe(mode === "append-doc" ? "NEXT!" : "NEXT");
        expect(actual.changes).toBe(mode === "append-doc" ? 1 : 0);
      });
  }
}
