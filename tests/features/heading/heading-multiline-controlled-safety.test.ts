import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/heading/heading-delete-controlled-fixture";
import type { RestartFramework } from "../../fixtures/list/ordered-restart-controlled-fixture";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

type MultilineTrace = {
  empty: boolean;
  text: string;
  from: number | null;
  to: number | null;
  pmEmpty: boolean;
  pmFrom: number;
  pmTo: number;
  start: number | null;
  expected: unknown;
};

declare global {
  interface Window {
    __headingMultilineTrace?: MultilineTrace[];
  }
}

let origin: string;
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/heading/heading-delete-controlled-fixture.ts", {
    framework: true,
  }));
});
afterAll(async () => stop?.());

type BreakCase = {
  name: string;
  heading: string;
  clickText: string;
  selected: string;
  from: number;
  to: number;
  headingMarks?: readonly string[];
  grapheme?: string;
};
// These are data-preservation expectations, not observed Yuque behavior.
const breakCases: BreakCase[] = [
  {
    name: "first visual line before a soft break",
    heading: "alpha<br>beta",
    clickText: "alpha",
    selected: "alpha",
    from: 0,
    to: 5,
  },
  {
    name: "second visual line after a soft break",
    heading: "alpha<br>beta",
    clickText: "beta",
    selected: "beta",
    from: 6,
    to: 10,
  },
  {
    name: "combining accent across marks before a soft break",
    heading: "A<strong>e</strong><em>\u0301</em>B<br>tail",
    clickText: "A",
    selected: "Ae\u0301B",
    from: 0,
    to: 4,
    headingMarks: ["bold", "italic"],
    grapheme: "e\u0301",
  },
  {
    name: "emoji ZWJ across marks before a soft break",
    heading: "A<strong>👩</strong><em>\u200d💻</em>B<br>tail",
    clickText: "A",
    selected: "A👩‍💻B",
    from: 0,
    to: 7,
    headingMarks: ["bold", "italic"],
    grapheme: "👩‍💻",
  },
  {
    name: "variation and ZWJ across marks before a soft break",
    heading: "A<strong>🏳️</strong><em>\u200d🌈</em>B<br>tail",
    clickText: "A",
    selected: "A🏳️‍🌈B",
    from: 0,
    to: 8,
    headingMarks: ["bold", "italic"],
    grapheme: "🏳️‍🌈",
  },
];
const wrapText = "一二三四五六七八九十".repeat(10);

async function mount(page: Page, framework: RestartFramework, heading: string, width?: number) {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountRestartControlledFixture === "function");
  await page.evaluate(
    (name) => window.__semloRequireFixture("mountRestartControlledFixture")(name, "legacy"),
    framework,
  );
  await page.evaluate(
    (html) => window.__semloRequireFixture("restartControlledFixture").setContent(html),
    `<h3>${heading}</h3><p><strong>next</strong> text</p>`,
  );
  if (width)
    await page.evaluate((value) => {
      const host = document.querySelector<HTMLElement>("#restart-controlled-fixture");
      if (!host) throw new Error("Missing controlled editor host");
      host.style.width = `${value}px`;
    }, width);
  await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
  await page.evaluate(() => window.__semloRequireFixture("closeHeadingDeleteHistory")());
}

async function read(page: Page) {
  return page.evaluate(() => {
    const fixture = window.__semloRequireFixture("restartControlledFixture");
    const editor = fixture.controller.editor;
    const selection = editor.state.selection;
    const native = window.getSelection();
    const fragment = native?.rangeCount ? native.getRangeAt(0).cloneContents() : null;
    fragment
      ?.querySelectorAll('[contenteditable="false"], .semlo-editor-heading-number')
      .forEach((node) => node.remove());
    return {
      snapshot: fixture.controller.getSnapshot(),
      selection: {
        empty: selection.empty,
        anchorType: selection.$anchor.parent.type.name,
        anchorOffset: selection.$anchor.parentOffset,
        headType: selection.$head.parent.type.name,
        headOffset: selection.$head.parentOffset,
      },
      domSelection: { empty: native?.isCollapsed ?? true, text: fragment?.textContent ?? "" },
      focused: editor.view.hasFocus(),
      changes: fixture.changes,
      documentChanges: fixture.documentChanges,
      errors: fixture.errors,
    };
  });
}

async function expectedDocument(page: Page, from: number, to: number) {
  return page.evaluate(
    ({ from, to }) => {
      const editor = window.__semloRequireFixture("restartControlledFixture").controller.editor;
      const doc = editor.state.doc;
      const heading = doc.firstChild;
      if (!heading || heading.type.name !== "heading") throw new Error("Missing root heading");
      const replacement = heading.copy(heading.content.cut(0, from).append(heading.content.cut(to)));
      const snapshot = window.__semloRequireFixture("restartControlledFixture").controller.getSnapshot().json;
      if (!snapshot.content?.[0]) throw new Error("Missing snapshot heading");
      snapshot.content[0].content = replacement.toJSON().content;
      return snapshot;
    },
    { from, to },
  );
}

async function clickTextPosition(page: Page, text: string) {
  return page.evaluate((needle) => {
    const heading = document.querySelector("#restart-controlled-fixture .semlo-editor-prose > h3");
    if (!heading) throw new Error("Missing heading DOM");
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (parent?.closest('[contenteditable="false"]')) continue;
      const offset = node.textContent?.indexOf(needle) ?? -1;
      if (offset < 0) continue;
      const range = document.createRange();
      range.setStart(node, offset);
      range.setEnd(node, offset + 1);
      const rect = range.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) throw new Error("Target has no text bounds");
      return { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
    }
    throw new Error("Missing target text");
  }, text);
}

async function wrappedLine(page: Page) {
  return page.evaluate(() => {
    const heading = document.querySelector("#restart-controlled-fixture .semlo-editor-prose > h3");
    if (!heading) throw new Error("Missing heading DOM");
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.parentElement?.closest('[contenteditable="false"]')) nodes.push(node as Text);
    }
    if (nodes.length !== 1) throw new Error("Expected a single plain text node for wrap geometry");
    const text = nodes[0].data;
    const ranges = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)].map((part) => {
      const range = document.createRange();
      range.setStart(nodes[0], part.index);
      range.setEnd(nodes[0], part.index + part.segment.length);
      const rect = range.getBoundingClientRect();
      return {
        start: part.index,
        end: part.index + part.segment.length,
        text: part.segment,
        left: rect.left,
        right: rect.right,
        x: (rect.left + rect.right) / 2,
        y: (rect.top + rect.bottom) / 2,
        top: rect.top,
      };
    });
    if (ranges.some((range) => !Number.isFinite(range.x) || !Number.isFinite(range.y)))
      throw new Error("Missing glyph geometry");
    const firstTop = ranges[0].top;
    const lineHeight = Number.parseFloat(getComputedStyle(heading).lineHeight);
    if (!Number.isFinite(lineHeight) || lineHeight <= 0) throw new Error("Missing line height");
    const rows = new Map<number, typeof ranges>();
    for (const range of ranges) {
      const row = Math.round((range.top - firstTop) / lineHeight);
      const list = rows.get(row) ?? [];
      list.push(range);
      rows.set(row, list);
    }
    const line = rows.get(1);
    if (!line || rows.size < 3) throw new Error(`Expected at least three visual lines, got ${rows.size}`);
    const middle = line[Math.floor(line.length / 2)];
    return {
      from: line[0].start,
      to: line[line.length - 1].end,
      selected: line.map((part) => part.text).join(""),
      click: { x: middle.x, y: middle.y },
      upper: {
        x: Math.min(rows.get(0)!.at(-1)!.right + 4, heading.getBoundingClientRect().right - 1),
        y: rows.get(0)![0].y,
      },
      lower: { x: line[0].left + 0.5, y: line[0].y },
    };
  });
}

async function captureBackspace(page: Page) {
  await page.evaluate(() => {
    const trace: MultilineTrace[] = [];
    let start: number | null = null;
    window.__headingMultilineTrace = trace;
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Backspace" && !(event.key === "End" && event.shiftKey)) return;
        const native = window.getSelection();
        const range = native?.rangeCount ? native.getRangeAt(0) : null;
        const fragment = range?.cloneContents();
        fragment
          ?.querySelectorAll('[contenteditable="false"], .semlo-editor-heading-number')
          .forEach((node) => node.remove());
        const editor = window.__semloRequireFixture("restartControlledFixture").controller.editor;
        const selection = editor.state.selection;
        if (event.key === "End") {
          start = native?.anchorNode ? editor.view.posAtDOM(native.anchorNode, native.anchorOffset) : null;
          return;
        }
        const expected = window.__semloRequireFixture("restartControlledFixture").controller.getSnapshot().json;
        const heading = editor.state.tr.delete(selection.from, selection.to).doc.firstChild;
        if (!expected.content?.[0] || !heading || heading.type.name !== "heading") throw new Error("Missing heading");
        expected.content[0].content = heading.toJSON().content;
        trace.push({
          empty: native?.isCollapsed ?? true,
          text: fragment?.textContent ?? "",
          from: range ? editor.view.posAtDOM(range.startContainer, range.startOffset) : null,
          to: range ? editor.view.posAtDOM(range.endContainer, range.endOffset) : null,
          pmEmpty: selection.empty,
          pmFrom: selection.from,
          pmTo: selection.to,
          start,
          expected,
        });
      },
      { capture: true },
    );
  });
}

async function runScenario(page: Page, framework: RestartFramework, scenario: BreakCase | "wrap") {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const isWrap = scenario === "wrap";
  await mount(page, framework, isWrap ? wrapText : scenario.heading, isWrap ? 300 : undefined);
  const before = await read(page);
  expect(before.changes).toHaveLength(0);
  const heading = before.snapshot.json.content?.[0];
  expect(heading).toMatchObject({ type: "heading", attrs: { level: 3 } });
  expect(before.snapshot.json.content?.[1]).toMatchObject({ type: "paragraph" });
  const followingMarks =
    before.snapshot.json.content?.[1]?.content?.flatMap((node) => node.marks?.map((mark) => mark.type) ?? []) ?? [];
  expect(followingMarks).toContain("bold");
  if (!isWrap) {
    const marks = heading?.content?.flatMap((node) => node.marks?.map((mark) => mark.type) ?? []) ?? [];
    expect(marks).toEqual(expect.arrayContaining([...(scenario.headingMarks ?? [])]));
    if (scenario.grapheme) {
      const segments = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(scenario.selected)].map(
        (part) => part.segment,
      );
      expect(segments).toContain(scenario.grapheme);
    }
  }
  const line = isWrap
    ? await wrappedLine(page)
    : {
        from: scenario.from,
        to: scenario.to,
        selected: scenario.selected,
        click: await clickTextPosition(page, scenario.clickText),
      };
  const expected = await expectedDocument(page, line.from, line.to);
  await captureBackspace(page);
  await page.mouse.click(line.click.x, line.click.y);
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.press("Backspace");
  await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
  const keydown = await page.evaluate(() => window.__semloRequireFixture("__headingMultilineTrace"));
  expect(keydown).toHaveLength(1);
  expect(keydown[0]).toMatchObject({
    empty: false,
    text: line.selected,
    from: 1 + line.from,
    to: 1 + line.to,
    pmEmpty: false,
    pmFrom: 1 + line.from,
    pmTo: 1 + line.to,
  });
  const removed = await read(page);
  expect(removed.snapshot.json).toEqual(expected);
  expect(removed.changes).toHaveLength(1);
  expect(removed.changes[0].json).toEqual(expected);
  expect(removed.documentChanges - before.documentChanges).toBe(1);
  expect(removed.focused).toBe(true);
  expect(removed.selection).toMatchObject({
    empty: true,
    anchorType: "heading",
    anchorOffset: line.from,
    headType: "heading",
    headOffset: line.from,
  });
  expect(removed.domSelection.empty).toBe(true);
  await page.keyboard.press("ControlOrMeta+z");
  await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
  const undone = await read(page);
  expect(undone.snapshot.json).toEqual(before.snapshot.json);
  expect(undone.selection).toMatchObject({
    empty: false,
    anchorType: "heading",
    anchorOffset: line.from,
    headType: "heading",
    headOffset: line.to,
  });
  expect(undone.domSelection).toEqual({ empty: false, text: line.selected });
  expect(undone.changes).toHaveLength(2);
  expect(undone.changes[1].json).toEqual(before.snapshot.json);
  expect(undone.focused).toBe(true);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
  const redone = await read(page);
  expect(redone.snapshot.json).toEqual(expected);
  expect(redone.selection).toEqual(removed.selection);
  expect(redone.changes).toHaveLength(3);
  expect(redone.changes[2].json).toEqual(expected);
  expect(redone.documentChanges - before.documentChanges).toBe(3);
  expect(redone.focused).toBe(true);
  expect(redone.errors).toEqual([]);
  expect(pageErrors).toEqual([]);
  await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").destroy());
}

for (const framework of ["react", "vue", "solid"] as const satisfies readonly RestartFramework[]) {
  for (const item of breakCases)
    test(`${framework}: safety expectation, ${item.name}`, async ({ page }) => runScenario(page, framework, item));
  test(`${framework}: safety expectation, an automatically wrapped middle visual line`, async ({ page }) =>
    runScenario(page, framework, "wrap"));
}

for (const framework of ["react", "vue", "solid"] as const satisfies readonly RestartFramework[]) {
  for (const mode of ["interior"] as const) {
    test(`${framework}: ${mode} selects only the current visual line and preserves controlled history`, async ({
      page,
    }) => {
      await mount(page, framework, wrapText, 300);
      const before = await read(page);
      const line = await wrappedLine(page);
      await captureBackspace(page);
      await page.mouse.click(line.click.x, line.click.y);
      await page.keyboard.press("Shift+End");
      await page.keyboard.press("Backspace");
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      const captures = await page.evaluate(() => window.__semloRequireFixture("__headingMultilineTrace"));
      expect(captures).toHaveLength(1);
      const trace = captures[0];
      expect(trace.empty).toBe(false);
      expect(trace.pmEmpty).toBe(false);
      expect(trace.start).not.toBeNull();
      const from = trace.start!;
      expect(trace).toMatchObject({ from, to: 1 + line.to, pmFrom: from, pmTo: 1 + line.to });
      expect(trace.text).toBe(wrapText.slice(from - 1, line.to));
      const removed = await read(page);
      expect(removed.snapshot.json).toEqual(trace.expected);
      expect(removed.snapshot.json.content?.[1]).toEqual(before.snapshot.json.content?.[1]);
      expect(removed.changes).toHaveLength(1);
      expect(removed.changes[0].json).toEqual(trace.expected);
      expect(removed.focused).toBe(true);
      await page.keyboard.press("ControlOrMeta+z");
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      const undone = await read(page);
      expect(undone.snapshot.json).toEqual(before.snapshot.json);
      expect(undone.selection).toMatchObject({ empty: false, anchorOffset: from - 1, headOffset: line.to });
      expect(undone.changes).toHaveLength(2);
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      const redone = await read(page);
      expect(redone.snapshot.json).toEqual(trace.expected);
      expect(redone.changes).toHaveLength(3);
      expect(redone.errors).toEqual([]);
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").destroy());
    });
  }
}

for (const framework of ["react", "vue", "solid"] as const) {
  for (const side of ["upper", "lower"] as const) {
    test(`${framework} controlled content preserves the ${side} wrap boundary`, async ({ page }) => {
      await mount(page, framework, wrapText, 300);
      const line = await wrappedLine(page);
      const before = await read(page);
      await page.mouse.click(line[side].x, line[side].y);
      await page.keyboard.press("Shift+End");
      const selected = await read(page);
      expect(selected.domSelection.text).toBe(side === "upper" ? "" : line.selected);
      if (side === "lower") {
        const expected = await expectedDocument(page, line.from, line.to);
        await page.keyboard.press("Backspace");
        await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
        const after = await read(page);
        expect(after.snapshot.json).toEqual(expected);
        expect(after.changes.at(-1)?.json).toEqual(expected);
        await page.keyboard.press("ControlOrMeta+z");
        await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
        expect((await read(page)).snapshot.json).toEqual(before.snapshot.json);
      } else {
        await page.keyboard.type("X");
        await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
        const after = await read(page);
        const text = after.snapshot.json.content?.[0].content?.[0].text;
        expect(text).toBe(wrapText.slice(0, line.from) + "X" + wrapText.slice(line.from));
        expect(after.changes.at(-1)?.json).toEqual(after.snapshot.json);
      }
    });
  }
}
