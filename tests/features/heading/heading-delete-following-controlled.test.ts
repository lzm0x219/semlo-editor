import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/heading/heading-delete-controlled-fixture";
import type { RestartFramework } from "../../fixtures/list/ordered-restart-controlled-fixture";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

let origin: string;
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/heading/heading-delete-controlled-fixture.ts", {
    framework: true,
  }));
});
afterAll(async () => stop?.());

const title = "test";
type Scenario = {
  name: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  container: "root" | "quote" | "details";
  before: boolean;
  after: readonly string[];
  numbered?: boolean;
  mark?: "bold" | "italic" | "mixed";
  text?: string;
};
const levels = [1, 2, 3, 4, 5, 6] as const;
const cases: Scenario[] = [
  ...levels.map((level) => ({
    name: `root H${level} followed by text`,
    level,
    container: "root" as const,
    before: false,
    after: ["next"],
  })),
  { name: "root H3 between text blocks", level: 3, container: "root", before: true, after: ["next"] },
  { name: "root H6 followed by two text blocks", level: 6, container: "root", before: false, after: ["next", "third"] },
  {
    name: "numbered root H3 followed by text",
    level: 3,
    container: "root",
    before: false,
    after: ["next"],
    numbered: true,
  },
  { name: "bold root H3 followed by text", level: 3, container: "root", before: false, after: ["next"], mark: "bold" },
  {
    name: "italic root H3 followed by text",
    level: 3,
    container: "root",
    before: false,
    after: ["next"],
    mark: "italic",
  },
  {
    name: "mixed-mark root H3 followed by text",
    level: 3,
    container: "root",
    before: false,
    after: ["next"],
    mark: "mixed",
    text: "abcd",
  },
  { name: "quoted H3 followed by text", level: 3, container: "quote", before: false, after: ["next"] },
  { name: "fold body H3 followed by text", level: 3, container: "details", before: false, after: ["next"] },
];

function htmlFor(item: Scenario): string {
  const content = item.text ?? title;
  const text =
    item.mark === "bold"
      ? `<strong>${content}</strong>`
      : item.mark === "italic"
        ? `<em>${content}</em>`
        : item.mark === "mixed"
          ? "a<strong>bc</strong>d"
          : content;
  const heading = `<h${item.level}${item.numbered ? ' data-semlo-editor-heading-numbering="mixed"' : ""}>${text}</h${item.level}>`;
  const body = `${item.before ? "<p>first</p>" : ""}${heading}${item.after.map((text) => `<p>${text}</p>`).join("")}`;
  if (item.container === "quote") return `<blockquote>${body}</blockquote>`;
  if (item.container === "details")
    return `<details open><summary></summary><div data-type="detailsContent">${body}</div></details>`;
  return body;
}

function headingPath(item: Scenario): number[] {
  if (item.container === "quote") return [0, 0];
  if (item.container === "details") return [0, 1, 0];
  return [item.before ? 1 : 0];
}

function headingAt(json: JSONContent, path: number[]): JSONContent {
  let node = json;
  for (const index of path) {
    const child = node.content?.[index];
    if (!child) throw new Error(`Missing heading at path ${path.join(".")}`);
    node = child;
  }
  return node;
}

async function mountHTML(page: Page, framework: RestartFramework, html: string) {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountRestartControlledFixture === "function");
  await page.evaluate(
    (name) => window.__semloRequireFixture("mountRestartControlledFixture")(name, "legacy"),
    framework,
  );
  await page.evaluate((value) => window.__semloRequireFixture("restartControlledFixture").setContent(value), html);
  await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
  // The host's setup write is not an edit in the history under test.
  await page.evaluate(() => window.__semloRequireFixture("closeHeadingDeleteHistory")());
}

async function read(page: Page) {
  return page.evaluate(() => {
    const fixture = window.__semloRequireFixture("restartControlledFixture");
    const editor = fixture.controller.editor;
    const selection = editor.state.selection;
    const domSelection = window.getSelection();
    const fragment = domSelection?.rangeCount ? domSelection.getRangeAt(0).cloneContents() : null;
    fragment
      ?.querySelectorAll('[contenteditable="false"], .semlo-editor-heading-number')
      .forEach((node) => node.remove());
    return {
      snapshot: fixture.controller.getSnapshot(),
      selection: {
        empty: selection.empty,
        anchorType: selection.$anchor.parent.type.name,
        anchorText: selection.$anchor.parent.textContent,
        anchorOffset: selection.$anchor.parentOffset,
        headType: selection.$head.parent.type.name,
        headText: selection.$head.parent.textContent,
        headOffset: selection.$head.parentOffset,
      },
      domSelection: { empty: domSelection?.isCollapsed ?? true, text: fragment?.textContent ?? "" },
      focused: editor.view.hasFocus(),
      changes: fixture.changes,
      documentChanges: fixture.documentChanges,
      errors: fixture.errors,
    };
  });
}

for (const framework of ["react", "vue", "solid"] as const satisfies readonly RestartFramework[]) {
  for (const item of cases) {
    test(`${framework}: ${item.name} deletes only heading text without an intervening wait`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await mountHTML(page, framework, htmlFor(item));
      const before = await read(page);
      const selectedText = item.text ?? title;
      expect(before.changes).toHaveLength(0);
      const expected = structuredClone(before.snapshot.json);
      const originalHeading = headingAt(expected, headingPath(item));
      expect(originalHeading).toMatchObject({
        type: "heading",
        attrs: { level: item.level, semloEditorHeadingNumbering: item.numbered ? "mixed" : null },
      });
      expect(originalHeading.content?.map((node) => node.text).join("")).toBe(selectedText);
      delete originalHeading.content;
      const host = page.locator("#restart-controlled-fixture");
      const selector =
        item.container === "quote"
          ? `.semlo-editor-prose > blockquote > h${item.level}`
          : item.container === "details"
            ? `.semlo-editor-prose [data-type="detailsContent"] > h${item.level}`
            : `.semlo-editor-prose > h${item.level}`;
      const heading = host.locator(selector);
      await heading.click();
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+End");
      await page.keyboard.press("Backspace");
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      const removed = await read(page);
      expect(removed.snapshot.json).toEqual(expected);
      expect(removed.changes).toHaveLength(1);
      expect(removed.changes[0].json).toEqual(expected);
      expect(removed.changes[0].html).toEqual(removed.snapshot.html);
      expect(removed.documentChanges - before.documentChanges).toBe(1);
      expect(removed.focused).toBe(true);
      expect(removed.selection).toMatchObject({
        empty: true,
        anchorType: "heading",
        anchorText: "",
        anchorOffset: 0,
        headType: "heading",
        headText: "",
        headOffset: 0,
      });
      expect(removed.domSelection.empty).toBe(true);
      await expect(heading).toHaveCount(1);
      if (item.numbered) {
        await expect(heading.locator(".semlo-editor-heading-number")).toHaveText("1. ");
        expect(removed.snapshot.html).toContain('data-semlo-editor-heading-numbering="mixed"');
      }
      expect(removed.snapshot.html).toContain("next");

      await page.keyboard.press("ControlOrMeta+z");
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      const undone = await read(page);
      expect(undone.snapshot.json).toEqual(before.snapshot.json);
      expect(undone.selection).toMatchObject({
        empty: false,
        anchorType: "heading",
        anchorText: selectedText,
        anchorOffset: 0,
        headType: "heading",
        headText: selectedText,
        headOffset: selectedText.length,
      });
      expect(undone.domSelection).toEqual({ empty: false, text: selectedText });
      expect(undone.focused).toBe(true);
      expect(undone.changes).toHaveLength(2);
      expect(undone.changes[1].json).toEqual(before.snapshot.json);
      expect(undone.documentChanges - before.documentChanges).toBe(2);
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      const redone = await read(page);
      expect(redone.snapshot.json).toEqual(expected);
      expect(redone.selection).toEqual(removed.selection);
      expect(redone.focused).toBe(true);
      expect(redone.changes).toHaveLength(3);
      expect(redone.changes[2].json).toEqual(expected);
      expect(redone.documentChanges - before.documentChanges).toBe(3);

      for (const saved of [removed.snapshot.json, removed.snapshot.html]) {
        await page.evaluate(() =>
          window.__semloRequireFixture("restartControlledFixture").setContent("<p>临时替换</p>"),
        );
        await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
        await page.evaluate(
          (value) => window.__semloRequireFixture("restartControlledFixture").setContent(value),
          saved,
        );
        await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
        const restored = await read(page);
        expect(restored.snapshot.json).toEqual(expected);
        expect(restored.changes).toHaveLength(3);
      }
      expect((await read(page)).errors).toEqual([]);
      expect(pageErrors).toEqual([]);
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").destroy());
    });
  }
}
