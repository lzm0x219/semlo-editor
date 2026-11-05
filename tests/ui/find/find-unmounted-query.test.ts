import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

for (const query of ["新词", ""] as const) {
  test(`search input changed to ${query || "empty"} during unmount matches highlights after remount`, async ({
    page,
  }) => {
    await installFixtureGuards(page);
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'find-unmounted-query'; document.body.append(host)
    window.findUnmountedQuery = createEditor({ element: host, outline: false, content: '<p>旧词 新词 新词</p>' })
  `,
    });
    const host = page.locator("#find-unmounted-query");
    await host.getByRole("button", { name: "查找替换" }).click();
    const panel = page.getByRole("dialog", { name: "查找替换" });
    const input = panel.getByRole("textbox", { name: "查找内容" });
    await input.fill("旧词");
    await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("1/1");
    await page.evaluate(() => Reflect.get(window, "findUnmountedQuery").editor.unmount());
    await input.fill(query);
    await page.evaluate(() => {
      const editor = Reflect.get(window, "findUnmountedQuery").editor;
      const target = document.createElement("div");
      document.querySelector("#find-unmounted-query .semlo-editor-content")!.append(target);
      editor.mount(target);
    });
    await expect(input).toHaveValue(query);
    await expect(panel.locator(".semlo-editor-find-counter")).toHaveText(query ? "1/2" : "0");
    await expect(host.locator(".semlo-editor-find-match")).toHaveCount(query ? 2 : 0);
    if (query) await expect(host.locator(".semlo-editor-find-match").first()).toHaveText("新词");
    await page.evaluate(() => Reflect.get(window, "findUnmountedQuery").destroy());
  });
}
