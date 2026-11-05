import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    nestedOrderedHeadingEditor?: EditorController;
    nestedOrderedHeadingChanges?: number;
    flatOrderedHostTrace?: Array<{ version: number; previous: number }>;
    flatOrderedHostFilter?: number;
    flatOrderedHostAppend?: number;
  }
}

const nested =
  '<ul><li><p>父项</p><ol start="7"><li><p><strong>甲甲</strong></p></li><li><p>乙乙</p></li><li><p><em>丙丙</em></p></li></ol></li></ul>' +
  '<p><a href="https://example.com">尾段</a></p><ol start="11"><li><p>其他一</p></li><li><p>其他二</p></li></ol>';
const flat =
  '<ol><li><p><strong>甲甲</strong></p></li><li data-semlo-editor-list-indent="1"><p><em>乙乙</em></p></li><li><p><a href="https://example.com">丙丙</a></p></li></ol>' +
  '<p>尾段</p><ol start="11"><li><p>其他一</p></li><li><p>其他二</p></li></ol>';

async function mount(page: Page, content: string) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'nested-ordered-heading-test'
      document.body.prepend(host)
      window.nestedOrderedHeadingChanges = 0
      window.nestedOrderedHeadingEditor = createEditor({
        element: host, outline: false, content: ${JSON.stringify(content)},
        onChange: () => { window.nestedOrderedHeadingChanges++ },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.nestedOrderedHeadingEditor));
}

async function select(page: Page, text: string, anchorOffset = 1, headOffset = anchorOffset) {
  await page.evaluate(
    ({ text, anchorOffset, headOffset }) => {
      const editor = window.__semloRequireFixture("nestedOrderedHeadingEditor").editor;
      let position = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock && node.textContent === text) position = pos + 1;
      });
      if (position < 0) throw new Error(`Missing ${text}`);
      editor.view.focus();
      editor.commands.setTextSelection({ from: position + anchorOffset, to: position + headOffset });
    },
    { text, anchorOffset, headOffset },
  );
}

async function inspect(page: Page) {
  return page.evaluate(() => {
    const controller = window.__semloRequireFixture("nestedOrderedHeadingEditor");
    const editor = controller.editor;
    const blocks: Array<{ text: string; type: string; depth: number | null; node: unknown }> = [];
    let unrelated: unknown;
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "orderedList" && node.textContent === "其他一其他二") unrelated = node.toJSON();
      if (!node.isTextblock) return;
      const resolved = editor.state.doc.resolve(position + 1);
      let listCount = 0;
      let indent = 0;
      for (let depth = 1; depth < resolved.depth; depth += 1) {
        const ancestor = resolved.node(depth);
        if (["bulletList", "orderedList"].includes(ancestor.type.name)) listCount += 1;
        if (ancestor.type.name === "listItem") indent += Number(ancestor.attrs.semloEditorListIndent ?? 0);
      }
      blocks.push({
        text: node.textContent,
        type: node.type.name,
        depth: listCount ? listCount - 1 + indent : null,
        node: node.toJSON(),
      });
    });
    const { $anchor, $head } = editor.state.selection;
    return {
      json: controller.getSnapshot().json,
      html: controller.getSnapshot().html,
      blocks,
      unrelated,
      selection: {
        anchor: $anchor.parent.textContent,
        anchorOffset: $anchor.parentOffset,
        head: $head.parent.textContent,
        headOffset: $head.parentOffset,
      },
      changes: window.__semloRequireFixture("nestedOrderedHeadingChanges"),
    };
  });
}

/** Read actual Chromium list marker labels, not just list-style-type. */
async function markers(page: Page): Promise<Record<string, string>> {
  const labels = await page
    .locator("#nested-ordered-heading-test .semlo-editor-prose li")
    .evaluateAll((items) =>
      items.map((item) => Array.from(item.children).find((child) => child.tagName === "P")?.textContent ?? ""),
    );
  const session = await page.context().newCDPSession(page);
  try {
    const { root } = await session.send("DOM.getDocument");
    const { nodeIds } = await session.send("DOM.querySelectorAll", {
      nodeId: root.nodeId,
      selector: "#nested-ordered-heading-test .semlo-editor-prose li",
    });
    const descriptions = await Promise.all(nodeIds.map((nodeId) => session.send("DOM.describeNode", { nodeId })));
    const { nodes } = await session.send("Accessibility.getFullAXTree");
    const byId = new Map(nodes.map((node) => [node.nodeId, node]));
    const findMarker = (id: string): string | undefined => {
      const node = byId.get(id);
      if (!node) return undefined;
      if (node.role?.value === "ListMarker") return String(node.name?.value ?? "").trim();
      for (const child of node.childIds ?? []) {
        const marker = findMarker(child);
        if (marker !== undefined) return marker;
      }
      return undefined;
    };
    const result: Record<string, string> = {};
    descriptions.forEach(({ node }, index) => {
      const entry = nodes.find((candidate) => candidate.backendDOMNodeId === node.backendNodeId);
      const marker = entry && findMarker(entry.nodeId);
      if (marker !== undefined) result[labels[index]] = marker;
    });
    return result;
  } finally {
    await session.detach();
  }
}

async function convert(page: Page, text: string, anchor = 1, head = anchor) {
  await select(page, text, anchor, head);
  const before = await inspect(page);
  await page.keyboard.press("ControlOrMeta+Alt+3");
  const after = await inspect(page);
  expect(after.json).not.toEqual(before.json);
  expect(after.changes - before.changes).toBe(1);
  expect(after.blocks.map((block) => block.text)).toEqual(before.blocks.map((block) => block.text));
  expect(after.blocks.filter((block) => block.text !== text)).toEqual(
    before.blocks.filter((block) => block.text !== text),
  );
  expect(after.unrelated).toEqual(before.unrelated);
  expect(after.selection).toEqual(before.selection);
  const heading = after.blocks.find((block) => block.text === text);
  expect(heading?.type).toBe("heading");
  expect(heading?.node).toMatchObject({ attrs: { level: 3, semloEditorHeadingNumbering: "mixed" } });
  await expect(
    page.locator("#nested-ordered-heading-test .semlo-editor-prose .semlo-editor-heading-number"),
  ).toHaveText("1.");
  return { before, after };
}

async function undoRedo(
  page: Page,
  before: Awaited<ReturnType<typeof inspect>>,
  after: Awaited<ReturnType<typeof inspect>>,
) {
  expect(
    await page.evaluate(() => window.__semloRequireFixture("nestedOrderedHeadingEditor").editor.commands.undo()),
  ).toBe(true);
  const undone = await inspect(page);
  expect(undone.json).toEqual(before.json);
  expect(undone.selection).toEqual(before.selection);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("nestedOrderedHeadingEditor").editor.commands.redo()),
  ).toBe(true);
  const redone = await inspect(page);
  expect(redone.json).toEqual(after.json);
  expect(redone.selection).toEqual(after.selection);
}

test("nested custom-start children retain their markers when their parent or middle item becomes H3", async ({
  page,
}) => {
  await mount(page, nested);
  expect(await markers(page)).toMatchObject({ 甲甲: "g.", 乙乙: "h.", 丙丙: "i." });
  const first = await convert(page, "父项");
  expect(await markers(page)).toMatchObject({ 甲甲: "g.", 乙乙: "h.", 丙丙: "i." });
  expect(
    first.after.blocks.filter((block) => ["甲甲", "乙乙", "丙丙"].includes(block.text)).map((block) => block.depth),
  ).toEqual([1, 1, 1]);
  const flattened = page.locator("#nested-ordered-heading-test .semlo-editor-prose > ol").first();
  await expect(flattened).toHaveAttribute("start", "7");
  await undoRedo(page, first.before, first.after);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("nestedOrderedHeadingEditor").editor.commands.undo()),
  ).toBe(true);
  expect((await inspect(page)).json).toEqual(first.before.json);

  const second = await convert(page, "乙乙");
  expect(await markers(page)).toMatchObject({ 甲甲: "g.", 丙丙: "h." });
  expect(
    second.after.blocks.filter((block) => ["甲甲", "丙丙"].includes(block.text)).map((block) => block.depth),
  ).toEqual([1, 1]);
  const lists = page.locator("#nested-ordered-heading-test .semlo-editor-prose > ol");
  await expect(lists.nth(0)).toHaveAttribute("start", "7");
  await expect(lists.nth(1)).toHaveAttribute("start", "8");
  await undoRedo(page, second.before, second.after);
  await page.evaluate(
    (html) => window.__semloRequireFixture("nestedOrderedHeadingEditor").setContent(html),
    second.after.html,
  );
  expect((await inspect(page)).json).toEqual(second.after.json);
});

test("a nested ordered list keeps its custom start when the ordered parent becomes H3", async ({ page }) => {
  await mount(
    page,
    '<ol><li><p>父项</p><ol start="7"><li><p>甲甲</p></li><li><p>乙乙</p></li><li><p>丙丙</p></li></ol></li></ol><p>尾段</p>',
  );
  expect(await markers(page)).toMatchObject({ 父项: "1.", 甲甲: "a.", 乙乙: "b.", 丙丙: "c." });
  const { before, after } = await convert(page, "父项");
  expect(await markers(page)).toMatchObject({ 甲甲: "g.", 乙乙: "h.", 丙丙: "i." });
  expect(
    after.blocks.filter((block) => ["甲甲", "乙乙", "丙丙"].includes(block.text)).map((block) => block.depth),
  ).toEqual([1, 1, 1]);
  await expect(page.locator("#nested-ordered-heading-test .semlo-editor-prose > ol")).toHaveAttribute("start", "7");
  await undoRedo(page, before, after);
});

for (const [selected, remaining] of [
  ["甲甲", { 乙乙: "a.", 丙丙: "1." }],
  ["乙乙", { 甲甲: "1.", 丙丙: "2." }],
  ["丙丙", { 甲甲: "1.", 乙乙: "a." }],
] as const) {
  test(`flat ordered list preserves the other levels and markers after converting ${selected}`, async ({ page }) => {
    await mount(page, flat);
    expect(await markers(page)).toMatchObject({ 甲甲: "1.", 乙乙: "a.", 丙丙: "2." });
    const { before, after } = await convert(page, selected);
    expect(await markers(page)).toMatchObject(remaining);
    if (selected !== "乙乙") expect(after.blocks.find((block) => block.text === "乙乙")?.depth).toBe(1);
    await undoRedo(page, before, after);
  });
}

test("a backward selection within the indented ordered item survives conversion and history", async ({ page }) => {
  await mount(page, flat);
  const { before, after } = await convert(page, "乙乙", 2, 0);
  expect(after.selection).toEqual({ anchor: "乙乙", anchorOffset: 2, head: "乙乙", headOffset: 0 });
  expect(await markers(page)).toMatchObject({ 甲甲: "1.", 丙丙: "2." });
  await undoRedo(page, before, after);
});

test("a single nested custom-start item becomes a heading without leaving an empty list", async ({ page }) => {
  await mount(page, '<ul><li><p>父项</p><ol start="7"><li><p>乙乙</p></li></ol></li></ul><p>尾段</p>');
  const { before, after } = await convert(page, "乙乙");
  await expect(page.locator("#nested-ordered-heading-test .semlo-editor-prose ol")).toHaveCount(0);
  await undoRedo(page, before, after);
});

test("an unselected sibling list subtree and its contents remain intact", async ({ page }) => {
  await mount(
    page,
    '<ul><li><p>父项</p><ol start="7"><li><p>甲甲</p></li><li><p>乙乙</p></li><li><p>丙丙</p></li></ol><ul><li><p><em>保留子树</em></p></li></ul></li></ul><p>尾段</p>',
  );
  const subtree = () =>
    page.evaluate(() => {
      let result: unknown;
      window.__semloRequireFixture("nestedOrderedHeadingEditor").editor.state.doc.descendants((node) => {
        if (node.type.name === "bulletList" && node.textContent === "保留子树") result = node.toJSON();
      });
      return result;
    });
  const original = await subtree();
  const { before, after } = await convert(page, "乙乙");
  expect(original).toBeDefined();
  expect(await subtree()).toEqual(original);
  await undoRedo(page, before, after);
});

test("a selected indented item keeps its unselected child list at the same effective depth", async ({ page }) => {
  await mount(
    page,
    '<ol><li><p>甲甲</p></li><li data-semlo-editor-list-indent="1"><p>乙乙</p><ul><li><p><em>保留子树</em></p></li></ul></li><li><p>丙丙</p></li></ol><p>尾段</p>',
  );
  const { before, after } = await convert(page, "乙乙");
  expect(after.blocks.find((block) => block.text === "保留子树")?.depth).toBe(2);
  expect(await markers(page)).toMatchObject({ 甲甲: "1.", 丙丙: "2." });
  await undoRedo(page, before, after);
});

test("a split suffix retains independent initial values for its first and resumed levels", async ({ page }) => {
  await mount(
    page,
    '<ol><li><p>甲甲</p></li><li data-semlo-editor-list-indent="1"><p>乙乙</p></li><li><p>丙丙</p></li><li data-semlo-editor-list-indent="1"><p>丁丁</p></li><li><p>戊戊</p></li></ol><p>尾段</p>',
  );
  expect(await markers(page)).toMatchObject({ 甲甲: "1.", 乙乙: "a.", 丙丙: "2.", 丁丁: "a.", 戊戊: "3." });
  const { before, after } = await convert(page, "丙丙");
  expect(await markers(page)).toMatchObject({ 甲甲: "1.", 乙乙: "a.", 丁丁: "b.", 戊戊: "2." });
  const suffix = after.json.content?.find(
    (node) => node.type === "orderedList" && JSON.stringify(node.content).includes("丁丁"),
  );
  expect(suffix?.attrs?.start).toBe(2);
  expect(suffix?.attrs?.semloEditorListLevelStarts).toEqual({ "0": 2 });
  expect(after.html).toContain("data-semlo-editor-list-level-starts");
  await undoRedo(page, before, after);
  await page.evaluate(
    (html) => window.__semloRequireFixture("nestedOrderedHeadingEditor").setContent(html),
    after.html,
  );
  expect((await inspect(page)).json).toEqual(after.json);

  // Continue editing the later level after restoring the exported HTML.
  await select(page, "戊戊", 2);
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("己己");
  expect(await markers(page)).toMatchObject({ 甲甲: "1.", 乙乙: "a.", 丁丁: "b.", 戊戊: "2.", 己己: "3." });
});

test("an explicitly typed flat ordered list keeps its type and custom start after a split", async ({ page }) => {
  await mount(
    page,
    '<ol type="A" start="3"><li><p>甲甲</p></li><li data-semlo-editor-list-indent="1"><p>乙乙</p></li><li><p>丙丙</p></li></ol><p>尾段</p>',
  );
  expect(await markers(page)).toMatchObject({ 甲甲: "C.", 乙乙: "A.", 丙丙: "D." });
  const { before, after } = await convert(page, "乙乙");
  expect(await markers(page)).toMatchObject({ 甲甲: "C.", 丙丙: "D." });
  const lists = page.locator("#nested-ordered-heading-test .semlo-editor-prose > ol");
  await expect(lists).toHaveCount(2);
  await expect(lists.nth(0)).toHaveAttribute("type", "A");
  await expect(lists.nth(1)).toHaveAttribute("type", "A");
  await expect(lists.nth(0)).toHaveAttribute("start", "3");
  await expect(lists.nth(1)).toHaveAttribute("start", "4");
  await undoRedo(page, before, after);
  await page.evaluate(
    (html) => window.__semloRequireFixture("nestedOrderedHeadingEditor").setContent(html),
    after.html,
  );
  expect((await inspect(page)).json).toEqual(after.json);
});

test("a custom-start flat ordered list keeps an indented item's marker when a later item becomes H3", async ({
  page,
}) => {
  await mount(
    page,
    '<ol start="7"><li data-semlo-editor-list-indent="1"><p>甲甲</p></li><li><p>乙乙</p></li></ol><p>尾段</p>',
  );
  expect(await markers(page)).toMatchObject({ 甲甲: "g.", 乙乙: "1." });
  const { before, after } = await convert(page, "乙乙");
  expect(await markers(page)).toMatchObject({ 甲甲: "g." });
  expect(after.blocks.find((block) => block.text === "甲甲")?.depth).toBe(1);
  await undoRedo(page, before, after);
});

test("a blank indented item becomes a heading without losing the following blank item", async ({ page }) => {
  await mount(
    page,
    '<ol><li><p>甲甲</p></li><li data-semlo-editor-list-indent="1"><p></p></li><li><p></p></li><li><p>丁丁</p></li></ol><p>尾段</p>',
  );
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("nestedOrderedHeadingEditor").editor;
    let position = -1;
    editor.state.doc.descendants((node, pos) => {
      if (position < 0 && node.isTextblock && !node.textContent) position = pos + 1;
    });
    if (position < 0) throw new Error("Missing empty list item");
    editor.view.focus();
    editor.commands.setTextSelection(position);
  });
  const before = await inspect(page);
  await page.keyboard.press("ControlOrMeta+Alt+3");
  const after = await inspect(page);
  expect(after.json).not.toEqual(before.json);
  expect(after.blocks.map((block) => [block.type, block.text])).toEqual([
    ["paragraph", "甲甲"],
    ["heading", ""],
    ["paragraph", ""],
    ["paragraph", "丁丁"],
    ["paragraph", "尾段"],
  ]);
  expect(await markers(page)).toMatchObject({ 甲甲: "1.", "": "2.", 丁丁: "3." });
  expect(after.selection).toEqual(before.selection);
  await undoRedo(page, before, after);
});

for (const backward of [false, true]) {
  test(`a ${backward ? "backward" : "forward"} multi-item selection preserves representable flat ordered levels`, async ({
    page,
  }) => {
    await mount(
      page,
      '<ol start="7"><li><p><strong>甲甲</strong></p></li><li data-semlo-editor-list-indent="2"><p>乙乙</p></li><li data-semlo-editor-list-indent="1"><p>丙丙</p></li><li><p><em>丁丁</em></p></li><li data-semlo-editor-list-indent="1"><p>戊戊</p></li></ol><p>尾段</p>',
    );
    expect(await markers(page)).toMatchObject({ 甲甲: "7.", 乙乙: "i.", 丙丙: "a.", 丁丁: "8.", 戊戊: "a." });
    await page.evaluate((backward) => {
      const editor = window.__semloRequireFixture("nestedOrderedHeadingEditor").editor;
      let from = -1;
      let to = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock && node.textContent === "乙乙") from = pos + 2;
        if (node.isTextblock && node.textContent === "丙丙") to = pos + 2;
      });
      if (from < 0 || to < 0) throw new Error("Missing selected blocks");
      editor.view.focus();
      editor.commands.setTextSelection(backward ? { from: to, to: from } : { from, to });
    }, backward);
    const before = await inspect(page);
    await page.keyboard.press("ControlOrMeta+Alt+3");
    const after = await inspect(page);
    expect(after.json).not.toEqual(before.json);
    expect(after.changes - before.changes).toBe(1);
    expect(after.selection).toEqual(before.selection);
    expect(after.blocks.map((block) => block.text)).toEqual(before.blocks.map((block) => block.text));
    expect(after.blocks.filter((block) => !["乙乙", "丙丙"].includes(block.text))).toEqual(
      before.blocks.filter((block) => !["乙乙", "丙丙"].includes(block.text)),
    );
    expect(after.blocks.filter((block) => ["乙乙", "丙丙"].includes(block.text)).map((block) => block.type)).toEqual([
      "heading",
      "heading",
    ]);
    await expect(
      page.locator("#nested-ordered-heading-test .semlo-editor-prose .semlo-editor-heading-number"),
    ).toHaveText(["1.", "2."]);
    expect(await markers(page)).toMatchObject({ 甲甲: "7.", 丁丁: "8.", 戊戊: "a." });
    await undoRedo(page, before, after);
  });
}

test("flat multi-item conversion preserves host command metadata and dispatches only the final document", async ({
  page,
}) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor, Extension, Plugin, PluginKey } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'nested-ordered-heading-test'
      document.body.prepend(host)
      const key = new PluginKey('flat-ordered-host')
      window.flatOrderedHostTrace = []
      window.flatOrderedHostFilter = 0
      window.flatOrderedHostAppend = 0
      window.nestedOrderedHeadingChanges = 0
      const custom = Extension.create({
        name: 'flat-ordered-host', priority: 1,
        addProseMirrorPlugins() {
          return [new Plugin({
            key,
            state: { init: () => ({version: 0}), apply: (tr, value) => tr.getMeta(key) ?? value },
            filterTransaction(tr) {
              if (!tr.docChanged) return true
              window.flatOrderedHostFilter++
              let headings = 0
              tr.doc.descendants(node => { if (node.type.name === 'heading') headings++ })
              return headings !== 1
            },
            appendTransaction(transactions, _oldState, state) {
              if (transactions.some(tr => tr.docChanged) && !transactions.some(tr => tr.getMeta('flat-host-appended'))) {
                window.flatOrderedHostAppend++
                return state.tr.setMeta('flat-host-appended', true)
              }
              return null
            },
          })]
        },
        addCommands() {
          return { setHeading: attrs => ({state, tr, commands}) => {
            const current = key.getState(state)
            const previous = tr.getMeta('flat-host-counter') ?? 0
            window.flatOrderedHostTrace.push({version: current.version, previous})
            tr.setMeta('flat-host-counter', previous + 1)
            tr.setMeta(key, {version: current.version + 1})
            return commands.setNode('heading', attrs)
          } }
        },
      })
      window.nestedOrderedHeadingEditor = createEditor({
        element: host, outline: false, extensions: [custom],
        content: '<ol><li><p>甲甲</p></li><li data-semlo-editor-list-indent="1"><p>乙乙</p></li><li><p>丙丙</p></li><li><p>丁丁</p></li><li data-semlo-editor-list-indent="1"><p>戊戊</p></li><li><p>己己</p></li></ol>',
        onChange: () => { window.nestedOrderedHeadingChanges++ },
      })
      const editor = window.nestedOrderedHeadingEditor.editor
      editor.view.dispatch(editor.state.tr.setMeta(key, {version: 41}))
    `,
  });
  await page.waitForFunction(() => Boolean(window.nestedOrderedHeadingEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("nestedOrderedHeadingEditor").editor;
    let from = -1;
    let to = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.isTextblock && node.textContent === "丙丙") from = pos + 1;
      if (node.isTextblock && node.textContent === "丁丁") to = pos + node.nodeSize - 1;
    });
    if (from < 0 || to < 0) throw new Error("Missing selected items");
    editor.view.focus();
    editor.commands.setTextSelection({ from, to });
    window.flatOrderedHostFilter = 0;
    window.flatOrderedHostAppend = 0;
  });
  const before = await inspect(page);
  await page.keyboard.press("ControlOrMeta+Alt+3");
  const after = await inspect(page);
  expect(after.json).not.toEqual(before.json);
  expect(after.selection).toEqual(before.selection);
  expect(after.changes - before.changes).toBe(1);
  expect(await page.evaluate(() => window.flatOrderedHostTrace)).toEqual([
    { version: 41, previous: 0 },
    { version: 41, previous: 1 },
  ]);
  expect(
    await page.evaluate(() => ({
      filter: window.__semloRequireFixture("flatOrderedHostFilter"),
      append: window.__semloRequireFixture("flatOrderedHostAppend"),
    })),
  ).toEqual({
    filter: 1,
    append: 1,
  });
  expect(await markers(page)).toMatchObject({ 甲甲: "1.", 乙乙: "a.", 戊戊: "b.", 己己: "2." });
  const suffix = after.json.content?.find(
    (node) => node.type === "orderedList" && JSON.stringify(node.content).includes("戊戊"),
  );
  expect(suffix?.attrs).toMatchObject({ start: 2, semloEditorListLevelStarts: { "0": 2 } });
  await undoRedo(page, before, after);
});

for (const [name, html, selected] of [
  [
    "nested custom-start child with its own subtree",
    '<ul><li><p>父项</p><ol start="7"><li><p>甲甲</p><ul><li><p>子树</p></li></ul></li><li><p>乙乙</p></li></ol></li></ul>',
    "乙乙",
  ],
] as const) {
  test(`unsupported ${name} is not partially dispatched`, async ({ page }) => {
    await mount(page, html);
    await select(page, selected);
    const before = await inspect(page);
    await page.keyboard.press("ControlOrMeta+Alt+3");
    const after = await inspect(page);
    expect(after.json).toEqual(before.json);
    expect(after.selection).toEqual(before.selection);
    expect(after.changes).toBe(before.changes);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("nestedOrderedHeadingEditor").editor.commands.undo()),
    ).toBe(false);
  });
}
