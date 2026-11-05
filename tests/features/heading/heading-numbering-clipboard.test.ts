import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    numberedClipboardEditor?: EditorController;
    numberedClipboardSecond?: EditorController;
    numberedClipboardCalls?: { serial: number; text: number; transform: number; event: number };
    numberedClipboardInit?: { html: string };
    numberedClipboardLifecycle?: string[];
  }
}

type ClipboardMode =
  | "default"
  | "host-later"
  | "host-earlier"
  | "host-transform"
  | "host-event"
  | "host-event-later"
  | "host-modified"
  | "host-text-later"
  | "host-text-earlier"
  | "host-equal-slice"
  | "host-serializer-only"
  | "host-init";

async function mount(page: Page, content: string, mode: ClipboardMode = "default") {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor, Extension, Plugin, DOMSerializer, Fragment, Slice } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      document.body.append(host)
      window.numberedClipboardCalls = { serial: 0, text: 0, transform: 0, event: 0 }
      const mode = ${JSON.stringify(mode)}
      const hostExtension = Extension.create({
        name: 'testClipboardHost',
        priority: mode === 'host-earlier' || mode === 'host-event' || mode === 'host-text-earlier' ? 200 : 1,
        addProseMirrorPlugins() {
          const editor = this.editor
          const base = DOMSerializer.fromSchema(editor.schema)
          const serializer = new DOMSerializer({
            ...base.nodes,
            heading: node => ['h' + node.attrs.level, { 'data-host-node': 'yes' }, 0],
            paragraph: () => ['p', { 'data-host-paragraph': 'yes' }, 0],
          }, { ...base.marks, italic: () => ['i', { 'data-host-mark': 'yes' }, 0] })
          const serializeHostFragment = serializer.serializeFragment.bind(serializer)
          serializer.serializeFragment = (fragment, options, target) => {
            window.numberedClipboardCalls.serial++
            if (target && (mode === 'host-serializer-only' || mode === 'host-init'))
              return serializeHostFragment(fragment, options, target)
            const result = DOMSerializer.fromSchema(editor.schema).serializeFragment(fragment, options, target)
            if (mode === 'host-modified') result.querySelector('h3')?.append('由宿主添加')
            const sentinel = (options?.document ?? document).createElement('span')
            sentinel.dataset.hostClipboard = 'preserved'
            sentinel.textContent = 'host-extra'
            result.appendChild(sentinel)
            return result
          }
          return [new Plugin({ props: {
            ...(mode === 'host-event' || mode === 'host-event-later' ? { handleDOMEvents: { copy(view, event) {
              window.numberedClipboardCalls.event++
              if (mode === 'host-event-later') {
                const firstSize = view.state.doc.firstChild.nodeSize
                const other = view.state.doc.slice(firstSize + 1, firstSize + 3, true)
                const result = view.serializeForClipboard(other)
                event.clipboardData.setData('text/plain', result.text)
                event.clipboardData.setData('text/html', result.dom.innerHTML)
              } else {
                event.clipboardData.setData('text/plain', 'host-event')
                event.clipboardData.setData('text/html', '<p data-host-event>host-event</p>')
              }
              event.preventDefault()
              return true
            } } } : {}),
            ...(mode === 'host-later' || mode === 'host-earlier' || mode === 'host-modified' || mode === 'host-serializer-only' || mode === 'host-init' ? {
              clipboardSerializer: serializer,
              clipboardTextSerializer(slice) {
                window.numberedClipboardCalls.text++
                return 'host:' + slice.content.textBetween(0, slice.content.size, '\\n\\n')
              },
            } : mode === 'host-text-earlier' || mode === 'host-text-later' ? {
              clipboardTextSerializer(slice) {
                window.numberedClipboardCalls.text++
                return 'host:' + slice.content.textBetween(0, slice.content.size, '\\n\\n')
              },
            } : {}),
            ...(mode === 'host-text-earlier' || mode === 'host-text-later' || mode === 'host-serializer-only' || mode === 'host-init' ? {} : { transformCopied(slice, view) {
              window.numberedClipboardCalls.transform++
              if (mode === 'host-equal-slice') {
                const firstSize = view.state.doc.firstChild.nodeSize
                return view.state.doc.slice(firstSize + 1, firstSize + 3, true)
              }
              if (mode !== 'host-transform') return slice
              const convert = node => {
                if (node.isText) return editor.schema.text(node.text.toUpperCase(), node.marks)
                if (!node.childCount) return node
                const children = []
                node.forEach(child => children.push(convert(child)))
                return node.copy(Fragment.fromArray(children))
              }
              const children = []
              slice.content.forEach(child => children.push(convert(child)))
              return new Slice(Fragment.fromArray(children), slice.openStart, slice.openEnd)
            } }),
          } })]
        },
      })
      const hostInit = Extension.create({
        name: 'testClipboardHostInit', priority: 200,
        addProseMirrorPlugins() { return [new Plugin({ view(view) {
          const exposed = view.someProp('clipboardSerializer')
          const dom = exposed.serializeNode(view.state.doc.firstChild, { document })
          window.numberedClipboardInit = { html: dom.outerHTML }
          return {}
        } })] },
      })
      window.numberedClipboardEditor = createEditor({
        element: host, outline: false, content: ${JSON.stringify(content)},
        extensions: mode === 'default' ? [] : mode === 'host-init' ? [hostExtension, hostInit] : [hostExtension],
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.numberedClipboardEditor));
}

async function select(
  page: Page,
  startText: string,
  endText: string,
  startOffset = 0,
  endOffset?: number,
  reverse = false,
) {
  await page.evaluate(
    ({ startText, endText, startOffset, endOffset, reverse }) => {
      const editor = window.__semloRequireFixture("numberedClipboardEditor").editor;
      const blocks: Array<{ text: string; pos: number; size: number }> = [];
      editor.state.doc.descendants((node, pos) => {
        if (node.isTextblock) blocks.push({ text: node.textContent, pos, size: node.content.size });
      });
      const start = blocks.find((block) => block.text === startText);
      const end = blocks.find((block) => block.text === endText);
      if (!start || !end) throw new Error("Missing clipboard selection block");
      const from = start.pos + 1 + startOffset;
      const to = end.pos + 1 + (endOffset ?? end.size);
      editor.view.focus();
      editor.commands.setTextSelection({ from: reverse ? to : from, to: reverse ? from : to });
    },
    { startText, endText, startOffset, endOffset, reverse },
  );
}

async function copy(page: Page, type: "copy" | "cut" = "copy") {
  return page.evaluate((eventType) => {
    const transfer = new DataTransfer();
    const event = new ClipboardEvent(eventType, { bubbles: true, cancelable: true, clipboardData: transfer });
    window.__semloRequireFixture("numberedClipboardEditor").editor.view.dom.dispatchEvent(event);
    return {
      html: transfer.getData("text/html"),
      text: transfer.getData("text/plain"),
      prevented: event.defaultPrevented,
    };
  }, type);
}

async function inspectHTML(page: Page, html: string) {
  return page.evaluate((value) => {
    const template = document.createElement("template");
    template.innerHTML = value;
    return {
      headings: Array.from(template.content.querySelectorAll("h1,h2,h3,h4,h5,h6"), (heading) => ({
        type: heading.tagName,
        text: heading.textContent,
        marker: heading.querySelector(":scope > [data-semlo-editor-heading-marker]")?.textContent ?? null,
        style: heading.getAttribute("data-semlo-editor-heading-numbering"),
      })),
      paragraphs: Array.from(template.content.querySelectorAll("p"), (paragraph) => paragraph.textContent),
      host: template.content.querySelector("[data-host-clipboard]")?.getAttribute("data-host-clipboard"),
    };
  }, html);
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("partial heading copy emits inline HTML without the number", async ({ page }) => {
  await mount(
    page,
    '<h3 data-semlo-editor-heading-numbering="mixed">上一项</h3><h3 data-semlo-editor-heading-numbering="mixed"><em>当前标题</em></h3>',
  );
  await select(page, "当前标题", "当前标题", 1, 3);
  const copied = await copy(page);
  expect(copied.prevented).toBe(true);
  expect(copied.text).toBe("前标");
  expect((await inspectHTML(page, copied.html)).headings).toEqual([]);
  expect(copied.html).not.toContain("data-semlo-editor-heading-marker");
  expect(copied.html).toContain("<em>前标</em>");
  expect(copied.html).toContain("data-pm-slice");
});

test("pasting partial heading text preserves its inline formatting", async ({ page }) => {
  await mount(page, '<h3 data-semlo-editor-heading-numbering="mixed"><em>甲乙丙丁</em></h3><p>目标</p>');
  await select(page, "甲乙丙丁", "甲乙丙丁", 2, 4);
  const copied = await copy(page);
  expect((await inspectHTML(page, copied.html)).headings).toEqual([]);
  await select(page, "目标", "目标", 2, 2);
  await page.evaluate(({ html, text }) => {
    const transfer = new DataTransfer();
    transfer.setData("text/html", html);
    transfer.setData("text/plain", text);
    window
      .__semloRequireFixture("numberedClipboardEditor")
      .editor.view.dom.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }),
      );
  }, copied);
  await expect(page.locator(".semlo-editor-prose > p")).toHaveText("目标丙丁");
  await expect(page.locator(".semlo-editor-prose > p em")).toHaveText("丙丁");
  await expect(page.locator(".semlo-editor-prose > h3")).toHaveCount(1);
});

test("pasting part of a nested heading remains inline in its destination", async ({ page }) => {
  await mount(
    page,
    '<blockquote><h3 data-semlo-editor-heading-numbering="mixed"><em>甲乙丙丁</em></h3></blockquote><p>目标</p>',
  );
  await select(page, "甲乙丙丁", "甲乙丙丁", 2, 4);
  const copied = await copy(page);
  expect((await inspectHTML(page, copied.html)).headings).toEqual([]);
  await select(page, "目标", "目标", 2, 2);
  await page.evaluate(({ html, text }) => {
    const transfer = new DataTransfer();
    transfer.setData("text/html", html);
    transfer.setData("text/plain", text);
    window
      .__semloRequireFixture("numberedClipboardEditor")
      .editor.view.dom.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }),
      );
  }, copied);
  await expect(page.locator(".semlo-editor-prose > p")).toHaveText("目标丙丁");
  await expect(page.locator(".semlo-editor-prose > p em")).toHaveText("丙丁");
  await expect(page.locator(".semlo-editor-prose > blockquote")).toHaveCount(1);
});

test("a reverse selection across numbered headings and a paragraph preserves their actual numbers", async ({
  page,
}) => {
  await mount(
    page,
    '<h3 data-semlo-editor-heading-numbering="mixed">第一标题</h3><h3 data-semlo-editor-heading-numbering="mixed">第二标题</h3><p>中间正文</p><h3 data-semlo-editor-heading-numbering="mixed">第三标题</h3>',
  );
  await select(page, "第二标题", "第三标题", 1, 2, true);
  const copied = await copy(page);
  expect(copied.text).toBe("二标题\n\n中间正文\n\n第三");
  const inspected = await inspectHTML(page, copied.html);
  expect(inspected.headings.map((heading) => heading.marker)).toEqual(["2. ", "3. "]);
  expect(inspected.paragraphs).toEqual(["中间正文"]);
});

test("copying across two adjacent numbered headings uses one plain-text line break", async ({ page }) => {
  await mount(
    page,
    '<h3 data-semlo-editor-heading-numbering="mixed">甲乙丙丁</h3><h3 data-semlo-editor-heading-numbering="mixed">戊己庚辛</h3>',
  );
  await select(page, "甲乙丙丁", "戊己庚辛", 2, 2);
  const copied = await copy(page);
  expect(copied.text).toBe("丙丁\n戊己");
  expect((await inspectHTML(page, copied.html)).headings).toEqual([
    { type: "H3", text: "1. 丙丁", marker: "1. ", style: "mixed" },
    { type: "H3", text: "2. 戊己", marker: "2. ", style: "mixed" },
  ]);
});

test("the adjacent-heading separator does not collapse explicit line breaks", async ({ page }) => {
  await mount(
    page,
    '<h3 data-semlo-editor-heading-numbering="mixed">甲<br><br>乙</h3><h3 data-semlo-editor-heading-numbering="mixed">丙丁</h3>',
  );
  await select(page, "甲乙", "丙丁");
  const copied = await copy(page);
  expect(copied.text).toBe("甲\n\n乙\n丙丁");
});

test("a host clipboard text serializer stays authoritative across numbered headings", async ({ page }) => {
  await mount(
    page,
    '<h3 data-semlo-editor-heading-numbering="mixed">甲乙丙丁</h3><h3 data-semlo-editor-heading-numbering="mixed">戊己庚辛</h3>',
    "host-earlier",
  );
  await select(page, "甲乙丙丁", "戊己庚辛", 2, 2);
  const copied = await copy(page);
  expect(copied.text).toBe("host:丙丁\n\n戊己");
  expect((await page.evaluate(() => window.__semloRequireFixture("numberedClipboardCalls"))).text).toBe(1);
});

for (const [mode, expected, calls] of [
  ["host-text-earlier", "host:丙丁\n\n戊己", 1],
  ["host-text-later", "丙丁\n\n戊己", 0],
] as const) {
  test(`${mode} preserves existing text serialization priority without transform hooks`, async ({ page }) => {
    await mount(
      page,
      '<h3 data-semlo-editor-heading-numbering="mixed">甲乙丙丁</h3><h3 data-semlo-editor-heading-numbering="mixed">戊己庚辛</h3>',
      mode,
    );
    await select(page, "甲乙丙丁", "戊己庚辛", 2, 2);
    const copied = await copy(page);
    expect(copied.text).toBe(expected);
    expect((await page.evaluate(() => window.__semloRequireFixture("numberedClipboardCalls"))).text).toBe(calls);
  });
}

test("cutting across adjacent numbered headings uses one separator and remains undoable", async ({ page }) => {
  await mount(
    page,
    '<h3 data-semlo-editor-heading-numbering="mixed">甲乙丙丁</h3><h3 data-semlo-editor-heading-numbering="mixed">戊己庚辛</h3>',
  );
  const before = await page.evaluate(() => window.__semloRequireFixture("numberedClipboardEditor").getSnapshot().json);
  await select(page, "甲乙丙丁", "戊己庚辛", 2, 2);
  const copied = await copy(page, "cut");
  expect(copied.text).toBe("丙丁\n戊己");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("numberedClipboardEditor").editor.commands.undo()),
  ).toBe(true);
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedClipboardEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("cut keeps ProseMirror deletion and undo semantics", async ({ page }) => {
  await mount(
    page,
    '<h3 data-semlo-editor-heading-numbering="mixed">甲乙</h3><p>正文</p><h3 data-semlo-editor-heading-numbering="mixed">丙丁</h3>',
  );
  const before = await page.evaluate(() => window.__semloRequireFixture("numberedClipboardEditor").getSnapshot().json);
  await select(page, "甲乙", "丙丁", 1, 1);
  const copied = await copy(page, "cut");
  expect(copied.prevented).toBe(true);
  expect(copied.text).toBe("乙\n\n正文\n\n丙");
  expect((await inspectHTML(page, copied.html)).headings.map((heading) => heading.marker)).toEqual(["1. ", "2. "]);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("numberedClipboardEditor").getSnapshot().json),
  ).not.toEqual(before);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("numberedClipboardEditor").editor.commands.undo()),
  ).toBe(true);
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedClipboardEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("pasting a copied numbered heading back does not insert its marker into document text", async ({ page }) => {
  await mount(page, '<h3 data-semlo-editor-heading-numbering="mixed">原始标题</h3><p>目标</p>');
  await page.evaluate(() =>
    window.__semloRequireFixture("numberedClipboardEditor").editor.commands.setNodeSelection(0),
  );
  const copied = await copy(page);
  expect((await inspectHTML(page, copied.html)).headings[0].marker).toBe("1. ");
  await select(page, "目标", "目标", 2, 2);
  const pasted = await page.evaluate(({ html, text }) => {
    const transfer = new DataTransfer();
    transfer.setData("text/html", html);
    transfer.setData("text/plain", text);
    const event = new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer });
    window.__semloRequireFixture("numberedClipboardEditor").editor.view.dom.dispatchEvent(event);
    return event.defaultPrevented;
  }, copied);
  expect(pasted).toBe(true);
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("numberedClipboardEditor").getSnapshot());
  expect(snapshot.text).not.toMatch(/\d+\./);
  expect(snapshot.text.match(/原始标题/g)).toHaveLength(2);
  await expect(page.locator(".semlo-editor-prose .semlo-editor-heading-number")).toHaveText(["1. ", "2. "]);
});

test("ordinary content remains untouched", async ({ page }) => {
  await mount(page, "<h3>普通标题</h3><p>普通正文</p>");
  await select(page, "普通标题", "普通正文");
  const copied = await copy(page);
  expect(copied.text).toBe("普通标题\n\n普通正文");
  const inspected = await inspectHTML(page, copied.html);
  expect(inspected.headings).toEqual([{ type: "H3", text: "普通标题", marker: null, style: null }]);
  expect(inspected.paragraphs).toEqual(["普通正文"]);
});

for (const [mode, expectedMarker, expectedText, textCalls] of [
  ["host-later", null, "abc", 0],
  ["host-earlier", null, "host:abc", 1],
] as const) {
  test(`${mode} clipboard serializer and text serializer keep their priority and output`, async ({ page }) => {
    await mount(page, '<h3 data-semlo-editor-heading-numbering="mixed">abc</h3>', mode);
    await select(page, "abc", "abc");
    const copied = await copy(page);
    expect(copied.text).toBe(expectedText);
    const inspected = await inspectHTML(page, copied.html);
    expect(inspected.host).toBe("preserved");
    expect(inspected.headings[0].marker).toBe(expectedMarker);
    expect(await page.evaluate(() => window.__semloRequireFixture("numberedClipboardCalls"))).toEqual({
      serial: 1,
      text: textCalls,
      transform: 1,
      event: 0,
    });
  });
}

test("a later host serializer is delegated when there is no external copy transform", async ({ page }) => {
  await mount(page, '<h3 data-semlo-editor-heading-numbering="mixed">abc</h3>', "host-serializer-only");
  await select(page, "abc", "abc");
  const copied = await copy(page);
  const inspected = await inspectHTML(page, copied.html);
  expect(inspected.headings[0].marker).toBe("1. ");
  expect(inspected.host).toBe("preserved");
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedClipboardCalls"))).toEqual({
    serial: 1,
    text: 0,
    transform: 0,
    event: 0,
  });
});

for (const type of ["copy", "cut"] as const) {
  test(`a host ${type} transform returning an equal slice from another heading owns its HTML`, async ({ page }) => {
    await mount(
      page,
      '<h3 data-semlo-editor-heading-numbering="mixed">相同</h3><h3 data-semlo-editor-heading-numbering="mixed">相同</h3>',
      "host-equal-slice",
    );
    await select(page, "相同", "相同");
    const equal = await page.evaluate(() => {
      const editor = window.__semloRequireFixture("numberedClipboardEditor").editor;
      const second = editor.state.doc.firstChild!.nodeSize + 1;
      return editor.state.selection.content().eq(editor.state.doc.slice(second, second + 2, true));
    });
    expect(equal).toBe(true);
    const copied = await copy(page, type);
    expect(copied.text).toBe("相同");
    expect((await inspectHTML(page, copied.html)).headings).toEqual([
      { type: "H3", text: "相同", marker: null, style: "mixed" },
    ]);
    expect((await page.evaluate(() => window.__semloRequireFixture("numberedClipboardCalls"))).transform).toBe(1);
  });
}

test("the exposed default clipboard serializer supports serializeNode and schema node/mark rules", async ({ page }) => {
  await mount(page, '<h3 data-semlo-editor-heading-numbering="mixed"><em>abc</em></h3>');
  const result = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("numberedClipboardEditor").editor;
    const serializer = editor.view.someProp("clipboardSerializer")!;
    const heading = editor.state.doc.firstChild!;
    const node = serializer.serializeNode(heading, { document }) as HTMLElement;
    return {
      html: node.outerHTML,
      hasHeading: Boolean(serializer.nodes.heading),
      hasItalic: Boolean(serializer.marks.italic),
    };
  });
  expect(result).toEqual({
    html: '<h3 data-semlo-editor-heading-numbering="mixed"><em>abc</em></h3>',
    hasHeading: true,
    hasItalic: true,
  });
});

test("the exposed clipboard serializer delegates serializeNode, nodes, and marks to a later host serializer", async ({
  page,
}) => {
  await mount(page, '<h3 data-semlo-editor-heading-numbering="mixed"><em>abc</em></h3>', "host-serializer-only");
  const result = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("numberedClipboardEditor").editor;
    const exposed = editor.view.someProp("clipboardSerializer")!;
    const host = editor.state.plugins
      .map((item) => item.props.clipboardSerializer)
      .find((item) => item && item !== exposed)!;
    const heading = editor.state.doc.firstChild!;
    const dom = exposed.serializeNode(heading, { document }) as HTMLElement;
    return {
      html: dom.outerHTML,
      sameNodes: exposed.nodes === host.nodes,
      sameMarks: exposed.marks === host.marks,
    };
  });
  expect(result).toEqual({
    html: '<h3 data-host-node="yes"><i data-host-mark="yes">abc</i></h3>',
    sameNodes: true,
    sameMarks: true,
  });
});

test("the host can call serializeNode before the numbering plugin's view is initialized", async ({ page }) => {
  await mount(page, '<h3 data-semlo-editor-heading-numbering="mixed">abc</h3>', "host-init");
  expect((await page.evaluate(() => window.__semloRequireFixture("numberedClipboardInit"))).html).toContain(
    'data-host-node="yes"',
  );
});

test("a retained clipboard serializer follows host plugin registration and removal", async ({ page }) => {
  await mount(page, '<h3 data-semlo-editor-heading-numbering="mixed">abc</h3>');
  await page.addScriptTag({
    type: "module",
    content: `
    import { DOMSerializer, Plugin, PluginKey } from '/dist/index.js'
    const editor = window.numberedClipboardEditor.editor
    const exposed = editor.view.someProp('clipboardSerializer')
    const render = () => exposed.serializeNode(editor.state.doc.firstChild, { document }).outerHTML
    const baseline = render()
    const base = DOMSerializer.fromSchema(editor.schema)
    const host = new DOMSerializer({ ...base.nodes,
      heading: () => ['h3', { 'data-dynamic-host': 'yes' }, 0] }, base.marks)
    const key = new PluginKey('dynamicClipboardHost')
    editor.registerPlugin(new Plugin({ key, props: { clipboardSerializer: host } }))
    const during = render()
    editor.unregisterPlugin(key)
    window.numberedClipboardLifecycle = [baseline, during, render()]
  `,
  });
  await page.waitForFunction(() => Boolean(window.numberedClipboardLifecycle));
  const [before, during, after] = await page.evaluate(() => window.__semloRequireFixture("numberedClipboardLifecycle"));
  expect(before).toContain('data-semlo-editor-heading-numbering="mixed"');
  expect(during).toContain('data-dynamic-host="yes"');
  expect(after).toBe(before);
});

test("a host transformCopied that changes the slice wins without losing its text", async ({ page }) => {
  await mount(page, '<h3 data-semlo-editor-heading-numbering="mixed">abc</h3>', "host-transform");
  await select(page, "abc", "abc");
  const copied = await copy(page);
  // Tiptap's earlier built-in text serializer reads the live selection, while
  // the later host transform still controls the HTML slice.
  expect(copied.text).toBe("abc");
  expect((await inspectHTML(page, copied.html)).headings).toEqual([
    { type: "H3", text: "ABC", marker: null, style: "mixed" },
  ]);
  expect((await page.evaluate(() => window.__semloRequireFixture("numberedClipboardCalls"))).transform).toBe(1);
});

test("a host copy event handler remains authoritative", async ({ page }) => {
  await mount(page, '<h3 data-semlo-editor-heading-numbering="mixed">abc</h3>', "host-event");
  await select(page, "abc", "abc");
  const copied = await copy(page);
  expect(copied.text).toBe("host-event");
  expect(copied.html).toContain("data-host-event");
  expect((await page.evaluate(() => window.__semloRequireFixture("numberedClipboardCalls"))).event).toBe(1);
});

for (const [style, marker] of [
  ["mixed", "a. "],
  ["decimal", "1.1. "],
  ["chinese", "(一) "],
] as const) {
  test(`full heading copy uses the existing ${style} hierarchy`, async ({ page }) => {
    await mount(
      page,
      `<h1 data-semlo-editor-heading-numbering="${style}">上级</h1><h3 data-semlo-editor-heading-numbering="${style}">下级标题</h3>`,
    );
    await select(page, "下级标题", "下级标题");
    const copied = await copy(page);
    expect(copied.text).toBe("下级标题");
    expect((await inspectHTML(page, copied.html)).headings[0].marker).toBe(marker);
  });
}

test("same-text headings use the selected position and leave direct serialization alone", async ({ page }) => {
  await mount(
    page,
    '<h3 data-semlo-editor-heading-numbering="mixed">相同</h3><h3 data-semlo-editor-heading-numbering="mixed">相同</h3>',
  );
  const direct = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("numberedClipboardEditor").editor;
    const second = editor.state.doc.firstChild!.nodeSize + 1;
    editor.commands.setTextSelection({ from: second, to: second + 2 });
    return editor.view.serializeForClipboard(editor.state.doc.slice(1, 3, true)).dom.innerHTML;
  });
  expect((await inspectHTML(page, direct)).headings[0].marker).toBeNull();
  const copied = await copy(page);
  expect(copied.text).toBe("相同");
  expect((await inspectHTML(page, copied.html)).headings[0].marker).toBe("2. ");
});

test("clipboard numbering is isolated between editors", async ({ page }) => {
  await mount(
    page,
    '<h3 data-semlo-editor-heading-numbering="mixed">相同</h3><h3 data-semlo-editor-heading-numbering="mixed">相同</h3>',
  );
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    document.body.append(host)
    window.numberedClipboardSecond = createEditor({ element: host, outline: false,
      content: '<h1 data-semlo-editor-heading-numbering="mixed">上级</h1><h3 data-semlo-editor-heading-numbering="mixed">相同</h3>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.numberedClipboardSecond));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("numberedClipboardEditor").editor;
    const second = editor.state.doc.firstChild!.nodeSize + 1;
    editor.view.focus();
    editor.commands.setTextSelection({ from: second, to: second + 2 });
  });
  expect((await inspectHTML(page, (await copy(page)).html)).headings[0].marker).toBe("2. ");
  await page.evaluate(() => {
    const original = window.__semloRequireFixture("numberedClipboardEditor");
    window.numberedClipboardEditor = window.__semloRequireFixture("numberedClipboardSecond");
    window.numberedClipboardSecond = original;
  });
  await select(page, "相同", "相同");
  expect((await inspectHTML(page, (await copy(page)).html)).headings[0].marker).toBe("a. ");
  await page.evaluate(() => window.__semloRequireFixture("numberedClipboardSecond").destroy());
  expect((await inspectHTML(page, (await copy(page)).html)).headings[0].marker).toBe("a. ");
});

test("pasting between editors recalculates the visible number without adding it to text", async ({ page }) => {
  await mount(
    page,
    '<h3 data-semlo-editor-heading-numbering="mixed">第一项</h3><h3 data-semlo-editor-heading-numbering="mixed">第二项</h3>',
  );
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("numberedClipboardEditor").editor;
    editor.commands.setNodeSelection(editor.state.doc.firstChild!.nodeSize);
  });
  const copied = await copy(page);
  expect((await inspectHTML(page, copied.html)).headings[0].marker).toBe("2. ");
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'clipboard-destination'
    document.body.append(host)
    window.numberedClipboardSecond = window.numberedClipboardEditor
    window.numberedClipboardEditor = createEditor({ element: host, outline: false,
      content: '<h1 data-semlo-editor-heading-numbering="mixed">上级</h1><p>目标</p>' })
  `,
  });
  await select(page, "目标", "目标", 2, 2);
  await page.evaluate(({ html, text }) => {
    const transfer = new DataTransfer();
    transfer.setData("text/html", html);
    transfer.setData("text/plain", text);
    window
      .__semloRequireFixture("numberedClipboardEditor")
      .editor.view.dom.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }),
      );
  }, copied);
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("numberedClipboardEditor").getSnapshot());
  expect(snapshot.text).toContain("第二项");
  expect(snapshot.text).not.toMatch(/\d+\./);
  await expect(page.locator("#clipboard-destination .semlo-editor-heading-number")).toHaveText(["1. ", "a. "]);
  expect(
    (await page.evaluate(() => window.__semloRequireFixture("numberedClipboardSecond").getSnapshot())).text,
  ).toContain("第一项");
});

test("pasting a multi-block selection avoids duplicate markers and can be undone", async ({ page }) => {
  await mount(
    page,
    '<h3 data-semlo-editor-heading-numbering="mixed">甲乙</h3><p>中间</p><h3 data-semlo-editor-heading-numbering="mixed">丙丁</h3>',
  );
  await select(page, "甲乙", "丙丁");
  const copied = await copy(page);
  expect((await inspectHTML(page, copied.html)).headings.map((heading) => heading.marker)).toEqual(["1. ", "2. "]);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    document.body.append(host)
    window.numberedClipboardEditor = createEditor({ element: host, outline: false, content: '<p>目标</p>' })
  `,
  });
  await select(page, "目标", "目标", 2, 2);
  const before = await page.evaluate(() => window.__semloRequireFixture("numberedClipboardEditor").getSnapshot().json);
  await page.evaluate(({ html, text }) => {
    const transfer = new DataTransfer();
    transfer.setData("text/html", html);
    transfer.setData("text/plain", text);
    window
      .__semloRequireFixture("numberedClipboardEditor")
      .editor.view.dom.dispatchEvent(
        new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }),
      );
  }, copied);
  const snapshot = await page.evaluate(() => window.__semloRequireFixture("numberedClipboardEditor").getSnapshot());
  expect(snapshot.text).toContain("甲乙");
  expect(snapshot.text).toContain("中间");
  expect(snapshot.text).toContain("丙丁");
  expect(snapshot.text).not.toMatch(/\d+\./);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("numberedClipboardEditor").editor.commands.undo()),
  ).toBe(true);
  expect(await page.evaluate(() => window.__semloRequireFixture("numberedClipboardEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("a host-modified heading serializer is left intact when matching is unsafe", async ({ page }) => {
  await mount(page, '<h3 data-semlo-editor-heading-numbering="mixed">abc</h3>', "host-modified");
  await select(page, "abc", "abc");
  const copied = await copy(page);
  const inspected = await inspectHTML(page, copied.html);
  expect(inspected.headings).toEqual([{ type: "H3", text: "abc由宿主添加", marker: null, style: "mixed" }]);
  expect(inspected.host).toBe("preserved");
});

test("a lower priority host event can serialize a same-text different heading without a wrong number", async ({
  page,
}) => {
  await mount(
    page,
    '<h3 data-semlo-editor-heading-numbering="mixed">相同</h3><h3 data-semlo-editor-heading-numbering="mixed">相同</h3>',
    "host-event-later",
  );
  await select(page, "相同", "相同");
  const copied = await copy(page);
  expect(copied.text).toBe("相同");
  expect((await inspectHTML(page, copied.html)).headings[0].marker).toBeNull();
  expect((await page.evaluate(() => window.__semloRequireFixture("numberedClipboardCalls"))).event).toBe(1);
});
