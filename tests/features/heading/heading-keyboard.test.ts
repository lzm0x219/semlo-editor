import { expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    headingKeyboardEditor?: EditorController;
  }
}

async function mount(page: Page, content: JSONContent) {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'heading-keyboard-test'
      document.body.prepend(host)
      window.headingKeyboardEditor = createEditor({
        element: host, toolbar: false, outline: false, content: ${JSON.stringify(content)},
      })
    `,
  });
  await page.waitForFunction(() => Boolean(window.headingKeyboardEditor));
  return page.locator("#heading-keyboard-test");
}

const paragraph = (text = ""): JSONContent => ({
  type: "paragraph",
  ...(text ? { content: [{ type: "text", text }] } : {}),
});

const heading = (level: number, text = ""): JSONContent => ({
  type: "heading",
  attrs: { level },
  ...(text ? { content: [{ type: "text", text }] } : {}),
});

async function focusSelection(page: Page, from: number, to = from) {
  await page.evaluate(
    ({ from, to }) => {
      const editor = window.__semloRequireFixture("headingKeyboardEditor").editor;
      editor.view.focus();
      editor.commands.setTextSelection({ from, to });
    },
    { from, to },
  );
}

async function blocks(page: Page) {
  return page.evaluate(() => {
    const result: Array<{ type: string; level: number | null; text: string }> = [];
    window.__semloRequireFixture("headingKeyboardEditor").editor.state.doc.forEach((node) => {
      result.push({
        type: node.type.name,
        level: node.type.name === "heading" ? node.attrs.level : null,
        text: node.textContent,
      });
    });
    return result;
  });
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("Backspace at the beginning of a heading converts levels 1–6 without merging the previous block", async ({
  page,
}) => {
  const host = await mount(page, { type: "doc", content: [paragraph("before"), heading(1, "title")] });
  for (let level = 1; level <= 6; level += 1) {
    await page.evaluate((content) => window.__semloRequireFixture("headingKeyboardEditor").setContent(content), {
      type: "doc",
      content: [paragraph("before"), heading(level, "title")],
    });
    await focusSelection(page, 9);
    await page.keyboard.press("Backspace");
    expect(await blocks(page)).toEqual([
      { type: "paragraph", level: null, text: "before" },
      { type: "paragraph", level: null, text: "title" },
    ]);
    await expect(host.locator(".semlo-editor-prose > p")).toHaveCount(2);
  }
});

test("Backspace immediately after a heading input rule creates an empty paragraph", async ({ page }) => {
  const host = await mount(page, { type: "doc", content: [paragraph()] });
  for (let level = 1; level <= 6; level += 1) {
    await page.evaluate((content) => window.__semloRequireFixture("headingKeyboardEditor").setContent(content), {
      type: "doc",
      content: [paragraph()],
    });
    await focusSelection(page, 1);
    await page.keyboard.type("#".repeat(level));
    await page.keyboard.press("Space");
    await expect(host.locator(`.semlo-editor-prose > h${level}`)).toHaveCount(1);
    await page.keyboard.press("Backspace");
    expect(await blocks(page)).toEqual([{ type: "paragraph", level: null, text: "" }]);
  }
  await page.evaluate((content) => window.__semloRequireFixture("headingKeyboardEditor").setContent(content), {
    type: "doc",
    content: [paragraph()],
  });
  await focusSelection(page, 1);
  await page.keyboard.type("###");
  await page.keyboard.press("Space");
  await page.keyboard.press("Backspace");
  await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").editor.commands.undo());
  expect(await blocks(page)).toEqual([{ type: "heading", level: 3, text: "" }]);
  await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").editor.commands.redo());
  expect(await blocks(page)).toEqual([{ type: "paragraph", level: null, text: "" }]);
});

test("Enter preserves heading split and paragraph behavior", async ({ page }) => {
  await mount(page, { type: "doc", content: [heading(3)] });
  await focusSelection(page, 1);
  await page.keyboard.press("Enter");
  expect(await blocks(page)).toEqual([
    { type: "heading", level: 3, text: "" },
    { type: "paragraph", level: null, text: "" },
  ]);
  await page.evaluate((content) => window.__semloRequireFixture("headingKeyboardEditor").setContent(content), {
    type: "doc",
    content: [heading(4, "abcd")],
  });
  await focusSelection(page, 3);
  await page.keyboard.press("Enter");
  expect(await blocks(page)).toEqual([
    { type: "heading", level: 4, text: "ab" },
    { type: "heading", level: 4, text: "cd" },
  ]);
  await page.evaluate((content) => window.__semloRequireFixture("headingKeyboardEditor").setContent(content), {
    type: "doc",
    content: [heading(4, "abcd")],
  });
  await focusSelection(page, 5);
  await page.keyboard.press("Enter");
  expect(await blocks(page)).toEqual([
    { type: "heading", level: 4, text: "abcd" },
    { type: "paragraph", level: null, text: "" },
  ]);
});

test("Backspace with a text selection deletes the selection instead of changing heading type", async ({ page }) => {
  await mount(page, { type: "doc", content: [heading(4, "abcd")] });
  await focusSelection(page, 1, 3);
  await page.keyboard.press("Backspace");
  expect(await blocks(page)).toEqual([{ type: "heading", level: 4, text: "cd" }]);
  await page.evaluate((content) => window.__semloRequireFixture("headingKeyboardEditor").setContent(content), {
    type: "doc",
    content: [heading(4, "abcd")],
  });
  await focusSelection(page, 3, 1);
  await page.keyboard.press("Backspace");
  expect(await blocks(page)).toEqual([{ type: "heading", level: 4, text: "cd" }]);
});

test("conversion preserves inline marks and is isolated for undo and redo", async ({ page }) => {
  await mount(page, {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 4, textAlign: "center" },
        content: [{ type: "text", text: "abcd", marks: [{ type: "italic" }] }],
      },
    ],
  });
  await focusSelection(page, 5);
  await page.keyboard.type("!");
  await focusSelection(page, 1);
  await page.keyboard.press("Backspace");
  let node = await page.evaluate(
    () => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json.content![0],
  );
  expect(node.type).toBe("paragraph");
  expect(node.attrs?.textAlign).toBe("center");
  expect(node.content?.map((item) => item.text).join("")).toBe("abcd!");
  expect(node.content?.[0].marks?.some((mark) => mark.type === "italic")).toBe(true);
  await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").editor.commands.undo());
  node = await page.evaluate(
    () => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json.content![0],
  );
  expect(node.type).toBe("heading");
  expect(node.attrs?.level).toBe(4);
  expect(node.content?.map((item) => item.text).join("")).toBe("abcd!");
  await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").editor.commands.undo());
  expect(await blocks(page)).toEqual([{ type: "heading", level: 4, text: "abcd" }]);
  await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").editor.commands.redo());
  expect(await blocks(page)).toEqual([{ type: "heading", level: 4, text: "abcd!" }]);
  await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").editor.commands.redo());
  expect(await blocks(page)).toEqual([{ type: "paragraph", level: null, text: "abcd!" }]);
});

test("ordinary paragraph Backspace and other input-rule undo retain their existing behavior", async ({ page }) => {
  const host = await mount(page, { type: "doc", content: [paragraph("before"), paragraph("after")] });
  await focusSelection(page, 9);
  await page.keyboard.press("Backspace");
  expect(await blocks(page)).toEqual([{ type: "paragraph", level: null, text: "beforeafter" }]);
  await page.evaluate((content) => window.__semloRequireFixture("headingKeyboardEditor").setContent(content), {
    type: "doc",
    content: [paragraph()],
  });
  await focusSelection(page, 1);
  await page.keyboard.type("-");
  await page.keyboard.press("Space");
  await expect(host.locator(".semlo-editor-prose > ul")).toHaveCount(1);
  await page.keyboard.press("Backspace");
  expect(await blocks(page)).toEqual([{ type: "paragraph", level: null, text: "- " }]);
});

test("bold shortcut leaves single and mixed-level heading selections unchanged", async ({ page }) => {
  await mount(page, { type: "doc", content: [heading(3, "alpha"), heading(4, "bravo")] });
  const modifier = await page.evaluate(() => (/Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "Meta" : "Control"));
  await focusSelection(page, 1);
  await page.keyboard.press(`${modifier}+b`);
  await page.keyboard.type("x");
  let snapshot = await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json);
  expect(snapshot.content?.[0].content?.some((node) => node.marks?.some((mark) => mark.type === "bold"))).toBe(false);
  await focusSelection(page, 1, 7);
  snapshot = await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json);
  await page.keyboard.press(`${modifier}+b`);
  expect(await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json)).toEqual(
    snapshot,
  );
  // xalpha has node size 8; the second heading starts at position 8.
  await focusSelection(page, 1, 14);
  snapshot = await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json);
  await page.keyboard.press(`${modifier}+b`);
  expect(await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json)).toEqual(
    snapshot,
  );
});

test("bold shortcut changes only paragraph text in mixed heading selections", async ({ page }) => {
  await mount(page, { type: "doc", content: [heading(3, "alpha"), paragraph("bravo")] });
  const modifier = await page.evaluate(() => (/Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "Meta" : "Control"));
  await focusSelection(page, 1, 13);
  await page.keyboard.press(`${modifier}+b`);
  const nodes = await page.evaluate(
    () => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json.content!,
  );
  expect(nodes[0].content?.some((node) => node.marks?.some((mark) => mark.type === "bold"))).toBe(false);
  expect(nodes[1].content?.some((node) => node.marks?.some((mark) => mark.type === "bold"))).toBe(true);
  await page.evaluate((content) => window.__semloRequireFixture("headingKeyboardEditor").setContent(content), {
    type: "doc",
    content: [heading(3, "alpha"), paragraph("bravo"), heading(4, "charlie")],
  });
  await focusSelection(page, 1, 21);
  await page.keyboard.press(`${modifier}+b`);
  const spanning = await page.evaluate(
    () => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json.content!,
  );
  expect(spanning[0].content?.some((node) => node.marks?.some((mark) => mark.type === "bold"))).toBe(false);
  expect(spanning[1].content?.some((node) => node.marks?.some((mark) => mark.type === "bold"))).toBe(true);
  expect(spanning[2].content?.some((node) => node.marks?.some((mark) => mark.type === "bold"))).toBe(false);
});

test("mixed bold toggle preserves existing heading marks and restores mixed paragraph marks on undo", async ({
  page,
}) => {
  await mount(page, {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 3 }, content: [{ type: "text", text: "alpha", marks: [{ type: "bold" }] }] },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "br", marks: [{ type: "bold" }] },
          { type: "text", text: "avo", marks: [{ type: "italic" }] },
        ],
      },
    ],
  });
  const modifier = await page.evaluate(() => (/Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "Meta" : "Control"));
  await focusSelection(page, 1, 13);
  const before = await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json);
  await page.keyboard.press(`${modifier}+b`);
  const after = await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json);
  expect(after.content?.[0]).toEqual(before.content?.[0]);
  expect(after.content?.[1].content?.every((node) => node.marks?.some((mark) => mark.type === "bold"))).toBe(true);
  await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").editor.commands.undo());
  expect(await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json)).toEqual(
    before,
  );
  await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").editor.commands.redo());
  expect(await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json)).toEqual(
    after,
  );
  await page.keyboard.press(`${modifier}+b`);
  const removed = await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json);
  expect(removed.content?.[0]).toEqual(before.content?.[0]);
  expect(removed.content?.[1].content?.some((node) => node.marks?.some((mark) => mark.type === "bold"))).toBe(false);
  await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").editor.commands.undo());
  expect(await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json)).toEqual(
    after,
  );
});

test("Mod+Alt+0–6 converts styles, clears inline formatting, and can be undone", async ({ page }) => {
  await mount(page, { type: "doc", content: [paragraph("initial")] });
  const modifier = await page.evaluate(() => (/Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "Meta" : "Control"));
  for (let level = 0; level <= 6; level += 1) {
    const block: JSONContent = {
      type: level === 0 ? "heading" : "paragraph",
      ...(level === 0 ? { attrs: { level: 4 } } : {}),
      content: [
        {
          type: "text",
          text: "format",
          marks: [
            { type: "bold" },
            { type: "italic" },
            { type: "underline" },
            { type: "strike" },
            { type: "subscript" },
            { type: "textStyle", attrs: { fontSize: "18px", color: "#ff0000" } },
          ],
        },
      ],
    };
    await page.evaluate((content) => window.__semloRequireFixture("headingKeyboardEditor").setContent(content), {
      type: "doc",
      content: [block],
    });
    await focusSelection(page, 1, 7);
    const before = await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json);
    await page.keyboard.press(`${modifier}+Alt+${level}`);
    const result = await page.evaluate(
      () => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json.content![0],
    );
    expect(result.type).toBe(level === 0 ? "paragraph" : "heading");
    if (level) expect(result.attrs?.level).toBe(level);
    expect(result.content?.[0].text).toBe("format");
    expect(
      result.content?.[0].marks?.some((mark) =>
        ["bold", "italic", "underline", "strike", "subscript"].includes(mark.type),
      ),
    ).not.toBe(true);
    const textStyle = result.content?.[0].marks?.find((mark) => mark.type === "textStyle");
    expect(textStyle?.attrs?.fontSize).toBeNull();
    expect(textStyle?.attrs?.color).toBe("#ff0000");
    await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").editor.commands.undo());
    expect(await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json)).toEqual(
      before,
    );
  }
});

test("repeating the same heading shortcut switches the block back to paragraph", async ({ page }) => {
  await mount(page, { type: "doc", content: [paragraph("text")] });
  const modifier = await page.evaluate(() => (/Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "Meta" : "Control"));
  await focusSelection(page, 1);
  await page.keyboard.press(`${modifier}+Alt+3`);
  expect(await blocks(page)).toEqual([{ type: "heading", level: 3, text: "text" }]);
  await page.keyboard.press(`${modifier}+Alt+3`);
  expect(await blocks(page)).toEqual([{ type: "paragraph", level: null, text: "text" }]);
  await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").editor.commands.undo());
  expect(await blocks(page)).toEqual([{ type: "heading", level: 3, text: "text" }]);
  await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").editor.commands.redo());
  expect(await blocks(page)).toEqual([{ type: "paragraph", level: null, text: "text" }]);
});

test("Mod+Alt+0 resets italic and font size even when the block is already a paragraph", async ({ page }) => {
  const content: JSONContent = {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "format",
            marks: [{ type: "italic" }, { type: "textStyle", attrs: { fontSize: "16px", color: "#ff0000" } }],
          },
        ],
      },
    ],
  };
  await mount(page, content);
  const modifier = await page.evaluate(() => (/Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "Meta" : "Control"));
  for (const [from, to] of [
    [1, 1],
    [2, 4],
  ]) {
    await page.evaluate((value) => window.__semloRequireFixture("headingKeyboardEditor").setContent(value), content);
    await focusSelection(page, from, to);
    const before = await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json);
    await page.keyboard.press(`${modifier}+Alt+0`);
    const after = await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json);
    const block = after.content?.[0];
    expect(block?.type).toBe("paragraph");
    expect(block?.content?.[0].text).toBe("format");
    expect(block?.content?.[0].marks?.some((mark) => mark.type === "italic")).not.toBe(true);
    const style = block?.content?.[0].marks?.find((mark) => mark.type === "textStyle");
    expect(style?.attrs?.fontSize).toBeNull();
    expect(style?.attrs?.color).toBe("#ff0000");
    await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").editor.commands.undo());
    expect(await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json)).toEqual(
      before,
    );
    await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").editor.commands.redo());
    expect(await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json)).toEqual(
      after,
    );
  }
});

test("heading shortcuts honor physical digits when Alt changes the key value", async ({ page }) => {
  await mount(page, { type: "doc", content: [paragraph("text")] });
  await focusSelection(page, 1);
  const result = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("headingKeyboardEditor").editor;
    const mod = /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
    const fire = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      editor.view.dom.dispatchEvent(event);
      return { prevented: event.defaultPrevented, json: editor.getJSON() };
    };
    const converted = fire({ key: "£", code: "Digit3", keyCode: 51, altKey: true, ...mod });
    const shifted = fire({ key: "£", code: "Digit3", keyCode: 51, altKey: true, shiftKey: true, ...mod });
    return { converted, shifted };
  });
  expect(result.converted.prevented).toBe(true);
  expect(result.converted.json.content?.[0].attrs?.level).toBe(3);
  expect(result.shifted.prevented).toBe(false);
  expect(result.shifted.json).toEqual(result.converted.json);
});

test("Control-based shortcuts work when the platform is not macOS", async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, "platform", { configurable: true, get: () => "Win32" }),
  );
  await mount(page, { type: "doc", content: [paragraph("text")] });
  await focusSelection(page, 1);
  await page.keyboard.press("Control+Alt+3");
  expect(await blocks(page)).toEqual([{ type: "heading", level: 3, text: "text" }]);
  await focusSelection(page, 1, 5);
  const before = await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json);
  await page.keyboard.press("Control+b");
  expect(await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json)).toEqual(
    before,
  );
  await page.keyboard.press("Control+Alt+3");
  expect(await blocks(page)).toEqual([{ type: "paragraph", level: null, text: "text" }]);
  const altGraph = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("headingKeyboardEditor").editor;
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "³",
      code: "Digit3",
      keyCode: 51,
      ctrlKey: true,
      altKey: true,
      modifierAltGraph: true,
    });
    editor.view.dom.dispatchEvent(event);
    return { altGraph: event.getModifierState("AltGraph"), prevented: event.defaultPrevented };
  });
  expect(altGraph).toEqual({ altGraph: true, prevented: false });
  expect(await blocks(page)).toEqual([{ type: "paragraph", level: null, text: "text" }]);
});

test("font-size shortcut leaves headings unchanged and applies only to paragraphs in a mixed selection", async ({
  page,
}) => {
  await mount(page, { type: "doc", content: [heading(2, "alpha"), paragraph("bravo")] });
  const modifier = await page.evaluate(() => (/Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "Meta" : "Control"));
  await focusSelection(page, 1, 6);
  const before = await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json);
  await page.keyboard.press(`${modifier}+Alt+=`);
  expect(await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json)).toEqual(
    before,
  );
  await focusSelection(page, 1, 13);
  await page.keyboard.press(`${modifier}+Alt+=`);
  const after = await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json);
  expect(after.content?.[0]).toEqual(before.content?.[0]);
  expect(after.content?.[1].content?.[0].marks?.find((mark) => mark.type === "textStyle")?.attrs?.fontSize).toBe(
    "16px",
  );
  await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").editor.commands.undo());
  expect(await page.evaluate(() => window.__semloRequireFixture("headingKeyboardEditor").getSnapshot().json)).toEqual(
    before,
  );
});

test("modified Backspace shortcuts do not convert a heading", async ({ page }) => {
  await mount(page, { type: "doc", content: [heading(3, "alpha")] });
  for (const key of ["Alt+Backspace", "Control+Backspace", "Meta+Backspace", "Shift+Backspace"]) {
    await page.evaluate((content) => window.__semloRequireFixture("headingKeyboardEditor").setContent(content), {
      type: "doc",
      content: [heading(3, "alpha")],
    });
    await focusSelection(page, 1);
    await page.keyboard.press(key);
    expect((await blocks(page))[0]?.type).toBe("heading");
  }
});

test("read-only and IME composition do not trigger heading conversion or bold", async ({ page }) => {
  await mount(page, { type: "doc", content: [heading(3, "alpha")] });
  await focusSelection(page, 1);
  const result = await page.evaluate(() => {
    const controller = window.__semloRequireFixture("headingKeyboardEditor");
    const editor = controller.editor;
    const before = JSON.stringify(editor.getJSON());
    const events: Array<{ prevented: boolean; changed: boolean; bold: boolean; composing?: boolean }> = [];
    const mod = /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
    const send = (init: KeyboardEventInit) => {
      const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      editor.view.dom.dispatchEvent(event);
      events.push({
        prevented: event.defaultPrevented,
        changed: JSON.stringify(editor.getJSON()) !== before,
        bold: editor.state.storedMarks?.some((mark) => mark.type.name === "bold") ?? false,
        composing: editor.view.composing,
      });
    };
    controller.setEditable(false);
    send({ key: "Backspace", keyCode: 8 });
    send({ key: "b", keyCode: 66, ...mod });
    controller.setEditable(true);
    send({ key: "Backspace", keyCode: 8, isComposing: true });
    send({ key: "Backspace", keyCode: 229 });
    send({ key: "b", keyCode: 66, isComposing: true, ...mod });
    send({ key: "3", code: "Digit3", keyCode: 51, altKey: true, isComposing: true, ...mod });
    editor.view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    send({ key: "Backspace", keyCode: 8 });
    editor.view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    return events;
  });
  expect(result.map(({ prevented, changed, bold }) => ({ prevented, changed, bold }))).toEqual([
    { prevented: false, changed: false, bold: false },
    { prevented: false, changed: false, bold: false },
    { prevented: false, changed: false, bold: false },
    { prevented: false, changed: false, bold: false },
    { prevented: false, changed: false, bold: false },
    { prevented: false, changed: false, bold: false },
    { prevented: false, changed: false, bold: false },
  ]);
  expect(result[6].composing).toBe(true);
});
