import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    longLinesEditor?: EditorController;
    testTransientMismatch?: {
      state: { removed: boolean; fallbacks: number };
      observer: MutationObserver;
    };
    lineMeasureTracker?: {
      frameId: number;
      measured: number[];
      rowCounts: number[];
      original: typeof Range.prototype.getClientRects;
      observer: MutationObserver;
    };
    trackedLineScroll?: Set<EventListenerOrEventListenerObject>;
  }
}

async function mount(page: Page) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'long-lines-test'
      host.style.width = '360px'
      document.body.prepend(host)
      window.longLinesEditor = createEditor({
        element: host,
        outline: false,
        content: { type: 'doc', content: [
          { type: 'codeBlock', attrs: { wordWrap: true, showLineNumbers: true },
            content: [{ type: 'text', text: 'first\\nsecond\\nthird' }] }
        ] },
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.longLinesEditor));
  const host = page.locator("#long-lines-test");
  await expect(host.locator(".semlo-editor-code-number-line")).toHaveCount(3);
  return host;
}

async function replaceCode(page: Page, text: string) {
  await page.evaluate((value) => {
    const editor = window.__semloRequireFixture("longLinesEditor").editor;
    const node = editor.state.doc.firstChild;
    if (!node || node.type.name !== "codeBlock") throw new Error("Missing code block");
    editor.view.dispatch(editor.state.tr.insertText(value, 1, 1 + node.content.size));
  }, text);
}

async function addWidget(page: Page, raw: boolean) {
  await page.addScriptTag({
    type: "module",
    content: `
      const editor = window.longLinesEditor.editor
      const headingPlugin = editor.state.plugins.find((plugin) => plugin.key.startsWith('semloEditorHeadingFold$'))
      if (!headingPlugin) throw new Error('Missing heading plugin')
      const existing = headingPlugin.props.decorations(editor.state)
      const sample = existing.find()[0]
      if (!sample) throw new Error('Missing real ProseMirror decoration')
      const Decoration = sample.constructor
      const DecorationSet = existing.constructor
      const Plugin = headingPlugin.constructor
      const raw = ${JSON.stringify(raw)}
      const widgets = Array.from({length: raw ? 1 : 3}, () => {
        const widget = document.createElement('span')
        widget.dataset.testCodeWidget = 'true'
        widget.contentEditable = 'false'
        widget.textContent = '[widget]'
        return widget
      })
      const plugin = new Plugin({
        props: {
          decorations(state) {
            let positions = null
            state.doc.descendants((node, pos) => {
              if (node.type.name === 'codeBlock') {
                positions = raw ? [pos + 5] : [pos + 1, pos + 5, pos + node.textContent.indexOf('\\n') + 2]
                return false
              }
              return true
            })
            return positions === null ? DecorationSet.empty : DecorationSet.create(state.doc,
              positions.map((position, index) => Decoration.widget(position, widgets[index],
                { raw, key: 'line-number-test-widget-' + index }))
            )
          }
        }
      })
      window.testCodeWidgetPlugin = plugin
      editor.registerPlugin(plugin)
    `,
  });
}

async function measureAlignment(page: Page, indexes: number[]) {
  return page.locator("#long-lines-test .semlo-editor-code-card").evaluate((card, indexes) => {
    const code = card.querySelector("pre code")!;
    const rows = [...card.querySelectorAll<HTMLElement>(".semlo-editor-code-number-line")];
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode())
      if (!(node as Text).parentElement?.closest(".ProseMirror-widget")) nodes.push(node as Text);
    const text = nodes.map((node) => node.data).join("");
    const starts = [0];
    for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") starts.push(i + 1);
    const point = (offset: number) => {
      for (const node of nodes) {
        if (offset < node.length) return { node, offset };
        offset -= node.length;
      }
      throw new Error("Missing code line");
    };
    return indexes.map((index) => {
      const codeRange = document.createRange();
      const numberRange = document.createRange();
      numberRange.selectNodeContents(rows[index]);
      let codeTop: number;
      if (starts[index] === text.length) {
        const trailing = code.querySelector("br.ProseMirror-trailingBreak");
        if (!trailing) throw new Error("Missing trailing empty-line marker");
        codeTop = trailing.getBoundingClientRect().top;
      } else {
        const location = point(starts[index]);
        codeRange.setStart(location.node, location.offset);
        codeRange.setEnd(location.node, location.offset + 1);
        codeTop = codeRange.getBoundingClientRect().top;
      }
      return {
        label: rows[index]?.textContent?.trim(),
        distance: Math.abs(codeTop - numberRange.getBoundingClientRect().top),
      };
    });
  }, indexes);
}

async function measureVisibleAlignment(page: Page) {
  return page.locator("#long-lines-test .semlo-editor-code-card").evaluate((card) => {
    const code = card.querySelector<HTMLElement>("pre code")!;
    const text = code.textContent!;
    const starts = [0];
    for (let i = 0; i < text.length; i += 1) if (text[i] === "\n") starts.push(i + 1);
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
    return [...card.querySelectorAll<HTMLElement>(".semlo-editor-code-visible-number")].map((row) => {
      const index = Number(row.textContent) - 1;
      let offset = starts[index];
      let codeTop: number | undefined;
      if (offset === text.length)
        codeTop = code.querySelector("br.ProseMirror-trailingBreak")?.getBoundingClientRect().top;
      else {
        for (const node of nodes) {
          if (offset < node.length) {
            const range = document.createRange();
            range.setStart(node, offset);
            range.setEnd(node, offset + 1);
            codeTop = range.getBoundingClientRect().top;
            break;
          }
          offset -= node.length;
        }
      }
      if (codeTop === undefined) throw new Error(`Missing visible code line ${index + 1}`);
      const numberRange = document.createRange();
      numberRange.selectNodeContents(row);
      return { index, distance: Math.abs(codeTop - numberRange.getBoundingClientRect().top) };
    });
  });
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("a ProseMirror widget inside code does not leave long line numbers hidden", async ({ page }) => {
  const host = await mount(page);
  const source = Array.from({ length: 300 }, (_, index) => `${index}: ${"long code ".repeat(8)}`).join("\n");
  await page.evaluate((source) => {
    window.__semloRequireFixture("longLinesEditor").setContent({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "heading" }] },
        {
          type: "codeBlock",
          attrs: { wordWrap: true, showLineNumbers: true },
          content: [{ type: "text", text: source }],
        },
      ],
    });
  }, source);
  await expect(host.locator(".semlo-editor-code-number-line")).toHaveCount(300, { timeout: 15000 });
  await addWidget(page, false);
  await expect(host.locator("pre code .ProseMirror-widget")).toHaveText(["[widget]", "[widget]", "[widget]"]);
  await expect(host.locator(".semlo-editor-code-numbers")).not.toHaveCSS("color", "rgba(0, 0, 0, 0)", {
    timeout: 3000,
  });
  for (const sample of await measureAlignment(page, [0, 1, 127, 128, 299])) expect(sample.distance).toBeLessThan(2);
});

test("an unmarked raw ProseMirror widget falls back and recovers when removed", async ({ page }) => {
  const host = await mount(page);
  const source = Array.from({ length: 300 }, (_, index) => `${index}: ${"long code ".repeat(8)}`).join("\n");
  await page.evaluate((source) => {
    window.__semloRequireFixture("longLinesEditor").setContent({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "heading" }] },
        {
          type: "codeBlock",
          attrs: { wordWrap: true, showLineNumbers: true },
          content: [{ type: "text", text: source }],
        },
      ],
    });
  }, source);
  const numbers = host.locator(".semlo-editor-code-numbers");
  await expect(numbers.locator(".semlo-editor-code-number-line")).toHaveCount(300, { timeout: 15000 });
  await addWidget(page, true);
  await expect(host.locator("pre code [data-test-code-widget]")).toHaveText("[widget]");
  await expect(numbers.locator(".semlo-editor-code-number-line")).toHaveCount(0);
  await expect(numbers).not.toHaveCSS("color", "rgba(0, 0, 0, 0)");
  await expect(numbers).toHaveText(Array.from({ length: 300 }, (_, index) => String(index + 1)).join("\n"));
  await page.addScriptTag({
    type: "module",
    content: "window.longLinesEditor.editor.unregisterPlugin({ key: window.testCodeWidgetPlugin.key })",
  });
  await expect(host.locator("pre code [data-test-code-widget]")).toHaveCount(0);
  await expect(numbers.locator(".semlo-editor-code-number-line")).toHaveCount(300, { timeout: 15000 });
  for (const sample of await measureAlignment(page, [0, 1, 127, 128, 299])) expect(sample.distance).toBeLessThan(2);
});

test("a transient DOM mismatch does not flash the fallback gutter", async ({ page }) => {
  const host = await mount(page);
  const source = Array.from({ length: 300 }, (_, index) => `${index}: ${"long code ".repeat(8)}`).join("\n");
  await page.evaluate((source) => {
    window.__semloRequireFixture("longLinesEditor").setContent({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "heading" }] },
        {
          type: "codeBlock",
          attrs: { wordWrap: true, showLineNumbers: true },
          content: [{ type: "text", text: source }],
        },
      ],
    });
  }, source);
  const numbers = host.locator(".semlo-editor-code-numbers");
  await expect(numbers.locator(".semlo-editor-code-number-line")).toHaveCount(300, { timeout: 15000 });
  await page.addScriptTag({
    type: "module",
    content: `
    const code = document.querySelector('#long-lines-test pre code')
    const numbers = document.querySelector('#long-lines-test .semlo-editor-code-numbers')
    const state = { fallbacks: 0, removed: false }
    const observer = new MutationObserver(() => {
      if (!numbers.querySelector('.semlo-editor-code-number-line') &&
          getComputedStyle(numbers).color !== 'rgba(0, 0, 0, 0)') state.fallbacks++
    })
    observer.observe(numbers, { childList: true, attributes: true, attributeFilter: ['style'] })
    const createWalker = document.createTreeWalker
    document.createTreeWalker = function(root, ...args) {
      if (root === code && code.querySelector('[data-test-code-widget]')) {
        document.createTreeWalker = createWalker
        requestAnimationFrame(() => {
          window.longLinesEditor.editor.unregisterPlugin({ key: window.testCodeWidgetPlugin.key })
          state.removed = true
        })
      }
      return createWalker.call(this, root, ...args)
    }
    window.testTransientMismatch = { state, observer }
  `,
  });
  await addWidget(page, true);
  await expect
    .poll(async () => page.evaluate(() => window.__semloRequireFixture("testTransientMismatch").state.removed))
    .toBe(true);
  await expect(host.locator("pre code [data-test-code-widget]")).toHaveCount(0);
  await expect(numbers.locator(".semlo-editor-code-number-line")).toHaveCount(300, { timeout: 15000 });
  await expect(numbers).not.toHaveCSS("color", "rgba(0, 0, 0, 0)");
  await page.evaluate(async () => {
    for (let frame = 0; frame < 5; frame += 1)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  });
  const fallbacks = await page.evaluate(() => {
    const test = window.__semloRequireFixture("testTransientMismatch");
    test.observer.disconnect();
    return test.state.fallbacks;
  });
  expect(fallbacks).toBe(0);
  for (const sample of await measureAlignment(page, [0, 1, 127, 128, 299])) expect(sample.distance).toBeLessThan(2);
});

test("long wrapped code measures across frames and commits a complete gutter atomically", async ({ page }) => {
  const host = await mount(page);
  const card = host.locator(".semlo-editor-code-card");
  const numbers = card.locator(".semlo-editor-code-numbers");
  await page.evaluate(() => {
    const code = document.querySelector<HTMLElement>("#long-lines-test pre code")!;
    const numbers = document.querySelector<HTMLElement>("#long-lines-test .semlo-editor-code-numbers")!;
    const state = {
      frame: 0,
      frameId: 0,
      measured: [] as number[],
      rowCounts: [] as number[],
      original: Range.prototype.getClientRects,
      observer: new MutationObserver(() => {
        state.rowCounts.push(numbers.querySelectorAll(".semlo-editor-code-number-line").length);
      }),
    };
    state.observer.observe(numbers, { childList: true });
    const tick = () => {
      state.frame += 1;
      state.frameId = requestAnimationFrame(tick);
    };
    state.frameId = requestAnimationFrame(tick);
    Range.prototype.getClientRects = function () {
      if (code.contains(this.commonAncestorContainer)) state.measured.push(state.frame);
      return state.original.call(this);
    };
    window.lineMeasureTracker = state;
  });
  const lines = Array.from({ length: 3000 }, (_, index) => `${index + 1}: ${"wide code ".repeat(10)}`);
  await replaceCode(page, lines.join("\n"));
  await expect(numbers.locator(".semlo-editor-code-number-line")).toHaveCount(lines.length, { timeout: 15000 });
  const observed = await page.evaluate(() => {
    const state = window.__semloRequireFixture("lineMeasureTracker");
    cancelAnimationFrame(state.frameId);
    state.observer.disconnect();
    Range.prototype.getClientRects = state.original;
    return { frames: [...new Set(state.measured)], rowCounts: state.rowCounts };
  });
  expect(observed.frames.length).toBeGreaterThan(1);
  expect(observed.rowCounts).toContain(lines.length);
  expect(observed.rowCounts.every((count) => count === 3 || count === lines.length)).toBe(true);
  for (const [index, sample] of (await measureAlignment(page, [0, 1, 127, 128, 1499, 2999])).entries()) {
    expect(sample.label).toBe(String([1, 2, 128, 129, 1500, 3000][index]));
    expect(sample.distance).toBeLessThan(2);
  }
});

test("a newly mounted long block shows line numbers and its observers settle", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'long-lines-test'
      host.style.width = '300px'
      document.body.prepend(host)
      const text = Array.from({ length: 1600 }, (_, index) => String(index) + ': ' + 'long code '.repeat(8)).join('\\n')
      window.longLinesEditor = createEditor({
        element: host,
        outline: false,
        content: { type: 'doc', content: [
          { type: 'codeBlock', attrs: { wordWrap: true, showLineNumbers: true }, content: [{ type: 'text', text }] }
        ] },
      })
    `,
  });
  const numbers = page.locator("#long-lines-test .semlo-editor-code-numbers");
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  const initial = await numbers.evaluate((element) =>
    element.querySelector(".semlo-editor-code-visible-numbers") ? element.firstChild?.textContent : element.textContent,
  );
  expect(initial?.startsWith("1\n2\n3")).toBe(true);
  expect(initial?.endsWith("1600")).toBe(true);
  await expect(numbers.locator(".semlo-editor-code-number-line")).toHaveCount(1600, { timeout: 15000 });
  const repeatedWrites = await numbers.evaluate(async (element) => {
    // Ignore already queued ResizeObserver delivery, then watch several frames.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    let writes = 0;
    const observer = new MutationObserver(() => (writes += 1));
    observer.observe(element, { childList: true, subtree: true, characterData: true });
    for (let frame = 0; frame < 10; frame += 1)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    observer.disconnect();
    return writes;
  });
  expect(repeatedWrites).toBe(0);
});

test("visible line numbers remain aligned while a long measurement is repeatedly superseded", async ({ page }) => {
  const host = await mount(page);
  await page.addStyleTag({ content: "#long-lines-test .semlo-editor-code-body { max-height: 240px }" });
  await host.evaluate((element) => ((element as HTMLElement).style.zoom = "0.75"));
  await page.evaluate(() => {
    // Make each frame's budget expire after one row, keeping the background
    // measurement pending without relying on a wall-clock threshold.
    const original = performance.now.bind(performance);
    let tick = 0;
    Object.defineProperty(performance, "now", { configurable: true, value: () => original() + tick++ * 20 });
  });
  const text = Array.from({ length: 3000 }, (_, index) => `${index}: ${"visible code ".repeat(8)}`).join("\n");
  await replaceCode(page, text);
  await expect(host.locator(".semlo-editor-code-visible-number").first()).toBeVisible();
  const samples = () =>
    host.locator(".semlo-editor-code-card").evaluate((card) => {
      const code = card.querySelector("pre code")!;
      const source = code.textContent!;
      const offsets = [0];
      for (let index = 0; index < source.length; index += 1) if (source[index] === "\n") offsets.push(index + 1);
      const nodes: Text[] = [];
      const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) nodes.push(node as Text);
      return [...card.querySelectorAll<HTMLElement>(".semlo-editor-code-visible-number")].map((row) => {
        const index = Number(row.textContent) - 1;
        let offset = offsets[index];
        for (const node of nodes) {
          if (offset < node.length) {
            const codeRange = document.createRange();
            codeRange.setStart(node, offset);
            codeRange.setEnd(node, offset + 1);
            const numberRange = document.createRange();
            numberRange.selectNodeContents(row);
            return {
              index,
              distance: Math.abs(codeRange.getBoundingClientRect().top - numberRange.getBoundingClientRect().top),
            };
          }
          offset -= node.length;
        }
        throw new Error("Missing visible code line");
      });
    });
  const top = await samples();
  expect(top.length).toBeGreaterThan(0);
  expect(top[0].index).toBe(0);
  expect(Math.max(...top.map((sample) => sample.distance))).toBeLessThan(2);
  const body = host.locator(".semlo-editor-code-body");
  await body.evaluate(async (element) => {
    element.scrollTop = Math.floor(element.scrollHeight / 2);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const scrolled = await samples();
  expect(scrolled[0].index).toBeGreaterThan(1000);
  expect(Math.max(...scrolled.map((sample) => sample.distance))).toBeLessThan(2);
  for (let iteration = 0; iteration < 4; iteration += 1) {
    await page.evaluate(async () => {
      const editor = window.__semloRequireFixture("longLinesEditor").editor;
      const source = editor.state.doc.firstChild!.textContent;
      const position = source.indexOf("\n", Math.floor(source.length / 2));
      editor.view.dispatch(editor.state.tr.insertText("\n", position + 1));
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    const current = await samples();
    expect(current.length).toBeGreaterThan(0);
    expect(Math.max(...current.map((sample) => sample.distance))).toBeLessThan(2);
  }
  await page.evaluate(() => {
    delete (performance as unknown as { now?: () => number }).now;
  });
  await expect(host.locator(".semlo-editor-code-number-line")).toHaveCount(3004, { timeout: 15000 });
  await expect(host.locator(".semlo-editor-code-visible-numbers")).toHaveCount(0);
});

test("visible line numbers appear when a long block moves into view without scrolling", async ({ page }) => {
  const host = await mount(page);
  await host.evaluate((element) => ((element as HTMLElement).style.marginTop = "3000px"));
  await page.evaluate(() => {
    const original = performance.now.bind(performance);
    let tick = 0;
    Object.defineProperty(performance, "now", { configurable: true, value: () => original() + tick++ * 20 });
  });
  const text = Array.from({ length: 1800 }, (_, index) => `${index}: ${"code ".repeat(20)}`).join("\n");
  await replaceCode(page, text);
  await expect(host.locator(".semlo-editor-code-visible-numbers")).toHaveCount(1);
  expect(await host.locator(".semlo-editor-code-visible-number").count()).toBe(0);
  await host.evaluate((element) => ((element as HTMLElement).style.marginTop = "0"));
  await expect(host.locator(".semlo-editor-code-visible-number").first()).toBeVisible();
  await page.evaluate(() => {
    delete (performance as unknown as { now?: () => number }).now;
  });
  await expect(host.locator(".semlo-editor-code-number-line")).toHaveCount(1800, { timeout: 15000 });
});

test("viewport overlay restores host colors and releases temporary listeners", async ({ page }) => {
  const host = await mount(page);
  await page.evaluate(() => {
    const original = performance.now.bind(performance);
    let tick = 0;
    Object.defineProperty(performance, "now", { configurable: true, value: () => original() + tick++ * 20 });
    const tracked = new Set<EventListenerOrEventListenerObject>();
    const originalAdd = document.addEventListener;
    const originalRemove = document.removeEventListener;
    document.addEventListener = function (
      this: Document,
      type: string,
      callback: EventListenerOrEventListenerObject | null,
      options?: boolean | AddEventListenerOptions,
    ) {
      if (type === "scroll" && callback && options === true) tracked.add(callback);
      return Reflect.apply(originalAdd, this, [type, callback, options]);
    } as typeof document.addEventListener;
    document.removeEventListener = function (
      this: Document,
      type: string,
      callback: EventListenerOrEventListenerObject | null,
      options?: boolean | EventListenerOptions,
    ) {
      if (type === "scroll" && callback && options === true) tracked.delete(callback);
      return Reflect.apply(originalRemove, this, [type, callback, options]);
    } as typeof document.removeEventListener;
    window.trackedLineScroll = tracked;
  });
  const numbers = host.locator(".semlo-editor-code-numbers");
  await numbers.evaluate((element) =>
    (element as HTMLElement).style.setProperty("color", "rgb(11, 22, 33)", "important"),
  );
  const initial = await page.evaluate(
    (text) => {
      const editor = window.__semloRequireFixture("longLinesEditor").editor;
      editor.view.focus();
      const size = editor.state.doc.firstChild!.content.size;
      editor.view.dispatch(editor.state.tr.insertText(text, 1, 1 + size));
      const numbers = document.querySelector<HTMLElement>("#long-lines-test .semlo-editor-code-numbers")!;
      return {
        color: getComputedStyle(numbers).color,
        hiddenFromAccessibility: numbers.getAttribute("aria-hidden"),
        editorFocused: document.activeElement === editor.view.dom,
      };
    },
    Array.from({ length: 1500 }, (_, index) => `${index}: ${"words ".repeat(20)}`).join("\n"),
  );
  expect(initial).toEqual({ color: "rgba(0, 0, 0, 0)", hiddenFromAccessibility: "true", editorFocused: true });
  await expect(host.locator(".semlo-editor-code-visible-number").first()).toBeVisible();
  await expect(host.locator(".semlo-editor-code-visible-number").first()).toHaveCSS("color", "rgb(11, 22, 33)");
  expect(await page.evaluate(() => window.__semloRequireFixture("trackedLineScroll").size)).toBe(1);
  await numbers.evaluate((element) => (element as HTMLElement).style.setProperty("color", "rgb(44, 55, 66)"));
  await expect(host.locator(".semlo-editor-code-visible-number").first()).toHaveCSS("color", "rgb(44, 55, 66)");
  await host.getByRole("button", { name: "收起代码块" }).click();
  await expect(host.locator(".semlo-editor-code-visible-numbers")).toHaveCount(0);
  expect(await page.evaluate(() => window.__semloRequireFixture("trackedLineScroll").size)).toBe(0);
  await expect(numbers).toHaveCSS("color", "rgb(44, 55, 66)");
  await host.getByRole("button", { name: "展开代码块" }).click();
  await expect(host.locator(".semlo-editor-code-visible-number").first()).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("trackedLineScroll").size)).toBe(1);
  await page.evaluate(() => {
    delete (performance as unknown as { now?: () => number }).now;
  });
  await expect(numbers.locator(".semlo-editor-code-number-line")).toHaveCount(1500, { timeout: 15000 });
  expect(await page.evaluate(() => window.__semloRequireFixture("trackedLineScroll").size)).toBe(0);
  expect(await numbers.evaluate((element) => (element as HTMLElement).style.getPropertyValue("color"))).toBe(
    "rgb(44, 55, 66)",
  );
  expect(await numbers.evaluate((element) => (element as HTMLElement).style.getPropertyPriority("color"))).toBe("");
  await page.evaluate(() => {
    const original = performance.now.bind(performance);
    let tick = 0;
    Object.defineProperty(performance, "now", { configurable: true, value: () => original() + tick++ * 20 });
    const editor = window.__semloRequireFixture("longLinesEditor").editor;
    editor.view.dispatch(editor.state.tr.insertText("Z", 2, 3));
  });
  await expect(host.locator(".semlo-editor-code-visible-number").first()).toBeVisible();
  expect(await page.evaluate(() => window.__semloRequireFixture("trackedLineScroll").size)).toBe(1);
  await page.evaluate(() => window.__semloRequireFixture("longLinesEditor").destroy());
  expect(await page.evaluate(() => window.__semloRequireFixture("trackedLineScroll").size)).toBe(0);
  await expect(page.locator(".semlo-editor-code-visible-numbers")).toHaveCount(0);
  await page.evaluate(() => {
    delete (performance as unknown as { now?: () => number }).now;
  });
});

test("updates, wrapping toggles, resize and zoom discard stale measurements without moving scroll", async ({
  page,
}) => {
  const host = await mount(page);
  const card = host.locator(".semlo-editor-code-card");
  const body = card.locator(".semlo-editor-code-body");
  const first = `${"x".repeat(40)}\n`.repeat(3000);
  const replacement = `${"y".repeat(81)}\n`.repeat(1500);
  expect(first.length).toBe(replacement.length);
  await page.evaluate(
    async ({ first, replacement }) => {
      const editor = window.__semloRequireFixture("longLinesEditor").editor;
      const set = (value: string) => {
        const size = editor.state.doc.firstChild!.content.size;
        editor.view.dispatch(editor.state.tr.insertText(value, 1, 1 + size));
      };
      set(first);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      set(replacement);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      editor.commands.updateAttributes("codeBlock", { wordWrap: false });
    },
    { first, replacement },
  );
  await expect(card).toHaveAttribute("data-code-wrap", "false");
  await expect(card.locator(".semlo-editor-code-number-line")).toHaveCount(0);
  await expect(card.locator(".semlo-editor-code-numbers")).toHaveText(
    Array.from({ length: 1501 }, (_, index) => String(index + 1)).join("\n"),
  );

  await page.addStyleTag({ content: "#long-lines-test .semlo-editor-code-body { max-height: 280px }" });
  await page.evaluate(() =>
    window.__semloRequireFixture("longLinesEditor").editor.commands.updateAttributes("codeBlock", { wordWrap: true }),
  );
  await expect(card.locator(".semlo-editor-code-number-line")).toHaveCount(1501, { timeout: 15000 });
  const before = await body.evaluate((element) => {
    element.scrollTop = Math.floor(element.scrollHeight / 2);
    return element.scrollTop;
  });
  expect(before).toBeGreaterThan(0);
  await host.evaluate((element) => {
    (element as HTMLElement).style.width = "260px";
    (element as HTMLElement).style.zoom = "0.75";
  });
  await expect
    .poll(
      async () => {
        const samples = await measureAlignment(page, [0, 1, 127, 128, 1499]);
        return Math.max(...samples.map((sample) => sample.distance));
      },
      { timeout: 15000 },
    )
    .toBeLessThan(2);
  const after = await body.evaluate((element) => element.scrollTop);
  expect(Math.abs(after - before)).toBeLessThan(2);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("longLinesEditor").editor.state.doc.firstChild?.textContent),
  ).toBe(replacement);
});

test("destroying a block cancels its scheduled gutter writes", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await mount(page);
  const result = await page.evaluate(async () => {
    const numbers = document.querySelector<HTMLElement>("#long-lines-test .semlo-editor-code-numbers")!;
    const replace = numbers.replaceChildren.bind(numbers);
    let destroyed = false;
    let lateWrites = 0;
    numbers.replaceChildren = (...nodes: (Node | string)[]) => {
      if (destroyed) lateWrites += 1;
      replace(...nodes);
    };
    const editor = window.__semloRequireFixture("longLinesEditor").editor;
    const text = `${"long line ".repeat(12)}\n`.repeat(3000);
    editor.view.dispatch(editor.state.tr.insertText(text, 1, 1 + editor.state.doc.firstChild!.content.size));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    destroyed = true;
    window.__semloRequireFixture("longLinesEditor").destroy();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return { lateWrites, connected: numbers.isConnected };
  });
  expect(result).toEqual({ lateWrites: 0, connected: false });
  expect(errors).toEqual([]);
});

test("scrolling between measurement frames keeps the final gutter aligned and preserves scroll", async ({ page }) => {
  const host = await mount(page);
  const body = host.locator(".semlo-editor-code-body");
  await page.addStyleTag({ content: "#long-lines-test .semlo-editor-code-body { max-height: 240px }" });
  const text = Array.from({ length: 2400 }, (_, index) => `${index}: ${"scrollable code ".repeat(7)}`).join("\n");
  await replaceCode(page, text);
  const expectedScroll = await body.evaluate(async (element) => {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    element.scrollTop = Math.floor(element.scrollHeight / 3);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    element.scrollTop = Math.floor(element.scrollHeight / 2);
    return element.scrollTop;
  });
  expect(expectedScroll).toBeGreaterThan(0);
  await expect(host.locator(".semlo-editor-code-number-line")).toHaveCount(2400, { timeout: 15000 });
  expect(Math.abs((await body.evaluate((element) => element.scrollTop)) - expectedScroll)).toBeLessThan(2);
  for (const sample of await measureAlignment(page, [0, 1, 127, 128, 1200, 2399]))
    expect(sample.distance).toBeLessThan(2);
});

test("mixed formatting, consecutive empty lines and a trailing newline stay aligned", async ({ page }) => {
  const host = await mount(page);
  await page.addStyleTag({ content: "#long-lines-test .semlo-editor-code-body { max-height: 440px }" });
  await page.evaluate(() => {
    const original = performance.now.bind(performance);
    let tick = 0;
    Object.defineProperty(performance, "now", { configurable: true, value: () => original() + tick++ * 20 });
  });
  const lines = Array.from({ length: 300 }, (_, index) =>
    index % 10 === 3 || index % 10 === 4 ? "" : `const value${index} = "${"wide text ".repeat(9)}"`,
  );
  lines.push("", "");
  const fragments: Array<{
    type: "text";
    text: string;
    marks?: Array<{ type: "textStyle"; attrs: { color: string } }>;
  }> = [];
  for (const [index, line] of lines.entries()) {
    const end = index + 1 < lines.length ? "\n" : "";
    if (line) {
      fragments.push({
        type: "text",
        text: line.slice(0, 5),
        marks: [{ type: "textStyle", attrs: { color: "#713939" } }],
      });
      fragments.push({ type: "text", text: line.slice(5) + end });
    } else if (end) fragments.push({ type: "text", text: end });
  }
  await page.evaluate((fragments) => {
    window.__semloRequireFixture("longLinesEditor").setContent({
      type: "doc",
      content: [{ type: "codeBlock", attrs: { language: "javascript", wordWrap: true }, content: fragments }],
    });
  }, fragments);
  await expect(host.locator(".semlo-editor-code-visible-number").first()).toBeVisible();
  const firstVisible = await measureVisibleAlignment(page);
  expect(firstVisible.some(({ index }) => index === 3)).toBe(true);
  expect(firstVisible.map(({ index }) => index)).toContain(4);
  expect(Math.max(...firstVisible.map(({ distance }) => distance))).toBeLessThan(2);
  await host.locator("pre code").evaluate((element) => ((element as HTMLElement).style.fontSize = "18px"));
  await expect(host.locator(".semlo-editor-code-visible-number").first()).toBeVisible();
  const resizedFont = await measureVisibleAlignment(page);
  expect(Math.max(...resizedFont.map(({ distance }) => distance))).toBeLessThan(2);
  await host.locator(".semlo-editor-code-body").evaluate(async (element) => {
    element.scrollTop = element.scrollHeight;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  const lastVisible = await measureVisibleAlignment(page);
  expect(lastVisible.some(({ index }) => index === lines.length - 1)).toBe(true);
  expect(Math.max(...lastVisible.map(({ distance }) => distance))).toBeLessThan(2);
  await page.evaluate(() => {
    delete (performance as unknown as { now?: () => number }).now;
  });
  await expect(host.locator(".semlo-editor-code-number-line")).toHaveCount(lines.length, { timeout: 15000 });
  const codeNodeCount = await host.locator("pre code").evaluate((code) => {
    const walker = document.createTreeWalker(code, NodeFilter.SHOW_TEXT);
    let count = 0;
    while (walker.nextNode()) count += 1;
    return count;
  });
  expect(codeNodeCount).toBeGreaterThan(300);
  const indexes = [0, 3, 4, 5, 127, 128, 299, 300, 301];
  const samples = await measureAlignment(page, indexes);
  for (const [index, sample] of samples.entries()) {
    expect(sample.label).toBe(String(indexes[index] + 1));
    expect(sample.distance).toBeLessThan(2);
  }
});
