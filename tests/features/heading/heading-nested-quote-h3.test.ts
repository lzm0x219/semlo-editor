import { expect, test, type Page } from "@rstest/playwright";

import type { EditorContent, EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    nestedQuoteEditor?: EditorController;
    nestedQuoteChanges?: number;
    nestedQuoteHost?: { calls: number; state: number | null; filters: number; appends: number };
  }
}

type TestMode = "normal" | "narrow-schema" | "object-attribute" | "host" | "unsafe-host";
const paragraph = (text: string, marks: Array<Record<string, unknown>> = []) => ({
  type: "paragraph",
  content: [{ type: "text", text, ...(marks.length ? { marks } : {}) }],
});
const item = (...content: unknown[]) => ({ type: "listItem", content });
const bullet = (...content: unknown[]) => ({ type: "bulletList", content });
const quote = (...content: unknown[]) => ({ type: "blockquote", attrs: { probe: "保持引用属性" }, content });

function fixture(
  options: {
    outer?: boolean;
    numbered?: boolean;
    object?: boolean;
    insideCallout?: boolean;
    invalidIndent?: boolean;
  } = {},
) {
  const selected = paragraph("选中文字", [{ type: "bold" }, { type: "link", attrs: { href: "https://example.com/" } }]);
  const body = options.insideCallout ? { type: "callout", attrs: { tone: "pink" }, content: [selected] } : selected;
  const quoteContent = [
    ...(options.numbered
      ? [
          {
            type: "heading",
            attrs: { level: 3, semloEditorHeadingNumbering: "mixed" },
            content: [{ type: "text", text: "已有编号" }],
          },
        ]
      : []),
    body,
    paragraph("引用兄弟", [{ type: "italic" }]),
  ];
  const quotation = quote(...quoteContent);
  if (options.object) Object.assign(quotation.attrs, { payload: { key: "value" } });
  const parent = item(paragraph("父项"), quotation, paragraph("父后段"), bullet(item(paragraph("子项"))));
  if (options.invalidIndent) Object.assign(parent, { attrs: { semloEditorListIndent: -1 } });
  const list = bullet(item(paragraph("祖父", [{ type: "bold" }]), bullet(parent, item(paragraph("同级")))));
  return { type: "doc", content: [options.outer ? quote(list) : list, paragraph("尾段")] } as EditorContent;
}

async function mount(page: Page, content: EditorContent, mode: TestMode = "normal") {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor, Extension, Plugin, PluginKey } from '/dist/index.js'
      document.body.replaceChildren()
      const mount = document.createElement('div')
      mount.id = 'nested-quote-h3-test'
      document.body.append(mount)
      const mode = ${JSON.stringify(mode)}
      const content = ${JSON.stringify(content)}
      const attrs = Extension.create({ name: 'quote-test-attrs', addGlobalAttributes() {
        return [{ types: ['blockquote'], attributes: {
          probe: { default: null, parseHTML: element => element.getAttribute('data-probe'),
            renderHTML: attrs => attrs.probe ? { 'data-probe': attrs.probe } : {} },
          payload: { default: null },
        } }]
      } })
      const extensions = [attrs]
      if (mode === 'narrow-schema') {
        const temporary = createEditor({ element: mount, outline: false })
        const standard = temporary.editor.extensionManager.extensions.find(extension => extension.name === 'blockquote')
        if (!standard) throw new Error('Missing blockquote extension')
        const narrow = standard.extend({ priority: 1, content: 'paragraph+' })
        temporary.destroy()
        extensions.push(narrow)
      }
      if (mode === 'host' || mode === 'unsafe-host') {
        const key = new PluginKey('nested-quote-host')
        window.nestedQuoteHost = { calls: 0, state: null, filters: 0, appends: 0 }
        extensions.push(Extension.create({ name: 'nested-quote-host', priority: 1,
          addCommands() { return { setHeading: attrs => ({state, tr, commands}) => {
            window.nestedQuoteHost.calls++
            window.nestedQuoteHost.state = key.getState(state)?.version ?? null
            tr.setMeta(key, { version: 42 })
            if (mode === 'unsafe-host') { tr.insertText('误改', 2); return true }
            return commands.setNode('heading', attrs)
          } } },
          addProseMirrorPlugins() { return [new Plugin({ key,
            state: { init: () => ({version: 41}), apply: (tr, previous) => tr.getMeta(key) ?? previous },
            filterTransaction(tr) { if (tr.docChanged) window.nestedQuoteHost.filters++; return true },
            appendTransaction(transactions, _old, state) {
              if (transactions.some(tr => tr.docChanged) && !transactions.some(tr => tr.getMeta('quote-host-appended'))) {
                window.nestedQuoteHost.appends++
                return state.tr.setMeta('quote-host-appended', true)
              }
              return null
            },
          })] },
        }))
      }
      window.nestedQuoteChanges = 0
      window.nestedQuoteEditor = createEditor({
        element: mount, outline: false, content, extensions,
        onChange: () => { window.nestedQuoteChanges++ },
      })
      if (window.nestedQuoteHost) {
        window.nestedQuoteHost.filters = 0
        window.nestedQuoteHost.appends = 0
      }
    `,
  });
  await page.waitForFunction(() => Boolean(window.nestedQuoteEditor));
}

async function select(page: Page, fromText: string, toText = fromText, reverse = false, collapsed = false) {
  await page.evaluate(
    ({ fromText, toText, reverse, collapsed }) => {
      const editor = window.__semloRequireFixture("nestedQuoteEditor").editor;
      let start = -1;
      let end = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock && node.textContent === fromText) start = pos + 1;
        if (node.isTextblock && node.textContent === toText) end = pos + node.nodeSize - 1;
      });
      if (start < 0 || end < 0) throw new Error("Selection text is missing");
      editor.view.focus();
      editor.commands.setTextSelection(
        collapsed ? start + 1 : { from: reverse ? end : start, to: reverse ? start : end },
      );
    },
    { fromText, toText, reverse, collapsed },
  );
}

async function inspect(page: Page) {
  return page.evaluate(() => {
    const controller = window.__semloRequireFixture("nestedQuoteEditor");
    const editor = controller.editor;
    const { $anchor, $head } = editor.state.selection;
    return {
      raw: editor.getJSON(),
      snapshot: controller.getSnapshot(),
      changes: window.nestedQuoteChanges ?? 0,
      selection: {
        anchor: $anchor.parent.textContent,
        anchorOffset: $anchor.parentOffset,
        head: $head.parent.textContent,
        headOffset: $head.parentOffset,
      },
    };
  });
}

function target(json: EditorContent) {
  if (typeof json === "string") throw new Error("Expected JSON");
  const result: Array<NonNullable<typeof json.content>[number]> = [];
  const walk = (node: NonNullable<typeof json.content>[number]) => {
    if (
      ["paragraph", "heading"].includes(node.type ?? "") &&
      node.content?.map((child) => child.text).join("") === "选中文字"
    )
      result.push(node);
    node.content?.forEach(walk);
  };
  walk(json);
  if (result.length !== 1) throw new Error("Expected one target");
  return result[0];
}

for (const selection of ["forward", "backward", "caret"] as const) {
  test(`a nested quote's selected paragraph becomes H3 in place (${selection})`, async ({ page }) => {
    await mount(page, fixture());
    await select(page, "选中文字", "选中文字", selection === "backward", selection === "caret");
    const before = await inspect(page);
    await page.keyboard.press("ControlOrMeta+Alt+3");
    const after = await inspect(page);
    expect(after.changes - before.changes).toBe(1);
    expect(after.selection).toEqual(before.selection);
    const beforeTarget = target(before.raw);
    const afterTarget = target(after.raw);
    expect(afterTarget).toMatchObject({ type: "heading", attrs: { level: 3, semloEditorHeadingNumbering: null } });
    expect(afterTarget.content).toEqual(
      beforeTarget.content?.map((node) => ({ ...node, marks: node.marks?.filter((mark) => mark.type !== "bold") })),
    );
    const normalized = structuredClone(after.raw);
    Object.assign(target(normalized), beforeTarget);
    expect(normalized).toEqual(before.raw);
    await expect(page.locator('#nested-quote-h3-test blockquote[data-probe="保持引用属性"] > h3')).toHaveCount(1);
    await expect(page.locator("#nested-quote-h3-test blockquote .semlo-editor-heading-number")).toHaveCount(0);
    expect(await page.evaluate(() => window.__semloRequireFixture("nestedQuoteEditor").editor.commands.undo())).toBe(
      true,
    );
    const undone = await inspect(page);
    expect(undone.raw).toEqual(before.raw);
    expect(undone.selection).toEqual(before.selection);
    expect(await page.evaluate(() => window.__semloRequireFixture("nestedQuoteEditor").editor.commands.redo())).toBe(
      true,
    );
    const redone = await inspect(page);
    expect(redone.raw).toEqual(after.raw);
    expect(redone.selection).toEqual(after.selection);
    for (const content of [after.snapshot.json, after.snapshot.html]) {
      await page.evaluate((value) => window.__semloRequireFixture("nestedQuoteEditor").setContent(value), content);
      expect((await inspect(page)).snapshot.json).toEqual(after.snapshot.json);
    }
  });
}

test("an ordinary root quote converts its first paragraph to an unnumbered H3", async ({ page }) => {
  await mount(page, {
    type: "doc",
    content: [quote(paragraph("选中文字"), paragraph("引用兄弟")), paragraph("尾段")],
  } as EditorContent);
  await select(page, "选中文字");
  const before = await inspect(page);
  await page.keyboard.press("ControlOrMeta+Alt+3");
  const after = await inspect(page);
  expect(target(after.raw)).toMatchObject({ type: "heading", attrs: { level: 3, semloEditorHeadingNumbering: null } });
  await expect(page.locator("#nested-quote-h3-test .semlo-editor-prose > blockquote > h3")).toHaveText("选中文字");
  await expect(
    page.locator("#nested-quote-h3-test .semlo-editor-prose > blockquote .semlo-editor-heading-number"),
  ).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("nestedQuoteEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await inspect(page)).raw).toEqual(before.raw);
});

for (const [name, content, mode, last] of [
  ["outside container", fixture({ outer: true }), "normal", "选中文字"],
  ["numbered sibling heading", fixture({ numbered: true }), "normal", "选中文字"],
  ["object attribute", fixture({ object: true }), "object-attribute", "选中文字"],
  ["invalid list indentation", fixture({ invalidIndent: true }), "normal", "选中文字"],
  ["nested callout", fixture({ insideCallout: true }), "normal", "选中文字"],
  ["cross-container range", fixture(), "normal", "父后段"],
  ["quote schema disallows heading", fixture(), "narrow-schema", "选中文字"],
  ["unsafe host command", fixture(), "unsafe-host", "选中文字"],
] as Array<[string, EditorContent, TestMode, string]>) {
  test(`${name} is left unchanged without a document dispatch`, async ({ page }) => {
    await mount(page, content, mode);
    if (mode === "narrow-schema")
      expect(
        await page.evaluate(
          () => window.__semloRequireFixture("nestedQuoteEditor").editor.schema.nodes.blockquote.spec.content,
        ),
      ).toBe("paragraph+");
    await select(page, "选中文字", last);
    const before = await inspect(page);
    await page.keyboard.press("ControlOrMeta+Alt+3");
    const after = await inspect(page);
    expect(after.raw).toEqual(before.raw);
    expect(after.selection).toEqual(before.selection);
    expect(after.changes).toBe(before.changes);
    expect(await page.evaluate(() => window.__semloRequireFixture("nestedQuoteEditor").editor.commands.undo())).toBe(
      false,
    );
    if (mode === "unsafe-host")
      expect(await page.evaluate(() => window.nestedQuoteHost)).toMatchObject({
        calls: 1,
        state: 41,
        filters: 0,
        appends: 0,
      });
  });
}

test("a host heading command sees committed state and filter/append hooks only observe the final transaction", async ({
  page,
}) => {
  await mount(page, fixture(), "host");
  await select(page, "选中文字");
  const before = await inspect(page);
  await page.keyboard.press("ControlOrMeta+Alt+3");
  const after = await inspect(page);
  expect(target(after.raw)).toMatchObject({ type: "heading", attrs: { level: 3, semloEditorHeadingNumbering: null } });
  expect(after.changes - before.changes).toBe(1);
  expect(await page.evaluate(() => window.nestedQuoteHost)).toMatchObject({
    calls: 1,
    state: 41,
    filters: 1,
    appends: 1,
  });
  expect(await page.evaluate(() => window.__semloRequireFixture("nestedQuoteEditor").editor.commands.undo())).toBe(
    true,
  );
  expect((await inspect(page)).raw).toEqual(before.raw);
});
