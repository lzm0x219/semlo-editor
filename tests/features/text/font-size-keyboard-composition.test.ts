import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    imeFontEditor?: EditorController;
  }
}

async function mount(page: Page, platform: "MacIntel" | "Win32" | "Linux x86_64") {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      Object.defineProperty(navigator, 'platform', { configurable: true, value: ${JSON.stringify(platform)} })
      document.body.replaceChildren()
      const host = document.createElement('div')
      host.id = 'ime-font'
      document.body.append(host)
      window.imeFontEditor = createEditor({ element: host, outline: false, content: '<p>测试</p>' })
      const editor = window.imeFontEditor.editor
      editor.view.focus()
      editor.commands.setTextSelection({ from: 1, to: 3 })
    `,
  });
  await page.waitForFunction(() => Boolean(window.imeFontEditor));
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("IME keyCode 229 is not treated as a font-size shortcut", async ({ page }) => {
  await mount(page, "MacIntel");
  const result = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("imeFontEditor").editor;
    const before = editor.getJSON();
    const event = new KeyboardEvent("keydown", {
      key: "=",
      code: "Equal",
      keyCode: 229,
      metaKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    editor.view.dom.dispatchEvent(event);
    return { before, after: editor.getJSON(), prevented: event.defaultPrevented };
  });
  expect(result.prevented).toBe(false);
  expect(result.after).toEqual(result.before);
});

test("an event explicitly marked composing is not consumed", async ({ page }) => {
  await mount(page, "MacIntel");
  const result = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("imeFontEditor").editor;
    const before = editor.getJSON();
    const event = new KeyboardEvent("keydown", {
      key: "=",
      code: "Equal",
      isComposing: true,
      metaKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    editor.view.dom.dispatchEvent(event);
    return { before, after: editor.getJSON(), prevented: event.defaultPrevented };
  });
  expect(result.prevented).toBe(false);
  expect(result.after).toEqual(result.before);
});

test("the font shortcut handler ignores a view in active composition", async ({ page }) => {
  await mount(page, "MacIntel");
  const result = await page.evaluate(() => {
    const editor = window.__semloRequireFixture("imeFontEditor").editor;
    const view = editor.view;
    view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    const composing = view.composing;
    const before = editor.getJSON();
    const event = new KeyboardEvent("keydown", {
      key: "=",
      code: "Equal",
      metaKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    });
    // Exercise the same public ProseMirror handler pipeline directly: its
    // native DOM dispatcher has an independent composition guard.
    const handled = Boolean(view.someProp("handleKeyDown", (handler) => handler(view, event)));
    const after = editor.getJSON();
    view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    return { composing, handled, before, after };
  });
  expect(result.composing).toBe(true);
  expect(result.handled).toBe(false);
  expect(result.after).toEqual(result.before);
});

for (const platform of ["Win32", "Linux x86_64"] as const) {
  test(`${platform} AltGraph text input is not mistaken for Ctrl+Alt font sizing`, async ({ page }) => {
    await mount(page, platform);
    const result = await page.evaluate(() => {
      const editor = window.__semloRequireFixture("imeFontEditor").editor;
      const before = editor.getJSON();
      const event = new KeyboardEvent("keydown", {
        key: "=",
        code: "Equal",
        ctrlKey: true,
        altKey: true,
        modifierAltGraph: true,
        bubbles: true,
        cancelable: true,
      });
      const altGraph = event.getModifierState("AltGraph");
      editor.view.dom.dispatchEvent(event);
      return { altGraph, before, after: editor.getJSON(), prevented: event.defaultPrevented };
    });
    expect(result.altGraph).toBe(true);
    expect(result.prevented).toBe(false);
    expect(result.after).toEqual(result.before);
  });
}

for (const platform of ["MacIntel", "Win32", "Linux x86_64"] as const) {
  for (const [key, code, expected] of [
    ["=", "Equal", "16px"],
    ["-", "Minus", "14px"],
  ] as const) {
    test(`the ordinary ${platform} ${code} font-size shortcut remains usable`, async ({ page }) => {
      await mount(page, platform);
      const result = await page.evaluate(
        ({ platform, key, code }) => {
          const editor = window.__semloRequireFixture("imeFontEditor").editor;
          const event = new KeyboardEvent("keydown", {
            key,
            code,
            metaKey: platform === "MacIntel",
            ctrlKey: platform !== "MacIntel",
            altKey: true,
            bubbles: true,
            cancelable: true,
          });
          editor.view.dom.dispatchEvent(event);
          return { prevented: event.defaultPrevented, json: editor.getJSON() };
        },
        { platform, key, code },
      );
      expect(result.prevented).toBe(true);
      expect(result.json.content?.[0].content?.[0].marks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "textStyle", attrs: expect.objectContaining({ fontSize: expected }) }),
        ]),
      );
    });
  }
}
