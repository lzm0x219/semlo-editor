import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("editing a mixed-format link uses its first run and can undo back to the placeholder", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'link-mixed-reference-test'
      document.body.append(host)
      window.linkMixedReferenceEditor = createEditor({ element: host, outline: false, content: '<p><strong>甲</strong>乙</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "linkMixedReferenceEditor")));
  const host = page.locator("#link-mixed-reference-test");
  await page.evaluate(() =>
    Reflect.get(window, "linkMixedReferenceEditor").editor.chain().setTextSelection({ from: 1, to: 3 }).focus().run(),
  );
  await expect(host.locator(".semlo-editor-prose")).toBeFocused();
  await host.getByRole("toolbar", { name: "文本格式" }).getByRole("button", { name: "链接", exact: true }).click();
  const form = page.getByRole("dialog", { name: "插入链接" });
  await form.getByLabel("文本").fill("新内容");
  await form.getByLabel("链接", { exact: true }).fill("https://example.com");
  await form.getByRole("button", { name: "确定" }).click();
  await expect(host.locator(".semlo-editor-prose strong a, .semlo-editor-prose a strong")).toHaveText("新内容");
  expect(await page.evaluate(() => Reflect.get(window, "linkMixedReferenceEditor").editor.commands.undo())).toBe(true);
  const afterFirst = await page.evaluate(() => Reflect.get(window, "linkMixedReferenceEditor").getSnapshot().json);
  expect(afterFirst.content?.[0]?.content?.map((node: { text: string }) => node.text).join("")).toBe("甲乙");
  expect(
    afterFirst.content?.[0]?.content?.every((node: { marks?: Array<{ type: string }> }) =>
      node.marks?.some((mark) => mark.type === "link"),
    ),
  ).toBe(true);
  expect(afterFirst.content?.[0]?.content?.[0]?.marks?.some((mark: { type: string }) => mark.type === "bold")).toBe(
    true,
  );
  expect(
    afterFirst.content?.[0]?.content?.[1]?.marks?.some((mark: { type: string }) => mark.type === "bold") ?? false,
  ).toBe(false);
  expect(await page.evaluate(() => Reflect.get(window, "linkMixedReferenceEditor").editor.commands.undo())).toBe(true);
  expect(await host.locator(".semlo-editor-prose a").count()).toBe(0);
  await page.evaluate(() => Reflect.get(window, "linkMixedReferenceEditor").destroy());
});
