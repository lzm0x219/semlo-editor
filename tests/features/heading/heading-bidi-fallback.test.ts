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
  { name: "LTR ends in mixed RTL scripts", text: "abc אב مرحبا", dir: "ltr" },
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
  { name: "LTR ends in Arabic", text: "abc مرحبا", dir: "ltr" as const },
  { name: "LTR ends in Hebrew", text: "abc אבג", dir: "ltr" as const },
  { name: "bold LTR ends in Hebrew", text: "abc אבג", dir: "ltr" as const, mark: "bold" as const },
  { name: "numbered LTR ends in Hebrew", text: "abc אבג", dir: "ltr" as const, numbered: true },
  { name: "LTR with heading link", text: "标题内容", dir: "ltr" as const },
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
    if (item.name === "LTR with heading link")
      await expect(page.locator("#heading-end-boundary h3 > .semlo-editor-heading-link")).toHaveCount(1);
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

test("标题链接进入文字流时保留选区，避免误选后文", async ({ page }) => {
  await mount(page, { name: "in-flow link", text: "标题内容", dir: "ltr" }, false);
  await page.addStyleTag({
    content: "#heading-end-boundary h3 > .semlo-editor-heading-link { position: static !important; }",
  });
  const before = await snapshot(page);
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const after = await snapshot(page);
  expect(after.pm).toEqual(before.pm);
  expect(after.json).toEqual(before.json);
  expect(after.endPrevented).toBe(true);
});

test("英文与希伯来文混排的行内光标继续保守回退", async ({ page }) => {
  await mount(page, { name: "interior bidi", text: "abc אבג", dir: "ltr" }, false);
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").select("abc אבג", 2, 2));
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const before = await snapshot(page);
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const after = await snapshot(page);
  expect(after.pm).toEqual(before.pm);
  expect(after.dom).toEqual(before.dom);
  expect(after.json).toEqual(before.json);
  expect(after.homePrevented).toBe(true);
  expect(after.endPrevented).toBe(true);
});

test("英文与希伯来文标题末尾换行时继续保守回退", async ({ page }) => {
  const text = "abc אבג\n";
  await mount(page, { name: "bidi trailing newline", text, dir: "ltr" }, false);
  await page.evaluate(
    (value) => window.__semloRequireFixture("headingEndBoundary").select(value, value.length, value.length),
    text,
  );
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const before = await snapshot(page);
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const after = await snapshot(page);
  expect(after.pm).toEqual(before.pm);
  expect(after.dom).toEqual(before.dom);
  expect(after.json).toEqual(before.json);
  expect(after.homePrevented).toBe(true);
  expect(after.endPrevented).toBe(true);
});

test("混排标题行距过紧时不把多行当作单行", async ({ page }) => {
  const text = "abc אבגדהוז";
  await mount(page, { name: "overlapping lines", text, dir: "ltr" }, false);
  await page.addStyleTag({
    content:
      "#heading-end-boundary h3 { font: 26px Arial !important; line-height: 2px !important; white-space: pre-wrap !important; width: 70px !important; }",
  });
  await page.evaluate(
    (value) => window.__semloRequireFixture("headingEndBoundary").select(value, value.length, value.length),
    text,
  );
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const tops = await page.locator("#heading-end-boundary h3").evaluate((heading) => {
    const node = Array.from(heading.childNodes).find((child) => child.nodeType === Node.TEXT_NODE)!;
    const range = document.createRange();
    range.selectNodeContents(node);
    return Array.from(range.getClientRects(), (rect) => rect.top);
  });
  expect(new Set(tops).size).toBeGreaterThan(1);
  const before = await snapshot(page);
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const after = await snapshot(page);
  expect(after.pm).toEqual(before.pm);
  expect(after.dom).toEqual(before.dom);
  expect(after.json).toEqual(before.json);
  expect(after.endPrevented).toBe(true);
});

for (const target of ["h3", ".semlo-editor-prose"]) {
  test(`缩放后的紧密混排行距仍保守回退：${target}`, async ({ page }) => {
    const text = "abc אבגדהו";
    await mount(page, { name: "scaled overlapping lines", text, dir: "ltr" }, false);
    await page.addStyleTag({
      content: `#heading-end-boundary h3 { font: 26px Arial !important; line-height: 13px !important; white-space: pre-wrap !important; width: 80px !important; } #heading-end-boundary ${target} { zoom: 0.4 !important; }`,
    });
    await page.evaluate(
      (value) => window.__semloRequireFixture("headingEndBoundary").select(value, value.length, value.length),
      text,
    );
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    const tops = await page.locator("#heading-end-boundary h3").evaluate((heading) => {
      const node = Array.from(heading.childNodes).find((child) => child.nodeType === Node.TEXT_NODE)!;
      const range = document.createRange();
      range.selectNodeContents(node);
      return Array.from(range.getClientRects(), (rect) => rect.top);
    });
    expect(new Set(tops).size).toBeGreaterThan(1);
    const before = await snapshot(page);
    await page.keyboard.press("Home");
    const home = await snapshot(page);
    expect(home.pm).toEqual(before.pm);
    expect(home.homePrevented).toBe(true);
    await page.keyboard.press("Shift+End");
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    const after = await snapshot(page);
    expect(after.pm).toEqual(before.pm);
    expect(after.dom).toEqual(before.dom);
    expect(after.json).toEqual(before.json);
    expect(after.endPrevented).toBe(true);
  });
}

for (const mode of ["zoom", "transform"] as const) {
  test(`插槽内${mode}的紧密混排标题不会跨行扩选`, async ({ page }) => {
    const text = "a אבגדהוזחטיכלמנסעפצקרשת";
    await mount(page, { name: "slotted zoom", text, dir: "ltr" }, false);
    await page.evaluate((mode) => {
      const container = document.querySelector("#heading-end-boundary")!;
      const host = document.createElement("div");
      document.body.append(host);
      const root = host.attachShadow({ mode: "closed" });
      const wrapper = document.createElement("div");
      wrapper.style.setProperty(mode, mode === "zoom" ? "0.25" : "scale(0.25)");
      wrapper.append(document.createElement("slot"));
      root.append(wrapper);
      host.append(container);
    }, mode);
    await page.addStyleTag({
      content:
        "#heading-end-boundary h3 { font-family: Arial !important; font-weight: normal !important; font-size: 16px !important; line-height: 8px !important; word-break: break-all !important; width: 155px !important; }",
    });
    await page.evaluate((value) => window.__semloRequireFixture("headingEndBoundary").select(value, 0, 0), text);
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    const tops = await page.locator("#heading-end-boundary h3").evaluate((heading) => {
      const node = Array.from(heading.childNodes).find((child) => child.nodeType === Node.TEXT_NODE)!;
      const range = document.createRange();
      range.selectNodeContents(node);
      return Array.from(range.getClientRects(), (rect) => rect.top);
    });
    expect(new Set(tops).size).toBeGreaterThan(1);
    const before = await snapshot(page);
    await page.keyboard.press("Shift+End");
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    const after = await snapshot(page);
    expect(after.pm).toEqual(before.pm);
    expect(after.dom).toEqual(before.dom);
    expect(after.endPrevented).toBe(true);
  });
}

test("无法获取缩放尺度时保留混排标题选区", async ({ page }) => {
  const text = "abc אבג";
  await mount(page, { name: "unknown zoom", text, dir: "ltr" }, false);
  await page.locator("#heading-end-boundary h3").evaluate((heading) => {
    Object.defineProperty(heading, "currentCSSZoom", { value: undefined, configurable: true });
  });
  await page.evaluate(
    (value) => window.__semloRequireFixture("headingEndBoundary").select(value, value.length, value.length),
    text,
  );
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const before = await snapshot(page);
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const after = await snapshot(page);
  expect(after.pm).toEqual(before.pm);
  expect(after.dom).toEqual(before.dom);
  expect(after.homePrevented).toBe(true);
  expect(after.endPrevented).toBe(true);
});

test("插槽内极小纵向缩放的多行标题不跨行扩选", async ({ page }) => {
  const text = "abc אבגדהו";
  await mount(page, { name: "slotted vertical scale", text, dir: "ltr" }, false);
  await page.evaluate(() => {
    const container = document.querySelector("#heading-end-boundary")!;
    const host = document.createElement("div");
    document.body.append(host);
    const root = host.attachShadow({ mode: "closed" });
    const wrapper = document.createElement("div");
    wrapper.style.transform = "scaleY(0.0001)";
    wrapper.style.transformOrigin = "top left";
    wrapper.append(document.createElement("slot"));
    root.append(wrapper);
    host.append(container);
  });
  await page.addStyleTag({
    content:
      "#heading-end-boundary h3 { font: 26px Arial !important; line-height: 13px !important; white-space: pre-wrap !important; width: 80px !important; }",
  });
  await page.evaluate((value) => window.__semloRequireFixture("headingEndBoundary").select(value, 0, 0), text);
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const before = await snapshot(page);
  await page.keyboard.press("Shift+End");
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const after = await snapshot(page);
  expect(after.pm).toEqual(before.pm);
  expect(after.dom).toEqual(before.dom);
  expect(after.endPrevented).toBe(true);
});

test("行内文字发生位移时保留标题选区", async ({ page }) => {
  await mount(page, { name: "positioned text", text: "标题内容", dir: "ltr", mark: "bold" }, false);
  await page.addStyleTag({ content: "#heading-end-boundary h3 strong { position: relative; left: 40px; }" });
  const before = await snapshot(page);
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const after = await snapshot(page);
  expect(after.pm).toEqual(before.pm);
  expect(after.dom).toEqual(before.dom);
  expect(after.json).toEqual(before.json);
  expect(after.homePrevented).toBe(true);
  expect(after.endPrevented).toBe(true);
});

test("宿主重排标题文字时保留选区，避免误删未选内容", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountHeadingEndBoundary === "function");
  await page.evaluate(() => {
    window.__semloRequireFixture("mountHeadingEndBoundary")({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 3 },
          content: [
            { type: "text", text: "AB", marks: [{ type: "bold" }] },
            { type: "text", text: "CD", marks: [{ type: "italic" }] },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "NEXT" }] },
      ],
    });
    const events: Record<string, KeyboardEvent> = {};
    window.headingBidiEvents = events;
    window
      .__semloRequireFixture("headingEndBoundary")
      .controller.editor.view.dom.addEventListener("keydown", (event) => {
        events[event.key] = event;
      });
  });
  await page.addStyleTag({
    content:
      "#heading-end-boundary h3 { display: flex; } #heading-end-boundary h3 strong { order: 2; } #heading-end-boundary h3 em { order: 1; }",
  });
  await page.locator("#heading-end-boundary h3 strong").click();
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const before = await snapshot(page);
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  const after = await snapshot(page);
  expect(after.pm).toEqual(before.pm);
  expect(after.json).toEqual(before.json);
  expect(after.endPrevented).toBe(true);
});
