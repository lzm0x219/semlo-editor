import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type {} from "../../fixtures/heading/heading-wrap-home-host-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/heading/heading-wrap-home-host-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const server = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${server.port}`;
  stop = () => server.server.close();
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => installFixtureGuards(page));
async function geometry(page: Page) {
  return page.evaluate(() => {
    const view = window.__semloRequireFixture("wrapHome").controller.editor.view;
    const heading = view.dom.querySelector("h3")!;
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT);
    const rows: Array<
      Array<{
        from: number;
        to: number;
        text: string;
        left: number;
        right: number;
        top: number;
        bottom: number;
        tag: string;
      }>
    > = [];
    for (let node = walker.nextNode(); node && rows.length < 3; node = walker.nextNode()) {
      if (node.parentElement?.closest('[contenteditable="false"]') || !node.textContent) continue;
      for (let i = 0; i < node.textContent.length && rows.length < 3; i++) {
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, i + 1);
        const rect = range.getBoundingClientRect();
        if (!rect.width || !rect.height) continue;
        let row = rows.find((values) => Math.abs(values[0].top - rect.top) < 1);
        if (!row) rows.push((row = []));
        row.push({
          from: view.posAtDOM(node, i),
          to: view.posAtDOM(node, i + 1),
          text: node.textContent[i],
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          tag: node.parentElement?.tagName ?? "",
        });
      }
    }
    const line = rows[1];
    if (!line || line.length < 3) throw new Error("missing second line");
    const target = line[Math.floor(line.length / 2)];
    return {
      from: line[0].from,
      to: line.at(-1)!.to,
      text: line.map((entry) => entry.text).join(""),
      x: (target.left + target.right) / 2,
      y: (target.top + target.bottom) / 2,
      top: target.top,
      bottom: target.bottom,
      left: line[0].left,
      firstTag: line[0].tag,
      previousTag: rows[0].at(-1)!.tag,
    };
  });
}
async function mount(page: Page, numbered: boolean, candidate: boolean, marked: boolean) {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountWrapHome === "function");
  await page.evaluate(
    ({ numbered, candidate }) => {
      window.__semloRequireFixture("mountWrapHome")(numbered, "normal", "early");
      const view = window.__semloRequireFixture("wrapHome").controller.editor.view;
      view.dom.style.caretColor = "rgb(255, 0, 255)";
      const plugin = view.state.plugins.find((entry) =>
        (entry as unknown as { key: string }).key.startsWith("semloEditorHeadingEndSelection$"),
      );
      const original = plugin?.props.handleKeyDown;
      if (!plugin || !original) throw new Error("missing heading selection plugin");
      if (!candidate)
        plugin.props.handleKeyDown = (v, event) => (event.key === "Home" ? false : original.call(plugin, v, event));
    },
    { numbered, candidate },
  );
  await page.evaluate(() => window.__semloRequireFixture("wrapHome").settle());
  const original = await geometry(page);
  if (marked)
    await page.evaluate((start) => {
      const editor = window.__semloRequireFixture("wrapHome").controller.editor;
      const json = editor.getJSON() as JSONContent;
      const heading = json.content?.[0];
      const value = heading?.content?.[0]?.text;
      if (!heading || !value) throw new Error("missing heading");
      heading.content = [
        { type: "text", text: value.slice(0, start - 1) },
        { type: "text", text: value.slice(start - 1), marks: [{ type: "bold" }] },
      ];
      editor.commands.setContent(json, { emitUpdate: false });
    }, original.from);
  await page.evaluate(() => window.__semloRequireFixture("wrapHome").settle());
  const result = await geometry(page);
  return { ...result, originalBreak: original.from };
}
async function home(page: Page, line: { x: number; y: number }, immediate: boolean) {
  await page.mouse.click(line.x, line.y);
  if (!immediate) await page.evaluate(() => window.__semloRequireFixture("wrapHome").settle());
  await page.keyboard.press("Home");
  if (!immediate) await page.evaluate(() => window.__semloRequireFixture("wrapHome").settle());
}
async function inspect(page: Page) {
  return page.evaluate(() => {
    const fixture = window.__semloRequireFixture("wrapHome"),
      editor = fixture.controller.editor,
      view = editor.view,
      s = document.getSelection()!;
    return {
      json: editor.getJSON(),
      pm: view.state.selection.toJSON(),
      native: {
        anchor: s.anchorNode ? view.posAtDOM(s.anchorNode, s.anchorOffset) : null,
        head: s.focusNode ? view.posAtDOM(s.focusNode, s.focusOffset) : null,
        text: s.toString(),
        collapsed: s.isCollapsed,
      },
      focused: view.hasFocus(),
      events: fixture.events.map((e) => ({ key: e.key, prevented: e.defaultPrevented, trusted: e.isTrusted })),
    };
  });
}
for (const marked of [false, true])
  for (const numbered of [false, true])
    for (const immediate of [true, false]) {
      const label = `${marked ? "cross-mark" : "plain"} ${numbered ? "numbered" : "ordinary"} ${immediate ? "immediate" : "settled"}`;
      test(`Home remains on its visual line: ${label}`, async ({ page }) => {
        const records: Array<Record<string, unknown>> = [];
        for (const candidate of [false, true]) {
          let line = await mount(page, numbered, candidate, marked);
          if (marked) {
            expect(line.from).toBe(line.originalBreak);
            expect(line.firstTag).not.toBe(line.previousTag);
          }
          await home(page, line, immediate);
          const initial = await inspect(page);
          expect(initial.focused).toBe(true);
          expect(initial.native).toMatchObject({ anchor: line.from, head: line.from, collapsed: true });
          const selected = await page.evaluate(() => {
            const view = window.__semloRequireFixture("wrapHome").controller.editor.view,
              selection = document.getSelection()!;
            selection.modify("extend", "forward", "lineboundary");
            return {
              text: selection.toString(),
              anchor: selection.anchorNode ? view.posAtDOM(selection.anchorNode, selection.anchorOffset) : null,
              head: selection.focusNode ? view.posAtDOM(selection.focusNode, selection.focusOffset) : null,
              collapsed: selection.isCollapsed,
            };
          });
          expect(selected).toEqual({ text: line.text, anchor: line.from, head: line.to, collapsed: false });
          const actions: Record<string, unknown> = {};
          for (const action of ["ArrowLeft", "ArrowRight", "input"] as const) {
            line = await mount(page, numbered, candidate, marked);
            await home(page, line, immediate);
            if (action === "input") await page.keyboard.type("X");
            else await page.keyboard.press(action);
            await page.evaluate(() => window.__semloRequireFixture("wrapHome").settle());
            const result = await inspect(page);
            expect(result.focused).toBe(true);
            const expected = action === "ArrowLeft" ? line.from - 1 : line.from + 1;
            expect(result.native).toMatchObject({ anchor: expected, head: expected, collapsed: true });
            expect(result.pm).toMatchObject({ anchor: expected, head: expected });
            actions[action] = { native: result.native, pm: result.pm, json: result.json };
          }
          records.push(actions);
        }
        expect(records[1]).toEqual(records[0]);
      });
    }

for (const marked of [false, true])
  for (const numbered of [false, true]) {
    test(`direct Shift+End at a clicked wrapped-line start preserves the next block: ${marked ? "marked" : "plain"} ${numbered ? "numbered" : "ordinary"}`, async ({
      page,
    }) => {
      const line = await mount(page, numbered, true, marked);
      await page.evaluate(() => window.__semloRequireFixture("wrapHome").closeHistory());
      const before = await inspect(page);
      await page.mouse.click(line.left + 0.5, line.y);
      const clicked = await inspect(page);
      expect(clicked.native).toMatchObject({ anchor: line.from, head: line.from, collapsed: true });
      await page.keyboard.press("Shift+End");
      const selected = await inspect(page);
      await page.keyboard.press("Backspace");
      const after = await inspect(page);
      expect(after.json.content?.at(-1)?.content?.[0]).toMatchObject({ text: "NEXT" });
      expect(selected.native).toMatchObject({ anchor: line.from, head: line.to, text: line.text, collapsed: false });
      await page.keyboard.press("ControlOrMeta+z");
      expect((await inspect(page)).json).toEqual(before.json);
    });
  }

test("a clicked wrap boundary loses its evidence after the host moves the selection away and back", async ({
  page,
}) => {
  const line = await mount(page, false, true, false);
  await page.mouse.click(line.left + 0.5, line.y);
  await page.evaluate((pos) => {
    const editor = window.__semloRequireFixture("wrapHome").controller.editor;
    editor.commands.setTextSelection(pos + 1);
    editor.commands.setTextSelection(pos);
  }, line.from);
  await page.keyboard.press("Shift+End");
  const result = await inspect(page);
  expect(result.events.at(-1)).toMatchObject({ key: "End", prevented: false });
});

for (const action of ["blur", "layout"] as const) {
  test(`a clicked wrap boundary loses evidence after ${action}`, async ({ page }) => {
    const line = await mount(page, false, true, false);
    await page.mouse.click(line.left + 0.5, line.y);
    await page.evaluate((change) => {
      const view = window.__semloRequireFixture("wrapHome").controller.editor.view;
      if (change === "blur") {
        view.dom.blur();
        view.focus();
      } else {
        view.dom.querySelector("h3")!.style.letterSpacing = "2px";
      }
    }, action);
    await page.keyboard.press("Shift+End");
    expect((await inspect(page)).events.at(-1)).toMatchObject({ key: "End", prevented: false });
  });
}

for (const numbered of [false, true])
  for (const direction of ["ArrowRight", "ArrowLeft"] as const) {
    test(`Shift+End after selecting one character on a wrapped heading line preserves following content: ${numbered ? "numbered" : "ordinary"} ${direction}`, async ({
      page,
    }) => {
      const line = await mount(page, numbered, true, false);
      await page.evaluate(() => window.__semloRequireFixture("wrapHome").closeHistory());
      const before = await inspect(page);
      await page.mouse.click(line.x, line.y);
      await page.keyboard.press(`Shift+${direction}`);
      const selected = await inspect(page);
      expect(selected.native.collapsed).toBe(false);
      expect(selected.native.text.length).toBe(1);
      await page.keyboard.press("Shift+End");
      const extended = await inspect(page);
      expect(extended.native).toMatchObject({ anchor: selected.native.anchor, head: line.to, collapsed: false });
      await page.keyboard.press("Backspace");
      await expect(page.locator("#heading-wrap-home-test .semlo-editor-prose > p")).toHaveText("NEXT");
      await page.keyboard.press("ControlOrMeta+z");
      expect((await inspect(page)).json).toEqual(before.json);
    });
  }

test("host rejection of nonempty heading selection leaves Shift+End unconsumed", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountWrapHome === "function");
  await page.evaluate(() => window.__semloRequireFixture("mountWrapHome")(false, "reject-range", "early"));
  await page.evaluate(() => window.__semloRequireFixture("wrapHome").settle());
  const line = await geometry(page);
  await page.mouse.click(line.x, line.y);
  await page.keyboard.press("Shift+ArrowRight");
  expect((await inspect(page)).native.text.length).toBe(1);
  await page.evaluate(() => window.__semloRequireFixture("wrapHome").arm());
  await page.keyboard.press("Shift+End");
  const result = await inspect(page);
  expect(await page.evaluate(() => window.__semloRequireFixture("wrapHome").trace)).toContain("filter");
  expect(result.events.at(-1)).toMatchObject({ key: "End", prevented: false });
  await expect(page.locator("#heading-wrap-home-test .semlo-editor-prose > p")).toHaveText("NEXT");
});

for (const numbered of [false, true]) {
  test(`repeated Shift+End on a wrapped heading selection preserves following content: ${numbered ? "numbered" : "ordinary"}`, async ({
    page,
  }) => {
    const line = await mount(page, numbered, true, false);
    await page.evaluate(() => window.__semloRequireFixture("wrapHome").closeHistory());
    const before = await inspect(page);
    await page.mouse.click(line.x, line.y);
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+End");
    const first = await inspect(page);
    expect(first.native.head).toBe(line.to);
    await page.keyboard.press("Shift+End");
    const second = await inspect(page);
    await page.keyboard.press("Backspace");
    await expect(page.locator("#heading-wrap-home-test .semlo-editor-prose > p")).toHaveText("NEXT");
    expect(second.native).toEqual(first.native);
    await page.keyboard.press("ControlOrMeta+z");
    expect((await inspect(page)).json).toEqual(before.json);
  });
}

for (const action of ["selection", "blur", "layout"] as const) {
  test(`repeated Shift+End drops its line evidence after ${action}`, async ({ page }) => {
    const line = await mount(page, false, true, false);
    await page.mouse.click(line.x, line.y);
    await page.keyboard.press("Shift+ArrowRight");
    await page.keyboard.press("Shift+End");
    const original = await inspect(page);
    await page.evaluate(
      ({ action, anchor, head }) => {
        const editor = window.__semloRequireFixture("wrapHome").controller.editor;
        if (action === "selection") {
          editor.commands.setTextSelection(anchor + 1);
          editor.commands.setTextSelection({ from: anchor, to: head });
        } else if (action === "blur") {
          editor.view.dom.blur();
          editor.view.focus();
        } else editor.view.dom.querySelector("h3")!.style.letterSpacing = "2px";
      },
      { action, anchor: original.pm.anchor, head: original.pm.head },
    );
    await page.keyboard.press("Shift+End");
    expect((await inspect(page)).events.at(-1)).toMatchObject({ key: "End", prevented: false });
  });
}

for (const numbered of [false, true]) {
  test(`Shift+Home from a wrapped heading preserves a preceding paragraph: ${numbered ? "numbered" : "ordinary"}`, async ({
    page,
  }) => {
    await mount(page, numbered, true, false);
    await page.evaluate(() => {
      const editor = window.__semloRequireFixture("wrapHome").controller.editor;
      editor.view.dispatch(
        editor.state.tr.insert(0, editor.schema.nodes.paragraph.create(null, editor.schema.text("PREFIX"))),
      );
      window.__semloRequireFixture("wrapHome").closeHistory();
    });
    const line = await geometry(page);
    const before = await inspect(page);
    await page.mouse.click(line.x, line.y);
    const clicked = await inspect(page);
    await page.keyboard.press("Shift+Home");
    const selected = await inspect(page);
    expect(selected.native).toMatchObject({ anchor: clicked.native.anchor, head: line.from, collapsed: false });
    expect(selected.pm).toMatchObject({ anchor: clicked.native.anchor, head: line.from });
    await page.keyboard.press("Backspace");
    await expect(page.locator("#heading-wrap-home-test .semlo-editor-prose > p").first()).toHaveText("PREFIX");
    await page.keyboard.press("ControlOrMeta+z");
    expect((await inspect(page)).json).toEqual(before.json);
  });
}

test("host rejection of Shift+Home range is not consumed or applied", async ({ page }) => {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountWrapHome === "function");
  await page.evaluate(() => {
    window.__semloRequireFixture("mountWrapHome")(false, "reject-range", "early");
    const editor = window.__semloRequireFixture("wrapHome").controller.editor;
    editor.view.dispatch(
      editor.state.tr.insert(0, editor.schema.nodes.paragraph.create(null, editor.schema.text("PREFIX"))),
    );
  });
  await page.evaluate(() => window.__semloRequireFixture("wrapHome").settle());
  const line = await geometry(page);
  const before = await inspect(page);
  await page.mouse.click(line.x, line.y);
  await page.evaluate(() => window.__semloRequireFixture("wrapHome").arm());
  await page.keyboard.press("Shift+Home");
  const result = await inspect(page);
  expect(await page.evaluate(() => window.__semloRequireFixture("wrapHome").trace)).toContain("filter");
  expect(result.events.at(-1)).toMatchObject({ key: "Home", prevented: false });
  expect(result.json).toEqual(before.json);
});
