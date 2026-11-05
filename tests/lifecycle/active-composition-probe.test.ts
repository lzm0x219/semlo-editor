import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";

test("compositionstart followed by composing Enter does not edit the document", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div'); document.body.append(host)
      window.activeCompositionProbe = createEditor({
        element: host, outline: false, toolbar: false, content: '<p>alpha</p>',
      })
    `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "activeCompositionProbe")));
  const result = await page.evaluate(() => {
    const controller = Reflect.get(window, "activeCompositionProbe");
    const view = controller.editor.view;
    view.dom.focus();
    const before = view.state.doc.toJSON();
    view.dom.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true, data: "" }));
    const composing = view.composing;
    const event = new KeyboardEvent("keydown", {
      key: "Enter",
      keyCode: 229,
      isComposing: true,
      bubbles: true,
      cancelable: true,
    });
    const unprevented = view.dom.dispatchEvent(event);
    const after = view.state.doc.toJSON();
    view.dom.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "" }));
    controller.destroy();
    return { composing, unprevented, before, after };
  });
  expect(result.composing).toBe(true);
  expect(result.unprevented).toBe(true);
  expect(result.after).toEqual(result.before);
});
