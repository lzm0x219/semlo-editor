import { expect, test } from "@rstest/playwright";

import type { EditorController, EditorSnapshot } from "../../../packages/core/src/types";

declare global {
  interface Window {
    slashBlurEditor?: EditorController;
    slashBlurSecond?: EditorController;
    slashBlurChanges?: EditorSnapshot[];
    slashBlurShadowProse?: HTMLElement;
    slashBlurShadowSave?: HTMLElement;
    slashBlurSaved?: string;
  }
}

test("焦点转到另一实例时提交查询，受控回写和销毁互不干扰", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const first = document.createElement('div')
      first.id = 'slash-blur-first'
      const second = document.createElement('div')
      second.id = 'slash-blur-second'
      document.body.prepend(first, second)
      window.slashBlurChanges = []
      let editor
      editor = createEditor({
        element: first,
        content: '<p></p>',
        onChange: snapshot => {
          window.slashBlurChanges.push(snapshot)
          editor.setContent(snapshot.json)
        },
      })
      window.slashBlurEditor = editor
      window.slashBlurSecond = createEditor({ element: second, content: '<p></p>' })
    `,
  });
  const first = page.locator("#slash-blur-first .semlo-editor-prose");
  const second = page.locator("#slash-blur-second .semlo-editor-prose");
  await first.click();
  await page.keyboard.type("/p");
  expect(await page.evaluate(() => window.slashBlurEditor?.getSnapshot().text)).toBe("");
  await second.click();
  await expect(second).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.slashBlurChanges?.at(-1)?.text)).toBe("/p");
  expect(await page.evaluate(() => window.slashBlurEditor?.getSnapshot().text)).toBe("/p");
  await page.evaluate(() => window.slashBlurEditor?.destroy());
  await page.keyboard.type("xy");
  await expect(second).toHaveText("xy");
  expect(await page.evaluate(() => window.slashBlurSecond?.getSnapshot().text)).toBe("xy");
  expect(errors).toEqual([]);
});

test("失焦目标为空时提交查询，已有字面斜杠不受影响", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'slash-blur-test'
      host.addEventListener('focusout', () => { window.slashBlurSaved = window.slashBlurEditor.getSnapshot().text })
      document.body.prepend(host)
      window.slashBlurEditor = createEditor({ element: host, content: '<p>已有 /p</p><p></p>' })
    `,
  });
  const prose = page.locator("#slash-blur-test .semlo-editor-prose");
  await prose.locator("p").last().click();
  await page.keyboard.type("/");
  await expect(page.getByRole("listbox", { name: "插入内容" })).toBeVisible();
  const savedDuringFocusOut = await page.evaluate(() => {
    (document.activeElement as HTMLElement).blur();
    return window.slashBlurSaved;
  });
  expect(savedDuringFocusOut).toBe("已有 /p\n\n/");
  await expect(page.getByRole("listbox", { name: "插入内容" })).toHaveCount(0);
  expect(await page.evaluate(() => window.slashBlurEditor?.getSnapshot().text)).toBe("已有 /p\n\n/");
});

test("窗口失焦事件提交活动查询", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'slash-blur-test'
      document.body.prepend(host)
      window.slashBlurChanges = []
      window.slashBlurEditor = createEditor({
        element: host,
        content: '<p></p>',
        onChange: snapshot => window.slashBlurChanges.push(snapshot),
      })
    `,
  });
  await page.locator("#slash-blur-test .semlo-editor-prose").click();
  await page.keyboard.type("/p");
  expect(await page.evaluate(() => window.slashBlurEditor?.getSnapshot().text)).toBe("");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await expect(page.getByRole("listbox", { name: "插入内容" })).toBeVisible();
  expect(await page.evaluate(() => window.slashBlurEditor?.getSnapshot().text)).toBe("");
  await page.evaluate(() => {
    const hasFocus = document.hasFocus;
    document.hasFocus = () => false;
    window.dispatchEvent(new Event("blur"));
    document.hasFocus = hasFocus;
  });
  await expect.poll(() => page.evaluate(() => window.slashBlurEditor?.getSnapshot().text)).toBe("/p");
  await expect.poll(() => page.evaluate(() => window.slashBlurChanges?.at(-1)?.text)).toBe("/p");
});

for (const mode of ["open", "closed"] as const) {
  test(`${mode} Shadow DOM 中的焦点转移保留查询和菜单`, async ({ page }) => {
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      const root = host.attachShadow({ mode: '${mode}' })
      const style = document.createElement('style')
      style.textContent = '.semlo-editor-prose { min-height: 48px; }'
      const container = document.createElement('div')
      const innerSave = document.createElement('button')
      innerSave.textContent = '内部保存'
      root.append(style, container, innerSave)
      const save = document.createElement('button')
      save.textContent = '宿主保存'
      document.body.prepend(host, save)
      window.slashBlurChanges = []
      window.slashBlurEditor = createEditor({
        element: container,
        content: '<p></p>',
        onChange: snapshot => window.slashBlurChanges.push(snapshot),
      })
      window.slashBlurShadowProse = container.querySelector('.semlo-editor-prose')
      window.slashBlurShadowSave = innerSave
      innerSave.addEventListener('focus', () => { window.slashBlurSaved = window.slashBlurEditor.getSnapshot().text })
    `,
    });
    await page.waitForFunction(() => !!window.slashBlurShadowProse);
    await page.evaluate(() => window.slashBlurShadowProse?.focus());
    await page.keyboard.type("/");
    const menu = page.locator(".semlo-editor-slash-menu");
    await expect(menu).toHaveCount(1);
    await page.keyboard.press("Tab");
    await expect(menu.getByRole("button", { name: "正文", exact: true })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(menu).toHaveCount(1);
    expect(await page.evaluate(() => window.slashBlurEditor?.getSnapshot().text)).toBe("");
    await page.keyboard.press("Tab");
    const savedOnFocus = await page.evaluate(() => {
      window.slashBlurShadowSave?.focus();
      return window.slashBlurSaved;
    });
    expect(savedOnFocus).toBe("/");
    await expect(menu).toHaveCount(0);
    await page.evaluate(() => window.slashBlurShadowProse?.focus());
    await page.keyboard.press("Backspace");
    await page.keyboard.type("/");
    await expect(menu).toHaveCount(1);
    await page.getByRole("button", { name: "宿主保存" }).click();
    await expect(menu).toHaveCount(0);
    expect(await page.evaluate(() => window.slashBlurEditor?.getSnapshot().text)).toBe("/");
    await expect.poll(() => page.evaluate(() => window.slashBlurChanges?.at(-1)?.text)).toBe("/");
  });
}

test("销毁带活动菜单的实例后不影响另一编辑器", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const first = document.createElement('div')
      first.id = 'slash-blur-first'
      const second = document.createElement('div')
      second.id = 'slash-blur-second'
      document.body.prepend(first, second)
      window.slashBlurEditor = createEditor({ element: first, content: '<p></p>' })
      window.slashBlurSecond = createEditor({ element: second, content: '<p></p>' })
    `,
  });
  await page.locator("#slash-blur-first .semlo-editor-prose").click();
  await page.keyboard.type("/");
  await expect(page.getByRole("listbox", { name: "插入内容" })).toBeVisible();
  await page.evaluate(() => window.slashBlurEditor?.destroy());
  await expect(page.getByRole("listbox", { name: "插入内容" })).toHaveCount(0);
  await page.locator("#slash-blur-second .semlo-editor-prose").click();
  await page.keyboard.type("/p");
  await page.keyboard.press("Escape");
  expect(await page.evaluate(() => window.slashBlurSecond?.getSnapshot().text)).toBe("/p");
  expect(errors).toEqual([]);
});

test("提交查询的变更回调同步销毁时不恢复已销毁的焦点", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'slash-blur-test'
      document.body.prepend(host)
      window.slashBlurChanges = []
      let editor
      editor = createEditor({
        element: host,
        content: '<p></p>',
        onChange: snapshot => {
          window.slashBlurChanges.push(snapshot)
          if (snapshot.text === '/') editor.destroy()
        },
      })
      window.slashBlurEditor = editor
    `,
  });
  await page.locator("#slash-blur-test .semlo-editor-prose").click();
  await page.keyboard.type("/");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  await expect(page.locator("#slash-blur-test .semlo-editor-prose")).toHaveCount(0);
  expect(await page.evaluate(() => window.slashBlurChanges?.at(-1)?.text)).toBe("/");
  expect(errors).toEqual([]);
});

test("斜杠查询失焦到宿主时保留正文并通知保存", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'slash-blur-test'
      const save = document.createElement('button')
      save.textContent = '宿主保存'
      document.body.prepend(host, save)
      window.slashBlurChanges = []
      window.slashBlurEditor = createEditor({
        element: host,
        content: '<p></p>',
        onChange: snapshot => window.slashBlurChanges.push(snapshot),
      })
    `,
  });
  const prose = page.locator("#slash-blur-test .semlo-editor-prose");
  const save = page.getByRole("button", { name: "宿主保存" });
  await prose.click();
  await page.keyboard.type("/p");
  const menu = page.getByRole("listbox", { name: "插入内容" });
  await expect(menu).toBeVisible();
  await expect(prose).toHaveText("/p");
  expect(await page.evaluate(() => window.slashBlurEditor?.getSnapshot().text)).toBe("");

  await save.click();
  await expect(save).toBeFocused();
  await expect(menu).toHaveCount(0);
  await expect(prose).toHaveText("/p");
  const snapshot = await page.evaluate(() => window.slashBlurEditor?.getSnapshot());
  expect(snapshot?.text).toBe("/p");
  expect(snapshot?.html).toContain("<p>/p</p>");
  expect(snapshot?.json.content?.[0].content?.[0].text).toBe("/p");
  await expect.poll(() => page.evaluate(() => window.slashBlurChanges?.at(-1)?.text)).toBe("/p");
  await prose.focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect(prose).toHaveText("");
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await expect(prose).toHaveText("/p");
  expect(await page.evaluate(() => window.slashBlurEditor?.getSnapshot().text)).toBe("/p");
});

test("快捷格式可键盘进入，离开后保留斜杠并允许宿主操作", async ({ page }) => {
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'slash-blur-test'
      const save = document.createElement('button')
      save.textContent = '宿主保存'
      document.body.prepend(host, save)
      window.slashBlurChanges = []
      window.slashBlurEditor = createEditor({
        element: host,
        content: '<p></p>',
        onChange: snapshot => window.slashBlurChanges.push(snapshot),
      })
    `,
  });
  const prose = page.locator("#slash-blur-test .semlo-editor-prose");
  const save = page.getByRole("button", { name: "宿主保存" });
  await prose.click();
  await page.keyboard.type("/");
  const menu = page.getByRole("listbox", { name: "插入内容" });
  await page.keyboard.press("Tab");
  await expect(menu.getByRole("button", { name: "正文", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(prose).toBeFocused();
  await expect(menu).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(menu.getByRole("button", { name: "正文", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(prose).toBeFocused();
  expect(await page.evaluate(() => window.slashBlurEditor?.getSnapshot().text)).toBe("/");
  await page.keyboard.press("Backspace");
  await page.keyboard.type("/");
  await page.keyboard.press("Tab");
  await expect(menu.getByRole("button", { name: "正文", exact: true })).toBeFocused();
  await save.click();
  await expect(save).toBeFocused();
  await expect(menu).toHaveCount(0);
  expect(await page.evaluate(() => window.slashBlurEditor?.getSnapshot().text)).toBe("/");
  await expect.poll(() => page.evaluate(() => window.slashBlurChanges?.at(-1)?.text)).toBe("/");
});

for (const entry of [
  { command: "table", other: "columns", label: "2行2列", otherLabel: "两栏", result: "table" },
  { command: "columns", other: "table", label: "两栏", otherLabel: "2行2列", result: "[data-semlo-editor-columns]" },
]) {
  test(`斜杠菜单的 ${entry.command} 子菜单保持焦点并可插入`, async ({ page }) => {
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
        import { createEditor } from '/dist/index.js'
        const host = document.createElement('div')
        host.id = 'slash-blur-test'
        const save = document.createElement('button')
        save.textContent = '宿主保存'
        document.body.prepend(host, save)
        window.slashBlurEditor = createEditor({ element: host, content: '<p></p>' })
      `,
    });
    const prose = page.locator("#slash-blur-test .semlo-editor-prose");
    const menu = page.getByRole("listbox", { name: "插入内容" });
    await prose.click();
    await page.keyboard.type("/");
    await menu.locator(`[data-command="${entry.command}"]`).focus();
    const option = page.getByLabel(entry.label, { exact: true });
    await option.focus();
    await expect(menu).toBeVisible();
    await option.hover();
    await page.mouse.move(0, 0);
    await page.waitForTimeout(250);
    await expect(option).toBeFocused();
    await menu.getByRole("button", { name: "正文", exact: true }).focus();
    await expect(option).toHaveCount(0);
    await expect(menu).toBeVisible();
    await menu.locator(`[data-command="${entry.command}"]`).focus();
    await option.focus();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(prose).toBeFocused();
    expect(await page.evaluate(() => window.slashBlurEditor?.getSnapshot().text)).toBe("/");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("/");
    await menu.locator(`[data-command="${entry.command}"]`).focus();
    await option.focus();
    await page.getByRole("button", { name: "宿主保存" }).click();
    await expect(menu).toHaveCount(0);
    expect(await page.evaluate(() => window.slashBlurEditor?.getSnapshot().text)).toBe("/");
    await prose.focus();
    await page.keyboard.press("Backspace");
    await page.keyboard.type("/");
    await menu.locator(`[data-command="${entry.command}"]`).focus();
    await option.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
    await expect(prose.locator(entry.result).first()).toBeVisible();
  });

  test(`鼠标切换 ${entry.command} 子菜单后仍可保存查询`, async ({ page }) => {
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
        import { createEditor } from '/dist/index.js'
        const host = document.createElement('div')
        host.id = 'slash-blur-test'
        const save = document.createElement('button')
        save.textContent = '宿主保存'
        document.body.prepend(host, save)
        window.slashBlurEditor = createEditor({ element: host, content: '<p></p>' })
      `,
    });
    await page.locator("#slash-blur-test .semlo-editor-prose").click();
    await page.keyboard.type("/");
    const menu = page.getByRole("listbox", { name: "插入内容" });
    await menu.locator(`[data-command="${entry.command}"]`).focus();
    await page.getByLabel(entry.label, { exact: true }).focus();
    await menu.locator(`[data-command="${entry.other}"]`).hover({ force: true, timeout: 2000 });
    await expect(menu).toBeVisible();
    await expect(page.getByLabel(entry.otherLabel, { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "宿主保存" }).click();
    await expect(menu).toHaveCount(0);
    expect(await page.evaluate(() => window.slashBlurEditor?.getSnapshot().text)).toBe("/");
  });
}
