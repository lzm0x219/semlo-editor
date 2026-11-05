import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("closing find while unmounted does not restore stale highlights on remount", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'find-close-unmounted'; document.body.append(host)
    window.findCloseUnmounted = createEditor({ element: host, outline: false, content: '<p>查找目标</p>' })
  `,
  });
  const host = page.locator("#find-close-unmounted");
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("目标");
  await expect(host.locator(".semlo-editor-find-match")).toHaveCount(1);
  await page.evaluate(() => Reflect.get(window, "findCloseUnmounted").editor.unmount());
  await panel.getByRole("button", { name: "关闭查找替换" }).click();
  await expect(panel).toHaveCount(0);
  await page.evaluate(() => {
    const editor = Reflect.get(window, "findCloseUnmounted").editor;
    const target = document.createElement("div");
    document.querySelector("#find-close-unmounted .semlo-editor-content")!.append(target);
    editor.mount(target);
  });
  await expect(host.locator(".semlo-editor-find-match")).toHaveCount(0);
  await host.getByRole("button", { name: "查找替换" }).click();
  await expect(panel.getByRole("textbox", { name: "查找内容" })).toHaveValue("");
  await page.evaluate(() => Reflect.get(window, "findCloseUnmounted").destroy());
});
