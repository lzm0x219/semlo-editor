import { expect, test } from "@rstest/playwright";

import { createDatabaseData, type DatabaseData } from "../../../packages/core/src/features/database/model";
import type { EditorController } from "../../../packages/core/src/types";
import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    databaseImeEditor?: EditorController;
    databaseSessionEditors?: EditorController[];
    databaseSessionRemount?: () => void;
  }
}

test("composition Enter neither blurs a cell nor creates an option", async ({ page }) => {
  await installFixtureGuards(page);
  const data = createDatabaseData();
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "databaseImeContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
    import { createEditor } from '/dist/index.js'
    const host = document.createElement('div'); host.id = 'database-ime'; document.body.prepend(host)
    window.databaseImeEditor = createEditor({element: host, outline: false, content: window.databaseImeContent})
  `,
  });
  const root = page.locator("#database-ime .semlo-editor-database");
  const text = root.getByLabel("第 1 行 文本");
  await text.fill("拼音");
  await page.evaluate(() => {
    for (const options of [{ isComposing: true }, { keyCode: 229 }])
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, ...options }));
  });
  await expect(text).toBeFocused();
  await text.press("Enter");
  await expect(text).not.toBeFocused();
  await root.getByLabel("第 1 行 单选").click();
  const dialog = root.getByRole("dialog", { name: "单选 选项" });
  const input = dialog.getByLabel("添加选项");
  await input.fill("新选项");
  await page.evaluate(() => {
    for (const options of [{ isComposing: true }, { keyCode: 229 }])
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, ...options }));
  });
  const read = () =>
    page.evaluate(
      () =>
        window.__semloRequireFixture("databaseImeEditor").getSnapshot().json.content?.[0].attrs?.data as DatabaseData,
    );
  expect((await read()).fields[1].options).toHaveLength(3);
  await expect(input).toBeFocused();
  await input.press("Enter");
  expect((await read()).fields[1].options).toHaveLength(4);
  await expect(root.getByLabel("第 1 行 单选")).toContainText("新选项");
});

test("cell composition and undo stay isolated when another editor is destroyed and remounted", async ({ page }) => {
  await installFixtureGuards(page);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const data = createDatabaseData();
  const content = { type: "doc", content: [{ type: "semloEditorDatabase", attrs: { data } }, { type: "paragraph" }] };
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.evaluate((value) => Reflect.set(window, "databaseSessionContent", value), content);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const hosts = [0, 1].map(index => {
        const host = document.createElement('div'); host.id = 'database-session-' + index; document.body.prepend(host)
        return host
      })
      const mount = index => createEditor({ element: hosts[index], outline: false, content: window.databaseSessionContent })
      window.databaseSessionEditors = [mount(0), mount(1)]
      window.databaseSessionRemount = () => { window.databaseSessionEditors[0] = mount(0) }
    `,
  });
  const first = page.locator("#database-session-0 .semlo-editor-database").getByLabel("第 1 行 文本");
  const second = page.locator("#database-session-1 .semlo-editor-database").getByLabel("第 1 行 文本");
  await first.focus();
  await page.evaluate(() => {
    const oldInput = document.querySelector<HTMLInputElement>('#database-session-0 input[aria-label="第 1 行 文本"]')!;
    const activeInput = document.querySelector<HTMLInputElement>(
      '#database-session-1 input[aria-label="第 1 行 文本"]',
    )!;
    oldInput.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    oldInput.value = "甲";
    oldInput.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
    oldInput.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
    activeInput.focus();
    activeInput.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    for (const value of ["n", "你", "你好"]) {
      activeInput.value = value;
      activeInput.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
    }
    window.__semloRequireFixture("databaseSessionEditors")[0].destroy();
    oldInput.value = "过期输入";
    oldInput.dispatchEvent(new InputEvent("input", { bubbles: true }));
    oldInput.dispatchEvent(new FocusEvent("blur"));
    activeInput.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  });
  await expect(second).toBeFocused();
  await expect(second).toHaveValue("你好");
  await second.press("ControlOrMeta+z");
  await expect(second).toHaveValue("");
  await second.press("ControlOrMeta+Shift+z");
  await expect(second).toHaveValue("你好");
  await second.press("Enter");
  await page.evaluate(() => window.__semloRequireFixture("databaseSessionRemount")());
  await expect(first).toHaveValue("");
  expect(
    await page.evaluate(() => window.__semloRequireFixture("databaseSessionEditors")[1].editor.commands.undo()),
  ).toBe(true);
  await expect(second).toHaveValue("");
  await expect(first).toHaveValue("");
  expect(errors).toEqual([]);
});
