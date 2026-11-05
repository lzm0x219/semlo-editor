import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type { HostMode, HostOrder } from "../../fixtures/heading/heading-end-host-fixture";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

let origin: string;
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/heading/heading-end-host-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = () => server.close();
});
afterAll(async () => stop?.());

type Container = "root" | "quote" | "details";
type Format = "bold" | "italic" | "mixed" | "numbered";
function initialDocument(container: Container, format?: Format): JSONContent {
  const headingContent: JSONContent[] =
    format === "mixed"
      ? [
          { type: "text", text: "a" },
          { type: "text", text: "bc", marks: [{ type: "bold" }] },
          { type: "text", text: "d" },
        ]
      : [
          {
            type: "text",
            text: "test",
            ...(format === "bold" || format === "italic" ? { marks: [{ type: format }] } : {}),
          },
        ];
  const blocks: JSONContent[] = [
    {
      type: "heading",
      attrs: { level: 3, ...(format === "numbered" ? { semloEditorHeadingNumbering: "mixed" } : {}) },
      content: headingContent,
    },
    { type: "paragraph", content: [{ type: "text", text: "next" }] },
  ];
  if (container === "root") return { type: "doc", content: blocks };
  if (container === "quote") return { type: "doc", content: [{ type: "blockquote", content: blocks }] };
  return {
    type: "doc",
    content: [
      {
        type: "details",
        attrs: { open: true },
        content: [{ type: "detailsSummary" }, { type: "detailsContent", content: blocks }],
      },
    ],
  };
}

async function mount(
  page: Page,
  container: Container,
  mode: HostMode = "none",
  order: HostOrder = "early",
  format?: Format,
) {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountHeadingEndHost === "function");
  await page.evaluate(
    ({ content, mode, order }) => window.__semloRequireFixture("mountHeadingEndHost")(content, mode, order),
    {
      content: initialDocument(container, format),
      mode,
      order,
    },
  );
  await page.evaluate(() => window.__semloRequireFixture("headingEndHost").settle());
  const heading = page.locator("#heading-end-host .semlo-editor-prose h3");
  await expect(heading).toBeVisible();
  await heading.click();
}

async function inspect(page: Page) {
  return page.evaluate(() => {
    const fixture = window.__semloRequireFixture("headingEndHost");
    const editor = fixture.controller.editor;
    if (editor.isDestroyed)
      return {
        destroyed: true as const,
        prevented: fixture.lastEndPrevented(),
        trace: fixture.trace,
        changes: fixture.changes,
      };
    const selection = editor.state.selection;
    return {
      destroyed: false as const,
      json: editor.getJSON() as JSONContent,
      selection: {
        anchorType: selection.$anchor.parent.type.name,
        anchorOffset: selection.$anchor.parentOffset,
        headType: selection.$head.parent.type.name,
        headOffset: selection.$head.parentOffset,
        text: document.getSelection()?.toString(),
        focused: editor.view.hasFocus(),
      },
      prevented: fixture.lastEndPrevented(),
      trace: fixture.trace,
      changes: fixture.changes,
    };
  });
}

test("same-selection transaction does not necessarily synchronize the native caret", async ({ page }) => {
  await mount(page, "root", "observe-home", "early", "numbered");
  const result = await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("headingEndHost");
    const before = fixture.inverseMismatch();
    const editor = fixture.controller.editor;
    fixture.trace.length = 0;
    editor.commands.setTextSelection(editor.state.selection.anchor);
    const selection = document.getSelection()!;
    return {
      before,
      after: {
        pm: editor.state.selection.anchor,
        dom: selection.anchorOffset,
        text: selection.anchorNode?.textContent,
      },
      trace: fixture.trace,
    };
  });
  expect(result.before).toEqual({ pm: 1, dom: 4 });
  expect(result.after).toEqual({ pm: 1, dom: 4, text: "test" });
  expect(result.trace.filter((item) => item.phase === "home-filter")).toHaveLength(1);
});

for (const order of ["early", "late"] as const) {
  test(`${order} numbered Home synchronizes a host-injected inverse DOM mismatch without a host transaction`, async ({
    page,
  }) => {
    await mount(page, "root", "observe-home", order, "numbered");
    const before = await inspect(page);
    const beforeEnvironment = await page.evaluate(() => {
      document.body.style.minHeight = "2500px";
      window.scrollTo(0, 600);
      return {
        scrollY: window.scrollY,
        focusEvents: { ...window.__semloRequireFixture("headingEndHost").focusEvents },
      };
    });
    expect(beforeEnvironment.scrollY).toBe(600);
    await page.evaluate(() => window.__semloRequireFixture("headingEndHost").installInverseMismatchOnHome());
    await page.keyboard.press("Home");
    const actual = await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("headingEndHost");
      const editor = fixture.controller.editor;
      const selection = document.getSelection()!;
      return {
        before: fixture.inverseBefore(),
        after: {
          pm: editor.state.selection.anchor,
          dom: editor.view.posAtDOM(selection.anchorNode!, selection.anchorOffset),
          text: selection.anchorNode?.textContent,
          offset: selection.anchorOffset,
          focused: editor.view.hasFocus(),
        },
        prevented: fixture.lastHomePrevented(),
        trace: fixture.trace,
        changes: fixture.changes,
        scrollY: window.scrollY,
        focusEvents: fixture.focusEvents,
      };
    });
    expect(actual.before).toEqual({ pm: 1, dom: 4 });
    expect(actual.after).toEqual({ pm: 1, dom: 1, text: "test", offset: 0, focused: true });
    expect(actual.prevented).toBe(true);
    expect(actual.trace.filter((item) => item.phase === "home-filter")).toEqual([]);
    expect(actual.changes).toBe(0);
    expect({ scrollY: actual.scrollY, focusEvents: actual.focusEvents }).toEqual(beforeEnvironment);
    await page.evaluate(() => window.__semloRequireFixture("headingEndHost").settle());
    const after = await inspect(page);
    if (after.destroyed || before.destroyed) throw new Error("Unexpected editor destruction");
    expect(after.json).toEqual(before.json);
    expect(after.selection).toMatchObject({ anchorOffset: 0, headOffset: 0, focused: true });
    expect(after.trace.filter((item) => item.phase === "home-filter")).toEqual([]);
    expect(after.changes).toBe(0);
  });
  test(`${order} host-injected inverse DOM mismatch preserves the following paragraph in the immediate keyboard chain`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mount(page, "root", "observe-home", order, "numbered");
    const before = await inspect(page);
    if (before.destroyed) throw new Error("Missing editor");
    await page.evaluate(() => window.__semloRequireFixture("headingEndHost").installInverseMismatchOnHome());
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.press("Backspace");
    await page.evaluate(() => window.__semloRequireFixture("headingEndHost").settle());
    const after = await inspect(page);
    if (after.destroyed) throw new Error("Unexpected editor destruction");
    expect(await page.evaluate(() => window.__semloRequireFixture("headingEndHost").inverseBefore())).toEqual({
      pm: 1,
      dom: 4,
    });
    const expected = JSON.parse(JSON.stringify(before.json)) as JSONContent;
    delete expected.content![0].content;
    expect(after.json).toEqual(expected);
    expect(after.selection).toMatchObject({
      anchorType: "heading",
      anchorOffset: 0,
      headType: "heading",
      headOffset: 0,
      focused: true,
    });
    expect(after.trace.filter((item) => item.phase === "home-filter")).toEqual([]);
    expect(after.changes).toBe(1);
    await page.keyboard.press("ControlOrMeta+z");
    await page.evaluate(() => window.__semloRequireFixture("headingEndHost").settle());
    const undone = await inspect(page);
    if (undone.destroyed) throw new Error("Unexpected editor destruction");
    expect(undone.json).toEqual(before.json);
    expect(undone.selection).toMatchObject({
      anchorType: "heading",
      anchorOffset: 0,
      headType: "heading",
      headOffset: 4,
      text: "test",
      focused: true,
    });
    expect(undone.changes).toBe(2);
    expect(errors).toEqual([]);
  });
  test(`${order} numbered Home at the synchronized start creates no extra host transaction`, async ({ page }) => {
    await mount(page, "root", "observe-home", order, "numbered");
    await page.keyboard.press("Home");
    await page.evaluate(() => window.__semloRequireFixture("headingEndHost").settle());
    const before = await inspect(page);
    if (before.destroyed) throw new Error("Missing editor");
    expect(before.selection).toMatchObject({
      anchorType: "heading",
      anchorOffset: 0,
      headType: "heading",
      headOffset: 0,
    });
    await page.evaluate(() => {
      window.__semloRequireFixture("headingEndHost").trace.length = 0;
    });
    await page.keyboard.press("Home");
    await page.evaluate(() => window.__semloRequireFixture("headingEndHost").settle());
    const after = await inspect(page);
    if (after.destroyed) throw new Error("Unexpected editor destruction");
    expect(after.selection).toEqual(before.selection);
    expect(after.json).toEqual(before.json);
    expect(after.trace.filter((item) => item.phase === "home-filter")).toEqual([]);
    expect(await page.evaluate(() => window.__semloRequireFixture("headingEndHost").lastHomePrevented())).toBe(true);
    expect(after.changes).toBe(0);
  });
  test(`${order} numbered Home synchronizes a newer DOM caret even when it is at start`, async ({ page }) => {
    await mount(page, "root", "observe-home", order, "numbered");
    const result = await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("headingEndHost");
      const editor = fixture.controller.editor;
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      const heading = editor.view.dom.querySelector("h3")!;
      const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) =>
          node.parentElement?.closest('[contenteditable="false"]')
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_ACCEPT,
      });
      const text = walker.nextNode();
      if (!text) throw new Error("Missing heading text");
      document.getSelection()!.setBaseAndExtent(text, 0, text, 0);
      const before = { type: editor.state.selection.$anchor.parent.type.name, pos: editor.state.selection.anchor };
      fixture.trace.length = 0;
      const event = new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true });
      editor.view.dom.dispatchEvent(event);
      return {
        before,
        after: {
          type: editor.state.selection.$anchor.parent.type.name,
          offset: editor.state.selection.$anchor.parentOffset,
        },
        prevented: event.defaultPrevented,
        trace: fixture.trace,
      };
    });
    expect(result.before.type).toBe("paragraph");
    expect(result.after).toEqual({ type: "heading", offset: 0 });
    expect(result.prevented).toBe(true);
    expect(result.trace.filter((item) => item.phase === "home-filter")).toHaveLength(1);
  });
  test(`${order} host may reject numbered heading Home without native fallthrough`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mount(page, "root", "reject-home", order, "numbered");
    const before = await inspect(page);
    const domBefore = await page.evaluate(() => ({
      offset: document.getSelection()?.anchorOffset,
      text: document.getSelection()?.anchorNode?.textContent,
    }));
    expect(domBefore).toEqual({ offset: 4, text: "test" });
    await page.keyboard.press("Home");
    await page.evaluate(() => window.__semloRequireFixture("headingEndHost").settle());
    const after = await inspect(page);
    const domAfter = await page.evaluate(() => ({
      offset: document.getSelection()?.anchorOffset,
      text: document.getSelection()?.anchorNode?.textContent,
      prevented: window.__semloRequireFixture("headingEndHost").lastHomePrevented(),
    }));
    expect(domAfter).toEqual({ offset: 4, text: "test", prevented: true });
    expect(after.trace.filter((item) => item.phase === "home-filter")).toHaveLength(1);
    expect(after.destroyed).toBe(false);
    if (after.destroyed || before.destroyed) throw new Error("Unexpected editor destruction");
    expect(after.json).toEqual(before.json);
    expect(after.changes).toBe(0);
    expect(errors).toEqual([]);
  });
  for (const mode of ["append-home-selection", "destroy-home"] as const) {
    test(`${order} host ${mode} controls numbered Home without a subsequent DOM correction`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await mount(page, "root", mode, order, "numbered");
      const before = await inspect(page);
      await page.keyboard.press("Home");
      await page.evaluate(() => window.__semloRequireFixture("headingEndHost").settle());
      const after = await inspect(page);
      expect(await page.evaluate(() => window.__semloRequireFixture("headingEndHost").lastHomePrevented())).toBe(true);
      expect(after.trace.filter((item) => item.phase === "home-filter")).toHaveLength(1);
      expect(after.trace.filter((item) => item.phase === "home-append")).toHaveLength(1);
      if (mode === "destroy-home") expect(after.destroyed).toBe(true);
      else {
        if (after.destroyed || before.destroyed) throw new Error("Unexpected editor destruction");
        expect(after.json).toEqual(before.json);
        expect(after.selection).toMatchObject({
          anchorType: "heading",
          anchorOffset: 4,
          headType: "heading",
          headOffset: 4,
          focused: true,
        });
        expect(
          await page.evaluate(() => ({
            text: document.getSelection()?.anchorNode?.textContent,
            offset: document.getSelection()?.anchorOffset,
          })),
        ).toEqual({ text: "test", offset: 4 });
        expect(after.changes).toBe(0);
      }
      expect(errors).toEqual([]);
    });
  }
  for (const mode of ["reject", "append-meta", "append-selection", "append-doc", "destroy", "throw"] as const) {
    test(`${order} host ${mode} controls the selection without native fallthrough`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await mount(page, "root", mode, order);
      await page.keyboard.press("Home");
      const before = await inspect(page);
      await page.keyboard.press("Shift+End");
      await page.evaluate(() => window.__semloRequireFixture("headingEndHost").settle());
      const after = await inspect(page);
      expect(after.prevented).toBe(true);
      expect(after.trace.filter((event) => event.phase === "filter")).toHaveLength(1);
      if (mode === "destroy") expect(after.destroyed).toBe(true);
      else {
        expect(after.destroyed).toBe(false);
        if (after.destroyed || before.destroyed) throw new Error("Unexpected editor destruction");
        expect(after.selection.focused).toBe(true);
        if (mode === "reject" || mode === "append-selection" || mode === "throw")
          expect(after.selection).toMatchObject({
            anchorType: "heading",
            anchorOffset: 0,
            headType: "heading",
            headOffset: 0,
            text: "",
          });
        else
          expect(after.selection).toMatchObject({
            anchorType: "heading",
            anchorOffset: 0,
            headType: "heading",
            headOffset: 4,
            text: "test",
          });
        if (mode === "append-doc") {
          expect(after.json.content?.[1].content?.[0].text).toBe("next!");
          expect(after.changes).toBe(1);
        } else {
          expect(after.json).toEqual(before.json);
          expect(after.changes).toBe(0);
        }
      }
      expect(errors).toEqual(mode === "throw" ? ["heading-end-host-filter-error"] : []);
    });
  }
}

for (const sample of [
  { container: "root" },
  { container: "quote" },
  { container: "details" },
  ...(["bold", "italic", "mixed", "numbered"] as const).map((format) => ({ container: "root" as const, format })),
] as Array<{ container: Container; format?: Format }>) {
  test(`${sample.container}/${sample.format ?? "plain"}: Home, Shift+End, Backspace run consecutively and undo once`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mount(page, sample.container, "none", "early", sample.format);
    const before = await inspect(page);
    if (before.destroyed) throw new Error("Missing editor");
    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+End");
    await page.keyboard.press("Backspace");
    await page.evaluate(() => window.__semloRequireFixture("headingEndHost").settle());
    const after = await inspect(page);
    if (after.destroyed) throw new Error("Unexpected editor destruction");
    const expected = JSON.parse(JSON.stringify(before.json)) as JSONContent;
    const empty = (node: JSONContent) => {
      if (node.type === "heading") delete node.content;
      else for (const child of node.content ?? []) empty(child);
    };
    empty(expected);
    expect(after.json).toEqual(expected);
    expect(after.selection).toMatchObject({
      anchorType: "heading",
      anchorOffset: 0,
      headType: "heading",
      headOffset: 0,
      focused: true,
    });
    expect(after.changes).toBe(1);
    await page.keyboard.press("ControlOrMeta+z");
    await page.evaluate(() => window.__semloRequireFixture("headingEndHost").settle());
    const undone = await inspect(page);
    if (undone.destroyed) throw new Error("Unexpected editor destruction");
    expect(undone.json).toEqual(before.json);
    expect(undone.selection).toMatchObject({
      anchorType: "heading",
      anchorOffset: 0,
      headType: "heading",
      headOffset: 4,
      text: sample.format === "mixed" ? "abcd" : "test",
      focused: true,
    });
    expect(undone.changes).toBe(2);
    expect(errors).toEqual([]);
  });
}
