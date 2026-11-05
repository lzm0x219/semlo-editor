import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";

test("controller.destroy during beforeTransaction aborts the uncommitted command", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'controller-before-destroy'
      document.body.append(host)
      window.controllerBeforeDestroy = createEditor({
        element: host, outline: false, content: '<p>alpha</p>',
      })
    `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "controllerBeforeDestroy")));
  const result = await page.evaluate(() => {
    const controller = Reflect.get(window, "controllerBeforeDestroy");
    const editor = controller.editor;
    let calls = 0;
    editor.on("beforeTransaction", () => {
      if (calls++) return;
      controller.destroy();
    });
    let outcome = "not-called";
    try {
      outcome = String(editor.commands.insertContent("X"));
    } catch (error) {
      outcome = error instanceof Error ? error.name : String(error);
    }
    return {
      outcome,
      calls,
      destroyed: editor.isDestroyed,
      shells: document.querySelectorAll("#controller-before-destroy .semlo-editor").length,
    };
  });
  expect(result).toEqual({ outcome: "TransactionAbortedError", calls: 1, destroyed: true, shells: 0 });
});
