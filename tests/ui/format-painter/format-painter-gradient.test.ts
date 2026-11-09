import { expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    gradientPainterEditor?: EditorController;
  }
}

const gradient = "linear-gradient(90deg, #2abcbf, #3836dd)";
const text = (value: string, attrs?: Record<string, unknown>): JSONContent => ({
  type: "text",
  text: value,
  ...(attrs ? { marks: [{ type: "textStyle", attrs }] } : {}),
});

async function paint(page: Page, source: JSONContent[], target: JSONContent[], reverse = false) {
  await page.evaluate(
    ({ source, target, reverse }) => {
      const api = window.__semloRequireFixture("gradientPainterEditor");
      api.setContent({
        type: "doc",
        content: [
          { type: "paragraph", content: source },
          { type: "paragraph", content: target },
        ],
      });
      api.editor.commands.focus();
      const end = 1 + source.reduce((total, node) => total + (node.text?.length ?? 0), 0);
      api.editor.commands.setTextSelection(reverse ? { from: end, to: 1 } : { from: 1, to: end });
    },
    { source, target, reverse },
  );
  await page.locator("#gradient-painter-test .semlo-editor-toolbar .semlo-editor-format-painter").click();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("gradientPainterEditor").editor;
    const start = editor.state.doc.child(0).nodeSize + 1;
    editor.commands.focus();
    editor.commands.setTextSelection({ from: start, to: start + editor.state.doc.child(1).textContent.length });
  });
  await page.locator("#gradient-painter-test .semlo-editor-prose").press("Enter");
  return page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").getSnapshot());
}

function targetStyle(snapshot: { json: JSONContent }) {
  return snapshot.json.content?.[1]?.content?.[0]?.marks?.find((mark) => mark.type === "textStyle")?.attrs ?? {};
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("composition keyboard events do not cancel or activate the format painter", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "platform", { configurable: true, value: "Linux x86_64" }),
  );
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'gradient-painter-test'
      document.body.append(host)
      window.gradientPainterEditor = createEditor({ element: host, outline: false, content: '<p><strong>目标</strong></p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.gradientPainterEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("gradientPainterEditor").editor;
    editor.commands.focus();
    editor.commands.setTextSelection({ from: 1, to: 3 });
  });
  const host = page.locator("#gradient-painter-test");
  const painter = host.locator(".semlo-editor-format-painter");
  const prose = host.locator(".semlo-editor-prose");
  await painter.click();
  await expect(painter).toHaveAttribute("aria-pressed", "true");
  const original = await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").getSnapshot().json);
  for (const event of [
    { key: "Escape", isComposing: true },
    { key: "Escape", keyCode: 229 },
    { key: "s", shiftKey: true, ctrlKey: true, isComposing: true },
  ]) {
    const result = await prose.evaluate(
      (element, init) => {
        const key = new KeyboardEvent("keydown", init);
        element.dispatchEvent(key);
        return {
          composing: key.isComposing,
          prevented: key.defaultPrevented,
          json: window.__semloRequireFixture("gradientPainterEditor").getSnapshot().json,
        };
      },
      { ...event, bubbles: true, cancelable: true },
    );
    expect(result.composing).toBe(event.isComposing ?? false);
    expect(result.json).toEqual(original);
    expect(result.prevented).toBe(false);
    await expect(painter, JSON.stringify(event)).toHaveAttribute("aria-pressed", "true");
  }
  await prose.evaluate((element) => element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })));
  expect(await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").editor.view.composing)).toBe(
    true,
  );
  await prose.evaluate((element) =>
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })),
  );
  await expect(painter).toHaveAttribute("aria-pressed", "true");
  const beforeEnter = await page.evaluate(
    () => window.__semloRequireFixture("gradientPainterEditor").getSnapshot().json,
  );
  await prose.evaluate((element) =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", isComposing: true, bubbles: true, cancelable: true }),
    ),
  );
  await expect(painter).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").getSnapshot().json)).toEqual(
    beforeEnter,
  );
  await prose.evaluate((element) => element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
  await page.waitForFunction(() => !window.__semloRequireFixture("gradientPainterEditor").editor.view.composing);
  await prose.evaluate((element) =>
    element.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })),
  );
  await expect(painter).toHaveAttribute("aria-pressed", "false");
  await painter.evaluate((element) =>
    element.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        shiftKey: true,
        isComposing: true,
        bubbles: true,
        cancelable: true,
      }),
    ),
  );
  await expect(painter).toHaveAttribute("aria-pressed", "false");
  await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").destroy());
});

test("starting composition cancels an unfinished painter drag", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'gradient-painter-test'; document.body.append(host)
      window.gradientPainterEditor = createEditor({ element: host, outline: false, content: '<p><strong>源</strong></p><p>目标</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.gradientPainterEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("gradientPainterEditor").editor;
    editor.commands.focus();
    editor.commands.setTextSelection({ from: 1, to: 2 });
  });
  const painter = page.locator("#gradient-painter-test .semlo-editor-format-painter");
  const prose = page.locator("#gradient-painter-test .semlo-editor-prose");
  await painter.click();
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("gradientPainterEditor").editor;
    const start = editor.state.doc.child(0).nodeSize + 1;
    editor.commands.focus();
    editor.commands.setTextSelection({ from: start, to: start + 2 });
  });
  await prose.evaluate((element) => {
    element.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 7, button: 0, clientX: 10, bubbles: true }));
    element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    element.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7, button: 0, clientX: 30, bubbles: true }));
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
  await expect(painter).toHaveAttribute("aria-pressed", "true");
  await expect(prose.locator("p").nth(1).locator("strong")).toHaveCount(0);
  await prose.evaluate((element) => element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })));
  await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").destroy());
});

for (const compositionCase of ["releases Shift", "swallows Shift", "starts after a queued selection"] as const) {
  test(`painter clears keyboard selection when composition ${compositionCase}`, async ({ page }) => {
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'gradient-painter-test'
      document.body.append(host)
      window.gradientPainterEditor = createEditor({ element: host, outline: false, content: '<p><strong>源</strong></p><p>目标</p>' })
    `,
    });
    await page.waitForFunction(() => Boolean(window.gradientPainterEditor));
    await page.evaluate(() => {
      const editor = window.__semloRequireFixture("gradientPainterEditor").editor;
      editor.commands.focus();
      editor.commands.setTextSelection({ from: 1, to: 2 });
    });
    const painter = page.locator("#gradient-painter-test .semlo-editor-format-painter");
    const prose = page.locator("#gradient-painter-test .semlo-editor-prose");
    await painter.click();
    await page.evaluate(() => {
      const editor = window.__semloRequireFixture("gradientPainterEditor").editor;
      const start = editor.state.doc.child(0).nodeSize + 1;
      editor.commands.focus();
      editor.commands.setTextSelection({ from: start, to: start + 2 });
    });
    await prose.evaluate((element, scenario) => {
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift", bubbles: true }));
      if (scenario === "starts after a queued selection") {
        element.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
        element.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", bubbles: true }));
      }
      element.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      if (scenario === "releases Shift")
        element.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", isComposing: true, bubbles: true }));
      element.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    }, compositionCase);
    await page.waitForFunction(() => !window.__semloRequireFixture("gradientPainterEditor").editor.view.composing);
    await prose.evaluate((element) => {
      element.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", shiftKey: true, bubbles: true }));
      element.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", bubbles: true }));
    });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
    await expect(painter).toHaveAttribute("aria-pressed", "true");
    await expect(prose.locator("p").nth(1).locator("strong")).toHaveCount(0);
    await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").destroy());
  });
}

test("format painter copies and clears gradients as text color, using the first source color", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
      host.id = 'gradient-painter-test'
    document.body.prepend(host)
    window.gradientPainterEditor = createEditor({ element: host, outline: false, content: '<p>准备</p>' })
  `,
  });
  await page.waitForFunction(() => Boolean(window.gradientPainterEditor));

  const painted = await paint(
    page,
    [text("源", { semloEditorGradient: gradient })],
    [text("目标", { color: "#123456" })],
  );
  expect(targetStyle(painted).semloEditorGradient).toBe(gradient);
  expect(targetStyle(painted).color).toBeNull();
  expect(await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").editor.commands.undo())).toBe(
    true,
  );
  const undone = await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").getSnapshot());
  expect(targetStyle(undone).color).toBe("#123456");
  expect(targetStyle(undone).semloEditorGradient).toBeNull();

  await page.evaluate((html) => window.__semloRequireFixture("gradientPainterEditor").setContent(html), painted.html);
  expect((await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").getSnapshot())).json).toEqual(
    painted.json,
  );

  const mixedSize = await paint(page, [text("甲", { fontSize: "22px" }), text("乙")], [text("目标")]);
  expect(targetStyle(mixedSize).fontSize).toBe("22px");
  const defaultSize = await paint(
    page,
    [text("甲"), text("乙", { fontSize: "22px" })],
    [text("目标", { fontSize: "24px" })],
  );
  expect(targetStyle(defaultSize).fontSize ?? null).toBeNull();
  const cleared = await paint(page, [text("源")], [text("目标", { semloEditorGradient: gradient })]);
  expect(targetStyle(cleared).semloEditorGradient ?? null).toBeNull();
  const mixed = await paint(
    page,
    [text("甲", { semloEditorGradient: gradient }), text("乙", { color: "#123456" })],
    [text("目标", { color: "#abcdef" })],
  );
  expect(targetStyle(mixed).color).toBeNull();
  expect(targetStyle(mixed).semloEditorGradient).toBe(gradient);
  const mixedDefault = await paint(
    page,
    [text("甲"), text("乙", { color: "#df2a3f" })],
    [text("目标", { color: "#df2a3f" })],
  );
  expect(targetStyle(mixedDefault).color ?? null).toBeNull();
  await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").destroy());
});

test("format painter uses the first selected run's bold state for mixed sources", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'gradient-painter-test'
      document.body.prepend(host)
      window.gradientPainterEditor = createEditor({ element: host, outline: false, content: '<p>准备</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.gradientPainterEditor));
  const code = (value: string): JSONContent => ({ type: "text", text: value, marks: [{ type: "code" }] });
  const linked = (value: string): JSONContent => ({
    type: "text",
    text: value,
    marks: [{ type: "link", attrs: { href: "https://example.com" } }],
  });
  for (const source of [code("源"), linked("源")]) {
    const painted = await paint(page, [source], [text("目标")]);
    const marks = painted.json.content?.[1]?.content?.[0]?.marks ?? [];
    expect(marks.some((mark) => mark.type === "code" || mark.type === "link")).toBe(false);
  }
  const keptCode = await paint(page, [text("源")], [code("目标")]);
  expect(keptCode.json.content?.[1]?.content?.[0]?.marks?.some((mark) => mark.type === "code")).toBe(true);
  const bold = (value: string): JSONContent => ({ type: "text", text: value, marks: [{ type: "bold" }] });
  const isBold = (snapshot: { json: JSONContent }) =>
    snapshot.json.content?.[1]?.content?.[0]?.marks?.some((mark) => mark.type === "bold") ?? false;

  const applied = await paint(page, [bold("甲"), text("乙")], [text("目标")]);
  expect(isBold(applied)).toBe(true);
  const reversed = await paint(page, [bold("甲"), text("乙")], [text("目标")], true);
  expect(isBold(reversed)).toBe(true);
  expect(await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(isBold(await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").getSnapshot()))).toBe(
    false,
  );
  const cleared = await paint(page, [text("甲"), bold("乙")], [bold("目标")]);
  expect(isBold(cleared)).toBe(false);
  expect(await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(isBold(await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").getSnapshot()))).toBe(
    true,
  );
  const decorated = (value: string): JSONContent => ({
    type: "text",
    text: value,
    marks: [{ type: "underline" }, { type: "strike" }],
  });
  const mixedDecorations = await paint(page, [decorated("甲"), text("乙")], [text("目标")]);
  for (const type of ["underline", "strike"]) {
    expect(mixedDecorations.json.content?.[1]?.content?.[0]?.marks?.some((mark) => mark.type === type)).toBe(true);
  }
  const clearedDecorations = await paint(page, [text("甲"), decorated("乙")], [decorated("目标")]);
  for (const type of ["underline", "strike"]) {
    expect(clearedDecorations.json.content?.[1]?.content?.[0]?.marks?.some((mark) => mark.type === type) ?? false).toBe(
      false,
    );
  }
  const highlighted = (value: string): JSONContent => ({
    type: "text",
    text: value,
    marks: [{ type: "highlight", attrs: { color: "#fbf5cb" } }],
  });
  const mixedHighlight = await paint(page, [highlighted("甲"), text("乙")], [text("目标")]);
  expect(
    mixedHighlight.json.content?.[1]?.content?.[0]?.marks?.find((mark) => mark.type === "highlight")?.attrs?.color,
  ).toBe("#fbf5cb");
  const clearedHighlight = await paint(page, [text("甲"), highlighted("乙")], [highlighted("目标")]);
  expect(
    clearedHighlight.json.content?.[1]?.content?.[0]?.marks?.some((mark) => mark.type === "highlight") ?? false,
  ).toBe(false);
  const script = (value: string, type: "subscript" | "superscript"): JSONContent => ({
    type: "text",
    text: value,
    marks: [{ type }],
  });
  for (const [sourceType, targetType] of [
    ["subscript", "superscript"],
    ["superscript", "subscript"],
  ] as const) {
    const switched = await paint(page, [script("甲", sourceType), text("乙")], [script("目标", targetType)]);
    const marks = switched.json.content?.[1]?.content?.[0]?.marks ?? [];
    expect(marks.some((mark) => mark.type === sourceType)).toBe(true);
    expect(marks.some((mark) => mark.type === targetType)).toBe(false);
  }
  const italic = (value: string): JSONContent => ({ type: "text", text: value, marks: [{ type: "italic" }] });
  const mixedItalic = await paint(page, [italic("甲"), text("乙")], [text("目标")]);
  expect(mixedItalic.json.content?.[1]?.content?.[0]?.marks?.some((mark) => mark.type === "italic")).toBe(true);
  const clearedItalic = await paint(page, [text("甲"), italic("乙")], [italic("目标")]);
  expect(clearedItalic.json.content?.[1]?.content?.[0]?.marks?.some((mark) => mark.type === "italic") ?? false).toBe(
    false,
  );
  await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").destroy());
});

test("a click paints a nonempty paragraph and consumes single-use format painter", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'gradient-painter-test'
      document.body.append(host)
      window.gradientPainterEditor = createEditor({ element: host, outline: false, content: '<p><strong>来源</strong></p><p><em>目标</em>文本</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.gradientPainterEditor));
  const before = await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").getSnapshot().json);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("gradientPainterEditor").editor;
    editor.commands.focus();
    editor.commands.setTextSelection({ from: 1, to: 3 });
  });
  await expect(page.locator("#gradient-painter-test .semlo-editor-prose")).toBeFocused();
  const painter = page.locator("#gradient-painter-test .semlo-editor-toolbar .semlo-editor-format-painter");
  await painter.click();
  await page.locator("#gradient-painter-test .semlo-editor-prose p").nth(1).click();
  await expect(painter).toHaveAttribute("aria-pressed", "false");
  const after = await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").getSnapshot().json);
  const target = after.content?.[1]?.content ?? [];
  expect(target.map((node) => node.text).join("")).toBe("目标文本");
  expect(target.every((node) => node.marks?.some((mark) => mark.type === "bold"))).toBe(true);
  expect(target.some((node) => node.marks?.some((mark) => mark.type === "italic"))).toBe(false);
  expect(await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").editor.commands.undo())).toBe(
    true,
  );
  expect(await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").getSnapshot().json)).toEqual(
    before,
  );
  await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").destroy());
});

test("clicking an empty paragraph applies the source typing style", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'gradient-painter-test'
      document.body.append(host)
      window.gradientPainterEditor = createEditor({ element: host, outline: false, content: '<p><strong>来源</strong></p><p></p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.gradientPainterEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("gradientPainterEditor").editor;
    editor.commands.focus();
    editor.commands.setTextSelection({ from: 1, to: 3 });
  });
  await expect(page.locator("#gradient-painter-test .semlo-editor-prose")).toBeFocused();
  const painter = page.locator("#gradient-painter-test .semlo-editor-toolbar .semlo-editor-format-painter");
  await painter.click();
  await page.locator("#gradient-painter-test .semlo-editor-prose p").nth(1).click();
  await expect(painter).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.type("new");
  const after = await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").getSnapshot().json);
  const marks = after.content?.[1]?.content?.[0]?.marks ?? [];
  expect(marks.some((mark) => mark.type === "bold")).toBe(true);
  await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").destroy());
});

test("continuous painter survives typing but exits when the document is replaced", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'gradient-painter-test'
      document.body.append(host)
      window.gradientPainterEditor = createEditor({ element: host, outline: false, content: '<p><strong>来源</strong></p><p></p><p>目标</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.gradientPainterEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("gradientPainterEditor").editor;
    editor.commands.focus();
    editor.commands.setTextSelection({ from: 1, to: 3 });
  });
  await expect(page.locator("#gradient-painter-test .semlo-editor-prose")).toBeFocused();
  const painter = page.locator("#gradient-painter-test .semlo-editor-toolbar .semlo-editor-format-painter");
  await painter.dblclick();
  await page.locator("#gradient-painter-test .semlo-editor-prose p").nth(1).click();
  await page.keyboard.type("new");
  await expect(painter).toHaveAttribute("aria-pressed", "true");
  await page.locator("#gradient-painter-test .semlo-editor-prose p").nth(2).click();
  await expect(painter).toHaveAttribute("aria-pressed", "true");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window
            .__semloRequireFixture("gradientPainterEditor")
            .getSnapshot()
            .json.content?.[2]?.content?.[0]?.marks?.some((mark) => mark.type === "bold") ?? false,
      ),
    )
    .toBe(true);
  await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").setContent("<p>替换文档</p>"));
  await expect(painter).toHaveAttribute("aria-pressed", "false");
  await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").destroy());
});

test("continuous painter exits when a plugin appends a whole-document replacement", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'gradient-painter-test'
      document.body.append(host)
      window.gradientPainterEditor = createEditor({ element: host, outline: false, content: '<p><strong>来源</strong></p><p>目标</p>' })
      const editor = window.gradientPainterEditor.editor
      const Plugin = editor.state.plugins[0].constructor
      editor.registerPlugin(new Plugin({
        appendTransaction(transactions, oldState, state) {
          if (transactions.some(transaction => transaction.getMeta('painter-roundtrip-test')))
            return state.tr.replaceWith(0, state.doc.content.size, oldState.doc.content)
          if (transactions.some(transaction => transaction.getMeta('painter-equal-test')))
            return state.tr.replaceWith(0, state.doc.content.size, state.doc.content)
          if (!transactions.some(transaction => transaction.getMeta('painter-replace-test'))) return null
          const transaction = state.tr.insertText('中间', 1)
          return transaction.replaceWith(0, transaction.doc.content.size, state.schema.nodes.paragraph.create(null, state.schema.text('新文档')))
        },
      }))
    `,
  });
  await page.waitForFunction(() => Boolean(window.gradientPainterEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("gradientPainterEditor").editor;
    editor.commands.focus();
    editor.commands.setTextSelection({ from: 1, to: 3 });
  });
  const painter = page.locator("#gradient-painter-test .semlo-editor-toolbar .semlo-editor-format-painter");
  await painter.dblclick();
  await expect(painter).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("gradientPainterEditor").editor;
    const { state } = editor;
    const temporary = state.schema.nodes.paragraph.create(null, state.schema.text("临时内容"));
    editor.view.dispatch(
      state.tr.replaceWith(0, state.doc.content.size, temporary).setMeta("painter-roundtrip-test", true),
    );
  });
  await expect(painter).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("gradientPainterEditor").editor;
    editor.view.dispatch(editor.state.tr.setMeta("painter-equal-test", true));
  });
  await expect(painter).toHaveAttribute("aria-pressed", "true");
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("gradientPainterEditor").editor;
    editor.view.dispatch(editor.state.tr.setMeta("painter-replace-test", true));
  });
  await expect(page.locator("#gradient-painter-test .semlo-editor-prose")).toHaveText("新文档");
  await expect(painter).toHaveAttribute("aria-pressed", "false");
  await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").destroy());
});

test("clicking a heading keeps the painter active and selecting it applies text formatting", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'gradient-painter-test'
      document.body.append(host)
      window.gradientPainterEditor = createEditor({ element: host, outline: false, content: '<p><strong><em><span style="font-size: 22px; color: #df2a3f">来源</span></em></strong></p><h2>标题目标</h2>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.gradientPainterEditor));
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("gradientPainterEditor").editor;
    editor.commands.focus();
    editor.commands.setTextSelection({ from: 1, to: 3 });
  });
  await expect(page.locator("#gradient-painter-test .semlo-editor-prose")).toBeFocused();
  const painter = page.locator("#gradient-painter-test .semlo-editor-toolbar .semlo-editor-format-painter");
  await painter.click();
  const heading = page.locator("#gradient-painter-test .semlo-editor-prose h2");
  await heading.click();
  await expect(painter).toHaveAttribute("aria-pressed", "true");
  const points = await heading.evaluate((element) => {
    const text = [...element.childNodes].find((node) => node.nodeType === Node.TEXT_NODE);
    if (!text?.textContent) throw new Error("Heading text missing");
    const range = document.createRange();
    range.selectNodeContents(text);
    const rect = range.getBoundingClientRect();
    return { left: rect.left, right: rect.right, middle: rect.top + rect.height / 2 };
  });
  await page.mouse.move(points.left + 1, points.middle);
  await page.mouse.down();
  await page.mouse.move(points.right - 1, points.middle, { steps: 5 });
  await page.mouse.up();
  await expect(painter).toHaveAttribute("aria-pressed", "false");
  const result = await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").getSnapshot().json);
  const marks = result.content?.[1]?.content?.[0]?.marks ?? [];
  expect(marks.some((mark) => mark.type === "bold")).toBe(true);
  expect(marks.some((mark) => mark.type === "italic")).toBe(true);
  expect(marks.find((mark) => mark.type === "textStyle")?.attrs?.fontSize).toBe("22px");
  expect(marks.find((mark) => mark.type === "textStyle")?.attrs?.color).toBeTruthy();
  await page.evaluate(() => window.__semloRequireFixture("gradientPainterEditor").destroy());
});
