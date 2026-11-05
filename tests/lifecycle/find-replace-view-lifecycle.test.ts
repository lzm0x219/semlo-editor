import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";

for (const remount of [false, true]) {
  test(`find replacement does not issue a follow-up transaction after ${remount ? "remount" : "unmount"}`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await installFixtureGuards(page);
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div'); host.id = 'find-view-lifecycle'; document.body.append(host)
      window.findViewLifecycle = createEditor({ element: host, outline: false, content: '<p>旧文目标</p>' })
    `,
    });
    const host = page.locator("#find-view-lifecycle");
    await host.getByRole("button", { name: "查找替换" }).click();
    const panel = page.getByRole("dialog", { name: "查找替换" });
    await panel.getByRole("textbox", { name: "查找内容" }).fill("目标");
    await panel.getByRole("tab", { name: "替换" }).click();
    await panel.getByRole("textbox", { name: "替换为" }).fill("改写");
    await page.evaluate((remount) => {
      const editor = Reflect.get(window, "findViewLifecycle").editor;
      let armed = true;
      editor.on("transaction", ({ transaction }: { transaction: { docChanged: boolean } }) => {
        if (!armed || !transaction.docChanged) return;
        armed = false;
        editor.unmount();
        if (remount) {
          const target = document.createElement("div");
          document.querySelector("#find-view-lifecycle .semlo-editor-content")!.append(target);
          editor.mount(target);
        }
        Reflect.set(window, "findViewStateAfterHost", editor.state);
      });
    }, remount);
    await panel.getByRole("button", { name: "替换", exact: true }).click();
    expect(
      await page.evaluate(() => {
        const api = Reflect.get(window, "findViewLifecycle");
        return {
          sameState: api.editor.state === Reflect.get(window, "findViewStateAfterHost"),
          text: api.editor.state.doc.textContent,
        };
      }),
    ).toEqual({ sameState: true, text: "旧文改写" });
    expect(errors).toEqual([]);
    await page.evaluate(() => {
      const api = Reflect.get(window, "findViewLifecycle");
      if (api.editor.isDestroyed) {
        const target = document.createElement("div");
        document.querySelector("#find-view-lifecycle .semlo-editor-content")!.append(target);
        api.editor.mount(target);
      }
      api.destroy();
    });
    await expect(panel).toHaveCount(0);
  });
}
