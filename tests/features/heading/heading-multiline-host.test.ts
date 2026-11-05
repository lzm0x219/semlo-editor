import { createRsbuild } from "@rsbuild/core";
import { afterAll, beforeAll, expect, test, type Page } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import type { Mode, Order } from "../../fixtures/heading/heading-multiline-host-fixture";
test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

let origin: string;
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  const rsbuild = await createRsbuild({
    cwd: process.cwd(),
    rsbuildConfig: {
      source: { entry: { index: "./tests/fixtures/heading/heading-multiline-host-fixture.ts" } },
      server: { host: "127.0.0.1", port: 0, strictPort: true },
      dev: { hmr: false, liveReload: false },
    },
  });
  const { port, server } = await rsbuild.startDevServer();
  origin = `http://127.0.0.1:${port}`;
  stop = () => server.close();
});
afterAll(async () => stop?.());
async function mount(page: Page, mode: Mode, order: Order) {
  await page.goto(origin);
  await page.waitForFunction(() => typeof window.mountHeadingMultilineHost === "function");
  await page.evaluate(({ mode, order }) => window.__semloRequireFixture("mountHeadingMultilineHost")(mode, order), {
    mode,
    order,
  });
  await page.evaluate(() => window.__semloRequireFixture("headingMultilineHost").settle());
  await page.locator("#heading-multiline-host h3").click({ position: { x: 50, y: 8 } });
  await page.evaluate(() => window.__semloRequireFixture("headingMultilineHost").settle());
  await page.keyboard.press("Home");
}
async function inspect(page: Page) {
  return page.evaluate(() => {
    const fixture = window.__semloRequireFixture("headingMultilineHost");
    const editor = fixture.controller.editor;
    if (editor.isDestroyed)
      return {
        destroyed: true as const,
        prevented: fixture.endEvent()?.defaultPrevented,
        trace: fixture.trace,
        changes: fixture.changes,
      };
    return {
      destroyed: false as const,
      json: editor.getJSON() as JSONContent,
      text: document.getSelection()?.toString(),
      anchor: editor.state.selection.$anchor.parentOffset,
      head: editor.state.selection.$head.parentOffset,
      focused: editor.view.hasFocus(),
      prevented: fixture.endEvent()?.defaultPrevented,
      trace: fixture.trace,
      changes: fixture.changes,
    };
  });
}
for (const order of ["early", "late"] as const)
  for (const mode of ["reject", "append-selection", "append-doc", "destroy", "throw"] as const) {
    test(`${order} ${mode} controls multiline selection`, async ({ page }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await mount(page, mode, order);
      const before = await inspect(page);
      await page.keyboard.press("Shift+End");
      await page.evaluate(() => window.__semloRequireFixture("headingMultilineHost").settle());
      const after = await inspect(page);
      expect(after.prevented).toBe(true);
      expect(after.trace.filter((item) => item === "filter")).toHaveLength(1);
      if (mode === "destroy") expect(after.destroyed).toBe(true);
      else {
        if (before.destroyed || after.destroyed) throw new Error("Unexpected destruction");
        expect(after.focused).toBe(true);
        if (mode === "append-doc") {
          expect(after.json.content?.[1].content?.[0].text).toBe("NEXT!");
          expect(after.changes).toBe(1);
          expect(after.text).toBe("test ".repeat(4));
        } else {
          expect(after.json).toEqual(before.json);
          expect(after.changes).toBe(0);
          expect(after.text).toBe("");
          expect(after.anchor).toBe(0);
          expect(after.head).toBe(0);
        }
      }
      expect(errors).toEqual(mode === "throw" ? ["multiline-host-filter-error"] : []);
    });
  }
for (const kind of ["isComposing", "keyCode229", "compositionstart"] as const) {
  test(`multiline ${kind} leaves the synthetic composition key alone`, async ({ page }) => {
    await mount(page, "observe", "early");
    const before = await inspect(page);
    const prevented = await page.evaluate((kind) => {
      const view = window.__semloRequireFixture("headingMultilineHost").controller.editor.view;
      if (kind === "compositionstart")
        view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
      const event = new KeyboardEvent("keydown", {
        key: "End",
        shiftKey: true,
        bubbles: true,
        cancelable: true,
        isComposing: kind === "isComposing",
      });
      if (kind === "keyCode229") Object.defineProperty(event, "keyCode", { value: 229 });
      view.dom.dispatchEvent(event);
      const prevented = event.defaultPrevented;
      if (kind === "compositionstart")
        view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
      return prevented;
    }, kind);
    const after = await inspect(page);
    if (before.destroyed || after.destroyed) throw new Error("Unexpected destruction");
    expect(prevented).toBe(false);
    expect(after.json).toEqual(before.json);
    expect(after.text).toBe("");
    expect(after.trace).toEqual([]);
    expect(after.changes).toBe(0);
  });
}
