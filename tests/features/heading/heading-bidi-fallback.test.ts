import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/heading/heading-end-boundary-fixture";

declare global {
  interface Window {
    headingBidiEvents?: Record<string, KeyboardEvent>;
  }
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

type Sample = {
  name: string;
  text: string;
  dir: "ltr" | "rtl";
  numbered?: boolean;
  numbering?: "mixed" | "decimal" | "chinese";
  nestedDirection?: boolean;
  mark?: "bold" | "italic";
  width?: number;
};
const cases: Sample[] = [
  // The narrow single-script RTL case has its own safety tests.
  { name: "LTR ends in RTL", text: "abc אבג", dir: "ltr" },
  { name: "RTL ends in LTR", text: "אבג abc", dir: "rtl" },
  { name: "mixed LTR trailing newline", text: "abc אבג def\n", dir: "ltr" },
  { name: "mixed RTL trailing newline", text: "אבג abc דהו\n", dir: "rtl" },
  { name: "mixed RTL with digit", text: "אבג 12 abc דהו", dir: "rtl" },
  { name: "explicit bidi controls", text: "abc\u2067def\u2069xyz", dir: "ltr" },
  { name: "Cyrillic mixed with RTL", text: "Пример אבג", dir: "ltr" },
  { name: "mixed marked direction override", text: "标题 אבג 正文", dir: "ltr", nestedDirection: true },
  { name: "wrapped marked mixed", text: "标题 אבג 正文 ".repeat(10) + "标题", dir: "ltr", mark: "bold", width: 180 },
  {
    name: "wrapped numbered marked mixed",
    text: "标题 אבג 正文 ".repeat(10) + "标题",
    dir: "ltr",
    mark: "italic",
    numbered: true,
    width: 180,
  },
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
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/heading/heading-end-boundary-fixture.ts"));
});
afterAll(async () => stop?.());
async function mount(page: Page, item: Sample, native: boolean) {
  const content: JSONContent = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 3, ...(item.numbered ? { semloEditorHeadingNumbering: item.numbering ?? "mixed" } : {}) },
        content: [
          {
            type: "text",
            text: item.text,
            ...(item.mark || item.nestedDirection ? { marks: [{ type: item.mark ?? "bold" }] } : {}),
          },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "NEXT" }] },
    ],
  };
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountHeadingEndBoundary === "function");
  await page.evaluate(
    ({ content, native, dir, nestedDirection, width }) => {
      window.__semloRequireFixture("mountHeadingEndBoundary")(content, width, native);
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
    { content, native, dir: item.dir, nestedDirection: item.nestedDirection ?? false, width: item.width ?? 850 },
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
  test(`未验证的双向标题保留选区并停止行扩选：${item.name}`, async ({ page }) => {
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
    expect(candidate.before).toEqual(native.before);
    expect(candidate.before.focused).toBe(true);
    expect(candidate.home.pm).toEqual(candidate.before.pm);
    expect(candidate.home.homePrevented).toBe(true);
    expect(candidate.end.pm).toEqual(candidate.before.pm);
    expect(candidate.end.endPrevented).toBe(true);
    expect(candidate.end.json).toEqual(candidate.before.json);
  });
}

for (const item of [
  { name: "LTR mixed", text: "abc אבג def", dir: "ltr" as const },
  { name: "numbered LTR mixed", text: "abc אבג def", dir: "ltr" as const, numbered: true },
  { name: "RTL mixed", text: "אבג abc דהו", dir: "rtl" as const },
  ...(["mixed", "decimal", "chinese"] as const).flatMap((numbering) => [
    { name: `numbered RTL mixed ${numbering}`, text: "אבג abc דהו", dir: "rtl" as const, numbered: true, numbering },
    { name: `numbered RTL ${numbering}`, text: "אבג דהו", dir: "rtl" as const, numbered: true, numbering },
  ]),
  {
    name: "bold numbered LTR Chinese mixed",
    text: "标题 אבג 正文",
    dir: "ltr" as const,
    numbered: true,
    mark: "bold" as const,
  },
  { name: "italic RTL Chinese mixed", text: "אבג 中文 דהו", dir: "rtl" as const, mark: "italic" as const },
  { name: "LTR Chinese mixed", text: "标题 אבג 正文", dir: "ltr" as const },
  { name: "numbered LTR Chinese mixed", text: "标题 مرحبا 正文", dir: "ltr" as const, numbered: true },
  { name: "RTL Chinese mixed", text: "אבג 中文 דהו", dir: "rtl" as const },
  { name: "LTR Arabic mixed", text: "abc مرحبا def", dir: "ltr" as const },
  { name: "RTL Arabic mixed", text: "مرحبا abc عالم", dir: "rtl" as const },
]) {
  test(`single-line ${item.name} selects only title and preserves following paragraph`, async ({ page }) => {
    await mount(page, item, false);
    const before = await snapshot(page);
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    const selected = await snapshot(page);
    expect(selected.dom.text).toBe(item.text);
    await page.keyboard.press("Backspace");
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    const after = await snapshot(page);
    const expected = structuredClone(before.json) as JSONContent;
    delete expected.content![0].content;
    expect(after.json).toEqual(expected);
    await page.keyboard.press("ControlOrMeta+z");
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    expect((await snapshot(page)).json).toEqual(before.json);
  });
}
