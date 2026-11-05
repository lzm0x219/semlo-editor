import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/heading/heading-end-boundary-fixture";

declare global {
  interface Window {
    headingBidiEvents?: Record<string, KeyboardEvent>;
  }
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

type Sample = { name: string; text: string; dir: "ltr" | "rtl"; numbered?: boolean; nestedDirection?: boolean };
const cases: Sample[] = [
  // The narrow single-script RTL case has its own safety tests.
  { name: "RTL mixed script", text: "אבג abc דהו", dir: "rtl" },
  { name: "LTR mixed script", text: "abc אבג def", dir: "ltr" },
  { name: "explicit bidi controls", text: "abc\u2067def\u2069xyz", dir: "ltr" },
  { name: "unclassified script", text: "Пример", dir: "ltr" },
  { name: "numbered RTL", text: "אבג דהו", dir: "rtl", numbered: true },
  { name: "nested direction style", text: "abcdef", dir: "ltr", nestedDirection: true },
  { name: "Arabic question mark mixed", text: "abc؟def", dir: "ltr" },
  { name: "Arabic question mark alone", text: "؟", dir: "ltr" },
  { name: "Arabic question mark numbered", text: "؟", dir: "ltr", numbered: true },
  { name: "Arabic tatweel mixed", text: "abcـdef", dir: "ltr" },
  { name: "Indic Siyaq digit mixed", text: "abc𞱱def", dir: "ltr" },
  { name: "Euro outside approved common ranges", text: "a€b", dir: "ltr" },
  { name: "nonbreaking space outside approved ranges", text: "a\u00a0b", dir: "ltr" },
];
let origin: string;
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/heading/heading-end-boundary-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = () => server.close();
});
afterAll(async () => stop?.());
async function mount(page: Page, item: Sample, native: boolean) {
  const content: JSONContent = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 3, ...(item.numbered ? { semloEditorHeadingNumbering: "mixed" } : {}) },
        content: [{ type: "text", text: item.text, ...(item.nestedDirection ? { marks: [{ type: "bold" }] } : {}) }],
      },
      { type: "paragraph", content: [{ type: "text", text: "NEXT" }] },
    ],
  };
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountHeadingEndBoundary === "function");
  await page.evaluate(
    ({ content, native, dir, nestedDirection }) => {
      window.__semloRequireFixture("mountHeadingEndBoundary")(content, 850, native);
      window.__semloRequireFixture("headingEndBoundary").controller.editor.view.dom.setAttribute("dir", dir);
      if (nestedDirection) {
        const style = document.createElement("style");
        style.textContent =
          "#heading-end-boundary h3 strong { direction: rtl !important; unicode-bidi: isolate !important; }";
        document.head.append(style);
      }
      const events: Record<string, KeyboardEvent> = {};
      window.headingBidiEvents = events;
      window
        .__semloRequireFixture("headingEndBoundary")
        .controller.editor.view.dom.addEventListener("keydown", (event) => {
          events[event.key] = event;
        });
    },
    { content, native, dir: item.dir, nestedDirection: item.nestedDirection ?? false },
  );
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  await page.locator("#heading-end-boundary .semlo-editor-prose h3").first().click();
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
}
async function snapshot(page: Page) {
  return page.evaluate(() => {
    const editor = window.__semloRequireFixture("headingEndBoundary").controller.editor;
    const dom = document.getSelection()!;
    const events = window.__semloRequireFixture("headingBidiEvents");
    const point = (node: Node | null, offset: number) => ({
      name: node?.nodeName,
      parent: node?.parentElement?.tagName,
      offset,
    });
    return {
      json: editor.getJSON(),
      dom: {
        text: dom.toString(),
        collapsed: dom.isCollapsed,
        anchor: point(dom.anchorNode, dom.anchorOffset),
        focus: point(dom.focusNode, dom.focusOffset),
      },
      pm: { anchor: editor.state.selection.anchor, head: editor.state.selection.head },
      homePrevented: events.Home?.defaultPrevented ?? null,
      endPrevented: events.End?.defaultPrevented ?? null,
      focused: editor.view.hasFocus(),
    };
  });
}
for (const item of cases) {
  test(`unproven bidi falls back to native: ${item.name}`, async ({ page }) => {
    async function run(native: boolean) {
      await mount(page, item, native);
      const before = await snapshot(page);
      await page.keyboard.press("Home");
      await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
      const home = await snapshot(page);
      await page.keyboard.press("Shift+End");
      await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
      const end = await snapshot(page);
      return { before, home, end };
    }
    const native = await run(true);
    const candidate = await run(false);
    expect(candidate).toEqual(native);
    expect(candidate.before.focused).toBe(true);
    expect(candidate.end.json).toEqual(candidate.before.json);
  });
}
