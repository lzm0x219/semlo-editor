import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { resolve } from "node:path";

import { expect, test, type Page } from "@rstest/playwright";

import { installFixtureGuards } from "../../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    captionControlTest?: {
      state: { text: string; visible: boolean };
      commits: Array<{ text: string; visible: boolean; kind: string }>;
      begins: number;
      exits: number;
      undos: number;
      redos: number;
      setEditable: (value: boolean) => void;
      replace: (state: { text: string; visible: boolean }) => void;
      destroy: () => void;
    };
  }
}

async function mount(page: Page) {
  // Exercise the source control in a real browser independently of NodeView
  // integration, which has its own document and history regression coverage.
  const source = readFileSync(
    resolve(process.cwd(), "packages/core/src/features/media/image/caption-control.ts"),
    "utf8",
  );
  const code = stripTypeScriptTypes(source, { mode: "strip" });
  await page.setContent('<div id="toolbar"></div><div id="media"></div><button id="after">正文</button>');
  await page.addScriptTag({
    type: "module",
    content: `${code}
      let state = {text: '', visible: false}
      let editable = true
      const test = {
        get state() { return state },
        commits: [], begins: 0, exits: 0, undos: 0, redos: 0,
        setEditable(value) { editable = value; control.close(); control.refresh() },
        replace(value) { control.close(); state = value; control.refresh() },
        destroy() { control.destroy() },
      }
      const control = createImageCaptionControl({
        doc: document,
        canEdit: () => editable,
        getState: () => state,
        commit: (text, visible, kind) => {
          test.commits.push({text, visible, kind})
          state = {text, visible}
          control.refresh()
        },
        beginEdit: () => test.begins++,
        enterAfter: () => { test.exits++; document.querySelector('#after').focus() },
        undo: () => { test.undos++; state = {text: '撤销结果', visible: true} },
        redo: () => { test.redos++; state = {text: '重做结果', visible: true} },
      })
      document.querySelector('#toolbar').append(control.button)
      document.querySelector('#media').append(control.caption)
      window.captionControlTest = test
    `,
  });
  await page.waitForFunction(() => Boolean(window.captionControlTest));
  return {
    toggle: page.getByRole("button", { name: "图片描述" }),
    input: page.getByRole("textbox", { name: "图片描述内容" }),
    caption: page.locator(".semlo-editor-image-caption"),
  };
}

test.beforeEach(async ({ page }) => {
  await installFixtureGuards(page);
});

test("description can be edited, hidden without losing text, and exited with Enter", async ({ page }) => {
  const { toggle, input, caption } = await mount(page);
  await expect(caption).toBeHidden();
  await toggle.click();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("placeholder", "添加图片描述");
  await input.fill("一段测试描述");
  expect(await page.evaluate(() => window.__semloRequireFixture("captionControlTest").state)).toEqual({
    text: "一段测试描述",
    visible: true,
  });
  await page.getByRole("button", { name: "正文" }).click();
  await expect(caption).toBeVisible();
  await toggle.click();
  await expect(caption).toBeHidden();
  expect(await page.evaluate(() => window.__semloRequireFixture("captionControlTest").state)).toEqual({
    text: "一段测试描述",
    visible: false,
  });
  await toggle.click();
  await expect(input).toHaveValue("一段测试描述");
  await expect(input).toBeFocused();
  await input.press("Enter");
  await expect(page.getByRole("button", { name: "正文" })).toBeFocused();
  expect(await page.evaluate(() => window.__semloRequireFixture("captionControlTest").exits)).toBe(1);
  expect(
    await page.evaluate(() => window.__semloRequireFixture("captionControlTest").commits.map((entry) => entry.kind)),
  ).toContain("finish");
});

test("empty descriptions hide on blur and read-only mode shows saved text", async ({ page }) => {
  const { toggle, input, caption } = await mount(page);
  await toggle.click();
  await page.getByRole("button", { name: "正文" }).click();
  await expect(caption).toBeHidden();
  expect(await page.evaluate(() => window.__semloRequireFixture("captionControlTest").state.visible)).toBe(false);
  await toggle.click();
  await input.fill("只读说明");
  await page.evaluate(() => window.__semloRequireFixture("captionControlTest").setEditable(false));
  await expect(input).toBeHidden();
  await expect(caption).toHaveText("只读说明");
  await expect(toggle).toBeDisabled();
  await page.evaluate(() => window.__semloRequireFixture("captionControlTest").setEditable(true));
  await expect(input).toHaveValue("只读说明");
});

test("composition commits only its final text and stale events cannot change a replacement", async ({ page }) => {
  const { toggle, input } = await mount(page);
  await toggle.click();
  await input.evaluate((element) => {
    const field = element as HTMLInputElement;
    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    field.value = "拼";
    field.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true }));
  });
  expect(await page.evaluate(() => window.__semloRequireFixture("captionControlTest").state.text)).toBe("");
  await input.evaluate((element) => {
    const field = element as HTMLInputElement;
    field.value = "拼音";
    field.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true }));
  });
  expect(await page.evaluate(() => window.__semloRequireFixture("captionControlTest").state.text)).toBe("拼音");
  await input.evaluate((element) => {
    const field = element as HTMLInputElement;
    field.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    field.value = "旧输入";
  });
  await page.evaluate(() =>
    window.__semloRequireFixture("captionControlTest").replace({ text: "新图片", visible: true }),
  );
  await input.dispatchEvent("compositionend", { bubbles: true });
  expect(await page.evaluate(() => window.__semloRequireFixture("captionControlTest").state)).toEqual({
    text: "新图片",
    visible: true,
  });
  await page.evaluate(() => window.__semloRequireFixture("captionControlTest").destroy());
  await expect(toggle).toHaveCount(0);
});

test("history shortcuts use the host and refresh the focused field", async ({ page }) => {
  const { toggle, input } = await mount(page);
  await toggle.click();
  await input.fill("原描述");
  await input.press("ControlOrMeta+z");
  await expect(input).toHaveValue("撤销结果");
  await input.press("ControlOrMeta+Shift+z");
  await expect(input).toHaveValue("重做结果");
  expect(
    await page.evaluate(() => [
      window.__semloRequireFixture("captionControlTest").undos,
      window.__semloRequireFixture("captionControlTest").redos,
    ]),
  ).toEqual([1, 1]);
});
