import { expect, test } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

test("search expansion of a collapsed card is an independent undoable edit", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'find-details-history-test'
      document.body.append(host)
      window.findDetailsHistoryEditor = createEditor({
        element: host,
        outline: false,
        content: '<p>前文</p><details><summary>卡片标题</summary><div data-type="detailsContent"><p>折叠命中文字</p></div></details>'
      })
    `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "findDetailsHistoryEditor")));
  const host = page.locator("#find-details-history-test");
  await page.evaluate(() => {
    const api = Reflect.get(window, "findDetailsHistoryEditor");
    api.editor.chain().setTextSelection(3).insertContent("新").run();
  });
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("折叠命中");
  await expect(host.getByText("折叠命中文字")).toBeVisible();
  await panel.getByRole("button", { name: "关闭查找替换" }).click();
  expect(await page.evaluate(() => Reflect.get(window, "findDetailsHistoryEditor").editor.commands.undo())).toBe(true);
  await expect(host.getByText("折叠命中文字")).toBeHidden();
  await expect(host.locator(".semlo-editor-prose > p").first()).toHaveText("前文新");
  expect(await page.evaluate(() => Reflect.get(window, "findDetailsHistoryEditor").editor.commands.undo())).toBe(true);
  await expect(host.locator(".semlo-editor-prose > p").first()).toHaveText("前文");
  expect(await page.evaluate(() => Reflect.get(window, "findDetailsHistoryEditor").editor.commands.redo())).toBe(true);
  await expect(host.locator(".semlo-editor-prose > p").first()).toHaveText("前文新");
  await expect(host.getByText("折叠命中文字")).toBeHidden();
  expect(await page.evaluate(() => Reflect.get(window, "findDetailsHistoryEditor").editor.commands.redo())).toBe(true);
  await expect(host.getByText("折叠命中文字")).toBeVisible();
  await page.evaluate(() => Reflect.get(window, "findDetailsHistoryEditor").destroy());
});

test("searching a collapsed card title reveals its body in editable and read-only modes", async ({ page }) => {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div')
    host.id = 'find-card-title-test'
    document.body.append(host)
    window.findCardTitleEditor = createEditor({ element: host, outline: false,
      content: '<p>前文</p><details><summary>标题样本</summary><div data-type="detailsContent"><p>卡片正文</p></div></details>' })
  `,
  });
  await page.waitForFunction(() => Boolean(Reflect.get(window, "findCardTitleEditor")));
  const host = page.locator("#find-card-title-test");
  await page.evaluate(() =>
    Reflect.get(window, "findCardTitleEditor").editor.chain().setTextSelection(3).insertContent("新").run(),
  );
  await host.getByRole("button", { name: "查找替换" }).click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("标题样本");
  await expect(host.getByText("卡片正文")).toBeVisible();
  await panel.getByRole("button", { name: "关闭查找替换" }).click();
  expect(await page.evaluate(() => Reflect.get(window, "findCardTitleEditor").editor.commands.undo())).toBe(true);
  await expect(host.getByText("卡片正文")).toBeVisible();
  await expect(host.locator(".semlo-editor-prose > p").first()).toHaveText("前文");
  await host.getByRole("button", { name: "收起内容" }).click();
  await expect(host.getByText("卡片正文")).toBeHidden();
  await page.evaluate(() => Reflect.get(window, "findCardTitleEditor").setEditable(false));
  await host.getByText("标题样本", { exact: true }).click();
  await page.keyboard.press("ControlOrMeta+f");
  await panel.getByRole("textbox", { name: "查找内容" }).fill("标题样本");
  await expect(host.getByText("卡片正文")).toBeVisible();
  expect(
    await page.evaluate(() => Reflect.get(window, "findCardTitleEditor").editor.getJSON().content[1].attrs.open),
  ).toBe(false);
  await page.evaluate(() => Reflect.get(window, "findCardTitleEditor").destroy());
});
