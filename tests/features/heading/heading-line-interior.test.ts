import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/heading/heading-line-interior-fixture";
let origin = "",
  stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const r = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/heading/heading-line-interior-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const s = await r.startDevServer();
  origin = `http://127.0.0.1:${s.port}`;
  stop = () => s.server.close();
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => installFixtureGuards(page));
async function mount(
  page: Page,
  single: boolean,
  numbered: boolean,
  bold: boolean,
  order: "early" | "late" = "early",
  customText?: string,
) {
  const text = customText ?? (single ? "ABCDEFGHIJ" : "ABCDEFGHIJKLMNOPQRSTUVWXYZ".repeat(4));
  const content: JSONContent = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 3, semloEditorHeadingNumbering: numbered ? "mixed" : null },
        content: [{ type: "text", text, ...(bold ? { marks: [{ type: "bold" }] } : {}) }],
      },
      { type: "paragraph", content: [{ type: "text", text: "NEXT" }] },
    ],
  };
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountLineInterior === "function");
  await page.evaluate(({ content, order }) => window.__semloRequireFixture("mountLineInterior")(content, order), {
    content,
    order,
  });
  await page.evaluate(() => window.__semloRequireFixture("lineInterior").settle());
  return page.evaluate(() => {
    const editor = window.__semloRequireFixture("lineInterior").controller.editor,
      view = editor.view,
      heading = view.dom.querySelector("h3")!;
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && node.parentElement?.closest('[contenteditable="false"]')) node = walker.nextNode();
    if (!node?.textContent) throw new Error("missing text");
    const rows: Array<Array<{ from: number; to: number; left: number; right: number; top: number; bottom: number }>> =
      [];
    for (const part of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(node.textContent)) {
      const i = part.index,
        end = i + part.segment.length;
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, end);
      const b = r.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      let row = rows.find((value) => Math.abs(value[0].top - b.top) < 1);
      if (!row) rows.push((row = []));
      row.push({
        from: view.posAtDOM(node, i),
        to: view.posAtDOM(node, end),
        left: b.left,
        right: b.right,
        top: b.top,
        bottom: b.bottom,
      });
    }
    return {
      json: editor.getJSON(),
      text: editor.state.doc.firstChild!.textContent,
      rows: rows.map((row) => {
        const target = row[Math.floor((row.length - 1) / 2)];
        return {
          from: row[0].from,
          to: row.at(-1)!.to,
          glyphs: row.length,
          x: target.left + (target.right - target.left) * 0.25,
          y: (target.top + target.bottom) / 2,
        };
      }),
    };
  });
}
async function read(page: Page) {
  return page.evaluate(() => {
    const f = window.__semloRequireFixture("lineInterior"),
      e = f.controller.editor,
      s = document.getSelection();
    return {
      json: e.getJSON(),
      first: e.state.doc.firstChild?.textContent,
      last: e.state.doc.lastChild?.textContent,
      keys: f.keys,
      events: f.events.map((event) => ({ trusted: event.isTrusted, prevented: event.defaultPrevented })),
      rejections: f.rejections(),
      focused: e.view.hasFocus(),
      pm: e.state.selection.toJSON(),
      native: s?.anchorNode
        ? {
            anchor: e.view.posAtDOM(s.anchorNode, s.anchorOffset),
            head: s.focusNode ? e.view.posAtDOM(s.focusNode, s.focusOffset) : null,
          }
        : null,
    };
  });
}
for (const numbered of [false, true])
  for (const bold of [false, true])
    for (const where of ["single", "first", "middle", "last"] as const) {
      test(`direct Shift+End: ${numbered ? "numbered" : "ordinary"} ${bold ? "bold" : "plain"} ${where} visual line`, async ({
        page,
      }) => {
        const single = where === "single";
        let customText: string | undefined;
        let before = await mount(page, single, numbered, bold);
        if (where === "last") {
          for (let extra = 1; before.rows.at(-1)!.glyphs < 4 && extra <= 8; extra++) {
            customText = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".repeat(4) + "Z".repeat(extra);
            before = await mount(page, false, numbered, bold, "early", customText);
          }
          expect(before.rows.at(-1)!.glyphs).toBeGreaterThanOrEqual(4);
        }
        expect(single ? before.rows.length === 1 : before.rows.length >= 3).toBe(true);
        const index =
            single || where === "first"
              ? 0
              : where === "last"
                ? before.rows.length - 1
                : Math.floor(before.rows.length / 2),
          row = before.rows[index];
        await page.mouse.click(row.x, row.y);
        const native = await page.evaluate(() => {
          const f = window.__semloRequireFixture("lineInterior"),
            view = f.controller.editor.view,
            s = document.getSelection()!;
          s.modify("extend", "forward", "lineboundary");
          return {
            anchor: s.anchorNode ? view.posAtDOM(s.anchorNode, s.anchorOffset) : null,
            head: s.focusNode ? view.posAtDOM(s.focusNode, s.focusOffset) : null,
            text: s.toString(),
          };
        });
        expect(native.anchor).not.toBe(native.head);
        expect(native.text).not.toContain("NEXT");
        const again = await mount(page, single, numbered, bold, "early", customText),
          target = again.rows[index];
        await page.mouse.click(target.x, target.y);
        await page.keyboard.press("Shift+End");
        await page.keyboard.press("Backspace");
        await page.evaluate(() => window.__semloRequireFixture("lineInterior").settle());
        const after = await read(page),
          trace = after.keys.find((entry) => entry.key === "Backspace")!;
        expect(trace.trusted).toBe(true);
        expect({ anchor: trace.anchor, head: trace.head, text: trace.text }).toEqual(native);
        expect(after.events).toEqual([{ trusted: true, prevented: true }]);
        expect(after.json).toEqual(trace.expected);
        expect(after.last).toBe("NEXT");
        expect(after.focused).toBe(true);
        await page.keyboard.press("ControlOrMeta+z");
        expect((await read(page)).json).toEqual(again.json);
      });
    }
for (const numbered of [false, true])
  for (const order of ["early", "late"] as const)
    for (const single of [false, true]) {
      test(`host rejects direct Shift+End without moving a freshly clicked ${numbered ? "numbered" : "ordinary"} ${single ? "single" : "multi"} caret (${order})`, async ({
        page,
      }) => {
        const before = await mount(page, single, numbered, false, order),
          row = before.rows[single ? 0 : 1];
        const end = await page.evaluate(async () => {
          const f = window.__semloRequireFixture("lineInterior"),
            e = f.controller.editor;
          const pos = e.state.doc.content.size - 1;
          e.commands.setTextSelection(pos);
          e.view.focus();
          await f.settle();
          f.reject();
          return pos;
        });
        await page.mouse.click(row.x, row.y);
        await page.keyboard.press("Shift+End");
        await page.keyboard.type("X");
        await page.evaluate(() => window.__semloRequireFixture("lineInterior").settle());
        const after = await read(page),
          key = after.keys[0];
        expect(key.key).toBe("End");
        expect(key.anchor).toBeGreaterThan(row.from);
        expect(key.anchor).toBeLessThan(row.to);
        expect(after.rejections).toBeGreaterThan(0);
        expect(after.events).toEqual([{ trusted: true, prevented: true }]);
        expect(after.first).toBe(`${before.text.slice(0, key.anchor! - 1)}X${before.text.slice(key.anchor! - 1)}`);
        expect(after.last).toBe("NEXT");
        expect(after.focused).toBe(true);
        await page.keyboard.press("ControlOrMeta+z");
        expect((await read(page)).json).toEqual(before.json);
        expect(end).toBeGreaterThan(row.to);
      });
    }

for (const numbered of [false, true])
  for (const bold of [false, true]) {
    test(`single-line Home then Shift+End preserves following content: ${numbered ? "numbered" : "ordinary"} ${bold ? "bold" : "plain"}`, async ({
      page,
    }) => {
      const before = await mount(page, true, numbered, bold);
      const row = before.rows[0];
      await page.mouse.click(row.x, row.y);
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+End");
      await page.keyboard.press("Backspace");
      await page.evaluate(() => window.__semloRequireFixture("lineInterior").settle());
      const after = await read(page);
      const trace = after.keys.find((entry) => entry.key === "Backspace")!;
      expect(trace).toMatchObject({ anchor: row.from, head: row.to, text: before.text, trusted: true });
      expect(after.json).toEqual(trace.expected);
      expect(after.last).toBe("NEXT");
      expect(after.focused).toBe(true);
      await page.keyboard.press("ControlOrMeta+z");
      expect((await read(page)).json).toEqual(before.json);
    });
  }

for (const numbered of [false, true])
  for (const bold of [false, true]) {
    for (const sample of [
      { name: "combining and emoji", text: "ABC e\u0301 👩‍💻 DEF", single: true },
      { name: "collapsed spaces", text: "ABC   DEF  GHI  ", single: true },
      { name: "wrapped spaces", text: "alpha   beta gamma delta  ".repeat(5), single: false },
    ] as const) {
      test(`direct Shift+End ${sample.name}: ${numbered ? "numbered" : "ordinary"} ${bold ? "bold" : "plain"}`, async ({
        page,
      }) => {
        const first = await mount(page, sample.single, numbered, bold, "early", sample.text);
        const index = sample.single ? 0 : Math.floor(first.rows.length / 2);
        if (!sample.single) expect(first.rows.length).toBeGreaterThanOrEqual(3);
        const point = first.rows[index];
        await page.mouse.click(point.x, point.y);
        const native = await page.evaluate(() => {
          const view = window.__semloRequireFixture("lineInterior").controller.editor.view;
          const selection = document.getSelection()!;
          selection.modify("extend", "forward", "lineboundary");
          const anchor = selection.anchorNode ? view.posAtDOM(selection.anchorNode, selection.anchorOffset) : null;
          const head = selection.focusNode ? view.posAtDOM(selection.focusNode, selection.focusOffset) : null;
          return {
            anchor,
            head,
            text:
              anchor !== null && head !== null
                ? view.state.doc.textBetween(Math.min(anchor, head), Math.max(anchor, head))
                : null,
          };
        });
        expect(native.anchor).not.toBe(native.head);
        const before = await mount(page, sample.single, numbered, bold, "early", sample.text);
        const target = before.rows[index];
        await page.mouse.click(target.x, target.y);
        await page.keyboard.press("Shift+End");
        await page.keyboard.press("Backspace");
        await page.evaluate(() => window.__semloRequireFixture("lineInterior").settle());
        const after = await read(page);
        const trace = after.keys.find((entry) => entry.key === "Backspace")!;
        expect({ anchor: trace.anchor, head: trace.head, text: trace.text }).toEqual(native);
        expect(after.events).toEqual([{ trusted: true, prevented: true }]);
        expect(after.json).toEqual(trace.expected);
        expect(after.last).toBe("NEXT");
        const boundaries = new Set([
          0,
          ...Array.from(
            new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(sample.text),
            (part) => part.index + part.segment.length,
          ),
        ]);
        expect(boundaries.has(trace.anchor! - 1)).toBe(true);
        expect(boundaries.has(trace.head! - 1)).toBe(true);
        await page.keyboard.press("ControlOrMeta+z");
        expect((await read(page)).json).toEqual(before.json);
      });
    }
  }

for (const single of [false, true])
  for (const start of [false, true]) {
    test(`synthetic AltGraph ${single ? "single" : "multi"} ${start ? "line start retains prior handling" : "interior declines new handling"}`, async ({
      page,
    }) => {
      const mounted = await mount(page, single, false, false);
      const position = start ? mounted.rows[0].from : mounted.rows[single ? 0 : 1].from + 2;
      const result = await page.evaluate(async (position) => {
        const fixture = window.__semloRequireFixture("lineInterior");
        const editor = fixture.controller.editor;
        editor.commands.setTextSelection(position);
        editor.view.focus();
        await fixture.settle();
        const before = editor.getJSON();
        const event = new KeyboardEvent("keydown", { key: "End", shiftKey: true, bubbles: true, cancelable: true });
        Object.defineProperty(event, "getModifierState", { value: (key: string) => key === "AltGraph" });
        editor.view.dom.dispatchEvent(event);
        return {
          prevented: event.defaultPrevented,
          before,
          after: editor.getJSON(),
          selection: editor.state.selection.toJSON(),
        };
      }, position);
      expect(result.after).toEqual(result.before);
      expect(result.prevented).toBe(start);
      if (!start) expect(result.selection).toMatchObject({ anchor: position, head: position });
    });
  }

for (const numbered of [false, true]) {
  test(`direct Shift+End crosses combining and emoji marks without splitting them: ${numbered ? "numbered" : "ordinary"}`, async ({
    page,
  }) => {
    await page.goto(origin);
    await page.waitForFunction(() => typeof window.mountLineInterior === "function");
    const content: JSONContent = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 3, semloEditorHeadingNumbering: numbered ? "mixed" : null },
          content: [
            { type: "text", text: "ABe", marks: [{ type: "bold" }] },
            { type: "text", text: "\u0301", marks: [{ type: "italic" }] },
            { type: "text", text: "👩", marks: [{ type: "bold" }] },
            { type: "text", text: "\u200d💻", marks: [{ type: "italic" }] },
            { type: "text", text: "DEF" },
          ],
        },
        { type: "paragraph", content: [{ type: "text", text: "NEXT" }] },
      ],
    };
    await page.evaluate((value) => window.__semloRequireFixture("mountLineInterior")(value, "early"), content);
    await page.evaluate(() => window.__semloRequireFixture("lineInterior").settle());
    const before = await read(page);
    const point = await page.evaluate(() => {
      const view = window.__semloRequireFixture("lineInterior").controller.editor.view;
      const a = view.domAtPos(2),
        b = view.domAtPos(3),
        range = document.createRange();
      range.setStart(a.node, a.offset);
      range.setEnd(b.node, b.offset);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width * 0.2, y: (rect.top + rect.bottom) / 2 };
    });
    await page.mouse.click(point.x, point.y);
    await page.keyboard.press("Shift+End");
    await page.keyboard.press("Backspace");
    await page.evaluate(() => window.__semloRequireFixture("lineInterior").settle());
    const after = await read(page),
      trace = after.keys.find((entry) => entry.key === "Backspace")!;
    expect(trace).toMatchObject({ anchor: 2, text: "Be\u0301👩‍💻DEF" });
    expect(after.events).toEqual([{ trusted: true, prevented: true }]);
    expect(after.json).toEqual(trace.expected);
    expect(after.last).toBe("NEXT");
    await page.keyboard.press("ControlOrMeta+z");
    expect((await read(page)).json).toEqual(before.json);
  });
}

for (const numbered of [false, true])
  for (const position of [6, 7]) {
    test(`real mouse hardBreak ${position === 6 ? "line end" : "empty middle line"} preserves following content: ${numbered ? "numbered" : "ordinary"}`, async ({
      page,
    }) => {
      await page.goto(origin);
      await page.waitForFunction(() => typeof window.mountLineInterior === "function");
      const content: JSONContent = {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 3, semloEditorHeadingNumbering: numbered ? "mixed" : null },
            content: [
              { type: "text", text: "alpha" },
              { type: "hardBreak" },
              { type: "hardBreak" },
              { type: "text", text: "beta" },
            ],
          },
          { type: "paragraph", content: [{ type: "text", text: "NEXT" }] },
        ],
      };
      await page.evaluate((value) => window.__semloRequireFixture("mountLineInterior")(value, "early"), content);
      await page.evaluate(() => window.__semloRequireFixture("lineInterior").settle());
      const before = await read(page);
      const target = await page.evaluate((position) => {
        const view = window.__semloRequireFixture("lineInterior").controller.editor.view;
        const rect = view.coordsAtPos(position, 1);
        return {
          point: { x: rect.left + 1, y: (rect.top + rect.bottom) / 2 },
          expected: view.state.tr.delete(position - 1, position).doc.toJSON(),
        };
      }, position);
      await page.mouse.click(target.point.x, target.point.y);
      await page.keyboard.press("Shift+End");
      await page.keyboard.press("Backspace");
      await page.evaluate(() => window.__semloRequireFixture("lineInterior").settle());
      const after = await read(page),
        end = after.keys.find((entry) => entry.key === "End")!,
        backspace = after.keys.find((entry) => entry.key === "Backspace")!;
      expect(end.anchor).toBe(position);
      expect(backspace).toMatchObject({ anchor: position, head: position, text: "" });
      expect(after.events).toEqual([{ trusted: true, prevented: true }]);
      expect(after.json).toEqual(target.expected);
      expect(after.last).toBe("NEXT");
      await page.keyboard.press("ControlOrMeta+z");
      expect((await read(page)).json).toEqual(before.json);
    });
  }
