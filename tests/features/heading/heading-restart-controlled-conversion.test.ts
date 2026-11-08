import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type { RestartFramework } from "../../fixtures/list/ordered-restart-controlled-fixture";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

let origin: string;
let closeServer: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop: closeServer } = await startFixtureServer(
    "./tests/fixtures/heading/heading-restart-controlled-fixture.ts",
    {
      framework: true,
    },
  ));
});
afterAll(async () => closeServer?.());

const labels = ["甲甲", "乙乙", "丙丙", "丁丁", "戊戊", "己己", "庚庚"];
type Case = {
  name: string;
  levels: number[];
  restarts: number[];
  selected: number;
  action: "shortcut" | "toolbar" | "blockMenu" | "blockMenuKeyboard";
  selection: readonly [number, number];
  beforeMarkers: string[];
  afterMarkers: string[];
};
const cases: Case[] = [
  {
    name: "item before a restart",
    levels: [0, 1, 1, 1],
    restarts: [2],
    selected: 1,
    action: "shortcut",
    selection: [1, 1],
    beforeMarkers: ["1.", "1.1.", "1.1.", "1.2."],
    afterMarkers: ["1.", "1.1.", "1.2."],
  },
  {
    name: "restarted item",
    levels: [0, 1, 1, 1],
    restarts: [2],
    selected: 2,
    action: "toolbar",
    selection: [2, 0],
    beforeMarkers: ["1.", "1.1.", "1.1.", "1.2."],
    afterMarkers: ["1.", "1.1.", "1.1."],
  },
  {
    name: "first of two same-level restarts",
    levels: [0, 1, 1, 1, 1, 1],
    restarts: [2, 4],
    selected: 2,
    action: "blockMenu",
    selection: [1, 1],
    beforeMarkers: ["1.", "1.1.", "1.1.", "1.2.", "1.1.", "1.2."],
    afterMarkers: ["1.", "1.1.", "1.1.", "1.1.", "1.2."],
  },
  {
    name: "first of two same-level restarts with keyboard menu navigation",
    levels: [0, 1, 1, 1, 1, 1],
    restarts: [2, 4],
    selected: 2,
    action: "blockMenuKeyboard",
    selection: [1, 1],
    beforeMarkers: ["1.", "1.1.", "1.1.", "1.2.", "1.1.", "1.2."],
    afterMarkers: ["1.", "1.1.", "1.1.", "1.1.", "1.2."],
  },
  {
    name: "second of two same-level restarts",
    levels: [0, 1, 1, 1, 1, 1],
    restarts: [2, 4],
    selected: 4,
    action: "shortcut",
    selection: [0, 2],
    beforeMarkers: ["1.", "1.1.", "1.1.", "1.2.", "1.1.", "1.2."],
    afterMarkers: ["1.", "1.1.", "1.1.", "1.2.", "1.1."],
  },
];

function documentFor(levels: number[], restarts: number[]): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "orderedList",
        attrs: { start: 1, semloEditorOrderedStyle: "decimal" },
        content: levels.map((indent, index) => ({
          type: "listItem",
          attrs: { semloEditorListIndent: indent, semloEditorListRestart: restarts.includes(index) },
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: labels[index], ...(index === 0 ? { marks: [{ type: "bold" }] } : {}) }],
            },
          ],
        })),
      },
      { type: "paragraph", content: [{ type: "text", text: "末尾", marks: [{ type: "italic" }] }] },
    ],
  };
}

async function mount(page: Page, framework: RestartFramework, content: JSONContent) {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountRestartControlledFixture === "function");
  await page.evaluate(
    (name) => window.__semloRequireFixture("mountRestartControlledFixture")(name, "legacy"),
    framework,
  );
  await page.evaluate((value) => window.__semloRequireFixture("restartControlledFixture").setContent(value), content);
  await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
  return page.locator("#restart-controlled-fixture");
}

async function select(page: Page, text: string, anchor: number, head: number) {
  await page.evaluate(
    ({ text, anchor, head }) => {
      const editor = window.__semloRequireFixture("restartControlledFixture").controller.editor;
      let start = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock && node.textContent === text) start = pos + 1;
      });
      if (start < 0) throw new Error("Missing selected item");
      editor.view.focus();
      editor.commands.setTextSelection({ from: start + anchor, to: start + head });
    },
    { text, anchor, head },
  );
}

async function read(page: Page) {
  return page.evaluate(() => {
    const fixture = window.__semloRequireFixture("restartControlledFixture");
    const editor = fixture.controller.editor;
    const items: Array<{ text: string; attrs: Record<string, unknown>; content: unknown }> = [];
    const blocks: Array<{ text: string; node: JSONContent }> = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "listItem")
        items.push({
          text: node.firstChild?.textContent ?? "",
          attrs: { ...node.attrs },
          content: node.firstChild?.content.toJSON(),
        });
      if (node.isTextblock) blocks.push({ text: node.textContent, node: node.toJSON() as JSONContent });
    });
    const { selection } = editor.state;
    return {
      snapshot: fixture.controller.getSnapshot(),
      items,
      blocks,
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

async function markers(page: Page) {
  return page.locator("#restart-controlled-fixture .semlo-editor-prose li").evaluateAll((items) =>
    items.map((element) => ({
      text: Array.from(element.children).find((child) => child.tagName === "P")?.textContent,
      marker: getComputedStyle(element).listStyleType,
    })),
  );
}

async function convert(page: Page, selected: string, action: Case["action"]) {
  const host = page.locator("#restart-controlled-fixture");
  if (action === "shortcut") {
    await page.keyboard.press("ControlOrMeta+Alt+3");
  } else if (action === "toolbar") {
    await host.getByRole("button", { name: "段落样式" }).click();
    await page.getByRole("menuitemradio", { name: "标题3", exact: true }).click();
  } else {
    await host.locator(".semlo-editor-prose").getByText(selected, { exact: true }).hover({ timeout: 4000 });
    await page.locator(".semlo-editor-block-handle:visible").click({ timeout: 4000 });
    await page.getByRole("menu", { name: "块操作" }).getByRole("menuitem", { name: "转化为" }).click({ timeout: 4000 });
    const submenu = page.getByRole("menu", { name: "转化为" });
    const title = submenu.getByRole("menuitem", { name: "标题 3", exact: true });
    if (action === "blockMenuKeyboard") {
      const focused = async () => page.evaluate(() => document.activeElement?.textContent);
      expect(await focused()).toBe("标题 1");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      expect(await focused()).toBe("标题 3");
      await page.keyboard.press("Enter");
    } else {
      const bounds = await title.boundingBox();
      if (!bounds) throw new Error("Missing heading submenu bounds");
      await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { steps: 20 });
      await title.click({ timeout: 4000 });
    }
  }
}

for (const framework of ["react", "vue", "solid"] as const satisfies readonly RestartFramework[]) {
  for (const fixture of cases) {
    test(`${framework} controlled ${fixture.name} converts through ${fixture.action}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      const host = await mount(page, framework, documentFor(fixture.levels, fixture.restarts));
      const selected = labels[fixture.selected];
      await select(page, selected, ...fixture.selection);
      const before = await read(page);
      expect(before.selection).toEqual({
        anchorText: selected,
        anchorOffset: fixture.selection[0],
        headText: selected,
        headOffset: fixture.selection[1],
      });
      expect((await markers(page)).map((entry) => entry.marker)).toEqual(
        fixture.beforeMarkers.map((value) => `"${value} "`),
      );
      expect(before.changes).toHaveLength(0);
      await convert(page, selected, fixture.action);
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      const after = await read(page);
      expect(after.snapshot.json).not.toEqual(before.snapshot.json);
      expect(after.changes).toHaveLength(1);
      expect(after.changes[0].json).toEqual(after.snapshot.json);
      expect(after.documentChanges - before.documentChanges).toBe(1);
      expect(after.focused).toBe(true);
      expect(after.selection).toEqual(
        fixture.action.startsWith("blockMenu")
          ? { anchorText: selected, anchorOffset: 0, headText: selected, headOffset: 0 }
          : before.selection,
      );
      expect(after.blocks.map((block) => block.text)).toEqual(before.blocks.map((block) => block.text));
      expect(after.blocks.filter((block) => block.text !== selected)).toEqual(
        before.blocks.filter((block) => block.text !== selected),
      );
      expect(after.items).toEqual(before.items.filter((item) => item.text !== selected));
      expect(after.blocks.find((block) => block.text === selected)?.node).toMatchObject({
        type: "heading",
        attrs: { level: 3, semloEditorHeadingNumbering: "mixed" },
      });
      await expect(host.locator(".semlo-editor-prose > h3 .semlo-editor-heading-number")).toHaveText("1. ");
      expect((await markers(page)).map((entry) => entry.marker)).toEqual(
        fixture.afterMarkers.map((value) => `"${value} "`),
      );
      expect(after.items.filter((item) => item.attrs.semloEditorListRestart === true).map((item) => item.text)).toEqual(
        fixture.restarts.filter((index) => index !== fixture.selected).map((index) => labels[index]),
      );
      expect(after.snapshot.html.includes('data-semlo-editor-list-restart="true"')).toBe(
        fixture.restarts.some((index) => index !== fixture.selected),
      );
      await page.keyboard.press("ControlOrMeta+z");
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      const undone = await read(page);
      expect(undone.snapshot.json).toEqual(before.snapshot.json);
      expect(undone.changes).toHaveLength(2);
      expect(undone.changes[1].json).toEqual(before.snapshot.json);
      expect(undone.documentChanges - before.documentChanges).toBe(2);
      expect(undone.selection).toEqual(before.selection);
      expect(undone.focused).toBe(true);
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      const redone = await read(page);
      expect(redone.snapshot.json).toEqual(after.snapshot.json);
      expect(redone.changes).toHaveLength(3);
      expect(redone.changes[2].json).toEqual(after.snapshot.json);
      expect(redone.documentChanges - before.documentChanges).toBe(3);
      expect(redone.selection).toEqual(after.selection);
      expect(redone.focused).toBe(true);
      expect((await markers(page)).map((entry) => entry.marker)).toEqual(
        fixture.afterMarkers.map((value) => `"${value} "`),
      );
      for (const value of [after.snapshot.json, after.snapshot.html]) {
        await page.evaluate(() =>
          window.__semloRequireFixture("restartControlledFixture").setContent("<p>临时替换</p>"),
        );
        await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
        await page.evaluate(
          (saved) => window.__semloRequireFixture("restartControlledFixture").setContent(saved),
          value,
        );
        await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
        const restored = await read(page);
        expect(restored.snapshot.json).toEqual(after.snapshot.json);
        expect(restored.items).toEqual(after.items);
        expect(restored.changes).toHaveLength(3);
        expect((await markers(page)).map((entry) => entry.marker)).toEqual(
          fixture.afterMarkers.map((marker) => `"${marker} "`),
        );
      }
      expect((await read(page)).errors).toEqual([]);
      expect(errors).toEqual([]);
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").destroy());
    });
  }
  test(`${framework} rolls back a mixed-level restart selection without an onChange`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mount(page, framework, documentFor([0, 1, 1, 1, 2, 2, 2], [2, 5]));
    await select(page, "乙乙", 2, 0);
    const before = await read(page);
    const beforeMarkers = await markers(page);
    await page.keyboard.press("ControlOrMeta+Alt+3");
    await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
    const after = await read(page);
    expect(after.snapshot.json).toEqual(before.snapshot.json);
    expect(after.snapshot.html).toBe(before.snapshot.html);
    expect(after.selection).toEqual(before.selection);
    expect(after.focused).toBe(true);
    expect(after.changes).toEqual(before.changes);
    expect(after.documentChanges).toBe(before.documentChanges);
    expect(after.items).toEqual(before.items);
    expect(await markers(page)).toEqual(beforeMarkers);
    expect(after.errors).toEqual([]);
    expect(errors).toEqual([]);
    await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").destroy());
  });
}
