import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

declare global {
  interface Window {
    flatListTabEditor?: EditorController;
    flatTabBoundaryPrevented?: boolean[];
    flatTabDocumentChanges?: number;
  }
}

const nested =
  '<ul><li><p>父项</p><ol start="7"><li><p><strong>甲项</strong></p></li><li><p>乙项</p></li><li><p>丙项</p></li></ol></li></ul><p>后文</p>';
const nestedBullet =
  "<ul><li><p>父项</p><ul><li><p><strong>甲项</strong></p></li><li><p>乙项</p></li><li><p>丙项</p></li></ul></li></ul><p>后文</p>";

async function mount(page: Page, kind: "ordered" | "bullet" = "ordered") {
  const content = kind === "ordered" ? nested : nestedBullet;
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'flat-list-tab'
      document.body.append(host)
      window.flatListTabEditor = createEditor({ element: host, outline: false, content: ${JSON.stringify(content)} })
    `,
  });
  await page.waitForFunction(() => Boolean(window.flatListTabEditor));
  const host = page.locator("#flat-list-tab");
  await host.locator(".semlo-editor-prose").getByText("父项", { exact: true }).click();
  await host.getByRole("button", { name: "段落样式" }).click();
  await page.getByRole("menuitemradio", { name: "标题3", exact: true }).click();
  await expect(host.locator(".semlo-editor-prose > h3")).toContainText("父项");
  if (kind === "ordered") await expect(host.locator(".semlo-editor-prose > ol")).toHaveAttribute("start", "7");
  else await expect(host.locator(".semlo-editor-prose > ul")).toHaveCount(1);
  expect(await items(page)).toEqual([
    { text: "甲项", indent: 1 },
    { text: "乙项", indent: 1 },
    { text: "丙项", indent: 1 },
  ]);
  return host;
}

async function items(page: Page) {
  return page.evaluate(() => {
    const result: Array<{ text: string; indent: number }> = [];
    window.__semloRequireFixture("flatListTabEditor").editor.state.doc.descendants((node) => {
      if (node.type.name === "listItem")
        result.push({ text: node.firstChild?.textContent ?? "", indent: node.attrs.semloEditorListIndent });
    });
    return result;
  });
}

async function select(
  page: Page,
  first: string,
  firstOffset: number,
  last = first,
  lastOffset = firstOffset,
  backward = false,
) {
  await page.evaluate(
    ({ first, firstOffset, last, lastOffset, backward }) => {
      const editor = window.__semloRequireFixture("flatListTabEditor").editor;
      const positions = new Map<string, number>();
      editor.state.doc.descendants((node, position) => {
        if (node.isTextblock && (node.textContent === first || node.textContent === last))
          positions.set(node.textContent, position + 1);
      });
      const start = positions.get(first),
        end = positions.get(last);
      if (start === undefined || end === undefined) throw new Error("Missing selected text");
      editor.view.focus();
      editor.commands.setTextSelection({
        from: backward ? end + lastOffset : start + firstOffset,
        to: backward ? start + firstOffset : end + lastOffset,
      });
    },
    { first, firstOffset, last, lastOffset, backward },
  );
}

async function selection(page: Page) {
  return page.evaluate(() => {
    const { state } = window.__semloRequireFixture("flatListTabEditor").editor;
    const { $anchor, $head, from, to } = state.selection;
    return {
      anchor: $anchor.parent.textContent,
      anchorOffset: $anchor.parentOffset,
      head: $head.parent.textContent,
      headOffset: $head.parentOffset,
      text: state.doc.textBetween(from, to, "\n"),
    };
  });
}

for (const kind of ["ordered", "bullet"] as const) {
  test(`${kind}: Tab and Shift+Tab at a converted flat item's start adjust its level with one-step undo`, async ({
    page,
  }) => {
    const host = await mount(page, kind);
    if (kind === "bullet")
      await expect(host.locator(".semlo-editor-prose > ul > li").first()).toHaveCSS("list-style-type", "circle");
    await select(page, "甲项", 0);
    const originalSelection = await selection(page);
    const original = await page.evaluate(() => window.__semloRequireFixture("flatListTabEditor").getSnapshot().json);
    await page.keyboard.press("Tab");
    expect(await items(page)).toEqual([
      { text: "甲项", indent: 2 },
      { text: "乙项", indent: 1 },
      { text: "丙项", indent: 1 },
    ]);
    expect(await selection(page)).toEqual(originalSelection);
    if (kind === "bullet")
      await expect(host.locator(".semlo-editor-prose > ul > li").first()).toHaveCSS("list-style-type", "square");
    await expect(host.locator(".semlo-editor-prose")).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => window.__semloRequireFixture("flatListTabEditor").getSnapshot().json)).toEqual(
      original,
    );
    expect(await selection(page)).toEqual(originalSelection);
    if (kind === "bullet")
      await expect(host.locator(".semlo-editor-prose > ul > li").first()).toHaveCSS("list-style-type", "circle");
    expect(await page.evaluate(() => window.__semloRequireFixture("flatListTabEditor").editor.commands.undo())).toBe(
      true,
    );
    expect((await items(page))[0].indent).toBe(2);
    expect(await page.evaluate(() => window.__semloRequireFixture("flatListTabEditor").editor.commands.undo())).toBe(
      true,
    );
    expect(await page.evaluate(() => window.__semloRequireFixture("flatListTabEditor").getSnapshot().json)).toEqual(
      original,
    );
    expect(await page.evaluate(() => window.__semloRequireFixture("flatListTabEditor").editor.commands.redo())).toBe(
      true,
    );
    expect((await items(page))[0].indent).toBe(2);
  });

  for (const [name, first, from, last, to, backward, expected] of [
    ["single full", "甲项", 0, "甲项", 2, false, "甲项"],
    ["single partial backward", "甲项", 1, "甲项", 2, true, "项"],
    ["whole items", "甲项", 0, "乙项", 2, false, "甲项\n乙项"],
    ["partial forward", "甲项", 1, "乙项", 1, false, "项\n乙"],
    ["partial backward", "甲项", 1, "乙项", 1, true, "项\n乙"],
  ] as const) {
    test(`${kind}: Tab adjusts ${name} selection without changing selected text or direction`, async ({ page }) => {
      const host = await mount(page, kind);
      await select(page, first, from, last, to, backward);
      const before = await selection(page);
      expect(before.text).toBe(expected);
      const original = await page.evaluate(() => window.__semloRequireFixture("flatListTabEditor").getSnapshot().json);
      await page.keyboard.press("Tab");
      expect(await selection(page)).toEqual(before);
      const changed = await items(page);
      expect(changed).toEqual([
        { text: "甲项", indent: 2 },
        { text: "乙项", indent: first === last ? 1 : 2 },
        { text: "丙项", indent: 1 },
      ]);
      await expect(host.locator(".semlo-editor-prose strong")).toHaveText("甲项");
      await page.keyboard.press("Shift+Tab");
      expect(await page.evaluate(() => window.__semloRequireFixture("flatListTabEditor").getSnapshot().json)).toEqual(
        original,
      );
      expect(await selection(page)).toEqual(before);
    });
  }

  test(`${kind}: Tab indents a selection spanning different flat levels`, async ({ page }) => {
    const host = await mount(page, kind);
    await select(page, "丙项", 0);
    await host.getByRole("button", { name: "缩进调整" }).click();
    await page.getByRole("menuitem", { name: "减少缩进" }).click();
    expect((await items(page))[2].indent).toBe(0);
    await select(page, "乙项", 0, "丙项", 2);
    const original = await page.evaluate(() => window.__semloRequireFixture("flatListTabEditor").getSnapshot().json);
    const before = await selection(page);
    await page.keyboard.press("Tab");
    expect(await items(page)).toEqual([
      { text: "甲项", indent: 1 },
      { text: "乙项", indent: 2 },
      { text: "丙项", indent: 1 },
    ]);
    expect(await selection(page)).toEqual(before);
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => window.__semloRequireFixture("flatListTabEditor").getSnapshot().json)).toEqual(
      original,
    );
    expect(await selection(page)).toEqual(before);
  });

  test(`${kind}: first top-level item keeps focus on Shift+Tab and indents with Tab`, async ({ page }) => {
    const host = await mount(page, kind);
    await page.evaluate((name) => {
      const tag = name === "ordered" ? "ol" : "ul";
      window
        .__semloRequireFixture("flatListTabEditor")
        .setContent(`<${tag}><li><p>首项</p></li><li><p>次项</p></li></${tag}>`);
    }, kind);
    await select(page, "首项", 0);
    const before = await page.evaluate(() => window.__semloRequireFixture("flatListTabEditor").getSnapshot().json);
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => window.__semloRequireFixture("flatListTabEditor").getSnapshot().json)).toEqual(
      before,
    );
    await expect(host.locator(".semlo-editor-prose")).toBeFocused();
    await page.keyboard.press("Tab");
    expect(await items(page)).toEqual([
      { text: "首项", indent: 1 },
      { text: "次项", indent: 0 },
    ]);
    expect(await selection(page)).toMatchObject({ anchor: "首项", anchorOffset: 0, headOffset: 0 });
    for (let index = 1; index < 8; index += 1) await page.keyboard.press("Tab");
    expect((await items(page))[0].indent).toBe(8);
    const atLimit = await page.evaluate(() => window.__semloRequireFixture("flatListTabEditor").getSnapshot().json);
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => window.__semloRequireFixture("flatListTabEditor").getSnapshot().json)).toEqual(
      atLimit,
    );
    await expect(host.locator(".semlo-editor-prose")).toBeFocused();
  });
}

test("cross-item indentation retains the observed ordered values and marker levels", async ({ page }) => {
  const host = await mount(page);
  const list = host.locator(".semlo-editor-prose > ol");
  const markers = () =>
    list
      .locator(":scope > li")
      .evaluateAll((nodes) =>
        nodes.map((node) => ({ value: node.getAttribute("value"), marker: getComputedStyle(node).listStyleType })),
      );
  expect(await markers()).toEqual([
    { value: "7", marker: "lower-alpha" },
    { value: "8", marker: "lower-alpha" },
    { value: "9", marker: "lower-alpha" },
  ]);
  await select(page, "甲项", 1, "乙项", 1);
  await page.keyboard.press("Tab");
  expect(await markers()).toEqual([
    { value: "7", marker: "semlo-mixed-roman" },
    { value: "8", marker: "semlo-mixed-roman" },
    { value: "1", marker: "lower-alpha" },
  ]);
  expect((await selection(page)).text).toBe("项\n乙");
});

for (const kind of ["ordered", "bullet"] as const) {
  test(`${kind}: Tab and Shift+Tab at the end insert literal tabs that survive HTML and JSON`, async ({ page }) => {
    const host = await mount(page, kind);
    await select(page, "甲项", 2);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    expect(await items(page)).toEqual([
      { text: "甲项\t\t", indent: 1 },
      { text: "乙项", indent: 1 },
      { text: "丙项", indent: 1 },
    ]);
    expect(await selection(page)).toMatchObject({ anchor: "甲项\t\t", anchorOffset: 4, headOffset: 4 });
    await expect(host.locator(".semlo-editor-prose")).toBeFocused();
    const original = await page.evaluate(() => window.__semloRequireFixture("flatListTabEditor").getSnapshot());
    expect(original.html).toContain("data-semlo-editor-preserve-tab");
    expect(original.text).toContain("甲项\t\t");
    for (const content of [original.html, original.json]) {
      const restored = await page.evaluate((value) => {
        const editor = window.__semloRequireFixture("flatListTabEditor");
        editor.setContent("<p>替换内容</p>");
        editor.setContent(value);
        return editor.getSnapshot();
      }, content);
      expect(restored.json).toEqual(original.json);
      expect(restored.text).toBe(original.text);
    }
  });

  for (const key of ["Tab", "Shift+Tab"] as const) {
    test(`${kind}: ${key} inside formatted text inserts a literal tab without losing marks`, async ({ page }) => {
      const host = await mount(page, kind);
      await select(page, "甲项", 1);
      await page.keyboard.press(key);
      expect(await items(page)).toEqual([
        { text: "甲\t项", indent: 1 },
        { text: "乙项", indent: 1 },
        { text: "丙项", indent: 1 },
      ]);
      expect(await selection(page)).toMatchObject({ anchor: "甲\t项", anchorOffset: 2, headOffset: 2 });
      await expect(host.locator(".semlo-editor-prose strong")).toHaveText("甲\t项");
      const snapshot = await page.evaluate(() => window.__semloRequireFixture("flatListTabEditor").getSnapshot());
      const restored = await page.evaluate((html) => {
        const controller = window.__semloRequireFixture("flatListTabEditor");
        controller.setContent("<p>临时内容</p>");
        controller.setContent(html);
        return controller.getSnapshot();
      }, snapshot.html);
      expect(restored.json).toEqual(snapshot.json);
    });
  }
}

test("Tab uses the newer browser caret before a delayed selectionchange", async ({ page }) => {
  await mount(page);
  const result = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("flatListTabEditor").editor;
    editor.view.focus();
    let after = 0;
    editor.state.doc.descendants((node, position) => {
      if (node.isTextblock && node.textContent === "后文") after = position + 1;
    });
    editor.commands.setTextSelection(after);
    const first = [...editor.view.dom.querySelectorAll("p")].find((node) => node.textContent === "甲项");
    const text = first?.querySelector("strong")?.firstChild;
    if (!text) throw new Error("Missing first item");
    document.getSelection()!.setBaseAndExtent(text, 0, text, 0);
    const event = new KeyboardEvent("keydown", {
      key: "Tab",
      code: "Tab",
      keyCode: 9,
      bubbles: true,
      cancelable: true,
    });
    editor.view.dom.dispatchEvent(event);
    return { prevented: event.defaultPrevented, text: editor.state.selection.$from.parent.textContent };
  });
  expect(result).toEqual({ prevented: true, text: "甲项" });
  expect((await items(page))[0].indent).toBe(2);
});

for (const kind of ["composing", "keyCode229", "activeComposition", "readOnly", "control", "alt", "meta"] as const) {
  test(`Tab does not alter the document during ${kind}`, async ({ page }) => {
    await mount(page);
    await select(page, "甲项", 0);
    const result = await page.evaluate((kind) => {
      const controller = window.__semloRequireFixture("flatListTabEditor");
      const editor = controller.editor;
      const view = editor.view;
      if (kind === "readOnly") controller.setEditable(false);
      if (kind === "activeComposition")
        view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      const before = controller.getSnapshot().json;
      const beforeSelection = editor.state.selection.toJSON();
      const event = new KeyboardEvent("keydown", {
        key: "Tab",
        code: "Tab",
        keyCode: kind === "keyCode229" ? 229 : 9,
        isComposing: kind === "composing",
        ctrlKey: kind === "control",
        altKey: kind === "alt",
        metaKey: kind === "meta",
        bubbles: true,
        cancelable: true,
      });
      view.dom.dispatchEvent(event);
      return {
        before,
        after: controller.getSnapshot().json,
        beforeSelection,
        afterSelection: editor.state.selection.toJSON(),
      };
    }, kind);
    expect(result.after).toEqual(result.before);
    expect(result.afterSelection).toEqual(result.beforeSelection);
  });
}

test("the new handler leaves genuine nested lists and non-list selections to their existing handlers", async ({
  page,
}) => {
  await mount(page);
  for (const [content, text] of [
    [nested, "甲项"],
    ["<p>普通段落</p>", "普通段落"],
    ['<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><div><p>任务</p></div></li></ul>', "任务"],
  ] as const) {
    const result = await page.evaluate(
      ({ content, text }) => {
        const controller = window.__semloRequireFixture("flatListTabEditor");
        controller.setContent(content);
        const editor = controller.editor;
        let position = 0;
        editor.state.doc.descendants((node, pos) => {
          if (node.isTextblock && node.textContent === text) position = pos + 1;
        });
        editor.view.focus();
        editor.commands.setTextSelection(position);
        const before = controller.getSnapshot().json;
        const plugin = editor.state.plugins.find((item) =>
          (item as typeof item & { key?: string }).key?.startsWith("semloEditorFlatListTab$"),
        );
        const handler = plugin?.props.handleDOMEvents?.keydown;
        if (!plugin || !handler) throw new Error("Missing flat list Tab handler");
        const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
        const handled = handler.call(plugin, editor.view, event);
        return { handled, before, after: controller.getSnapshot().json };
      },
      { content, text },
    );
    expect(result.handled).toBe(false);
    expect(result.after).toEqual(result.before);
  }
});

async function prepareBoundary(
  page: Page,
  kind: "ordered" | "bullet",
  indents: [number, number],
  invalidMetadata = false,
) {
  await page.evaluate(
    ({ kind, indents, invalidMetadata }) => {
      const controller = window.__semloRequireFixture("flatListTabEditor");
      controller.setContent({
        type: "doc",
        content: [
          {
            type: kind === "ordered" ? "orderedList" : "bulletList",
            attrs:
              kind === "ordered"
                ? { start: 2, semloEditorListLevelStarts: invalidMetadata ? { invalid: 2 } : null }
                : {},
            content: indents.map((indent, index) => ({
              type: "listItem",
              attrs: { semloEditorListIndent: indent },
              content: [{ type: "paragraph", content: [{ type: "text", text: index ? "乙项" : "甲项" }] }],
            })),
          },
        ],
      });
      window.flatTabBoundaryPrevented = [];
      window.flatTabDocumentChanges = 0;
      controller.editor.view.dom.addEventListener("keydown", (event) => {
        if (event.key === "Tab") window.__semloRequireFixture("flatTabBoundaryPrevented").push(event.defaultPrevented);
      });
      controller.editor.on("transaction", ({ transaction }) => {
        if (transaction.docChanged)
          window.flatTabDocumentChanges = window.__semloRequireFixture("flatTabDocumentChanges") + 1;
      });
      const next = document.createElement("button");
      next.textContent = "编辑器后的焦点目标";
      document.body.append(next);
    },
    { kind, indents, invalidMetadata },
  );
}

for (const kind of ["bullet", "ordered"] as const) {
  for (const direction of ["Tab", "Shift+Tab"] as const) {
    for (const backward of [false, true]) {
      for (const atBoundary of [false, true]) {
        const start: [number, number] =
          direction === "Tab" ? (atBoundary ? [8, 8] : [7, 8]) : atBoundary ? [0, 0] : [0, 1];
        const expected = direction === "Tab" ? [8, 8] : [0, 0];
        test(`${kind}: ${direction} clamps ${atBoundary ? "all-boundary" : "mixed-boundary"} ${backward ? "backward" : "forward"} selection`, async ({
          page,
        }) => {
          const host = await mount(page, kind);
          await prepareBoundary(page, kind, start);
          await select(page, "甲项", 1, "乙项", 1, backward);
          const before = await page.evaluate(() => window.__semloRequireFixture("flatListTabEditor").editor.getJSON());
          const selected = await selection(page);
          await page.keyboard.press(direction);
          expect((await items(page)).map((item) => item.indent)).toEqual(expected);
          expect(await selection(page)).toEqual(selected);
          expect(await page.evaluate(() => window.flatTabBoundaryPrevented)).toEqual([true]);
          await expect(host.locator(".semlo-editor-prose")).toBeFocused();
          expect(await page.evaluate(() => window.flatTabDocumentChanges)).toBe(atBoundary ? 0 : 1);
          if (atBoundary) {
            expect(
              await page.evaluate(() => window.__semloRequireFixture("flatListTabEditor").editor.getJSON()),
            ).toEqual(before);
          } else {
            const after = await page.evaluate(() => window.__semloRequireFixture("flatListTabEditor").editor.getJSON());
            expect(
              await page.evaluate(() => window.__semloRequireFixture("flatListTabEditor").editor.commands.undo()),
            ).toBe(true);
            expect(
              await page.evaluate(() => window.__semloRequireFixture("flatListTabEditor").editor.getJSON()),
            ).toEqual(before);
            expect(await selection(page)).toEqual(selected);
            expect(
              await page.evaluate(() => window.__semloRequireFixture("flatListTabEditor").editor.commands.redo()),
            ).toBe(true);
            expect(
              await page.evaluate(() => window.__semloRequireFixture("flatListTabEditor").editor.getJSON()),
            ).toEqual(after);
          }
        });
      }
    }
  }
}

// This fallback keeps focus when malformed host metadata prevents indentation;
// the corresponding behavior in Yuque has not been observed.
for (const direction of ["Tab", "Shift+Tab"] as const) {
  for (const backward of [false, true]) {
    test(`${direction}: invalid metadata leaves the document and ${backward ? "backward" : "forward"} selection intact`, async ({
      page,
    }) => {
      const host = await mount(page);
      await prepareBoundary(page, "ordered", [1, 2], true);
      await select(page, "甲项", 1, "乙项", 1, backward);
      const before = await page.evaluate(() => window.__semloRequireFixture("flatListTabEditor").editor.getJSON());
      const selected = await selection(page);
      await page.keyboard.press(direction);
      expect(await page.evaluate(() => window.__semloRequireFixture("flatListTabEditor").editor.getJSON())).toEqual(
        before,
      );
      expect(await selection(page)).toEqual(selected);
      expect(await page.evaluate(() => window.flatTabDocumentChanges)).toBe(0);
      expect(await page.evaluate(() => window.flatTabBoundaryPrevented)).toEqual([true]);
      await expect(host.locator(".semlo-editor-prose")).toBeFocused();
    });
  }
}
