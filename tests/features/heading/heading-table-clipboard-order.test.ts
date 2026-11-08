import { expect, test, type Page } from "@rstest/playwright";
import type { PluginKey } from "@tiptap/pm/state";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    headingTableCopyEditor?: EditorController;
    headingTableCopyHostCalls?: number;
    headingTableCopyPluginKey?: PluginKey;
    headingTableCopyTrace?: Array<{ phase: string; html: string; text: string }>;
  }
}

type HostMode = "none" | "early" | "early-empty" | "late" | "late-empty" | "early-dom";

async function mount(page: Page, mode: HostMode = "none") {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor, Extension, Plugin, PluginKey } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'heading-table-copy-test'
      document.body.append(host)
      const mode = ${JSON.stringify(mode)}
      window.headingTableCopyHostCalls = 0
      const custom = Extension.create({
        name: 'heading-table-host', priority: mode.startsWith('early') ? 200 : 1,
        addProseMirrorPlugins() {
          if (mode === 'early-dom') return [new Plugin({ view(view) {
            window.headingTableCopyTrace = []
            const listener = () => {
              const { dom, text } = view.serializeForClipboard(view.state.selection.content())
              window.headingTableCopyTrace.push({ phase: 'early-bubble', html: dom.innerHTML, text })
            }
            view.dom.addEventListener('copy', listener)
            return { destroy() { view.dom.removeEventListener('copy', listener) } }
          } })]
          return [new Plugin({ key: new PluginKey('headingTableHost'), props: {
          clipboardTextSerializer(slice) {
            window.headingTableCopyHostCalls++
            return mode.endsWith('empty') ? '' : 'host:' + slice.content.textBetween(0, slice.content.size, '\\n\\n')
          },
        } })] },
      })
      window.headingTableCopyEditor = createEditor({
        element: host, outline: false,
        content: '<h3 data-semlo-editor-heading-numbering="mixed">甲乙丙丁</h3><h3 data-semlo-editor-heading-numbering="mixed">戊己庚辛</h3><table><tbody><tr><td>A1</td><td>A2</td></tr><tr><td>B1</td><td>B2</td></tr></tbody></table><p>尾段</p>',
        extensions: mode === 'none' ? [] : [custom],
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.headingTableCopyEditor));
}

async function selectHeadings(page: Page) {
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("headingTableCopyEditor").editor;
    let from = -1;
    let to = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "heading" && node.textContent === "甲乙丙丁") from = pos + 3;
      if (node.type.name === "heading" && node.textContent === "戊己庚辛") to = pos + 3;
    });
    if (from < 0 || to < 0) throw new Error("Missing numbered headings");
    editor.view.focus();
    editor.commands.setTextSelection({ from, to });
  });
}

async function selectCells(page: Page) {
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("headingTableCopyEditor").editor;
    const positions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (["tableCell", "tableHeader"].includes(node.type.name)) positions.push(pos);
    });
    if (positions.length !== 4) throw new Error("Missing table cells");
    editor.view.focus();
    editor.commands.setCellSelection({ anchorCell: positions[0], headCell: positions[3] });
  });
}

async function copy(page: Page) {
  return page.evaluate(() => {
    const transfer = new DataTransfer();
    const event = new ClipboardEvent("copy", { bubbles: true, cancelable: true, clipboardData: transfer });
    window.__semloRequireFixture("headingTableCopyEditor").editor.view.dom.dispatchEvent(event);
    return {
      text: transfer.getData("text/plain"),
      html: transfer.getData("text/html"),
      prevented: event.defaultPrevented,
      calls: window.headingTableCopyHostCalls ?? 0,
    };
  });
}

async function tableAfterHeading(page: Page) {
  return page.evaluate(() => {
    const editor = window.__semloRequireFixture("headingTableCopyEditor").editor;
    const plugins = [...editor.state.plugins];
    const table = plugins.findIndex((plugin) =>
      /^semloEditorTableClipboard\$(?:\d+)?$/.test((plugin as { key?: string }).key ?? ""),
    );
    const heading = plugins.findIndex(
      (plugin) =>
        plugin.props.clipboardSerializer && plugin.props.clipboardTextSerializer && plugin.props.transformCopied,
    );
    if (table < 0 || heading < 0) throw new Error("Missing table or heading clipboard plugin");
    const [plugin] = plugins.splice(table, 1);
    const destination = plugins.findIndex(
      (entry) => entry.props.clipboardSerializer && entry.props.clipboardTextSerializer && entry.props.transformCopied,
    );
    plugins.splice(destination + 1, 0, plugin);
    editor.view.updateState(editor.state.reconfigure({ plugins }));
    return { before: table < heading, after: destination < plugins.indexOf(plugin) };
  });
}

async function registerDynamicHost(
  page: Page,
  value: string,
  beforeDefault: boolean,
  name = "dynamicHeadingTableHost",
) {
  await page.addScriptTag({
    type: "module",
    content: `
      import { Plugin, PluginKey } from '/dist/index.js'
      const editor = window.headingTableCopyEditor.editor
      const key = new PluginKey(${JSON.stringify(name)})
      window.headingTableCopyPluginKey = key
      const plugin = new Plugin({ key, props: { clipboardTextSerializer() {
        window.headingTableCopyHostCalls++
        return ${JSON.stringify(value)}
      } } })
      editor.registerPlugin(plugin, ${
        beforeDefault
          ? `(added, plugins) => { const index = plugins.findIndex(item => /^clipboardTextSerializer\\$(?:\\d+)?$/.test(item.key)); if (index < 0) throw new Error('Missing default serializer'); plugins.splice(index, 0, added); return plugins }`
          : "undefined"
      })
    `,
  });
}

test("table serializer before the heading serializer yields one separator for numbered headings", async ({ page }) => {
  await mount(page);
  await selectHeadings(page);
  const copied = await copy(page);
  expect(copied.prevented).toBe(true);
  expect(copied.text).toBe("丙丁\n戊己");
  expect(copied.html).toContain('data-semlo-editor-heading-marker=""');
  expect(copied.html).toContain("1. ");
  expect(copied.html).toContain("2. ");
});

test("table serializer after the heading serializer also yields one separator for numbered headings", async ({
  page,
}) => {
  await mount(page);
  expect(await tableAfterHeading(page)).toEqual({ before: true, after: true });
  await selectHeadings(page);
  expect((await copy(page)).text).toBe("丙丁\n戊己");
});

for (const order of ["before", "after"] as const) {
  test(`a cell selection is copied as tabular text with the table serializer ${order} headings`, async ({ page }) => {
    await mount(page);
    if (order === "after") await tableAfterHeading(page);
    await selectCells(page);
    const copied = await copy(page);
    expect(copied.prevented).toBe(true);
    expect(copied.text).toBe("A1\tA2\nB1\tB2");
    expect(copied.html).toContain("<table");
  });
}

for (const [mode, expected, calls] of [
  ["early", "host:丙丁\n\n戊己", 1],
  ["early-empty", "丙丁\n\n戊己", 1],
  ["late", "丙丁\n\n戊己", 0],
  ["late-empty", "丙丁\n\n戊己", 0],
] as Array<[HostMode, string, number]>) {
  test(`${mode} host serializer keeps its priority and is not invoked twice`, async ({ page }) => {
    await mount(page, mode);
    await selectHeadings(page);
    const copied = await copy(page);
    expect(copied.text).toBe(expected);
    expect(copied.calls).toBe(calls);
  });
}

for (const [value, expected] of [
  ["host-dynamic", "host-dynamic"],
  ["", "丙丁\n\n戊己"],
] as const) {
  test(`a dynamic serializer before the default ${value ? "wins" : "lets the default continue"} once`, async ({
    page,
  }) => {
    await mount(page);
    await registerDynamicHost(page, value, true);
    await selectHeadings(page);
    const copied = await copy(page);
    expect(copied.text).toBe(expected);
    expect(copied.calls).toBe(1);
    await page.evaluate(() => {
      const editor = window.__semloRequireFixture("headingTableCopyEditor").editor;
      editor.unregisterPlugin(window.__semloRequireFixture("headingTableCopyPluginKey"));
      window.headingTableCopyHostCalls = 0;
    });
    const unregistered = await copy(page);
    expect(unregistered.text).toBe("丙丁\n戊己");
    expect(unregistered.calls).toBe(0);
  });
}

for (const [mode, expectedCalls] of [
  ["early", 1],
  ["early-empty", 1],
] as const) {
  test(`${mode} host retains priority for a cell selection`, async ({ page }) => {
    await mount(page, mode);
    await selectCells(page);
    const copied = await copy(page);
    expect(copied.calls).toBe(expectedCalls);
    if (mode === "early") expect(copied.text.startsWith("host:")).toBe(true);
    else expect(copied.text).toBe("A1\tA2\nB1\tB2");
  });
}

for (const [value, expected] of [
  ["host-collision", "host-collision"],
  ["", "丙丁\n\n戊己"],
] as const) {
  test(`a host with a table-like key is still respected when it returns ${value || "empty"}`, async ({ page }) => {
    await mount(page);
    await registerDynamicHost(page, value, true, "semloEditorTableClipboard");
    await selectHeadings(page);
    const copied = await copy(page);
    expect(copied.text).toBe(expected);
    expect(copied.calls).toBe(1);
    await page.evaluate(() =>
      window
        .__semloRequireFixture("headingTableCopyEditor")
        .editor.unregisterPlugin(window.__semloRequireFixture("headingTableCopyPluginKey")),
    );
    expect((await copy(page)).text).toBe("丙丁\n戊己");
  });
}

test("a dynamic host after the default is not called and unregistering restores heading copy", async ({ page }) => {
  await mount(page);
  await registerDynamicHost(page, "host-late", false);
  await selectHeadings(page);
  expect(await copy(page)).toMatchObject({ text: "丙丁\n\n戊己", calls: 0 });
  await page.evaluate(() =>
    window
      .__semloRequireFixture("headingTableCopyEditor")
      .editor.unregisterPlugin(window.__semloRequireFixture("headingTableCopyPluginKey")),
  );
  expect(await copy(page)).toMatchObject({ text: "丙丁\n戊己", calls: 0 });
});

test("a direct view serializer keeps precedence without being called twice", async ({ page }) => {
  await mount(page);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("headingTableCopyEditor").editor;
    editor.view.setProps({
      clipboardTextSerializer() {
        window.headingTableCopyHostCalls!++;
        return "view-host";
      },
    });
  });
  await selectHeadings(page);
  expect(await copy(page)).toMatchObject({ text: "view-host", calls: 1 });
});

test("real keyboard copy places numbered heading text and marked HTML on the browser clipboard", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mount(page);
  await selectHeadings(page);
  await page.keyboard.press("ControlOrMeta+c");
  const clipboard = await page.evaluate(async () => {
    const text = await navigator.clipboard.readText();
    const items = await navigator.clipboard.read();
    const item = items.find((entry) => entry.types.includes("text/html"))!;
    return { text, html: await (await item.getType("text/html")).text() };
  });
  expect(clipboard.text).toBe("丙丁\n戊己");
  expect(clipboard.html).toContain('data-semlo-editor-heading-marker=""');
});

test("real keyboard cut copies numbered headings and a single undo restores them", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mount(page);
  await selectHeadings(page);
  const original = await page.evaluate(() => window.__semloRequireFixture("headingTableCopyEditor").getSnapshot().json);
  await page.keyboard.press("ControlOrMeta+x");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("丙丁\n戊己");
  expect(await page.evaluate(() => window.__semloRequireFixture("headingTableCopyEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("headingTableCopyEditor").getSnapshot().json)).toEqual(
    original,
  );
});

async function observeExternalSerializations(page: Page, type: "copy" | "cut", stop: boolean) {
  await page.evaluate(
    ({ type, stop }) => {
      const view = window.__semloRequireFixture("headingTableCopyEditor").editor.view;
      window.headingTableCopyTrace = [];
      const record = (phase: string) => {
        const { dom, text } = view.serializeForClipboard(view.state.selection.content());
        window.headingTableCopyTrace!.push({ phase, html: dom.innerHTML, text });
      };
      view.dom.addEventListener(
        type,
        (event) => {
          record("capture");
          queueMicrotask(() => record("capture-microtask"));
          if (stop) {
            event.preventDefault();
            event.stopImmediatePropagation();
          }
        },
        true,
      );
      view.dom.addEventListener(type, () => {
        record("bubble");
        queueMicrotask(() => record("bubble-microtask"));
      });
    },
    { type, stop },
  );
}

for (const type of ["copy", "cut"] as const) {
  test(`stopped native ${type} leaves event-time and microtask serializations unnumbered`, async ({ page }) => {
    await mount(page);
    await selectHeadings(page);
    const original = await page.evaluate(
      () => window.__semloRequireFixture("headingTableCopyEditor").getSnapshot().json,
    );
    await observeExternalSerializations(page, type, true);
    await page.keyboard.press(type === "copy" ? "ControlOrMeta+c" : "ControlOrMeta+x");
    await expect.poll(() => page.evaluate(() => window.headingTableCopyTrace?.length)).toBe(2);
    const trace = await page.evaluate(() => window.headingTableCopyTrace!);
    expect(trace.map((entry) => entry.phase)).toEqual(["capture", "capture-microtask"]);
    for (const entry of trace) {
      expect(entry.html).not.toContain("data-semlo-editor-heading-marker");
      expect(entry.text).toBe("丙丁\n\n戊己");
    }
    expect(
      await page.evaluate(() => window.__semloRequireFixture("headingTableCopyEditor").getSnapshot().json),
    ).toEqual(original);
  });
}

test("unrelated native copy-time, microtask and later serializations do not acquire heading markers", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await mount(page);
  await selectHeadings(page);
  await observeExternalSerializations(page, "copy", false);
  await page.keyboard.press("ControlOrMeta+c");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("丙丁\n戊己");
  await expect.poll(() => page.evaluate(() => window.headingTableCopyTrace?.length)).toBe(4);
  const trace = await page.evaluate(() => window.headingTableCopyTrace!);
  expect(trace.map((entry) => entry.phase)).toEqual(["capture", "capture-microtask", "bubble", "bubble-microtask"]);
  for (const entry of trace) {
    expect(entry.html).not.toContain("data-semlo-editor-heading-marker");
    expect(entry.text).toBe("丙丁\n\n戊己");
  }
  const later = await page.evaluate(() => {
    const view = window.__semloRequireFixture("headingTableCopyEditor").editor.view;
    return view.serializeForClipboard(view.state.selection.content()).dom.innerHTML;
  });
  expect(later).not.toContain("data-semlo-editor-heading-marker");
});

for (const type of ["copy", "cut"] as const) {
  for (const order of ["before", "after"] as const) {
    test(`a ${order} host DOM handler intercepts native ${type} without unrelated numbering`, async ({ page }) => {
      await mount(page);
      await page.addScriptTag({
        type: "module",
        content: `
          import { Plugin, PluginKey } from '/dist/index.js'
          const editor = window.headingTableCopyEditor.editor
          window.headingTableCopyTrace = []
          const record = (phase, view) => {
            const { dom, text } = view.serializeForClipboard(view.state.selection.content())
            window.headingTableCopyTrace.push({ phase, html: dom.innerHTML, text })
          }
          const host = new Plugin({ key: new PluginKey('hostDOMClipboard'), props: { handleDOMEvents: {
            ${type}(view, event) {
              record('host', view)
              queueMicrotask(() => record('host-microtask', view))
              event.preventDefault()
              return true
            },
          } } })
          editor.registerPlugin(host, (added, plugins) => {
            const index = plugins.findIndex((entry) => entry.props.clipboardSerializer && entry.props.clipboardTextSerializer && entry.props.transformCopied)
            if (index < 0) throw new Error('Missing heading clipboard plugin')
            plugins.splice(index + ${order === "after" ? 1 : 0}, 0, added)
            return plugins
          })
        `,
      });
      await selectHeadings(page);
      const original = await page.evaluate(
        () => window.__semloRequireFixture("headingTableCopyEditor").getSnapshot().json,
      );
      await page.keyboard.press(type === "copy" ? "ControlOrMeta+c" : "ControlOrMeta+x");
      await expect.poll(() => page.evaluate(() => window.headingTableCopyTrace?.length)).toBe(2);
      const trace = await page.evaluate(() => window.headingTableCopyTrace!);
      expect(trace.map((entry) => entry.phase)).toEqual(["host", "host-microtask"]);
      for (const entry of trace) {
        expect(entry.html).not.toContain("data-semlo-editor-heading-marker");
        expect(entry.text).toBe("丙丁\n\n戊己");
      }
      expect(
        await page.evaluate(() => window.__semloRequireFixture("headingTableCopyEditor").getSnapshot().json),
      ).toEqual(original);
    });
  }
}

test("a synthetic copy cannot reuse numbering during an earlier host bubble listener", async ({ page }) => {
  await mount(page, "early-dom");
  await selectHeadings(page);
  const copied = await copy(page);
  expect(copied.text).toBe("丙丁\n戊己");
  expect(copied.html).toContain("data-semlo-editor-heading-marker");
  const trace = await page.evaluate(() => window.headingTableCopyTrace!);
  expect(trace).toHaveLength(1);
  expect(trace[0].phase).toBe("early-bubble");
  expect(trace[0].html).not.toContain("data-semlo-editor-heading-marker");
  expect(trace[0].text).toBe("丙丁\n\n戊己");
});
