import { afterAll, beforeAll, expect, test } from "@rstest/playwright";
import type { JSONContent } from "@tiptap/core";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";
import { startFixtureServer } from "../../fixtures/browser/fixture-rsbuild";
import type {} from "../../fixtures/heading/heading-delete-controlled-fixture";
import type { RestartFramework } from "../../fixtures/list/ordered-restart-controlled-fixture";

let origin = "";
let stop: (() => Promise<void>) | undefined;
beforeAll(async () => {
  ({ origin, stop } = await startFixtureServer("./tests/fixtures/heading/heading-delete-controlled-fixture.ts", {
    framework: true,
  }));
});
afterAll(async () => stop?.());
test.beforeEach(async ({ page }) => installFixtureGuards(page));

for (const framework of ["react", "vue", "solid"] as const satisfies readonly RestartFramework[]) {
  for (const text of ["אבג דהו", "مرحبا بالعالم"]) {
    test(`local RTL ${framework} controlled ${text}: immediate keyboard chain preserves the following block`, async ({
      page,
    }) => {
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(origin);
      await page.waitForFunction(() => typeof window.mountRestartControlledFixture === "function");
      await page.evaluate(
        (framework) => window.__semloRequireFixture("mountRestartControlledFixture")(framework, "legacy"),
        framework,
      );
      await page.evaluate(
        (html) => window.__semloRequireFixture("restartControlledFixture").setContent(html),
        `<h3>${text}</h3><p>NEXT</p>`,
      );
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      await page.evaluate(() => {
        window.__semloRequireFixture("closeHeadingDeleteHistory")();
        window.__semloRequireFixture("restartControlledFixture").controller.editor.view.dom.setAttribute("dir", "rtl");
      });
      const before = await page.evaluate(() => {
        const fixture = window.__semloRequireFixture("restartControlledFixture");
        return {
          snapshot: fixture.controller.getSnapshot(),
          changes: fixture.changes.length,
          documentChanges: fixture.documentChanges,
        };
      });
      expect(before.changes).toBe(0);
      const expected = structuredClone(before.snapshot.json) as JSONContent;
      delete expected.content![0].content;
      await page.locator("#restart-controlled-fixture .semlo-editor-prose h3").click();
      await page.keyboard.press("Home");
      await page.keyboard.press("Shift+End");
      await page.keyboard.press("Backspace");
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      const after = await page.evaluate(() => {
        const fixture = window.__semloRequireFixture("restartControlledFixture");
        const editor = fixture.controller.editor;
        return {
          snapshot: fixture.controller.getSnapshot(),
          changes: fixture.changes,
          documentChanges: fixture.documentChanges,
          focused: editor.view.hasFocus(),
          empty: editor.state.selection.empty,
          errors: fixture.errors,
        };
      });
      expect(after.snapshot.json).toEqual(expected);
      expect(after.snapshot.html).toContain("NEXT");
      expect(after.changes).toHaveLength(1);
      expect(after.changes[0].json).toEqual(expected);
      expect(after.changes[0].html).toEqual(after.snapshot.html);
      expect(after.documentChanges - before.documentChanges).toBe(1);
      expect(after.focused).toBe(true);
      expect(after.empty).toBe(true);
      expect(after.errors).toEqual([]);
      await page.keyboard.press("ControlOrMeta+z");
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      const undo = await page.evaluate(() => {
        const fixture = window.__semloRequireFixture("restartControlledFixture");
        const editor = fixture.controller.editor;
        return {
          snapshot: fixture.controller.getSnapshot(),
          changes: fixture.changes,
          text: document.getSelection()?.toString(),
          selection: { anchor: editor.state.selection.anchor, head: editor.state.selection.head },
        };
      });
      expect(undo.snapshot.json).toEqual(before.snapshot.json);
      expect(undo.snapshot.html).toEqual(before.snapshot.html);
      expect(undo.text).toBe(text);
      expect(undo.selection).toEqual({ anchor: 1, head: text.length + 1 });
      expect(undo.changes).toHaveLength(2);
      await page.keyboard.press("ControlOrMeta+Shift+z");
      await page.evaluate(() => window.__semloRequireFixture("restartControlledFixture").settle());
      const redo = await page.evaluate(() => {
        const fixture = window.__semloRequireFixture("restartControlledFixture");
        return { snapshot: fixture.controller.getSnapshot(), changes: fixture.changes };
      });
      expect(redo.snapshot.json).toEqual(expected);
      expect(redo.snapshot.html).toEqual(after.snapshot.html);
      expect(redo.changes).toHaveLength(3);
      expect(errors).toEqual([]);
    });
  }
}
