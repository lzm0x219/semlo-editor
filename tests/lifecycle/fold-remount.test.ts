import { expect, test, type Page } from "@rstest/playwright";

import type { EditorController } from "../../packages/core/src/types";
import { installFixtureGuards } from "../fixtures/browser/fixture-browser-runtime";

declare global {
  interface Window {
    foldRemountEditor?: EditorController;
    foldRemountOther?: EditorController;
  }
}

type Fixture = "heading" | "list" | "numbering";

async function mount(page: Page, kind: Fixture) {
  await installFixtureGuards(page);
  await page.goto(process.env.SEMLO_TEST_ORIGIN!);
  const html: Record<Fixture, string> = {
    heading: "<h3>标题</h3><p>后文</p>",
    list: "<ul><li><p>父级</p><ul><li><p>子级</p></li></ul></li></ul><p>后文</p>",
    numbering: "<ol><li><p>第一项</p></li><li><p>第二项</p></li></ol><p>后文</p>",
  };
  await page.addScriptTag({
    type: "module",
    content: `
      import { createEditor } from '/dist/index.js'
      const host = document.createElement('div')
      host.id = 'fold-remount'
      document.body.replaceChildren(host)
      window.foldRemountEditor = createEditor({
        element: host, outline: false, content: ${JSON.stringify(html[kind])},
      })
      const other = document.createElement('div')
      document.body.append(other)
      window.foldRemountOther = createEditor({ element: other, outline: false, content: '<p>旁边</p>' })
    `,
  });
  await page.waitForFunction(() => Boolean(window.foldRemountEditor));
}

for (const kind of ["heading", "list", "numbering"] as const) {
  test(`${kind} widget uses the new owner document after remount`, async ({ page }) => {
    await mount(page, kind);
    const result = await page.evaluate((kind) => {
      const controller = window.__semloRequireFixture("foldRemountEditor");
      const other = window.__semloRequireFixture("foldRemountOther");
      const before = controller.getSnapshot().json;
      const oldDOM = controller.editor.view.dom;
      controller.editor.unmount();
      const iframe = document.createElement("iframe");
      document.body.append(iframe);
      const child = iframe.contentDocument!;
      const target = child.createElement("div");
      child.body.append(target);
      let error = "";
      try {
        controller.editor.mount(target);
      } catch (cause) {
        error = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
      }
      if (error) return { error };
      const view = controller.editor.view;
      const selector =
        kind === "heading"
          ? ".semlo-editor-heading-fold-toggle"
          : kind === "list"
            ? ".semlo-editor-list-fold-toggle"
            : ".semlo-editor-list-numbering-trigger";
      const widget = view.dom.querySelector<HTMLButtonElement>(selector);
      if (!widget) return { error: `Missing ${kind} widget` };
      const after = controller.getSnapshot().json;
      const belongs =
        view.dom.ownerDocument === child && widget.ownerDocument === child && oldDOM.ownerDocument === document;
      const beforeCount = view.dom.querySelectorAll(selector).length;
      widget.click();
      const action =
        kind === "heading"
          ? !!view.dom.querySelector(".semlo-editor-heading-fold-hidden")
          : kind === "list"
            ? !!view.dom.querySelector(".semlo-editor-list-fold-hidden")
            : !!child.querySelector(".semlo-editor-list-numbering-menu");
      const afterCount = view.dom.querySelectorAll(selector).length;
      let restored = true;
      if (kind !== "numbering") {
        view.dom.querySelector<HTMLButtonElement>(selector)?.click();
        restored = !view.dom.querySelector(
          kind === "heading" ? ".semlo-editor-heading-fold-hidden" : ".semlo-editor-list-fold-hidden",
        );
      }
      let destroyError = "";
      try {
        controller.destroy();
      } catch (cause) {
        destroyError = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
      }
      const editorRemoved = !target.querySelector(".ProseMirror");
      other.setContent("<p>旁边仍可编辑</p>");
      const otherText = other.getSnapshot().text;
      other.destroy();
      return {
        error,
        before,
        after,
        belongs,
        action,
        beforeCount,
        afterCount,
        restored,
        destroyError,
        editorRemoved,
        otherText,
      };
    }, kind);
    expect(result.error, `${kind}: ${result.error}`).toBe("");
    expect(result.after).toEqual(result.before);
    expect(result.belongs).toBe(true);
    expect(result.action).toBe(true);
    expect(result.beforeCount).toBe(kind === "numbering" ? 2 : 1);
    expect(result.afterCount).toBe(result.beforeCount);
    expect(result.restored).toBe(true);
    expect(result.destroyError).toBe("");
    expect(result.editorRemoved).toBe(true);
    expect(result.otherText).toBe("旁边仍可编辑");
  });
}

for (const kind of ["heading", "list", "numbering"] as const) {
  test(`${kind} widget survives unmount and mount`, async ({ page }) => {
    await mount(page, kind);
    const result = await page.evaluate((kind) => {
      const controller = window.__semloRequireFixture("foldRemountEditor");
      const before = controller.getSnapshot().json;
      const oldDOM = controller.editor.view.dom;
      const oldWidget = oldDOM.querySelector(
        kind === "heading"
          ? ".semlo-editor-heading-fold-toggle"
          : kind === "list"
            ? ".semlo-editor-list-fold-toggle"
            : ".semlo-editor-list-numbering-trigger",
      );
      if (!oldWidget) throw new Error(`Missing initial ${kind} widget`);
      controller.editor.unmount();
      const target = document.createElement("div");
      document.querySelector("#fold-remount .semlo-editor-content")!.append(target);
      let error = "";
      try {
        controller.editor.mount(target);
      } catch (cause) {
        error = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);
      }
      const widget = target.querySelector(
        oldWidget.className ? `.${oldWidget.className.split(" ")[0]}` : "[role=status]",
      );
      return { error, before, after: error ? null : controller.getSnapshot().json, hasWidget: !!widget };
    }, kind);
    expect(result.error, `${kind}: ${result.error}`).toBe("");
    expect(result.after).toEqual(result.before);
    expect(result.hasWidget).toBe(true);
  });
}
