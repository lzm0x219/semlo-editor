import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";

import { createEditor } from "../../../packages/core/src/index";
import type { EditorContent, EditorController } from "../../../packages/core/src/types";

import "../../../demo/editor.css";

export type HostMode =
  | "none"
  | "reject"
  | "reject-home"
  | "observe-home"
  | "append-home-selection"
  | "destroy-home"
  | "append-meta"
  | "append-selection"
  | "append-doc"
  | "destroy"
  | "throw";
export type HostOrder = "early" | "late";
type Trace = { phase: string; docChanged: boolean; selection: [number, number] };
interface HostFixture {
  controller: EditorController;
  trace: Trace[];
  changes: number;
  lastEndPrevented(): boolean | null;
  lastHomePrevented(): boolean | null;
  focusEvents: { focus: number; blur: number };
  inverseMismatch(): { pm: number; dom: number };
  installInverseMismatchOnHome(): void;
  inverseBefore(): { pm: number; dom: number } | undefined;
  settle(): Promise<void>;
}
declare global {
  interface Window {
    mountHeadingEndHost?(content: EditorContent, mode: HostMode, order: HostOrder): void;
    headingEndHost?: HostFixture;
  }
}

function isTargetSelection(tr: Transaction): boolean {
  const selection = tr.selection;
  return (
    !tr.docChanged &&
    tr.selectionSet &&
    selection instanceof TextSelection &&
    !selection.empty &&
    selection.$anchor.sameParent(selection.$head) &&
    selection.$anchor.parent.type.name === "heading" &&
    selection.$anchor.parentOffset === 0 &&
    selection.$head.parentOffset === selection.$head.parent.content.size
  );
}

function isTargetHome(tr: Transaction): boolean {
  const selection = tr.selection;
  return (
    !tr.docChanged &&
    tr.selectionSet &&
    selection instanceof TextSelection &&
    selection.empty &&
    selection.$anchor.parent.type.name === "heading" &&
    selection.$anchor.parent.attrs.semloEditorHeadingNumbering === "mixed" &&
    selection.$anchor.parentOffset === 0
  );
}

window.mountHeadingEndHost = (content, mode, order) => {
  const host = document.createElement("div");
  host.id = "heading-end-host";
  host.style.width = "850px";
  document.body.replaceChildren(host);
  const trace: Trace[] = [];
  let changes = 0;
  let lastEnd: KeyboardEvent | undefined;
  let lastHome: KeyboardEvent | undefined;
  const focusEvents = { focus: 0, blur: 0 };
  let inverseBefore: { pm: number; dom: number } | undefined;
  let injectInverse = false;
  const inverseExtension = Extension.create({
    name: "headingEndInverseMismatchTest",
    priority: 3000,
    addProseMirrorPlugins() {
      return [
        new Plugin({
          props: {
            handleKeyDown(_view, event) {
              if (!injectInverse || event.key !== "Home") return false;
              injectInverse = false;
              // Reproduce a host plugin changing DOM selection after PM's
              // initial key handling but before the candidate extension.
              inverseBefore = inverseMismatch();
              trace.length = 0;
              return false;
            },
          },
        }),
      ];
    },
  });
  const hostExtension = Extension.create({
    name: "headingEndHostTest",
    priority: order === "early" ? 2000 : 1,
    addProseMirrorPlugins() {
      const editor = this.editor;
      return [
        new Plugin({
          key: new PluginKey("headingEndHostTest"),
          filterTransaction(tr) {
            if (
              ["reject-home", "observe-home", "append-home-selection", "destroy-home"].includes(mode) &&
              isTargetHome(tr)
            ) {
              trace.push({
                phase: "home-filter",
                docChanged: false,
                selection: [tr.selection.anchor, tr.selection.head],
              });
              if (mode === "reject-home") return false;
            }
            if (isTargetSelection(tr)) {
              trace.push({
                phase: "filter",
                docChanged: tr.docChanged,
                selection: [tr.selection.anchor, tr.selection.head],
              });
              if (mode === "reject") return false;
              if (mode === "throw") throw new Error("heading-end-host-filter-error");
            }
            return true;
          },
          appendTransaction(transactions, _oldState, newState) {
            if (
              (mode === "append-home-selection" || mode === "destroy-home") &&
              transactions.some(isTargetHome) &&
              !transactions.some((tr) => tr.getMeta("headingEndHostTest"))
            ) {
              trace.push({
                phase: "home-append",
                docChanged: false,
                selection: [newState.selection.anchor, newState.selection.head],
              });
              if (mode === "destroy-home") {
                editor.destroy();
                return null;
              }
              return newState.tr
                .setSelection(TextSelection.create(newState.doc, newState.selection.$anchor.end()))
                .setMeta("headingEndHostTest", true)
                .setMeta("addToHistory", false);
            }
            if (!transactions.some(isTargetSelection) || transactions.some((tr) => tr.getMeta("headingEndHostTest")))
              return null;
            trace.push({
              phase: "append",
              docChanged: false,
              selection: [newState.selection.anchor, newState.selection.head],
            });
            if (mode === "destroy") {
              editor.destroy();
              return null;
            }
            if (mode === "append-meta")
              return newState.tr.setMeta("headingEndHostTest", true).setMeta("addToHistory", false);
            if (mode === "append-selection")
              return newState.tr
                .setSelection(TextSelection.create(newState.doc, newState.selection.anchor))
                .setMeta("headingEndHostTest", true)
                .setMeta("addToHistory", false);
            if (mode === "append-doc")
              return newState.tr
                .insertText("!", newState.doc.content.size - 1)
                .setMeta("headingEndHostTest", true)
                .setMeta("addToHistory", false);
            return null;
          },
        }),
      ];
    },
  });
  const controller = createEditor({
    element: host,
    content,
    toolbar: false,
    outline: false,
    extensions: mode === "none" ? [inverseExtension] : [inverseExtension, hostExtension],
    onChange: () => {
      changes += 1;
    },
  });
  controller.editor.view.dom.addEventListener("keydown", (event) => {
    if (event.key === "End") lastEnd = event;
    if (event.key === "Home") lastHome = event;
  });
  controller.editor.view.dom.addEventListener("focus", () => (focusEvents.focus += 1));
  controller.editor.view.dom.addEventListener("blur", () => (focusEvents.blur += 1));
  function inverseMismatch() {
    const editor = controller.editor;
    editor.commands.setTextSelection(1);
    const heading = editor.view.dom.querySelector("h3")!;
    const walker = document.createTreeWalker(heading, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) =>
        node.parentElement?.closest('[contenteditable="false"]') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    const node = walker.nextNode();
    if (!node) throw new Error("Missing heading text");
    document.getSelection()!.setBaseAndExtent(node, 4, node, 4);
    return { pm: editor.state.selection.anchor, dom: document.getSelection()!.anchorOffset };
  }
  window.headingEndHost = {
    controller,
    trace,
    get changes() {
      return changes;
    },
    lastEndPrevented: () => lastEnd?.defaultPrevented ?? null,
    lastHomePrevented: () => lastHome?.defaultPrevented ?? null,
    focusEvents,
    inverseMismatch,
    installInverseMismatchOnHome() {
      injectInverse = true;
    },
    inverseBefore: () => inverseBefore,
    settle: () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  };
};
