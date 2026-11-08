import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/heading/heading-end-boundary-fixture";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

type Case = { name: string; content: JSONContent; title?: string; dir?: "rtl" };
const text = (value: string, marks?: JSONContent["marks"]): JSONContent => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const p = (content: JSONContent[] = [text("NEXT")], attrs?: Record<string, unknown>): JSONContent => ({
  type: "paragraph",
  ...(attrs ? { attrs } : {}),
  ...(content.length ? { content } : {}),
});
const h = (content: JSONContent[] = [text("test")], attrs: Record<string, unknown> = {}): JSONContent => ({
  type: "heading",
  attrs: { level: 3, ...attrs },
  content,
});
const doc = (...content: JSONContent[]): JSONContent => ({ type: "doc", content });
const mark = (...types: string[]): JSONContent["marks"] => types.map((type) => ({ type }));
const link = { type: "link", attrs: { href: "#heading-test" } };
const titleCase = (name: string, marks: JSONContent["marks"], attrs?: Record<string, unknown>): Case => ({
  name,
  content: doc(h([text("test", marks)], attrs), p()),
});
const cases: Case[] = [
  titleCase("bold and italic", mark("bold", "italic")),
  titleCase("underline", mark("underline")),
  titleCase("strike", mark("strike")),
  titleCase("code", mark("code")),
  titleCase("link", [link]),
  titleCase("bold link", [...mark("bold")!, link]),
  titleCase("color", [{ type: "textStyle", attrs: { color: "#ff0000" } }]),
  titleCase("highlight", [{ type: "highlight", attrs: { color: "#ffff00" } }]),
  titleCase("subscript", mark("subscript")),
  titleCase("superscript", mark("superscript")),
  titleCase("mixed numbering with bold", mark("bold"), { semloEditorHeadingNumbering: "mixed" }),
  titleCase("decimal numbering with italic", mark("italic"), { semloEditorHeadingNumbering: "decimal" }),
  titleCase("Chinese numbering with underline", mark("underline"), { semloEditorHeadingNumbering: "chinese" }),
  { name: "grapheme clusters", content: doc(h([text("a🇨🇳é")]), p()), title: "a🇨🇳é" },
  { name: "Chinese punctuation", content: doc(h([text("中文，标点。！")]), p()), title: "中文，标点。！" },
  { name: "Japanese punctuation", content: doc(h([text("日本語（句読点）、。")]), p()), title: "日本語（句読点）、。" },
  { name: "Korean punctuation", content: doc(h([text("한글，문장。")]), p()), title: "한글，문장。" },
  { name: "ZWJ emoji", content: doc(h([text("a👨‍👩‍👧‍👦b")]), p()), title: "a👨‍👩‍👧‍👦b" },
  { name: "formatted next paragraph", content: doc(h(), p([text("NEXT", mark("bold"))])) },
  { name: "indented next paragraph", content: doc(h(), p([text("NEXT")], { semloEditorIndent: 1 })) },
  { name: "next heading", content: doc(h(), h([text("NEXT")], { level: 2 })) },
  { name: "next list", content: doc(h(), { type: "bulletList", content: [{ type: "listItem", content: [p()] }] }) },
  { name: "next quote", content: doc(h(), { type: "blockquote", content: [p()] }) },
  { name: "next code", content: doc(h(), { type: "codeBlock", content: [text("NEXT")] }) },
  { name: "next divider", content: doc(h(), { type: "horizontalRule" }, p()) },
  {
    name: "next table",
    content: doc(h(), {
      type: "table",
      content: [{ type: "tableRow", content: [{ type: "tableCell", content: [p()] }] }],
    }),
  },
  {
    name: "marked heading inside quote",
    content: doc({ type: "blockquote", content: [h([text("test", mark("bold", "italic"))]), p()] }),
  },
  {
    name: "marked heading inside details",
    content: doc({
      type: "details",
      attrs: { open: true },
      content: [
        { type: "detailsSummary" },
        { type: "detailsContent", content: [h([text("test", mark("bold"))]), p()] },
      ],
    }),
  },
];

let origin: string;
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/heading/heading-end-boundary-fixture.ts"));
});
afterAll(async () => stop?.());
async function mount(page: Page, item: Case) {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountHeadingEndBoundary === "function");
  await page.evaluate((content) => window.__semloRequireFixture("mountHeadingEndBoundary")(content, 850), item.content);
  if (item.dir)
    await page.evaluate(
      (dir) => window.__semloRequireFixture("headingEndBoundary").controller.editor.view.dom.setAttribute("dir", dir),
      item.dir,
    );
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
  await page.locator("#heading-end-boundary .semlo-editor-prose h3").first().click();
  await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
}
async function snapshot(page: Page) {
  return page.evaluate(() => {
    const editor = window.__semloRequireFixture("headingEndBoundary").controller.editor;
    return { json: editor.getJSON(), text: document.getSelection()?.toString(), focused: editor.view.hasFocus() };
  });
}
function emptyFirstHeading(json: JSONContent): JSONContent {
  const copy = JSON.parse(JSON.stringify(json)) as JSONContent;
  let found = false;
  const visit = (node: JSONContent) => {
    if (node.type === "heading" && !found) {
      delete node.content;
      found = true;
    } else for (const child of node.content ?? []) visit(child);
  };
  visit(copy);
  if (!found) throw new Error("Missing heading");
  return copy;
}
for (const item of cases) {
  test(`single line: ${item.name}`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mount(page, item);
    const before = await snapshot(page);
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.evaluate(() => window.__semloRequireFixture("headingEndBoundary").settle());
    const selected = await snapshot(page);
    expect(selected.text).toBe(item.title ?? "test");
    await page.keyboard.press("Backspace");
    const after = await snapshot(page);
    expect(after.json).toEqual(emptyFirstHeading(before.json));
    expect(after.focused).toBe(true);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await snapshot(page)).json).toEqual(before.json);
    await mount(page, item);
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.press("Backspace");
    expect((await snapshot(page)).json).toEqual(emptyFirstHeading(before.json));
    expect(errors).toEqual([]);
  });
}
