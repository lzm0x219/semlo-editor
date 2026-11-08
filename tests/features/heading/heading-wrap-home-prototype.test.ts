import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/heading/heading-wrap-home-host-fixture";

for (const numbered of [false, true]) {
  for (const immediate of [false, true]) {
    test(`double Home and Shift+End preserve following content in ${numbered ? "numbered" : "ordinary"} wrapped heading ${immediate ? "immediate" : "settled"}`, async ({
      page,
    }) => {
      await mount(page, numbered, "normal", "early");
      const line = await secondLine(page);
      const before = await read(page);
      await page.mouse.click(line.x, line.y);
      await page.keyboard.press("Home");
      if (!immediate) await page.evaluate(() => window.__semloRequireFixture("wrapHome").settle());
      await page.keyboard.press("Home");
      if (!immediate) await page.evaluate(() => window.__semloRequireFixture("wrapHome").settle());
      await page.keyboard.press("Shift+End");
      if (!immediate) {
        const selected = await read(page);
        expect(selected.pm).toMatchObject({ anchor: line.from + 1, head: line.to + 1 });
        expect(selected.dom).toEqual({ anchor: line.from + 1, head: line.to + 1, text: line.text, collapsed: false });
      }
      await page.keyboard.press("Backspace");
      await page.evaluate(() => window.__semloRequireFixture("wrapHome").settle());
      expect((await read(page)).last).toBe("NEXT");
      await page.keyboard.press("ControlOrMeta+z");
      expect((await read(page)).json).toEqual(before.json);
    });
  }
}

declare global {
  interface Window {
    __homeRejectCaptures?: Array<{ native: number | null; pm: number; trusted: boolean }>;
    __hostImmediateCaptures?: Array<{ anchor: number; head: number; text: string; expected: unknown }>;
  }
}

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/heading/heading-wrap-home-host-fixture.ts"));
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

async function mount(
  page: Page,
  numbered: boolean,
  mode: "normal" | "reject" | "append-meta" | "append-selection" | "append-doc",
  order: "early" | "late",
) {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountWrapHome === "function");
  await page.evaluate(
    ({ numbered, mode, order }) => window.__semloRequireFixture("mountWrapHome")(numbered, mode, order),
    { numbered, mode, order },
  );
  await page.evaluate(() => window.__semloRequireFixture("wrapHome").settle());
}
async function secondLine(page: Page) {
  return page.evaluate(() => {
    const heading = document.querySelector("#heading-wrap-home-test h3")!;
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node && node.parentElement?.closest('[contenteditable="false"]')) node = walker.nextNode();
    if (!node?.textContent) throw new Error("Missing text");
    const rows: Array<
      Array<{
        from: number;
        to: number;
        text: string;
        rect: { left: number; right: number; top: number; bottom: number };
      }>
    > = [];
    for (const segment of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(node.textContent)) {
      const range = document.createRange();
      range.setStart(node, segment.index);
      range.setEnd(node, segment.index + segment.segment.length);
      const rect = range.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      let row = rows.find((current) => Math.abs(current[0].rect.top - rect.top) < 1);
      if (!row) rows.push((row = []));
      row.push({
        from: segment.index,
        to: segment.index + segment.segment.length,
        text: segment.segment,
        rect: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom },
      });
      if (rows.length > 2) break;
    }
    const line = rows[1];
    if (!line || line.length < 3) throw new Error("Missing second visual line");
    const middle = line[Math.floor(line.length / 2)].rect;
    return {
      from: line[0].from,
      to: line.at(-1)!.to,
      text: line.map((item) => item.text).join(""),
      x: (middle.left + middle.right) / 2,
      y: (middle.top + middle.bottom) / 2,
    };
  });
}
async function read(page: Page) {
  return page.evaluate(() => {
    const fixture = window.__semloRequireFixture("wrapHome");
    const editor = fixture.controller.editor;
    const native = document.getSelection();
    return {
      json: editor.getJSON(),
      last: editor.state.doc.lastChild?.textContent,
      pm: editor.state.selection.toJSON(),
      dom: native?.anchorNode
        ? {
            anchor: editor.view.posAtDOM(native.anchorNode, native.anchorOffset),
            head: native.focusNode ? editor.view.posAtDOM(native.focusNode, native.focusOffset) : null,
            text: native.toString(),
            collapsed: native.isCollapsed,
          }
        : null,
      events: fixture.events.map((event) => ({
        key: event.key,
        prevented: event.defaultPrevented,
        trusted: event.isTrusted,
      })),
      trace: [...fixture.trace],
      focused: editor.view.hasFocus(),
    };
  });
}
for (const numbered of [false, true]) {
  for (const immediate of [false, true]) {
    test(`${numbered ? "numbered" : "ordinary"} second visual line Home then Shift+End ${immediate ? "immediate" : "settled"}`, async ({
      page,
    }) => {
      await mount(page, numbered, "normal", "early");
      const line = await secondLine(page);
      await page.mouse.click(line.x, line.y);
      if (!immediate) await page.evaluate(() => window.__semloRequireFixture("wrapHome").settle());
      const before = await read(page);
      await page.keyboard.press("Home");
      if (!immediate) await page.evaluate(() => window.__semloRequireFixture("wrapHome").settle());
      await page.keyboard.press("Shift+End");
      await page.evaluate(() => window.__semloRequireFixture("wrapHome").settle());
      const selected = await read(page);
      expect(selected.events).toEqual([
        { key: "Home", prevented: true, trusted: true },
        { key: "End", prevented: true, trusted: true },
      ]);
      expect(selected.dom).toEqual({ anchor: line.from + 1, head: line.to + 1, text: line.text, collapsed: false });
      expect(selected.pm).toMatchObject({ anchor: line.from + 1, head: line.to + 1 });
      const expected = await page.evaluate(({ from, to }) => {
        const { state } = window.__semloRequireFixture("wrapHome").controller.editor;
        return state.tr.delete(from + 1, to + 1).doc.toJSON();
      }, line);
      await page.keyboard.press("Backspace");
      expect((await read(page)).json).toEqual(expected);
      await page.keyboard.press("ControlOrMeta+z");
      expect((await read(page)).json).toEqual(before.json);
    });
  }
}
for (const order of ["early", "late"] as const) {
  for (const mode of ["reject", "append-meta", "append-selection", "append-doc"] as const) {
    test(`${order} host ${mode} leaves no trusted Home hint`, async ({ page }) => {
      await mount(page, true, mode, order);
      const line = await secondLine(page);
      await page.mouse.click(line.x, line.y);
      await page.evaluate(() => window.__semloRequireFixture("wrapHome").settle());
      await page.evaluate(() => window.__semloRequireFixture("wrapHome").arm());
      const before = await read(page);
      await page.keyboard.press("Home");
      await page.evaluate(() => window.__semloRequireFixture("wrapHome").settle());
      const home = await read(page);
      expect(home.events[0]).toEqual({ key: "Home", prevented: true, trusted: true });
      expect(home.trace).toContain("filter");
      if (mode === "reject") {
        expect(home.json).toEqual(before.json);
        expect(home.pm).toEqual(before.pm);
        expect(home.dom).toEqual(before.dom);
      } else expect(home.trace).toContain("append");
      if (mode === "append-doc") expect(JSON.stringify(home.json)).toContain("NEXT!");
      await page.keyboard.press("Shift+End");
      await page.evaluate(() => window.__semloRequireFixture("wrapHome").settle());
      const after = await read(page);
      expect(after.json).toEqual(home.json);
      if (mode === "reject" || mode === "append-selection") {
        // The host's committed caret is now an unambiguous point inside the
        // line. A fresh geometry check may select from there without the hint.
        expect(home.dom?.collapsed).toBe(true);
        const anchor = home.dom!.anchor;
        expect(after.events[1]).toEqual({ key: "End", prevented: true, trusted: true });
        expect(after.dom).toMatchObject({
          anchor,
          head: line.to + 1,
          text: line.text.slice(anchor - line.from - 1),
          collapsed: false,
        });
        expect(after.pm).toMatchObject({ anchor, head: line.to + 1 });
        await page.keyboard.press("Backspace");
        expect((await read(page)).last).toBe("NEXT");
        await page.keyboard.press("ControlOrMeta+z");
        expect((await read(page)).json).toEqual(home.json);
      } else {
        expect(after.events[1]).toEqual({ key: "End", prevented: true, trusted: true });
        expect(after.dom).toMatchObject({
          anchor: line.from + 1,
          head: line.to + 1,
          text: line.text,
          collapsed: false,
        });
        await page.keyboard.press("Backspace");
        expect((await read(page)).last).toBe(mode === "append-doc" ? "NEXT!" : "NEXT");
        await page.keyboard.press("ControlOrMeta+z");
        expect((await read(page)).json).toEqual(home.json);
      }
    });
  }
}
for (const action of [
  "keyboard",
  "same-selection",
  "attribute",
  "cssom",
  "cssom-same-geometry",
  "media",
  "scroll",
  "blur",
] as const) {
  test(`wrapped Home hint invalidates after ${action}`, async ({ page }) => {
    await mount(page, false, "normal", "early");
    const line = await secondLine(page);
    if (action === "cssom" || action === "cssom-same-geometry")
      await page.addStyleTag({ content: "#heading-wrap-home-test h3 { color: black; }" });
    await page.mouse.click(line.x, line.y);
    await page.evaluate(() => window.__semloRequireFixture("wrapHome").settle());
    await page.keyboard.press("Home");
    await page.evaluate(() => window.__semloRequireFixture("wrapHome").settle());
    if (action === "keyboard") {
      await page.keyboard.press("ArrowRight");
      await page.keyboard.press("ArrowLeft");
    }
    if (action === "same-selection")
      await page.evaluate(() => {
        const editor = window.__semloRequireFixture("wrapHome").controller.editor;
        editor.commands.setTextSelection(editor.state.selection.anchor);
      });
    if (action === "attribute")
      await page.evaluate(() =>
        document.querySelector("#heading-wrap-home-test h3")!.setAttribute("data-host-change", "1"),
      );
    if (action === "cssom")
      await page.evaluate(() => {
        const sheet = document.styleSheets[document.styleSheets.length - 1];
        sheet.insertRule("#heading-wrap-home-test h3 { letter-spacing: 1px !important; }", sheet.cssRules.length);
      });
    if (action === "cssom-same-geometry") {
      const before = await page.evaluate(() => {
        const editor = window.__semloRequireFixture("wrapHome").controller.editor;
        const heading = editor.view.dom.querySelector("h3")!;
        const pos = editor.state.selection.anchor;
        const box = heading.getBoundingClientRect();
        const before = editor.view.coordsAtPos(pos, -1);
        const after = editor.view.coordsAtPos(pos, 1);
        return {
          family: getComputedStyle(heading).fontFamily,
          box: [box.left, box.right, box.top, box.bottom],
          before: [before.left, before.right, before.top, before.bottom],
          after: [after.left, after.right, after.top, after.bottom],
        };
      });
      await page.evaluate((family) => {
        const sheet = document.styleSheets[document.styleSheets.length - 1];
        sheet.insertRule(
          `#heading-wrap-home-test h3 { font-family: "SemloMissingAuditFont123", ${family} !important; }`,
          sheet.cssRules.length,
        );
      }, before.family);
      const after = await page.evaluate(() => {
        const editor = window.__semloRequireFixture("wrapHome").controller.editor;
        const heading = editor.view.dom.querySelector("h3")!;
        const pos = editor.state.selection.anchor;
        const box = heading.getBoundingClientRect();
        const before = editor.view.coordsAtPos(pos, -1);
        const after = editor.view.coordsAtPos(pos, 1);
        return {
          family: getComputedStyle(heading).fontFamily,
          box: [box.left, box.right, box.top, box.bottom],
          before: [before.left, before.right, before.top, before.bottom],
          after: [after.left, after.right, after.top, after.bottom],
        };
      });
      expect(after.family).not.toBe(before.family);
      expect({ box: after.box, before: after.before, after: after.after }).toEqual({
        box: before.box,
        before: before.before,
        after: before.after,
      });
    }
    if (action === "media") await page.emulateMedia({ colorScheme: "dark" });
    if (action === "scroll") await page.evaluate(() => window.scrollBy(0, 20));
    if (action === "blur")
      await page.evaluate(() => {
        const editor = window.__semloRequireFixture("wrapHome").controller.editor;
        editor.view.dom.blur();
        editor.view.focus();
      });
    let expected: { anchor: number | null; head: number | null; text: string } | null = null;
    if (action === "cssom")
      expected = await page.evaluate(() => {
        const view = window.__semloRequireFixture("wrapHome").controller.editor.view;
        const selection = document.getSelection()!;
        const original = selection.getRangeAt(0).cloneRange();
        selection.modify("extend", "forward", "lineboundary");
        const selected = {
          anchor: selection.anchorNode ? view.posAtDOM(selection.anchorNode, selection.anchorOffset) : null,
          head: selection.focusNode ? view.posAtDOM(selection.focusNode, selection.focusOffset) : null,
          text: selection.toString(),
        };
        selection.removeAllRanges();
        selection.addRange(original);
        return selected;
      });
    await page.keyboard.press("Shift+End");
    await page.evaluate(() => window.__semloRequireFixture("wrapHome").settle());
    const result = await read(page);
    if (action === "cssom") {
      expect(result.events.at(-1)).toEqual({ key: "End", prevented: true, trusted: true });
      expect(result.dom).toMatchObject({ ...expected, collapsed: false });
      expect(result.pm).toMatchObject({ anchor: expected?.anchor, head: expected?.head });
      await page.keyboard.press("Backspace");
      expect((await read(page)).last).toBe("NEXT");
      await page.keyboard.press("ControlOrMeta+z");
      expect((await read(page)).json).toEqual(result.json);
    } else if (result.events.at(-1)?.prevented) {
      expect(result.dom?.text).not.toContain("NEXT");
      expect(["", line.text]).toContain(result.dom?.text);
      if (result.dom?.text) {
        await page.keyboard.press("Backspace");
        expect((await read(page)).last).toBe("NEXT");
        await page.keyboard.press("ControlOrMeta+z");
        expect((await read(page)).json).toEqual(result.json);
      }
    }
  });
}

for (const numbered of [false, true]) {
  for (const order of ["early", "late"] as const) {
    test(`${order} rejected Home preserves an immediately clicked ${numbered ? "numbered" : "ordinary"} title caret`, async ({
      page,
    }) => {
      await mount(page, numbered, "reject", order);
      const line = await secondLine(page);
      const before = await page.evaluate(async () => {
        const fixture = window.__semloRequireFixture("wrapHome");
        const editor = fixture.controller.editor;
        const end = editor.state.doc.content.size - 1;
        editor.commands.setTextSelection(end);
        editor.view.focus();
        await fixture.settle();
        fixture.arm();
        const captures: Array<{ native: number | null; pm: number; trusted: boolean }> = [];
        window.__homeRejectCaptures = captures;
        editor.view.dom.addEventListener(
          "keydown",
          (event) => {
            if (event.key !== "Home") return;
            const native = document.getSelection();
            captures.push({
              native: native?.anchorNode ? editor.view.posAtDOM(native.anchorNode, native.anchorOffset) : null,
              pm: editor.state.selection.anchor,
              trusted: event.isTrusted,
            });
          },
          true,
        );
        return { end, text: editor.state.doc.firstChild!.textContent, json: editor.getJSON() };
      });
      await page.mouse.click(line.x, line.y);
      await page.keyboard.press("Home");
      await page.keyboard.type("X");
      await page.evaluate(() => window.__semloRequireFixture("wrapHome").settle());
      const after = await read(page);
      const observed = await page.evaluate(() => {
        const editor = window.__semloRequireFixture("wrapHome").controller.editor;
        return {
          captures: window.__semloRequireFixture("__homeRejectCaptures"),
          first: editor.state.doc.firstChild?.textContent,
          last: editor.state.doc.lastChild?.textContent,
        };
      });
      expect(observed.captures).toHaveLength(1);
      const caret = observed.captures[0];
      expect(caret.trusted).toBe(true);
      expect(caret.pm).toBe(before.end);
      expect(caret.native).toBeGreaterThan(line.from + 1);
      expect(caret.native).toBeLessThan(line.to + 1);
      expect(after.events[0]).toEqual({ key: "Home", prevented: true, trusted: true });
      expect(after.trace).toContain("filter");
      const insertion = caret.native! - 1;
      expect(observed.first).toBe(`${before.text.slice(0, insertion)}X${before.text.slice(insertion)}`);
      expect(observed.last).toBe("NEXT");
      expect(after.focused).toBe(true);
      await page.keyboard.press("ControlOrMeta+z");
      expect((await read(page)).json).toEqual(before.json);
    });
  }
}

for (const mode of ["reject", "append-selection"] as const)
  for (const order of ["early", "late"] as const) {
    test(`${order} ${mode} immediately continues from the committed caret`, async ({ page }) => {
      await mount(page, true, mode, order);
      const line = await secondLine(page);
      await page.mouse.click(line.x, line.y);
      await page.evaluate(() => window.__semloRequireFixture("wrapHome").settle());
      const before = await read(page);
      await page.evaluate(() => {
        const fixture = window.__semloRequireFixture("wrapHome"),
          editor = fixture.controller.editor;
        fixture.arm();
        const captured: Array<{ anchor: number; head: number; text: string; expected: unknown }> = [];
        window.__hostImmediateCaptures = captured;
        editor.view.dom.addEventListener(
          "keydown",
          (event) => {
            if (event.key !== "Backspace") return;
            const selection = document.getSelection();
            if (!selection?.anchorNode || !selection.focusNode) return;
            const anchor = editor.view.posAtDOM(selection.anchorNode, selection.anchorOffset),
              head = editor.view.posAtDOM(selection.focusNode, selection.focusOffset);
            const fragment = selection.getRangeAt(0).cloneContents();
            fragment.querySelectorAll('[contenteditable="false"]').forEach((node) => node.remove());
            captured.push({
              anchor,
              head,
              text: fragment.textContent ?? "",
              expected: editor.state.tr.delete(Math.min(anchor, head), Math.max(anchor, head)).doc.toJSON(),
            });
          },
          true,
        );
      });
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+End");
      await page.keyboard.press("Backspace");
      await page.evaluate(() => window.__semloRequireFixture("wrapHome").settle());
      const after = await read(page);
      const captured = await page.evaluate(() => window.__semloRequireFixture("__hostImmediateCaptures"));
      const anchor = mode === "reject" ? before.dom!.anchor : line.from + 2;
      expect(captured).toHaveLength(1);
      expect(captured[0]).toMatchObject({ anchor, head: line.to + 1, text: line.text.slice(anchor - line.from - 1) });
      expect(after.json).toEqual(captured[0].expected);
      expect(after.last).toBe("NEXT");
      expect(after.focused).toBe(true);
      await page.keyboard.press("ControlOrMeta+z");
      expect((await read(page)).json).toEqual(before.json);
    });
  }
