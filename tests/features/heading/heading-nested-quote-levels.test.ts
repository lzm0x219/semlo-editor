import { expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import type { EditorContent, EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    nestedQuoteLevelsEditor?: EditorController;
    nestedQuoteLevelsChanges?: number;
    nestedQuoteLevelsHost?: { calls: number; state: number | null; filters: number; appends: number };
  }
}

type Mode = "normal" | "narrow-paragraph" | "host-paragraph" | "unsafe-paragraph";
const text = (value: string, bold = false): JSONContent => ({
  type: "text",
  text: value,
  marks: [{ type: "link", attrs: { href: "https://example.com/" } }, ...(bold ? [{ type: "bold" }] : [])],
});
const paragraph = (value: string, bold = false): JSONContent => ({ type: "paragraph", content: [text(value, bold)] });
const heading = (value: string, level: number, numbered = false, bold = false): JSONContent => ({
  type: "heading",
  attrs: { level, semloEditorHeadingNumbering: numbered ? "mixed" : null },
  content: [text(value, bold)],
});
const item = (...content: JSONContent[]): JSONContent => ({ type: "listItem", content });
const list = (...content: JSONContent[]): JSONContent => ({ type: "bulletList", content });
const quote = (...content: JSONContent[]): JSONContent => ({
  type: "blockquote",
  attrs: { probe: "引用属性" },
  content,
});

function fixture(scope: "root" | "deep", selected: JSONContent = paragraph("选中文字", true)): JSONContent {
  const quoted = quote(selected, paragraph("引用兄弟"));
  const content =
    scope === "root"
      ? quoted
      : list(
          item(
            paragraph("祖父"),
            list(
              item(paragraph("父项"), quoted, paragraph("父后段"), list(item(paragraph("子项")))),
              item(paragraph("同级")),
            ),
          ),
        );
  return { type: "doc", content: [content, paragraph("尾段")] };
}

async function mount(page: Page, content: EditorContent, mode: Mode = "normal") {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor, Extension, Plugin, PluginKey } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'nested-quote-levels-test'
      document.body.append(host)
      const mode = ${JSON.stringify(mode)}
      const attrs = Extension.create({ name: 'quote-levels-attrs', addGlobalAttributes() {
        return [{ types: ['blockquote'], attributes: { probe: {
          default: null, parseHTML: element => element.getAttribute('data-probe'),
          renderHTML: attrs => attrs.probe ? { 'data-probe': attrs.probe } : {},
        } } }]
      } })
      const extensions = [attrs]
      if (mode === 'narrow-paragraph') {
        const temporary = createEditor({ element: host, outline: false })
        const standard = temporary.editor.extensionManager.extensions.find(extension => extension.name === 'blockquote')
        if (!standard) throw new Error('Missing blockquote extension')
        const narrow = standard.extend({ priority: 1, content: 'heading+' })
        temporary.destroy()
        extensions.push(narrow)
      }
      if (mode === 'host-paragraph' || mode === 'unsafe-paragraph') {
        const key = new PluginKey('nested-quote-levels-host')
        window.nestedQuoteLevelsHost = { calls: 0, state: null, filters: 0, appends: 0 }
        extensions.push(Extension.create({ name: 'nested-quote-levels-host', priority: 1,
          addCommands() { return { setParagraph: () => ({state, tr, commands}) => {
            window.nestedQuoteLevelsHost.calls++
            window.nestedQuoteLevelsHost.state = key.getState(state)?.version ?? null
            tr.setMeta(key, { version: 42 })
            if (mode === 'unsafe-paragraph') { tr.insertText('误改', 2); return true }
            return commands.setNode('paragraph')
          } } },
          addProseMirrorPlugins() { return [new Plugin({ key,
            state: { init: () => ({version: 41}), apply: (tr, previous) => tr.getMeta(key) ?? previous },
            filterTransaction(tr) { if (tr.docChanged) window.nestedQuoteLevelsHost.filters++; return true },
            appendTransaction(transactions, _old, state) {
              if (transactions.some(tr => tr.docChanged) && !transactions.some(tr => tr.getMeta('quote-levels-host-appended'))) {
                window.nestedQuoteLevelsHost.appends++
                return state.tr.setMeta('quote-levels-host-appended', true)
              }
              return null
            },
          })] },
        }))
      }
      window.nestedQuoteLevelsChanges = 0
      window.nestedQuoteLevelsEditor = createEditor({
        element: host, outline: false, content: ${JSON.stringify(content)}, extensions,
        onChange: () => { window.nestedQuoteLevelsChanges++ },
      })
      if (window.nestedQuoteLevelsHost) {
        window.nestedQuoteLevelsHost.filters = 0
        window.nestedQuoteLevelsHost.appends = 0
      }
    `,
  });
  await page.waitForFunction(() => Boolean(window.nestedQuoteLevelsEditor));
}

async function select(page: Page, reverse = false, collapsed = false) {
  await page.evaluate(
    ({ reverse, collapsed }) => {
      const editor = window.__semloRequireFixture("nestedQuoteLevelsEditor").editor;
      let start = -1;
      let end = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock && node.textContent === "选中文字") {
          start = pos + 1;
          end = pos + node.nodeSize - 1;
        }
      });
      if (start < 0 || end < 0) throw new Error("Selected block missing");
      editor.view.focus();
      editor.commands.setTextSelection(collapsed ? start : { from: reverse ? end : start, to: reverse ? start : end });
    },
    { reverse, collapsed },
  );
}

async function inspect(page: Page) {
  return page.evaluate(() => {
    const editor = window.__semloRequireFixture("nestedQuoteLevelsEditor").editor;
    const { $anchor, $head } = editor.state.selection;
    const dom = window.getSelection();
    const nativeAnchor = dom?.anchorNode;
    const element = nativeAnchor instanceof Element ? nativeAnchor : nativeAnchor?.parentElement;
    const block = element?.closest("p,h1,h2,h3,h4,h5,h6");
    const blockCopy = block?.cloneNode(true) as HTMLElement | undefined;
    blockCopy
      ?.querySelectorAll('[contenteditable="false"], .semlo-editor-heading-number')
      .forEach((node) => node.remove());
    let textOffset: number | null = null;
    let caretHeight = 0;
    if (dom?.rangeCount && nativeAnchor && block && block.contains(nativeAnchor)) {
      const range = dom.getRangeAt(0);
      caretHeight = range.getBoundingClientRect().height;
      const prefix = document.createRange();
      prefix.selectNodeContents(block);
      prefix.setEnd(nativeAnchor, dom.anchorOffset);
      const fragment = prefix.cloneContents();
      fragment
        .querySelectorAll('[contenteditable="false"], .semlo-editor-heading-number')
        .forEach((node) => node.remove());
      textOffset = fragment.textContent?.length ?? null;
    }
    return {
      raw: editor.getJSON(),
      changes: window.nestedQuoteLevelsChanges ?? 0,
      selection: {
        anchor: $anchor.parent.textContent,
        anchorOffset: $anchor.parentOffset,
        head: $head.parent.textContent,
        headOffset: $head.parentOffset,
      },
      dom: {
        focused: document.activeElement === editor.view.dom,
        collapsed: dom?.isCollapsed ?? false,
        blockTag: block?.tagName ?? null,
        blockText: blockCopy?.textContent ?? null,
        textOffset,
        caretHeight,
      },
    };
  });
}

function target(json: JSONContent): JSONContent {
  const matches: JSONContent[] = [];
  const walk = (node: JSONContent) => {
    if (
      ["paragraph", "heading"].includes(node.type ?? "") &&
      node.content?.map((child) => child.text).join("") === "选中文字"
    )
      matches.push(node);
    node.content?.forEach(walk);
  };
  walk(json);
  if (matches.length !== 1) throw new Error("Expected one target");
  return matches[0];
}

function assertOnlySelectedChange(before: JSONContent, after: JSONContent) {
  const normalized = structuredClone(after);
  Object.assign(target(normalized), target(before));
  expect(normalized).toEqual(before);
}

function expectCaret(actual: Awaited<ReturnType<typeof inspect>>, tag: string) {
  expect(actual.selection).toEqual({ anchor: "选中文字", anchorOffset: 0, head: "选中文字", headOffset: 0 });
  expect(actual.dom).toMatchObject({
    focused: true,
    collapsed: true,
    blockTag: tag,
    blockText: "选中文字",
    textOffset: 0,
  });
  expect(actual.dom.caretHeight).toBeGreaterThan(0);
}

for (const scope of ["root", "deep"] as const) {
  test(`${scope} quote changes H1–H6 in sequence and toggles H6 to paragraph`, async ({ page }) => {
    await mount(page, fixture(scope));
    await page.locator("#nested-quote-levels-test").getByText("选中文字", { exact: true }).click();
    await page.keyboard.press("Home");
    let previous = await inspect(page);
    expect(previous.dom).toMatchObject({
      focused: true,
      collapsed: true,
      blockTag: "P",
      blockText: "选中文字",
      textOffset: 0,
    });
    for (let level = 1; level <= 6; level++) {
      await page.keyboard.press(`ControlOrMeta+Alt+${level}`);
      const after = await inspect(page);
      expect(after.changes - previous.changes).toBe(1);
      expect(target(after.raw)).toMatchObject({ type: "heading", attrs: { level, semloEditorHeadingNumbering: null } });
      expect(target(after.raw).content).toEqual(
        target(previous.raw).content?.map((node) => ({
          ...node,
          marks: node.marks?.filter((mark) => mark.type !== "bold"),
        })),
      );
      assertOnlySelectedChange(previous.raw, after.raw);
      expectCaret(after, `H${level}`);
      await expect(
        page.locator('#nested-quote-levels-test blockquote[data-probe="引用属性"] .semlo-editor-heading-number'),
      ).toHaveCount(0);
      previous = after;
    }
    await page.keyboard.press("ControlOrMeta+Alt+6");
    const after = await inspect(page);
    expect(after.changes - previous.changes).toBe(1);
    expect(target(after.raw).type).toBe("paragraph");
    assertOnlySelectedChange(previous.raw, after.raw);
    expectCaret(after, "P");
    await page.keyboard.press("ControlOrMeta+z");
    const undone = await inspect(page);
    expect(undone.raw).toEqual(previous.raw);
    expectCaret(undone, "H6");
    expect(
      await page.evaluate(() => window.__semloRequireFixture("nestedQuoteLevelsEditor").editor.commands.redo()),
    ).toBe(true);
    expect((await inspect(page)).raw).toEqual(after.raw);
  });
}

for (const level of [1, 2, 3, 4, 5, 6]) {
  for (const reverse of [false, true]) {
    test(`deep quote to H${level} retains ${reverse ? "backward" : "forward"} selection and one-step history`, async ({
      page,
    }) => {
      await mount(page, fixture("deep"));
      await select(page, reverse);
      const before = await inspect(page);
      await page.keyboard.press(`ControlOrMeta+Alt+${level}`);
      const after = await inspect(page);
      expect(target(after.raw)).toMatchObject({ type: "heading", attrs: { level, semloEditorHeadingNumbering: null } });
      assertOnlySelectedChange(before.raw, after.raw);
      expect(after.selection).toEqual(before.selection);
      expect(after.changes - before.changes).toBe(1);
      expect(
        await page.evaluate(() => window.__semloRequireFixture("nestedQuoteLevelsEditor").editor.commands.undo()),
      ).toBe(true);
      const undone = await inspect(page);
      expect(undone.raw).toEqual(before.raw);
      expect(undone.selection).toEqual(before.selection);
      expect(
        await page.evaluate(() => window.__semloRequireFixture("nestedQuoteLevelsEditor").editor.commands.redo()),
      ).toBe(true);
      expect((await inspect(page)).raw).toEqual(after.raw);
    });
  }
}

test("an existing H6 becomes H1 then paragraph without losing links or surrounding structure", async ({ page }) => {
  await mount(page, fixture("deep", heading("选中文字", 6, false, true)));
  await select(page, true);
  const before = await inspect(page);
  await page.keyboard.press("ControlOrMeta+Alt+1");
  const first = await inspect(page);
  expect(target(first.raw)).toMatchObject({ type: "heading", attrs: { level: 1, semloEditorHeadingNumbering: null } });
  expect(target(first.raw).content).toEqual(
    target(before.raw).content?.map((node) => ({ ...node, marks: node.marks?.filter((mark) => mark.type !== "bold") })),
  );
  assertOnlySelectedChange(before.raw, first.raw);
  expect(first.selection).toEqual(before.selection);
  await page.keyboard.press("ControlOrMeta+Alt+1");
  const second = await inspect(page);
  expect(target(second.raw).type).toBe("paragraph");
  assertOnlySelectedChange(first.raw, second.raw);
  expect(second.selection).toEqual(first.selection);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("nestedQuoteLevelsEditor").editor.commands.undo()),
  ).toBe(true);
  expect((await inspect(page)).raw).toEqual(first.raw);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("nestedQuoteLevelsEditor").editor.commands.undo()),
  ).toBe(true);
  expect((await inspect(page)).raw).toEqual(before.raw);
});

test("toggling a formatted H6 to paragraph clears bold while retaining the link", async ({ page }) => {
  await mount(page, fixture("deep", heading("选中文字", 6, false, true)));
  await select(page, true);
  const before = await inspect(page);
  await page.keyboard.press("ControlOrMeta+Alt+6");
  const after = await inspect(page);
  expect(target(after.raw).type).toBe("paragraph");
  expect(target(after.raw).content).toEqual(
    target(before.raw).content?.map((node) => ({ ...node, marks: node.marks?.filter((mark) => mark.type !== "bold") })),
  );
  assertOnlySelectedChange(before.raw, after.raw);
  expect(after.selection).toEqual(before.selection);
  expect(after.changes - before.changes).toBe(1);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("nestedQuoteLevelsEditor").editor.commands.undo()),
  ).toBe(true);
  expect((await inspect(page)).raw).toEqual(before.raw);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("nestedQuoteLevelsEditor").editor.commands.redo()),
  ).toBe(true);
  expect((await inspect(page)).raw).toEqual(after.raw);
});

for (const [name, mode, selected, key] of [
  ["numbered heading changed level", "normal", heading("选中文字", 3, true), 4],
  ["numbered heading toggled", "normal", heading("选中文字", 3, true), 3],
  ["paragraph disallowed by quote schema", "narrow-paragraph", heading("选中文字", 6), 6],
  ["unsafe host paragraph command", "unsafe-paragraph", heading("选中文字", 6), 6],
] as Array<[string, Mode, JSONContent, number]>) {
  test(`${name} safely leaves the document and selection untouched`, async ({ page }) => {
    const content = fixture("deep", selected);
    if (mode === "narrow-paragraph") {
      const nested = content.content![0].content![0].content![1].content![0].content![1];
      nested.content = [selected];
    }
    await mount(page, content, mode);
    if (mode === "narrow-paragraph")
      expect(
        await page.evaluate(
          () => window.__semloRequireFixture("nestedQuoteLevelsEditor").editor.schema.nodes.blockquote.spec.content,
        ),
      ).toBe("heading+");
    await select(page, true);
    const before = await inspect(page);
    await page.keyboard.press(`ControlOrMeta+Alt+${key}`);
    const after = await inspect(page);
    expect(after.raw).toEqual(before.raw);
    expect(after.selection).toEqual(before.selection);
    expect(after.changes).toBe(before.changes);
    expect(
      await page.evaluate(() => window.__semloRequireFixture("nestedQuoteLevelsEditor").editor.commands.undo()),
    ).toBe(false);
    if (mode === "unsafe-paragraph")
      expect(await page.evaluate(() => window.nestedQuoteLevelsHost)).toMatchObject({
        calls: 1,
        state: 41,
        filters: 0,
        appends: 0,
      });
  });
}

test("a multi-heading selection crossing out of the quote does not toggle partially", async ({ page }) => {
  const content = fixture("deep", heading("选中文字", 3));
  const parent = content.content![0].content![0].content![1].content![0];
  parent.content![1].content = [heading("选中文字", 3)];
  parent.content![2] = heading("外标题", 3);
  await mount(page, content);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("nestedQuoteLevelsEditor").editor;
    let from = -1;
    let to = -1;
    editor.state.doc.descendants((node, position) => {
      if (node.isTextblock && node.textContent === "选中文字") from = position + 1;
      if (node.isTextblock && node.textContent === "外标题") to = position + node.nodeSize - 1;
    });
    if (from < 0 || to < 0) throw new Error("Missing heading selection");
    editor.view.focus();
    editor.commands.setTextSelection({ from, to });
  });
  const before = await inspect(page);
  await page.keyboard.press("ControlOrMeta+Alt+3");
  const after = await inspect(page);
  expect(after.raw).toEqual(before.raw);
  expect(after.selection).toEqual(before.selection);
  expect(after.changes).toBe(before.changes);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("nestedQuoteLevelsEditor").editor.commands.undo()),
  ).toBe(false);
});

test("host paragraph command sees committed plugin state and only final filter/append hooks", async ({ page }) => {
  await mount(page, fixture("deep", heading("选中文字", 6)), "host-paragraph");
  await select(page, true);
  const before = await inspect(page);
  await page.keyboard.press("ControlOrMeta+Alt+6");
  const after = await inspect(page);
  expect(target(after.raw).type).toBe("paragraph");
  assertOnlySelectedChange(before.raw, after.raw);
  expect(after.selection).toEqual(before.selection);
  expect(await page.evaluate(() => window.nestedQuoteLevelsHost)).toMatchObject({
    calls: 1,
    state: 41,
    filters: 1,
    appends: 1,
  });
  expect(
    await page.evaluate(() => window.__semloRequireFixture("nestedQuoteLevelsEditor").editor.commands.undo()),
  ).toBe(true);
  expect((await inspect(page)).raw).toEqual(before.raw);
});
