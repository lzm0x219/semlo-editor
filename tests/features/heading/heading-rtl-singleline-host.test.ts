import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type { HostMode } from "../../fixtures/heading/heading-end-host-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/heading/heading-end-host-fixture.ts" } },
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

for (const order of ["early", "late"] as const) {
  for (const mode of [
    "reject",
    "append-meta",
    "append-selection",
    "append-doc",
  ] as const satisfies readonly HostMode[]) {
    test(`local RTL ${order} host ${mode} owns the final selection`, async ({ page }) => {
      const content: JSONContent = {
        type: "doc",
        content: [
          { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "אבג דהו" }] },
          { type: "paragraph", content: [{ type: "text", text: "NEXT" }] },
        ],
      };
      await page.goto(origin);
      await page.waitForFunction(() => typeof window.mountHeadingEndHost === "function");
      await page.evaluate(
        ({ content, mode, order }) => {
          window.__semloRequireFixture("mountHeadingEndHost")(content, mode, order);
          const editor = window.__semloRequireFixture("headingEndHost").controller.editor;
          editor.view.dom.setAttribute("dir", "rtl");
          editor.view.focus();
          editor.commands.setTextSelection(1);
        },
        { content, mode, order },
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
        mode === "reject" || mode === "append-selection" ? { anchor: 1, head: 1 } : { anchor: 1, head: 8 },
      );
      expect(actual.native).toEqual(
        mode === "reject" || mode === "append-selection"
          ? { anchor: 1, head: 1, collapsed: true }
          : { anchor: 1, head: 8, collapsed: false },
      );
      expect(actual.json.content?.[1].content?.[0].text).toBe(mode === "append-doc" ? "NEXT!" : "NEXT");
      expect(actual.changes).toBe(mode === "append-doc" ? 1 : 0);
    });
  }
}
