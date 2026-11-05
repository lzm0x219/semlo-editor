import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../packages/core/src/types";
import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";

type Tracked = {
  target: EventTarget;
  type: string;
  callback: EventListenerOrEventListenerObject;
  capture: boolean;
  removed: boolean;
};
type RemountProbe = {
  controller: EditorController;
  tracked: Tracked[];
  oldDOM: HTMLElement;
  newDOM?: HTMLElement;
};
declare global {
  interface Window {
    remountProbe?: RemountProbe;
  }
}

async function mount(page: Page) {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const tracked = []
      const add = EventTarget.prototype.addEventListener
      const remove = EventTarget.prototype.removeEventListener
      const capture = options => typeof options === 'boolean' ? options : Boolean(options?.capture)
      EventTarget.prototype.addEventListener = function(type, callback, options) {
        if (callback && ['pointerdown', 'semlo-editor:editable', 'compositionstart'].includes(type))
          tracked.push({ target: this, type, callback, capture: capture(options), removed: false })
        return add.call(this, type, callback, options)
      }
      EventTarget.prototype.removeEventListener = function(type, callback, options) {
        for (const item of tracked)
          if (item.target === this && item.type === type && item.callback === callback && item.capture === capture(options))
            item.removed = true
        return remove.call(this, type, callback, options)
      }
      const host = document.createElement('div')
      host.id = 'remount-listener-host'
      document.body.replaceChildren(host)
      const controller = createEditor({
        element: host, outline: false,
        content: '<p>目标文字</p><hr><table><tbody><tr><td><p>甲</p></td><td><p>乙</p></td></tr></tbody></table><p>aaa AAA</p>',
      })
      window.remountProbe = { controller, tracked, oldDOM: controller.editor.view.dom }
    `,
  });
  await page.waitForFunction(() => Boolean(window.remountProbe));
}

async function remount(page: Page) {
  return await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("remountProbe");
    const editor = fixture.controller.editor;
    editor.unmount();
    const mount = document.createElement("div");
    document.querySelector("#remount-listener-host .semlo-editor-content")!.append(mount);
    editor.mount(mount);
    fixture.newDOM = editor.view.dom;
    return { different: fixture.oldDOM !== fixture.newDOM, oldConnected: fixture.oldDOM.isConnected };
  });
}

for (const variant of ["initial", "remount"] as const) {
  test(`${variant} stale node selection follows a synthetic pointer drag on editor DOM`, async ({ page }) => {
    await mount(page);
    if (variant === "remount") expect((await remount(page)).different).toBe(true);
    const result = await page.evaluate(() => {
      const fixture = window.__semloRequireFixture("remountProbe");
      const editor = fixture.controller.editor;
      const view = editor.view;
      const pos: number[] = [];
      editor.state.doc.descendants((node, position) => {
        if (node.type.name === "horizontalRule") pos.push(position);
      });
      if (!editor.commands.setNodeSelection(pos[0])) throw new Error("Unable to create node selection");
      view.focus();
      const target = Array.from(view.dom.querySelectorAll("p")).find((item) => item.textContent === "目标文字");
      if (!target?.firstChild) throw new Error("Missing text node");
      const before = editor.state.selection.toJSON();
      view.dom.dispatchEvent(
        new PointerEvent("pointerdown", { pointerId: 71, button: 0, clientX: 10, clientY: 10, bubbles: true }),
      );
      document.getSelection()!.setBaseAndExtent(target.firstChild, 0, target.firstChild, 2);
      const browserText = document.getSelection()!.toString();
      document.dispatchEvent(
        new PointerEvent("pointerup", { pointerId: 71, button: 0, clientX: 30, clientY: 10, bubbles: true }),
      );
      const beforeAction = editor.state.selection.toJSON();
      const bold = document.querySelector<HTMLButtonElement>(
        '#remount-listener-host .semlo-editor-toolbar [aria-label="加粗"]',
      )!;
      const disabled = bold.disabled;
      bold.click();
      return {
        before,
        beforeAction,
        after: editor.state.selection.toJSON(),
        browserText,
        html: fixture.controller.getSnapshot().html,
        disabled,
      };
    });
    expect(result.before.type).toBe("node");
    expect(result.beforeAction.type).toBe("node");
    expect(result.browserText).toBe("目标");
    expect(result.disabled).toBe(false);
    expect(result.html).toContain("<strong>目标</strong>文字");
  });
}

test("a remounted iframe view synchronizes its own DOM selection", async ({ page }) => {
  await mount(page);
  const result = await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("remountProbe");
    const editor = fixture.controller.editor;
    editor.unmount();
    const iframe = document.createElement("iframe");
    document.body.append(iframe);
    const owner = iframe.contentDocument!;
    const targetMount = owner.createElement("div");
    owner.body.append(targetMount);
    editor.mount(targetMount);
    const view = editor.view;
    const positions: number[] = [];
    editor.state.doc.descendants((node, position) => {
      if (node.type.name === "horizontalRule") positions.push(position);
    });
    editor.commands.setNodeSelection(positions[0]);
    view.focus();
    const target = Array.from(view.dom.querySelectorAll("p")).find((item) => item.textContent === "目标文字")!;
    view.dom.dispatchEvent(
      new PointerEvent("pointerdown", { pointerId: 7, button: 0, clientX: 1, clientY: 1, bubbles: true }),
    );
    owner.getSelection()!.setBaseAndExtent(target.firstChild!, 0, target.firstChild!, 2);
    owner.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 7, button: 0, clientX: 30, clientY: 1, bubbles: true }),
    );
    document
      .querySelector<HTMLButtonElement>('#remount-listener-host .semlo-editor-toolbar [aria-label="加粗"]')!
      .click();
    return fixture.controller.getSnapshot().html;
  });
  expect(result).toContain("<strong>目标</strong>文字");
});

test("remount toggles table toolbar visibility with editable state", async ({ page }) => {
  await mount(page);
  await page.locator("#remount-listener-host td").first().click();
  const toolbar = page.getByRole("toolbar", { name: "表格工具栏", includeHidden: true });
  await expect(toolbar).toBeVisible();
  expect((await remount(page)).different).toBe(true);
  const result = await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("remountProbe");
    const table = document.querySelector<HTMLElement>('[aria-label="表格工具栏"]')!;
    const before = { hidden: table.hidden, editable: fixture.controller.editor.isEditable };
    fixture.controller.setEditable(false);
    const readOnly = { hidden: table.hidden, editable: fixture.controller.editor.isEditable };
    fixture.controller.setEditable(true);
    const editing = { hidden: table.hidden, editable: fixture.controller.editor.isEditable };
    return { before, readOnly, editing };
  });
  expect(result.readOnly).toEqual({ hidden: true, editable: false });
  expect(result.editing).toEqual({ hidden: false, editable: true });
});

test("remount toggles find replacement actions with editable state", async ({ page }) => {
  await mount(page);
  await page.locator('#remount-listener-host .semlo-editor-toolbar [aria-label="查找替换"]').click();
  const panel = page.getByRole("dialog", { name: "查找替换" });
  await panel.getByRole("textbox", { name: "查找内容" }).fill("aaa");
  await panel.getByRole("tab", { name: "替换" }).click();
  await expect(panel.getByRole("button", { name: "全部替换" })).toBeEnabled();
  expect((await remount(page)).different).toBe(true);
  const result = await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("remountProbe");
    const panel = document.querySelector<HTMLElement>('[role="dialog"][aria-label="查找替换"]')!;
    const all = Array.from(panel.querySelectorAll<HTMLButtonElement>("button.semlo-editor-find-action")).find(
      (button) => button.textContent === "全部替换",
    )!;
    const replace = Array.from(panel.querySelectorAll<HTMLButtonElement>("button.semlo-editor-find-action")).find(
      (button) => button.textContent === "替换",
    )!;
    const state = () => ({
      allDisabled: all.disabled,
      replaceDisabled: replace.disabled,
      editable: fixture.controller.editor.isEditable,
    });
    const before = state();
    fixture.controller.setEditable(false);
    const readOnly = state();
    fixture.controller.setEditable(true);
    const editing = state();
    return { before, readOnly, editing };
  });
  expect(result.readOnly).toEqual({ allDisabled: true, replaceDisabled: true, editable: false });
  expect(result.editing).toEqual({ allDisabled: false, replaceDisabled: false, editable: true });
});

test("remount format painter activates on new view", async ({ page }) => {
  await mount(page);
  expect((await remount(page)).different).toBe(true);
  await page.evaluate(() => {
    const editor = window.__semloRequireFixture("remountProbe").controller.editor;
    editor.commands.focus();
    editor.commands.setTextSelection({ from: 1, to: 3 });
  });
  const painter = page.locator("#remount-listener-host .semlo-editor-toolbar .semlo-editor-format-painter");
  await painter.click();
  const active = await page.evaluate(() => {
    const fixture = window.__semloRequireFixture("remountProbe");
    const button = document.querySelector<HTMLElement>(
      "#remount-listener-host .semlo-editor-toolbar .semlo-editor-format-painter",
    )!;
    return {
      pressed: button.getAttribute("aria-pressed"),
      old: fixture.oldDOM.classList.contains("semlo-editor-format-painter-active"),
      current: fixture.controller.editor.view.dom.classList.contains("semlo-editor-format-painter-active"),
    };
  });
  await page.locator("#remount-listener-host .semlo-editor-prose p").first().click();
  expect(active.pressed).toBe("true");
  expect(active.current).toBe(true);
  expect(active.old).toBe(false);
});

for (const entry of ["controller", "editor"] as const) {
  test(`remount ${entry} destroy removes old and new view listeners`, async ({ page }) => {
    await mount(page);
    expect((await remount(page)).different).toBe(true);
    const result = await page.evaluate((entry) => {
      const fixture = window.__semloRequireFixture("remountProbe");
      const count = (target: EventTarget) =>
        Object.fromEntries(
          ["pointerdown", "semlo-editor:editable", "compositionstart"].map((type) => [
            type,
            fixture.tracked.filter((item) => item.target === target && item.type === type && !item.removed).length,
          ]),
        );
      const before = { old: count(fixture.oldDOM), current: count(fixture.newDOM!) };
      let error = "";
      try {
        if (entry === "editor") fixture.controller.editor.destroy();
        else fixture.controller.destroy();
      } catch (cause) {
        error = String(cause);
      }
      return {
        error,
        before,
        after: { old: count(fixture.oldDOM), current: count(fixture.newDOM!) },
        shell: Boolean(document.querySelector("#remount-listener-host .semlo-editor")),
      };
    }, entry);
    expect(result.error).toBe("");
    expect(result.shell).toBe(false);
    expect(result.after.old).toEqual({ pointerdown: 0, "semlo-editor:editable": 0, compositionstart: 0 });
    expect(result.after.current).toEqual({ pointerdown: 0, "semlo-editor:editable": 0, compositionstart: 0 });
  });
}
