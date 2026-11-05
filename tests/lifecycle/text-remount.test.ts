import { expect, test } from "@rstest/playwright";

import type { EditorController } from "../../packages/core/src/types";
import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    textRemountEditor?: EditorController;
  }
}

for (const crossDocument of [false, true]) {
  test(`find and painter rebind after ${crossDocument ? "cross-document" : "same-document"} remount`, async ({
    page,
  }) => {
    await installFixtureGuards(page);
    await page.goto(process.env.SEMLO_TEST_ORIGIN!);
    await page.addScriptTag({
      type: "module",
      content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div'); host.id = 'text-remount'; document.body.append(host)
      window.textRemountEditor = createEditor({element: host, outline: false, content: '<p><strong>aaa</strong> AAA</p>'})
    `,
    });
    await page.waitForFunction(() => Boolean(window.textRemountEditor));
    await page.locator('#text-remount [aria-label="查找替换"]').click();
    const panel = page.getByRole("dialog", { name: "查找替换" });
    await panel.getByRole("textbox", { name: "查找内容" }).fill("aaa");
    await panel.getByRole("button", { name: "下一个" }).click();
    await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("2/2");
    await panel.getByRole("tab", { name: "替换" }).click();
    await page.evaluate((crossDocument) => {
      const editor = window.__semloRequireFixture("textRemountEditor").editor;
      editor.unmount();
      let target: HTMLElement;
      if (crossDocument) {
        const iframe = document.createElement("iframe");
        document.body.append(iframe);
        target = iframe.contentDocument!.createElement("div");
        iframe.contentDocument!.body.append(target);
      } else {
        target = document.createElement("div");
        document.querySelector("#text-remount .semlo-editor-content")!.append(target);
      }
      editor.mount(target);
    }, crossDocument);
    await expect(panel.locator(".semlo-editor-find-counter")).toHaveText("2/2");
    await page.evaluate(() => window.__semloRequireFixture("textRemountEditor").setEditable(false));
    await expect(panel.getByRole("button", { name: "全部替换" })).toBeDisabled();
    await page.evaluate(() => window.__semloRequireFixture("textRemountEditor").setEditable(true));
    await expect(panel.getByRole("button", { name: "全部替换" })).toBeEnabled();
    const result = await page.evaluate(() => {
      const editor = window.__semloRequireFixture("textRemountEditor").editor;
      const oldPanel = document.querySelector('[role="dialog"][aria-label="查找替换"]');
      const win = editor.view.dom.ownerDocument.defaultView!;
      const key = new win.KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true });
      editor.view.dom.dispatchEvent(key);
      const closed = !oldPanel?.isConnected;
      editor.commands.focus();
      editor.commands.setTextSelection({ from: 1, to: 4 });
      const painter = document.querySelector<HTMLButtonElement>("#text-remount .semlo-editor-format-painter")!;
      painter.click();
      const active = editor.view.dom.classList.contains("semlo-editor-format-painter-active");
      editor.commands.setTextSelection({ from: 5, to: 8 });
      editor.view.dom.dispatchEvent(
        new win.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
      const painted = window
        .__semloRequireFixture("textRemountEditor")
        .getSnapshot()
        .html.includes("<strong>AAA</strong>");
      editor.commands.setTextSelection({ from: 1, to: 4 });
      painter.click();
      const escape = new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
      editor.view.dom.dispatchEvent(escape);
      const cancelled = painter.getAttribute("aria-pressed") === "false";
      const viewDOM = editor.view.dom;
      window.__semloRequireFixture("textRemountEditor").destroy();
      const after = new win.KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true, cancelable: true });
      viewDOM.dispatchEvent(after);
      return { handled: key.defaultPrevented, closed, active, painted, cancelled, after: after.defaultPrevented };
    });
    expect(result).toEqual({ handled: true, closed: true, active: true, painted: true, cancelled: true, after: false });
  });
}
