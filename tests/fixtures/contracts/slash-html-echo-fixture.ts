import { createEditor, type EditorContent, type EditorControllerWithResults } from "@semlo-editor/core";
import { Node as TiptapNode } from "@tiptap/core";

import "../insertion/slash-table-draft-fixture";

export type RendererAction = "replace" | "selection" | "destroy" | "remount" | "throw" | "replace-throw";
type Watch = {
  anchor: Node | null;
  anchorOffset: number;
  focus: Node | null;
  focusOffset: number;
  replacements: number;
  remove(): void;
};
type Guard = {
  controller: EditorControllerWithResults;
  errors: Error[];
  replacements: number;
  effect(): void;
};
const watches = new Map<string, Watch>();
const guards = new Map<string, Guard>();

function table(literal?: string): EditorContent {
  return {
    type: "doc",
    content: [
      {
        type: "table",
        attrs: { semloEditorHeaderBackground: "#e7efff" },
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                attrs: { colwidth: [180] },
                content: [{ type: "paragraph", content: [{ type: "text", text: "单元格甲" }] }],
              },
              {
                type: "tableCell",
                attrs: { colwidth: [220] },
                content: [{ type: "paragraph", ...(literal ? { content: [{ type: "text", text: literal }] } : {}) }],
              },
            ],
          },
        ],
      },
      { type: "paragraph", content: [{ type: "text", text: "表外后文" }] },
    ],
  };
}

function capture(id: string) {
  watches.get(id)?.remove();
  const prose = document.querySelector<HTMLElement>(`#${id} .semlo-editor-prose`);
  if (!prose) throw new Error(`缺少编辑器视图：${id}`);
  const selection = document.getSelection();
  if (!selection) throw new Error("缺少原生选区");
  const watch: Watch = {
    anchor: selection.anchorNode,
    anchorOffset: selection.anchorOffset,
    focus: selection.focusNode,
    focusOffset: selection.focusOffset,
    replacements: 0,
    remove: () => prose.removeEventListener("semlo-editor:document-replace", replaced),
  };
  const replaced = () => watch.replacements++;
  prose.addEventListener("semlo-editor:document-replace", replaced);
  watches.set(id, watch);
}

function mountGuard(id: string) {
  const host = document.createElement("div");
  host.id = id;
  host.style.cssText = "width:780px;max-width:calc(100% - 32px);margin:24px auto";
  document.body.append(host);
  let guard: Guard | undefined;
  const probe = TiptapNode.create({
    name: "semloHTMLEchoProbe",
    group: "block",
    atom: true,
    addAttributes: () => ({
      token: {
        default: "mixedCase",
        parseHTML: (element: HTMLElement) => element.getAttribute("data-semlo-html-echo-probe"),
      },
    }),
    parseHTML: () => [{ tag: "aside[data-semlo-html-echo-probe]" }],
    renderHTML({ node }) {
      guard?.effect();
      return ["aside", { "data-semlo-html-echo-probe": String(node.attrs.token).toUpperCase() }, "渲染探针"];
    },
  });
  const errors: Error[] = [];
  const controller = createEditor({
    element: host,
    outline: false,
    extensions: [probe],
    content: {
      type: "doc",
      content: [{ type: "paragraph" }, { type: "semloHTMLEchoProbe", attrs: { token: "mixedCase" } }],
    },
    onError: (error) => errors.push(error),
  });
  guard = { controller, errors, replacements: 0, effect: () => {} };
  const owner = guard;
  controller.editor.view.dom.addEventListener("semlo-editor:document-replace", () => owner.replacements++);
  guards.set(id, guard);
}

function runGuard(id: string, action: RendererAction, matching = true) {
  const guard = guards.get(id);
  if (!guard) throw new Error(`缺少渲染夹具：${id}`);
  const { controller } = guard;
  const { editor } = controller;
  const html = controller.getSnapshot().html;
  const beforeState = editor.state;
  const beforeDoc = beforeState.doc;
  const beforeView = editor.view;
  const failure = new Error("host renderHTML failed");
  let fired = 0;
  guard.effect = () => {
    guard.effect = () => {};
    fired++;
    if (action === "replace" || action === "replace-throw") controller.setContent("<p>宿主新正文</p>");
    if (action === "selection") editor.commands.setTextSelection(1);
    if (action === "destroy") controller.destroy();
    if (action === "remount") {
      editor.unmount();
      const next = document.createElement("div");
      document.body.append(next);
      editor.mount(next);
    }
    if (action === "throw" || action === "replace-throw") throw failure;
  };
  const result = controller.trySetContent(matching ? html : "<p>外层不同正文</p>");
  guard.effect = () => {};
  const destroyed = editor.isDestroyed;
  return {
    action,
    matching,
    fired,
    result: {
      status: result.status,
      reason: "reason" in result ? result.reason : null,
      error: "error" in result ? result.error?.message : null,
    },
    sameError: "error" in result && result.error === failure,
    destroyed,
    sameState: !destroyed && editor.state === beforeState,
    sameDoc: !destroyed && editor.state.doc === beforeDoc,
    sameView: !destroyed && editor.view === beforeView,
    before: beforeDoc.toJSON(),
    after: destroyed ? null : editor.getJSON(),
    text: destroyed ? null : controller.getSnapshot().text,
    replacements: guard.replacements,
    errors: guard.errors.map((error) => error.message),
  };
}

const fixture = {
  table,
  capture,
  selectionUnchanged(id: string) {
    const watch = watches.get(id);
    const selection = document.getSelection();
    return (
      !!watch &&
      !!selection &&
      selection.anchorNode === watch.anchor &&
      selection.anchorOffset === watch.anchorOffset &&
      selection.focusNode === watch.focus &&
      selection.focusOffset === watch.focusOffset
    );
  },
  replacements: (id: string) => watches.get(id)?.replacements,
  mountGuard,
  runGuard,
  dispose() {
    for (const watch of watches.values()) watch.remove();
    watches.clear();
    for (const guard of guards.values()) guard.controller.destroy();
    guards.clear();
    window.slashTableFixture?.dispose();
  },
};
declare global {
  interface Window {
    slashHTMLEcho?: typeof fixture;
  }
}
window.slashHTMLEcho = fixture;
