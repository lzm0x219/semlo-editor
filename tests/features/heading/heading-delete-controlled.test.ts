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

const title = "标题甲乙";
type Scenario = {
  name: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  numbered: boolean;
  quote: boolean;
  selection: "heading" | "document";
  key: "Backspace" | "Delete";
};
const levels = [1, 2, 3, 4, 5, 6] as const;
const cases: Scenario[] = [
  ...levels.flatMap((level) =>
    [false, true].map((numbered) => ({
      name: `${numbered ? "numbered" : "ordinary"} H${level} full text Backspace`,
      level,
      numbered,
      quote: false,
      selection: "heading" as const,
      key: "Backspace" as const,
    })),
  ),
  {
    name: "ordinary H5 full text Delete",
    level: 5,
    numbered: false,
    quote: false,
    selection: "heading",
    key: "Delete",
  },
  { name: "numbered H2 full text Delete", level: 2, numbered: true, quote: false, selection: "heading", key: "Delete" },
  ...levels.map((level) => ({
    name: `native quote H${level} full text Backspace`,
    level,
    numbered: false,
    quote: true,
    selection: "heading" as const,
    key: "Backspace" as const,
  })),
  {
    name: "native quote H3 full text Delete",
    level: 3,
    numbered: false,
    quote: true,
    selection: "heading",
    key: "Delete",
  },
  {
    name: "ordinary H5 document select-all Backspace",
    level: 5,
    numbered: false,
    quote: false,
    selection: "document",
    key: "Backspace",
  },
  {
    name: "numbered H2 document select-all Backspace",
    level: 2,
    numbered: true,
    quote: false,
    selection: "document",
    key: "Backspace",
  },
  {
    name: "native quote H3 document select-all Backspace",
    level: 3,
    numbered: false,
    quote: true,
    selection: "document",
    key: "Backspace",
  },
];

function contentFor(item: Scenario): JSONContent {
  const heading: JSONContent = {
    type: "heading",
    attrs: { level: item.level, semloEditorHeadingNumbering: item.numbered ? "mixed" : null },
    content: [{ type: "text", text: title }],
  };
  return { type: "doc", content: [item.quote ? { type: "blockquote", content: [heading] } : heading] };
}

async function mount(page: Page, framework: RestartFramework, item: Scenario) {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountRestartControlledFixture === "function");
  await page.evaluate(
    (name) => window.__semloRequireFixture("mountRestartControlledFixture")(name, "legacy"),
    framework,
  );
  await page.evaluate(
    (content) => window.__semloRequireFixture("restartControlledFixture").setContent(content),
    contentFor(item),
  );
  await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
  // The host's initial setContent is fixture setup, not the edit under test.
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
    test(`${framework}: ${item.name} survives controlled host echo`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await mount(page, framework, item);
      const host = page.locator("#restart-controlled-fixture");
      const selector = `.semlo-editor-prose > ${item.quote ? "blockquote > " : ""}h${item.level}`;
      const heading = host.locator(selector);
      await heading.click();
      if (item.selection === "heading") {
        await page.keyboard.press("Home");
        await page.keyboard.press("Shift+End");
      } else await page.keyboard.press("ControlOrMeta+a");
      const before = await read(page);
      expect(before.focused).toBe(true);
      expect(before.domSelection).toEqual({ empty: false, text: title });
      expect(before.changes).toHaveLength(0);
      const beforeRoot = before.snapshot.json.content?.[0];
      const beforeHeading = item.quote ? beforeRoot?.content?.[0] : beforeRoot;
      expect(beforeHeading).toMatchObject({
        type: "heading",
        attrs: { level: item.level, semloEditorHeadingNumbering: item.numbered ? "mixed" : null },
      });

      await page.keyboard.press(item.key);
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      const removed = await read(page);
      expect(removed.changes).toHaveLength(1);
      expect(removed.changes[0].json).toEqual(removed.snapshot.json);
      expect(removed.changes[0].html).toEqual(removed.snapshot.html);
      expect(removed.documentChanges - before.documentChanges).toBe(1);
      expect(removed.focused).toBe(true);
      expect(removed.domSelection.empty).toBe(true);
      expect(removed.selection).toMatchObject({
        empty: true,
        anchorType: item.selection === "document" ? "paragraph" : "heading",
        anchorText: "",
        anchorOffset: 0,
        headType: item.selection === "document" ? "paragraph" : "heading",
        headText: "",
        headOffset: 0,
      });
      expect(removed.snapshot.json.content).toHaveLength(1);
      const root = removed.snapshot.json.content?.[0];
      if (item.selection === "document") {
        expect(root?.type).toBe("paragraph");
        expect(root?.content ?? []).toEqual([]);
        await expect(host.locator(".semlo-editor-prose > p")).toHaveCount(1);
        await expect(
          host.locator(
            ".semlo-editor-prose h1, .semlo-editor-prose h2, .semlo-editor-prose h3, .semlo-editor-prose h4, .semlo-editor-prose h5, .semlo-editor-prose h6",
          ),
        ).toHaveCount(0);
        expect(removed.snapshot.html).not.toContain("data-semlo-editor-heading-numbering");
      } else {
        const emptyHeading = item.quote ? root?.content?.[0] : root;
        if (item.quote) {
          expect(root?.type).toBe("blockquote");
          expect(root?.attrs).toEqual(beforeRoot?.attrs);
          expect(root?.content).toHaveLength(1);
        }
        expect(emptyHeading).toMatchObject({ type: "heading", attrs: beforeHeading?.attrs });
        expect(emptyHeading?.content ?? []).toEqual([]);
        await expect(heading).toHaveCount(1);
        if (item.numbered) {
          await expect(heading.locator(".semlo-editor-heading-number")).toHaveText("1. ");
          expect(removed.snapshot.html).toContain('data-semlo-editor-heading-numbering="mixed"');
        } else await expect(heading.locator(".semlo-editor-heading-number")).toHaveCount(0);
      }

      await page.keyboard.press("ControlOrMeta+z");
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      const undone = await read(page);
      expect(undone.snapshot.json).toEqual(before.snapshot.json);
      if (item.selection === "heading") {
        expect(undone.selection).toMatchObject({
          empty: false,
          anchorType: "heading",
          anchorText: title,
          anchorOffset: 0,
          headType: "heading",
          headText: title,
          headOffset: title.length,
        });
      } else expect(undone.selection).toEqual(before.selection);
      expect(undone.domSelection).toEqual(before.domSelection);
      expect(undone.focused).toBe(true);
      expect(undone.changes).toHaveLength(2);
      expect(undone.changes[1].json).toEqual(before.snapshot.json);
      expect(undone.documentChanges - before.documentChanges).toBe(2);

      await page.keyboard.press("ControlOrMeta+Shift+z");
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      const redone = await read(page);
      expect(redone.snapshot.json).toEqual(removed.snapshot.json);
      expect(redone.selection).toEqual(removed.selection);
      expect(redone.focused).toBe(true);
      expect(redone.changes).toHaveLength(3);
      expect(redone.changes[2].json).toEqual(removed.snapshot.json);
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
        expect(restored.snapshot.json).toEqual(removed.snapshot.json);
        expect(restored.changes).toHaveLength(3);
      }
      expect((await read(page)).errors).toEqual([]);
      expect(pageErrors).toEqual([]);
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").destroy());
    });
  }
}

// Keep this path free of selection reads or waits between the user's two keys.
const immediateCases: Scenario[] = [
  {
    name: "ordinary H1 immediately Backspace",
    level: 1,
    numbered: false,
    quote: false,
    selection: "heading",
    key: "Backspace",
  },
  {
    name: "numbered H2 immediately Backspace",
    level: 2,
    numbered: true,
    quote: false,
    selection: "heading",
    key: "Backspace",
  },
  {
    name: "quote H6 immediately Backspace",
    level: 6,
    numbered: false,
    quote: true,
    selection: "heading",
    key: "Backspace",
  },
  { name: "quote H3 immediately Delete", level: 3, numbered: false, quote: true, selection: "heading", key: "Delete" },
];
for (const framework of ["react", "vue", "solid"] as const satisfies readonly RestartFramework[]) {
  for (const item of immediateCases) {
    test(`${framework}: ${item.name} after Shift+End`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await mount(page, framework, item);
      const initial = await read(page);
      const host = page.locator("#restart-controlled-fixture");
      const heading = host.locator(`.semlo-editor-prose > ${item.quote ? "blockquote > " : ""}h${item.level}`);
      await heading.click();
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+End");
      await page.keyboard.press(item.key);
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      const removed = await read(page);
      const root = removed.snapshot.json.content?.[0];
      const emptyHeading = item.quote ? root?.content?.[0] : root;
      expect(removed.snapshot.json.content).toHaveLength(1);
      if (item.quote) expect(root?.type).toBe("blockquote");
      expect(emptyHeading).toMatchObject({
        type: "heading",
        attrs: { level: item.level, semloEditorHeadingNumbering: item.numbered ? "mixed" : null },
      });
      expect(emptyHeading?.content ?? []).toEqual([]);
      expect(removed.selection).toMatchObject({ empty: true, anchorType: "heading", anchorOffset: 0 });
      expect(removed.focused).toBe(true);
      expect(removed.changes).toHaveLength(1);
      expect(removed.changes[0].json).toEqual(removed.snapshot.json);
      expect(removed.documentChanges - initial.documentChanges).toBe(1);

      await page.keyboard.press("ControlOrMeta+z");
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      const undone = await read(page);
      expect(undone.snapshot.json).toEqual(initial.snapshot.json);
      expect(undone.selection).toMatchObject({
        empty: false,
        anchorType: "heading",
        anchorText: title,
        anchorOffset: 0,
        headType: "heading",
        headText: title,
        headOffset: title.length,
      });
      expect(undone.domSelection).toEqual({ empty: false, text: title });
      expect(undone.focused).toBe(true);
      expect(undone.changes).toHaveLength(2);
      expect(undone.documentChanges - initial.documentChanges).toBe(2);
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      const redone = await read(page);
      expect(redone.snapshot.json).toEqual(removed.snapshot.json);
      expect(redone.selection).toEqual(removed.selection);
      expect(redone.focused).toBe(true);
      expect(redone.changes).toHaveLength(3);
      expect(redone.documentChanges - initial.documentChanges).toBe(3);
      expect(redone.errors).toEqual([]);
      expect(pageErrors).toEqual([]);
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").destroy());
    });
  }
}
