import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/heading/heading-block-history-fixture";
import type { RestartFramework } from "../../fixtures/list/ordered-restart-controlled-fixture";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

let origin: string;
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/heading/heading-block-history-fixture.ts", {
    framework: true,
  }));
});
afterAll(async () => stop?.());

const paragraph = (text: string, mark?: "bold" | "italic"): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text, ...(mark ? { marks: [{ type: mark }] } : {}) }],
});
const item = (text: string, indent: number, mark?: "bold" | "italic"): JSONContent => ({
  type: "listItem",
  attrs: { semloEditorListIndent: indent },
  content: [paragraph(text, mark)],
});
const groupDocument: JSONContent = {
  type: "doc",
  content: [
    {
      type: "orderedList",
      attrs: { start: 1, semloEditorOrderedStyle: "decimal" },
      content: [item("甲甲", 0, "bold"), item("乙乙", 1, "italic"), item("丙丙", 0)],
    },
    paragraph("末尾", "italic"),
  ],
};

async function mount(page: Page, framework: RestartFramework, content = groupDocument) {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountRestartControlledFixture === "function");
  await page.evaluate(
    (name) => window.__semloRequireFixture("mountRestartControlledFixture")(name, "legacy"),
    framework,
  );
  await page.evaluate((value) => window.__semloRequireFixture("restartControlledFixture").setContent(value), content);
  await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
}

async function inspect(page: Page) {
  return page.evaluate(() => {
    const fixture = window.__semloRequireFixture("restartControlledFixture");
    const editor = fixture.controller.editor;
    const selection = editor.state.selection;
    return {
      snapshot: fixture.controller.getSnapshot(),
      selection: {
        anchorText: selection.$anchor.parent.textContent,
        anchorOffset: selection.$anchor.parentOffset,
        headText: selection.$head.parent.textContent,
        headOffset: selection.$head.parentOffset,
      },
      focused: editor.view.hasFocus(),
      changes: fixture.changes,
      documentChanges: fixture.documentChanges,
      errors: fixture.errors,
    };
  });
}

async function openHeadingMenu(page: Page, text: string) {
  await page.locator("#restart-controlled-fixture .semlo-editor-prose").getByText(text, { exact: true }).hover();
  await page.locator(".semlo-editor-block-handle:visible").click();
  await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click();
  const title = page.getByRole("menu", { name: "转化为" }).getByRole("menuitem", { name: "标题 3", exact: true });
  const bounds = await title.boundingBox();
  if (!bounds) throw new Error("Missing heading submenu bounds");
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { steps: 20 });
  return title;
}

for (const framework of ["core", "react", "vue", "solid"] as const satisfies readonly RestartFramework[]) {
  for (const selection of [
    { name: "parent caret", text: "甲甲", anchor: 1, head: 1 },
    { name: "reversed selection", text: "甲甲", anchor: 2, head: 0 },
    { name: "caret outside group", text: "丙丙", anchor: 1, head: 1 },
  ]) {
    test(`${framework}: parent-child heading undo restores ${selection.name}`, async ({ page }) => {
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => pageErrors.push(error.message));
      await mount(page, framework);
      await page.evaluate(
        (value) => window.__semloRequireFixture("headingUndoProbe").setSelection(value.text, value.anchor, value.head),
        selection,
      );
      await page.evaluate(() => window.__semloRequireFixture("headingUndoProbe").observeChanges());
      const before = await inspect(page);
      const beforeDetails = await page.evaluate(() => {
        const selection = window.__semloRequireFixture("restartControlledFixture").controller.editor.state.selection;
        return {
          positions: [selection.anchor, selection.head],
          depth: window.__semloRequireFixture("headingUndoProbe").historyDepth(),
        };
      });
      expect(before.selection).toEqual({
        anchorText: selection.text,
        anchorOffset: selection.anchor,
        headText: selection.text,
        headOffset: selection.head,
      });
      const title = await openHeadingMenu(page, "甲甲");
      expect((await inspect(page)).selection).toEqual(before.selection);
      const startCalls = await page.evaluate(() => window.__semloRequireFixture("headingUndoProbe").filterCalls.length);
      await title.click();
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      const converted = await inspect(page);
      expect(converted.snapshot.json).not.toEqual(before.snapshot.json);
      const blocks = converted.snapshot.json.content ?? [];
      expect(blocks.map((node) => node.type)).toEqual(["heading", "heading", "orderedList", "paragraph"]);
      expect(blocks[0].content?.[0]?.text).toBe("甲甲");
      expect(blocks[1].content?.[0]?.text).toBe("乙乙");
      expect(blocks[2].content?.[0]?.content?.[0]).toEqual(before.snapshot.json.content?.[0].content?.[2].content?.[0]);
      expect(blocks[3]).toEqual(before.snapshot.json.content?.[1]);
      expect(converted.selection).toEqual({ anchorText: "甲甲", anchorOffset: 0, headText: "甲甲", headOffset: 0 });
      expect(converted.focused).toBe(true);
      expect(converted.changes).toHaveLength(1);
      expect(converted.documentChanges - before.documentChanges).toBe(1);
      const hookResult = await page.evaluate((start) => {
        const calls = window.__semloRequireFixture("headingUndoProbe").filterCalls.slice(start);
        return {
          calls,
          revision: window.__semloRequireFixture("headingUndoProbe").pluginRevision(),
          depth: window.__semloRequireFixture("headingUndoProbe").historyDepth(),
        };
      }, startCalls);
      const firstDocumentChange = hookResult.calls.findIndex((call) => call.docChanged);
      expect(firstDocumentChange).toBeGreaterThanOrEqual(0);
      expect(hookResult.calls.slice(0, firstDocumentChange).filter((call) => call.selectionSet)).toEqual([]);
      expect(hookResult.calls[firstDocumentChange].before).toEqual(beforeDetails.positions);
      expect(hookResult.revision).toBe(1);
      expect(hookResult.depth).toBe(beforeDetails.depth + 1);
      await page.keyboard.press("ControlOrMeta+z");
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      const undone = await inspect(page);
      expect(undone.snapshot.json).toEqual(before.snapshot.json);
      expect(undone.selection).toEqual(before.selection);
      expect(undone.focused).toBe(true);
      expect(undone.changes).toHaveLength(2);
      expect(undone.documentChanges - before.documentChanges).toBe(2);
      expect(await page.evaluate(() => window.__semloRequireFixture("headingUndoProbe").pluginRevision())).toBe(2);
      expect(await page.evaluate(() => window.__semloRequireFixture("headingUndoProbe").historyDepth())).toBe(
        beforeDetails.depth,
      );
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      const redone = await inspect(page);
      expect(redone.snapshot.json).toEqual(converted.snapshot.json);
      expect(redone.selection).toEqual(converted.selection);
      expect(redone.focused).toBe(true);
      expect(redone.changes).toHaveLength(3);
      expect(redone.documentChanges - before.documentChanges).toBe(3);
      expect(await page.evaluate(() => window.__semloRequireFixture("headingUndoProbe").pluginRevision())).toBe(3);
      expect(await page.evaluate(() => window.__semloRequireFixture("headingUndoProbe").historyDepth())).toBe(
        beforeDetails.depth + 1,
      );
      expect(redone.errors).toEqual([]);
      expect(pageErrors).toEqual([]);
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").destroy());
    });
  }

  test(`${framework}: rejected host transaction leaves content, selection, focus and echoes untouched`, async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    await mount(page, framework);
    await page.evaluate(() => {
      window.__semloRequireFixture("headingUndoProbe").setSelection("甲甲", 2, 0);
      window.__semloRequireFixture("headingUndoProbe").rejectChanges();
    });
    const before = await inspect(page);
    const title = await openHeadingMenu(page, "甲甲");
    const startCalls = await page.evaluate(() => window.__semloRequireFixture("headingUndoProbe").filterCalls.length);
    await title.click();
    await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
    const after = await inspect(page);
    expect(after.snapshot.json).toEqual(before.snapshot.json);
    expect(after.selection).toEqual(before.selection);
    expect(after.changes).toEqual(before.changes);
    expect(after.documentChanges).toBe(before.documentChanges);
    await expect(page.locator(".semlo-editor-block-menu-status")).toHaveText("当前块无法无损转换");
    await expect(title).toBeFocused();
    const calls = await page.evaluate(
      (start) => window.__semloRequireFixture("headingUndoProbe").filterCalls.slice(start),
      startCalls,
    );
    expect(calls.filter((call) => call.docChanged)).toHaveLength(1);
    expect(calls.filter((call) => !call.docChanged && call.selectionSet)).toEqual([]);
    expect(after.errors).toEqual([]);
    expect(pageErrors).toEqual([]);
    await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").destroy());
  });
}

test("a mixed restart group is rejected without changing the pre-menu selection", async ({ page }) => {
  const unsupported: JSONContent = {
    ...groupDocument,
    content: [
      {
        ...groupDocument.content![0],
        content: [
          item("甲甲", 0, "bold"),
          {
            ...item("乙乙", 1, "italic"),
            attrs: { semloEditorListIndent: 1, semloEditorListRestart: true },
          },
          item("丙丙", 0),
        ],
      },
      groupDocument.content![1],
    ],
  };
  await mount(page, "core", unsupported);
  await page.evaluate(() => window.__semloRequireFixture("headingUndoProbe").setSelection("甲甲", 2, 0));
  const before = await inspect(page);
  const title = await openHeadingMenu(page, "甲甲");
  await title.click();
  await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
  const after = await inspect(page);
  expect(after.snapshot.json).toEqual(before.snapshot.json);
  expect(after.selection).toEqual(before.selection);
  expect(after.documentChanges).toBe(before.documentChanges);
  expect(after.changes).toEqual(before.changes);
  await expect(page.locator(".semlo-editor-block-menu-status")).toHaveText("当前块无法无损转换");
  await expect(title).toBeFocused();
  await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").destroy());
});

test("a synthetic composition in progress defers the block-menu conversion", async ({ page }) => {
  await mount(page, "core");
  await page.evaluate(() => window.__semloRequireFixture("headingUndoProbe").setSelection("甲甲", 1, 1));
  const before = await inspect(page);
  const title = await openHeadingMenu(page, "甲甲");
  const composing = await page.evaluate(() => {
    const view = window.__semloRequireFixture("restartControlledFixture").controller.editor.view;
    view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    return view.composing;
  });
  expect(composing).toBe(true);
  await title.click();
  await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
  const after = await inspect(page);
  expect(after.snapshot.json).toEqual(before.snapshot.json);
  expect(after.selection).toEqual(before.selection);
  expect(after.documentChanges).toBe(before.documentChanges);
  expect(after.changes).toEqual(before.changes);
  await expect(title).toBeFocused();
  await page.evaluate(() => {
    const view = window.__semloRequireFixture("restartControlledFixture").controller.editor.view;
    view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "" }));
    window.__semloRequireFixture("restartControlledFixture").destroy();
  });
});
