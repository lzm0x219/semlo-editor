import { createEditor, type EditorContent, type EditorController } from "@semlo-editor/core";

import "@semlo-editor/core/style.css";
import { Extension } from "@tiptap/core";
import { undoDepth, redoDepth } from "@tiptap/pm/history";
import { DOMParser as ProseMirrorDOMParser, Fragment, Slice } from "@tiptap/pm/model";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { sequencePasteContent } from "./numbering-sequence-paste-content";

type Slot = "primary" | "peer";
const controllers = new Map<Slot, EditorController>();
const changes = new Map<Slot, number>();
const events: { type: string; trusted: boolean }[] = [];
const faults = new Map<Slot, string>();
const observed: string[] = [];
const retiredDOM: HTMLElement[] = [];
const parsedPastes: { plain: boolean; first: string | undefined }[] = [];
const rawPastes: { trusted: boolean; types: string[]; html: string; prevented: boolean }[] = [];
document.body.innerHTML = '<main id="primary"></main><main id="peer"></main>';
document.body.style.margin = "40px";

function mount(
  slot: Slot,
  content: EditorContent = sequencePasteContent(),
  echo: "json" | "html" | null = null,
  customTextParser: boolean | "decline" | "dom" | "late-decline" | "late-accept" = false,
) {
  controllers.get(slot)?.destroy();
  const host = document.getElementById(slot)!;
  host.replaceChildren();
  changes.set(slot, 0);
  faults.set(slot, "none");
  const fault = (phase: string, view: EditorView) => {
    const value = faults.get(slot) ?? "none";
    if (!value.startsWith(phase + "-")) return;
    faults.set(slot, "none");
    observed.push(value);
    const action = value.slice(phase.length + 1);
    if (action === "selection")
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 1)));
    else if (action === "document") controllers.get(slot)!.setContent("<p>宿主新文档</p>");
    else if (action === "readonly") controllers.get(slot)!.setEditable(false);
    else if (action === "destroy") {
      retiredDOM.push(view.dom);
      controllers.get(slot)!.destroy();
    } else if (action === "reenter") controllers.get(slot)!.editor.commands.insertContent("宿主重入");
  };
  const hostExtension = Extension.create({
    name: "sequencePasteHost",
    priority: customTextParser === "late-decline" || customTextParser === "late-accept" ? 1 : 100,
    addGlobalAttributes() {
      return [
        {
          types: ["paragraph"],
          attributes: {
            hostPasteProbe: {
              default: null,
              parseHTML: () => {
                const editor = controllers.get(slot)?.editor;
                if (editor && !editor.isDestroyed) fault("parser", editor.view);
                return null;
              },
              renderHTML: () => ({}),
            },
          },
        },
        {
          types: ["orderedList"],
          attributes: {
            hostListSetting: {
              default: null,
              parseHTML: (element: HTMLElement) => element.getAttribute("data-host-list-setting"),
              renderHTML: (attrs: Record<string, unknown>) =>
                attrs.hostListSetting == null ? {} : { "data-host-list-setting": attrs.hostListSetting },
            },
          },
        },
        {
          types: ["listItem"],
          attributes: {
            hostItemSetting: {
              default: null,
              parseHTML: (element: HTMLElement) => element.getAttribute("data-host-item-setting"),
              renderHTML: (attrs: Record<string, unknown>) =>
                attrs.hostItemSetting == null ? {} : { "data-host-item-setting": attrs.hostItemSetting },
            },
          },
        },
      ];
    },
    addProseMirrorPlugins() {
      const domParser = ProseMirrorDOMParser.fromSchema(this.editor.schema);
      return [
        new Plugin({
          filterTransaction(tr) {
            if (tr.getMeta("semloEditorNumberingSequenceOperation") && faults.get(slot) === "key-reject") {
              faults.set(slot, "none");
              observed.push("key-reject");
              return false;
            }
            if (tr.getMeta("uiEvent") === "paste" && faults.get(slot) === "filter-reject") {
              faults.set(slot, "none");
              observed.push("filter-reject");
              return false;
            }
            return true;
          },
          props: {
            ...(customTextParser === "dom"
              ? {
                  clipboardParser: {
                    parseSlice(node: Node, options: Parameters<ProseMirrorDOMParser["parseSlice"]>[1]) {
                      observed.push("host-dom-parser");
                      return domParser.parseSlice(node, options);
                    },
                  } as unknown as ProseMirrorDOMParser,
                }
              : {}),
            ...(customTextParser && customTextParser !== "dom"
              ? {
                  clipboardTextParser(_text: string, _context: unknown, _plain: boolean, view: EditorView) {
                    observed.push("host-text-parser");
                    if (customTextParser === "decline" || customTextParser === "late-decline")
                      return undefined as unknown as Slice;
                    const paragraph = view.state.schema.nodes.paragraph.create(
                      null,
                      view.state.schema.text("宿主处理"),
                    );
                    return new Slice(Fragment.from(paragraph), 1, 1);
                  },
                }
              : {}),
            handleDOMEvents: {
              paste(_view, event) {
                if (
                  faults.get(slot) === "custom-route" &&
                  event.clipboardData?.types.includes("application/x-semlo-host-inline")
                ) {
                  faults.set(slot, "none");
                  observed.push("custom-route");
                  controllers.get(slot)!.editor.commands.insertContent("宿主内联");
                  event.preventDefault();
                  return true;
                }
                if (faults.get(slot) !== "file-route" || !event.clipboardData?.files.length) return false;
                faults.set(slot, "none");
                observed.push("file-route");
                event.preventDefault();
                return true;
              },
            },
            transformPastedHTML(html, view) {
              fault("html", view);
              return html;
            },
            transformPasted(slice, view, plain) {
              parsedPastes.push({ plain, first: slice.content.firstChild?.type.name });
              fault("slice", view);
              return slice;
            },
          },
        }),
      ];
    },
  });
  const controller = createEditor({
    element: host,
    content,
    outline: false,
    extensions: [hostExtension],
    onChange(snapshot) {
      changes.set(slot, (changes.get(slot) ?? 0) + 1);
      if (echo) controllers.get(slot)?.setContent(echo === "html" ? snapshot.html : snapshot.json);
    },
  });
  controllers.set(slot, controller);
  controller.editor.view.dom.addEventListener(
    "paste",
    (event) => {
      try {
        rawPastes.push({
          trusted: event.isTrusted,
          types: [...(event.clipboardData?.types ?? [])],
          html: event.clipboardData?.getData("text/html") ?? "",
          prevented: event.defaultPrevented,
        });
      } catch {
        /* 故障载荷由产品入口处理，诊断探针不重复抛出。 */
      }
    },
    true,
  );
  controller.editor.on("beforeTransaction", ({ transaction }) => {
    if (transaction.getMeta("uiEvent") === "paste") fault("before", controller.editor.view);
  });
  for (const type of ["copy", "paste"])
    controller.editor.view.dom.addEventListener(type, (event) => {
      events.push({ type, trusted: event.isTrusted });
    });
}
function get(slot: Slot = "primary") {
  const controller = controllers.get(slot);
  if (!controller) throw new Error(`未挂载${slot}`);
  return controller;
}
function destroy() {
  for (const controller of controllers.values()) controller.destroy();
  controllers.clear();
  for (const id of ["primary", "peer"]) document.getElementById(id)!.replaceChildren();
}
const fixture = {
  mount,
  get,
  destroy,
  events,
  observed,
  retiredDOM,
  parsedPastes,
  rawPastes,
  setFault: (value: string, slot: Slot = "primary") => faults.set(slot, value),
  history: (slot: Slot = "primary") => ({
    undo: undoDepth(get(slot).editor.state),
    redo: redoDepth(get(slot).editor.state),
  }),
  changes: (slot: Slot = "primary") => changes.get(slot) ?? 0,
};
declare global {
  interface Window {
    sequencePasteFixture: typeof fixture;
  }
}
window.sequencePasteFixture = fixture;
mount("primary");
