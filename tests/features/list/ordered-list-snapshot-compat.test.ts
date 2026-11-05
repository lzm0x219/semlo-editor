import { expect, test, type Page } from "@rstest/playwright";
import { getSchema, type Editor, type JSONContent } from "@tiptap/core";

import { createStarterKitWithCodeFonts } from "../../../packages/core/src/editor/starter-kit";
import { rebaseOrderedListLevelStarts } from "../../../packages/core/src/features/list/ordinals";
import { ParagraphLayout } from "../../../packages/core/src/features/text/paragraph-layout";
import type { EditorController, EditorSnapshot } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    snapshotCompatEditor?: EditorController;
    snapshotCompatUpdates?: EditorSnapshot[];
    snapshotCompatEchoes?: Array<{ legacyHasKey: boolean; starts: unknown }>;
    snapshotCompatUpdateCount?: number;
    ancestorPathEchoes?: Array<{ legacyKeys: boolean[]; starts: unknown; style: unknown; path: unknown }>;
    ancestorPathUpdateCount?: number;
  }
}

const paragraph = (text: string) => ({ type: "paragraph", content: [{ type: "text", text }] });
const item = (text: string, indent = 0) => ({
  type: "listItem",
  attrs: { semloEditorListIndent: indent },
  content: [paragraph(text)],
});
const content = {
  type: "doc",
  content: [
    { type: "orderedList", attrs: { start: 7 }, content: [item("旧列表甲"), item("旧列表乙")] },
    { type: "blockquote", content: [{ type: "orderedList", content: [item("嵌套旧列表")] }] },
    {
      type: "orderedList",
      attrs: { start: 2, semloEditorListLevelStarts: { 0: 2 } },
      content: [item("新列表丁", 1), item("新列表戊")],
    },
  ],
};

test("first-level rebasing preserves split seeds and leaves plain starts alone", () => {
  const schema = getSchema([createStarterKitWithCodeFonts([]).configure({ trailingNode: false }), ParagraphLayout]);
  const list = (start: number, metadata: unknown, indents: number[]) =>
    schema.nodeFromJSON({
      type: "orderedList",
      attrs: { start, semloEditorListLevelStarts: metadata },
      content: indents.map((indent, index) => item(`项${index}`, indent)),
    });
  expect(rebaseOrderedListLevelStarts(list(2, { 0: 2 }, [1, 0]), 2)).toEqual({
    ok: true,
    attrs: { start: 1, semloEditorListLevelStarts: { 0: 2, 1: 2 } },
  });
  expect(rebaseOrderedListLevelStarts(list(1, { 0: 2, 1: 2 }, [2, 1]), 1)).toEqual({
    ok: true,
    attrs: { start: 2, semloEditorListLevelStarts: { 0: 2 } },
  });
  expect(rebaseOrderedListLevelStarts(list(7, null, [1, 1, 1]), 2)).toEqual({ ok: true, attrs: null });
  expect(rebaseOrderedListLevelStarts(list(2, { 9: 2 }, [1, 0]), 2)).toEqual({ ok: false });
});

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'snapshot-compat-test'
      document.body.append(host)
      window.snapshotCompatUpdates = []
      window.snapshotCompatEditor = createEditor({
        element: host, outline: false, content: ${JSON.stringify(content)},
        onChange(snapshot) { window.snapshotCompatUpdates.push(snapshot) },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.snapshotCompatEditor));
  return page.locator("#snapshot-compat-test");
}

test("legacy list snapshots omit absent metadata and valid snapshot metadata is detached", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mount(page);
  const result = await page.evaluate(() => {
    const controller = window.__semloRequireFixture("snapshotCompatEditor");
    const editor = controller.editor;
    const documentBefore = JSON.stringify(editor.getJSON());
    const snapshot = controller.getSnapshot();
    const lists: JSONContent[] = [];
    const collect = (node: JSONContent) => {
      if (node.type === "orderedList") lists.push(node);
      node.content?.forEach(collect);
    };
    collect(snapshot.json);
    const legacyHasKeys = lists
      .slice(0, 2)
      .map((list) => Object.hasOwn(list.attrs ?? {}, "semloEditorListLevelStarts"));
    const rawLists: Array<unknown> = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "orderedList") rawLists.push(node.attrs.semloEditorListLevelStarts);
    });
    (lists[2].attrs!.semloEditorListLevelStarts as Record<string, number>)["0"] = 999;
    const stateAfterSnapshotMutation = JSON.stringify(editor.getJSON());
    const current = controller.getSnapshot();
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "旧列表甲") position = pos + node.nodeSize;
    });
    if (position < 0) throw new Error("Missing legacy item");
    editor.commands.setTextSelection(position);
    editor.commands.insertContent("续");
    const update = window.__semloRequireFixture("snapshotCompatUpdates").at(-1);
    if (!update) throw new Error("Missing onChange snapshot");
    const updatedLists: JSONContent[] = [];
    const collectUpdate = (node: JSONContent) => {
      if (node.type === "orderedList") updatedLists.push(node);
      node.content?.forEach(collectUpdate);
    };
    collectUpdate(update.json);
    const updateLegacyHasKeys = updatedLists
      .slice(0, 2)
      .map((list) => Object.hasOwn(list.attrs ?? {}, "semloEditorListLevelStarts"));
    const documentBeforeUpdateMutation = JSON.stringify(editor.getJSON());
    (updatedLists[2].attrs!.semloEditorListLevelStarts as Record<string, number>)["0"] = 888;
    const documentAfterUpdateMutation = JSON.stringify(editor.getJSON());
    return {
      legacyHasKeys,
      rawLists,
      documentBefore,
      stateAfterSnapshotMutation,
      currentMetadata: current.json.content?.[2].attrs?.semloEditorListLevelStarts,
      updateLegacyHasKeys,
      documentBeforeUpdateMutation,
      documentAfterUpdateMutation,
      current: controller.getSnapshot(),
    };
  });
  expect(result.legacyHasKeys).toEqual([false, false]);
  expect(result.rawLists).toEqual([null, null, { 0: 2 }]);
  expect(result.stateAfterSnapshotMutation).toBe(result.documentBefore);
  expect(result.currentMetadata).toEqual({ 0: 2 });
  expect(result.updateLegacyHasKeys).toEqual([false, false]);
  expect(result.documentAfterUpdateMutation).toBe(result.documentBeforeUpdateMutation);
  expect(result.current.json.content?.[2].attrs?.semloEditorListLevelStarts).toEqual({ 0: 2 });

  for (const format of ["json", "html"] as const) {
    const restored = await page.evaluate((value) => {
      const controller = window.__semloRequireFixture("snapshotCompatEditor");
      controller.setContent("<p>替换</p>");
      controller.setContent(value);
      return controller.getSnapshot();
    }, result.current[format]);
    expect(restored.json).toEqual(result.current.json);
    expect(restored.text).toBe(result.current.text);
  }
  expect(errors).toEqual([]);
});

test("ordered style and ancestor paths preserve legacy snapshots and detach host values", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mount(page);
  const result = await page.evaluate(() => {
    const controller = window.__semloRequireFixture("snapshotCompatEditor");
    const editor = controller.editor;
    const legacy: JSONContent[] = [];
    const collect = (node: JSONContent) => {
      if (node.type === "orderedList") legacy.push(node);
      node.content?.forEach(collect);
    };
    collect(controller.getSnapshot().json);
    const legacyKeys = legacy
      .slice(0, 2)
      .map((list) =>
        ["semloEditorListLevelStarts", "semloEditorOrderedStyle", "semloEditorOrderedAncestorPath"].map((key) =>
          Object.hasOwn(list.attrs ?? {}, key),
        ),
      );

    controller.setContent({
      type: "doc",
      content: [
        {
          type: "orderedList",
          attrs: {
            start: 4,
            semloEditorListLevelStarts: { 0: 8 },
            semloEditorOrderedStyle: "decimal",
            semloEditorOrderedAncestorPath: [7],
          },
          content: [
            {
              type: "listItem",
              attrs: { semloEditorListIndent: 1 },
              content: [{ type: "paragraph", content: [{ type: "text", text: "路径丁" }] }],
            },
            { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "路径戊" }] }] },
          ],
        },
        { type: "paragraph" },
      ],
    });
    const snapshot = controller.getSnapshot();
    const beforeMutation = JSON.stringify(editor.getJSON());
    (snapshot.json.content![0].attrs!.semloEditorOrderedAncestorPath as number[])[0] = 999;
    const afterMutation = JSON.stringify(editor.getJSON());
    const unchanged = controller.getSnapshot();
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "路径丁") position = pos + node.nodeSize;
    });
    if (position < 0) throw new Error("Missing path item");
    window.snapshotCompatUpdates = [];
    editor.commands.setTextSelection(position);
    editor.commands.insertContent("续");
    const update = window.__semloRequireFixture("snapshotCompatUpdates").at(-1);
    if (!update) throw new Error("Missing onChange snapshot");
    const beforeUpdateMutation = JSON.stringify(editor.getJSON());
    (update.json.content![0].attrs!.semloEditorOrderedAncestorPath as number[])[0] = 888;
    const afterUpdateMutation = JSON.stringify(editor.getJSON());
    return {
      legacyKeys,
      beforeMutation,
      afterMutation,
      unchanged,
      beforeUpdateMutation,
      afterUpdateMutation,
      edited: controller.getSnapshot(),
    };
  });
  expect(result.legacyKeys).toEqual([
    [false, false, false],
    [false, false, false],
  ]);
  expect(result.afterMutation).toBe(result.beforeMutation);
  expect(result.afterUpdateMutation).toBe(result.beforeUpdateMutation);
  expect(result.unchanged.json.content?.[0].attrs).toMatchObject({
    start: 4,
    semloEditorListLevelStarts: { 0: 8 },
    semloEditorOrderedStyle: "decimal",
    semloEditorOrderedAncestorPath: [7],
  });
  expect(result.edited.json.content?.[0].attrs?.semloEditorOrderedAncestorPath).toEqual([7]);
  expect(result.edited.html).toContain("data-semlo-editor-ordered-ancestor-path");
  for (const format of ["json", "html"] as const) {
    const restored = await page.evaluate((value) => {
      const controller = window.__semloRequireFixture("snapshotCompatEditor");
      controller.setContent("<p>替换</p>");
      controller.setContent(value);
      return controller.getSnapshot();
    }, result.edited[format]);
    expect(restored.json).toEqual(result.edited.json);
  }
  expect(errors).toEqual([]);
});

for (const scenario of [
  { name: "first item", selection: "first", backward: false, indents: [2, 0], values: [1, 2] },
  { name: "second item", selection: "second", backward: false, indents: [1, 1], values: [2, 3] },
  { name: "both forward", selection: "both", backward: false, indents: [2, 1], values: [1, 2] },
  { name: "both backward", selection: "both", backward: true, indents: [2, 1], values: [1, 2] },
] as const) {
  test(`toolbar indentation rebases stored level starts for ${scenario.name}`, async ({ page }) => {
    const host = await mount(page);
    const before = await page.evaluate(
      ({ selection, backward }) => {
        const controller = window.__semloRequireFixture("snapshotCompatEditor");
        const editor = controller.editor;
        const positions: Record<string, number> = {};
        editor.state.doc.descendants((node, pos) => {
          if (node.isText && (node.text === "新列表丁" || node.text === "新列表戊")) positions[node.text] = pos;
        });
        const from = positions[selection === "second" ? "新列表戊" : "新列表丁"];
        const to = selection === "both" ? positions["新列表戊"] + "新列表戊".length : from;
        editor.view.focus();
        editor.commands.setTextSelection({ from: backward ? to : from, to: backward ? from : to });
        window.snapshotCompatUpdates = [];
        return {
          snapshot: controller.getSnapshot(),
          selection: { anchor: editor.state.selection.anchor, head: editor.state.selection.head },
        };
      },
      { selection: scenario.selection, backward: scenario.backward },
    );
    await host.getByRole("button", { name: "缩进调整" }).click();
    await page.getByRole("menuitem", { name: "增加缩进" }).click();
    const after = await page.evaluate(() => {
      const controller = window.__semloRequireFixture("snapshotCompatEditor");
      const editor = controller.editor;
      return {
        snapshot: controller.getSnapshot(),
        selection: { anchor: editor.state.selection.anchor, head: editor.state.selection.head },
        updates: window.__semloRequireFixture("snapshotCompatUpdates").length,
      };
    });
    const list = after.snapshot.json.content?.[2];
    expect(list?.content?.map((node) => node.attrs?.semloEditorListIndent)).toEqual([...scenario.indents]);
    expect(list?.attrs?.start).toBe(scenario.selection === "second" ? 2 : 1);
    expect(list?.attrs?.semloEditorListLevelStarts).toEqual(
      scenario.selection === "second" ? { 0: 2 } : { 0: 2, 1: 2 },
    );
    expect(
      await host
        .locator(".semlo-editor-prose > ol")
        .last()
        .locator(":scope > li")
        .evaluateAll((items) => items.map((node) => Number(node.getAttribute("value")))),
    ).toEqual([...scenario.values]);
    expect(after.selection).toEqual(before.selection);
    expect(after.updates).toBe(1);
    expect(await page.evaluate(() => window.__semloRequireFixture("snapshotCompatEditor").editor.commands.undo())).toBe(
      true,
    );
    expect(
      (await page.evaluate(() => window.__semloRequireFixture("snapshotCompatEditor").getSnapshot())).json,
    ).toEqual(before.snapshot.json);
    expect(await page.evaluate(() => window.__semloRequireFixture("snapshotCompatEditor").editor.commands.redo())).toBe(
      true,
    );
    expect(
      (await page.evaluate(() => window.__semloRequireFixture("snapshotCompatEditor").getSnapshot())).json,
    ).toEqual(after.snapshot.json);
    for (const format of ["html", "json"] as const) {
      const restored = await page.evaluate((value) => {
        const controller = window.__semloRequireFixture("snapshotCompatEditor");
        controller.setContent("<p>临时替换</p>");
        controller.setContent(value);
        return controller.getSnapshot();
      }, after.snapshot[format]);
      expect(restored.json).toEqual(after.snapshot.json);
    }
  });
}

test("toolbar indentation keeps the original start of a plain list", async ({ page }) => {
  const host = await mount(page);
  const plain = {
    type: "doc",
    content: [{ type: "orderedList", attrs: { start: 7 }, content: [item("甲", 1), item("乙", 1), item("丙", 1)] }],
  };
  const before = await page.evaluate((value) => {
    const controller = window.__semloRequireFixture("snapshotCompatEditor");
    const editor = controller.editor;
    controller.setContent(value);
    const positions: Record<string, number> = {};
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text) positions[node.text] = pos;
    });
    editor.view.focus();
    editor.commands.setTextSelection({ from: positions["甲"], to: positions["乙"] + 1 });
    return controller.getSnapshot();
  }, plain);
  await host.getByRole("button", { name: "缩进调整" }).click();
  await page.getByRole("menuitem", { name: "增加缩进" }).click();
  const after = await page.evaluate(() => window.__semloRequireFixture("snapshotCompatEditor").getSnapshot());
  const list = after.json.content?.[0];
  expect(list?.attrs?.start).toBe(7);
  expect(Object.hasOwn(list?.attrs ?? {}, "semloEditorListLevelStarts")).toBe(false);
  expect(list?.content?.map((node) => node.attrs?.semloEditorListIndent)).toEqual([2, 2, 1]);
  expect(
    await host
      .locator(".semlo-editor-prose > ol > li")
      .evaluateAll((items) => items.map((node) => Number(node.getAttribute("value")))),
  ).toEqual([7, 8, 1]);
  expect(await page.evaluate(() => window.__semloRequireFixture("snapshotCompatEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("snapshotCompatEditor").getSnapshot())).json).toEqual(
    before.json,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("snapshotCompatEditor").editor.commands.redo())).toBe(
    true,
  );
  expect((await page.evaluate(() => window.__semloRequireFixture("snapshotCompatEditor").getSnapshot())).json).toEqual(
    after.json,
  );
});

for (const framework of ["react", "vue", "solid"] as const) {
  test(`${framework} controlled snapshots reapply legacy and metadata lists without resetting selection`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN}/tests/controlled.html`);
    const prose = page.locator(`#${framework} .semlo-editor-prose`);
    await expect(prose).toBeVisible();
    await page.evaluate(
      ({ name, value }) => {
        const element = document.querySelector(`#${name} .semlo-editor-prose`) as HTMLElement & { editor: Editor };
        element.editor.commands.setContent(value);
      },
      { name: framework, value: content },
    );
    await expect(prose.getByText("新列表戊", { exact: true })).toBeVisible();
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );

    await page.evaluate((name) => {
      const element = document.querySelector(`#${name} .semlo-editor-prose`) as HTMLElement & { editor: Editor };
      const editor = element.editor;
      window.snapshotCompatEchoes = [];
      window.snapshotCompatUpdateCount = 0;
      const schema = editor.schema;
      const nodeFromJSON = schema.nodeFromJSON;
      schema.nodeFromJSON = (value) => {
        const parsed = nodeFromJSON.call(schema, value);
        if (value?.type === "doc") {
          const legacy = value.content?.[0];
          const metadata = value.content?.[2]?.attrs?.semloEditorListLevelStarts;
          window.__semloRequireFixture("snapshotCompatEchoes").push({
            legacyHasKey: Object.hasOwn(legacy?.attrs ?? {}, "semloEditorListLevelStarts"),
            starts: metadata,
          });
        }
        return parsed;
      };
      editor.on("update", () => {
        window.__semloIncrementFixture("snapshotCompatUpdateCount");
      });
      let position = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === "新列表丁") position = pos + node.nodeSize;
      });
      if (position < 0) throw new Error("Missing controlled item");
      editor.view.focus();
      editor.commands.setTextSelection(position);
    }, framework);
    await page.keyboard.insertText("续");
    await expect(prose.getByText("新列表丁续", { exact: true })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__semloRequireFixture("snapshotCompatEchoes").at(-1) ?? null))
      .toEqual({
        legacyHasKey: false,
        starts: { 0: 2 },
      });
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    const after = await page.evaluate((name) => {
      const element = document.querySelector(`#${name} .semlo-editor-prose`) as HTMLElement & { editor: Editor };
      const editor = element.editor;
      return {
        updates: window.__semloRequireFixture("snapshotCompatUpdateCount"),
        parent: editor.state.selection.$from.parent.textContent,
        offset: editor.state.selection.$from.parentOffset,
      };
    }, framework);
    expect(after).toEqual({ updates: 1, parent: "新列表丁续", offset: "新列表丁续".length });
    expect(errors).toEqual([]);
  });

  test(`${framework} controlled content retains ancestor paths and legacy JSON shape`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`${process.env.SEMLO_TEST_ORIGIN}/tests/controlled.html`);
    const prose = page.locator(`#${framework} .semlo-editor-prose`);
    await expect(prose).toBeVisible();
    const value = {
      type: "doc",
      content: [
        { type: "orderedList", attrs: { start: 7 }, content: [item("旧列表", 0)] },
        { type: "paragraph" },
        {
          type: "orderedList",
          attrs: {
            start: 4,
            semloEditorListLevelStarts: { 0: 8 },
            semloEditorOrderedStyle: "decimal",
            semloEditorOrderedAncestorPath: [7],
          },
          content: [item("路径丁", 1), item("路径戊", 0)],
        },
      ],
    };
    await page.evaluate(
      ({ name, content }) => {
        const element = document.querySelector(`#${name} .semlo-editor-prose`) as HTMLElement & { editor: Editor };
        element.editor.commands.setContent(content);
      },
      { name: framework, content: value },
    );
    await expect(prose.getByText("路径丁", { exact: true })).toBeVisible();
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    await page.evaluate((name) => {
      const element = document.querySelector(`#${name} .semlo-editor-prose`) as HTMLElement & { editor: Editor };
      const editor = element.editor;
      window.ancestorPathEchoes = [];
      window.ancestorPathUpdateCount = 0;
      const schema = editor.schema;
      const nodeFromJSON = schema.nodeFromJSON;
      schema.nodeFromJSON = (value) => {
        const parsed = nodeFromJSON.call(schema, value);
        if (value?.type === "doc") {
          const legacy = value.content?.[0];
          const attrs = value.content?.[2]?.attrs;
          window.__semloRequireFixture("ancestorPathEchoes").push({
            legacyKeys: ["semloEditorListLevelStarts", "semloEditorOrderedStyle", "semloEditorOrderedAncestorPath"].map(
              (key) => Object.hasOwn(legacy?.attrs ?? {}, key),
            ),
            starts: attrs?.semloEditorListLevelStarts,
            style: attrs?.semloEditorOrderedStyle,
            path: attrs?.semloEditorOrderedAncestorPath,
          });
        }
        return parsed;
      };
      editor.on("update", () => {
        window.__semloIncrementFixture("ancestorPathUpdateCount");
      });
      let position = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isText && node.text === "路径丁") position = pos + node.nodeSize;
      });
      if (position < 0) throw new Error("Missing controlled path item");
      editor.view.focus();
      editor.commands.setTextSelection(position);
    }, framework);
    await page.keyboard.insertText("续");
    await expect(prose.getByText("路径丁续", { exact: true })).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.__semloRequireFixture("ancestorPathEchoes").at(-1) ?? null))
      .toEqual({
        legacyKeys: [false, false, false],
        starts: { 0: 8 },
        style: "decimal",
        path: [7],
      });
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
    );
    const after = await page.evaluate((name) => {
      const element = document.querySelector(`#${name} .semlo-editor-prose`) as HTMLElement & { editor: Editor };
      const editor = element.editor;
      return {
        updates: window.__semloRequireFixture("ancestorPathUpdateCount"),
        parent: editor.state.selection.$from.parent.textContent,
        offset: editor.state.selection.$from.parentOffset,
      };
    }, framework);
    expect(after).toEqual({ updates: 1, parent: "路径丁续", offset: "路径丁续".length });
    const marker = await prose.getByText("路径丁续", { exact: true }).evaluate((node) => {
      return getComputedStyle(node.closest("li")!).listStyleType;
    });
    expect(marker).toContain("7.4.");
    expect(errors).toEqual([]);
  });
}
