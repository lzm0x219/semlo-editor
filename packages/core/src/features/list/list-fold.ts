import { Extension, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

const lists = new Set(["bulletList", "orderedList", "taskList"]);
const items = new Set(["listItem", "taskItem"]);
const viewFoldKey = new PluginKey<ReadonlyMap<number, boolean>>("semloEditorListFoldView");

function indent(node: ProseMirrorNode): number {
  const value = Number(node.attrs.semloEditorListIndent);
  return Number.isInteger(value) && value > 0 ? value : 0;
}

type Section = { node: ProseMirrorNode; pos: number; from: number; to: number; nested: { from: number; to: number }[] };
function sectionAt(doc: ProseMirrorNode, pos: number): Section | null {
  const $pos = doc.resolve(pos),
    node = $pos.nodeAfter;
  if (!node || !items.has(node.type.name) || !lists.has($pos.parent.type.name)) return null;
  const parent = $pos.parent,
    level = indent(node),
    index = $pos.index();
  let to = pos + node.nodeSize;
  for (let i = index + 1; i < parent.childCount; i++) {
    const child = parent.child(i);
    if (indent(child) <= level) break;
    to += child.nodeSize;
  }
  const from = pos + node.nodeSize;
  const nested: { from: number; to: number }[] = [];
  node.forEach((child, offset) => {
    if (lists.has(child.type.name)) nested.push({ from: pos + 1 + offset, to: pos + 1 + offset + child.nodeSize });
  });
  return to > from || nested.length ? { node, pos, from, to, nested } : null;
}

export function setListItemFolded(editor: Editor, pos: number, folded: boolean): boolean {
  if (editor.isDestroyed || !Number.isInteger(pos) || pos < 0 || pos > editor.state.doc.content.size) return false;
  const section = sectionAt(editor.state.doc, pos);
  if (!section) return false;
  const current = editor.isEditable
    ? !!section.node.attrs.semloEditorListFolded
    : (viewFoldKey.getState(editor.state)?.get(pos) ?? !!section.node.attrs.semloEditorListFolded);
  if (current === folded) return true;
  if (!editor.isEditable) {
    editor.view.dispatch(editor.state.tr.setMeta(viewFoldKey, { pos, folded }).setMeta("addToHistory", false));
    return true;
  }
  let tr = closeHistory(editor.state.tr).setNodeMarkup(pos, undefined, {
    ...section.node.attrs,
    semloEditorListFolded: folded,
  });
  if (
    folded &&
    tr.selection.ranges.some(({ $from, $to }) =>
      [section, ...section.nested].some(
        (range) => ($from.pos >= range.from && $from.pos < range.to) || ($to.pos >= range.from && $to.pos < range.to),
      ),
    )
  ) {
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 2)));
  }
  editor.view.dispatch(tr);
  return true;
}

function button(editor: Editor, doc: Document, section: Section, folded: boolean): HTMLButtonElement {
  const element = doc.createElement("button");
  element.type = "button";
  element.className = "semlo-editor-list-fold-toggle";
  element.contentEditable = "false";
  element.setAttribute("aria-expanded", String(!folded));
  element.setAttribute("data-semlo-editor-list-fold-pos", String(section.pos));
  element.setAttribute(
    "aria-label",
    `${folded ? "展开" : "折叠"}列表项：${(section.node.firstChild?.textContent ?? "").trim()}`,
  );
  element.title = folded ? "展开列表项" : "折叠列表项";
  element.innerHTML =
    '<svg aria-hidden="true" viewBox="0 0 16 16"><path d="m6 3.5 4 4.5-4 4.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  element.addEventListener("mousedown", (event) => event.preventDefault());
  element.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const keyboard = event.detail === 0 && editor.view.dom.ownerDocument.activeElement === element;
    if (!setListItemFolded(editor, section.pos, !folded) || !keyboard || editor.isDestroyed) return;
    editor.view.dom
      .querySelector<HTMLButtonElement>(`[data-semlo-editor-list-fold-pos="${section.pos}"]`)
      ?.focus({ preventScroll: true });
  });
  return element;
}

function decorations(editor: Editor, doc: ProseMirrorNode, overrides: ReadonlyMap<number, boolean>): DecorationSet {
  const result: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (!items.has(node.type.name)) return true;
    const section = sectionAt(doc, pos);
    if (!section || node.firstChild?.type.name !== "paragraph") return true;
    const folded = editor.isEditable
      ? !!node.attrs.semloEditorListFolded
      : (overrides.get(pos) ?? !!node.attrs.semloEditorListFolded);
    result.push(Decoration.node(pos, pos + node.nodeSize, { class: "semlo-editor-list-foldable" }));
    result.push(
      Decoration.widget(pos + 1, (view) => button(editor, view.dom.ownerDocument, section, folded), {
        side: -1,
        key: `list-fold-${pos}-${folded}-${node.textContent}`,
        stopEvent: () => true,
      }),
    );
    if (folded) {
      for (const range of section.nested)
        result.push(
          Decoration.node(range.from, range.to, { class: "semlo-editor-list-fold-hidden", "aria-hidden": "true" }),
        );
      const $pos = doc.resolve(pos),
        parent = $pos.parent;
      let childPos = section.from;
      for (let i = $pos.index() + 1; i < parent.childCount && childPos < section.to; i++) {
        const child = parent.child(i);
        result.push(
          Decoration.node(childPos, childPos + child.nodeSize, {
            class: "semlo-editor-list-fold-hidden",
            "aria-hidden": "true",
          }),
        );
        childPos += child.nodeSize;
      }
    }
    return true;
  });
  return DecorationSet.create(doc, result);
}

export const ListFold = Extension.create({
  name: "semloEditorListFold",
  addGlobalAttributes() {
    return [
      {
        types: ["listItem", "taskItem"],
        attributes: {
          semloEditorListFolded: {
            default: false,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-semlo-editor-list-folded") === "true",
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.semloEditorListFolded ? { "data-semlo-editor-list-folded": "true" } : {},
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<ReadonlyMap<number, boolean>>({
        key: viewFoldKey,
        state: {
          init: () => new Map(),
          apply(tr, previous) {
            const next = new Map<number, boolean>();
            for (const [pos, folded] of previous) {
              const mapped = tr.mapping.mapResult(pos, 1);
              if (!mapped.deleted && sectionAt(tr.doc, mapped.pos)) next.set(mapped.pos, folded);
            }
            const action = tr.getMeta(viewFoldKey) as { pos: number; folded: boolean } | undefined;
            if (action && sectionAt(tr.doc, action.pos)) next.set(action.pos, action.folded);
            return next;
          },
        },
        props: { decorations: (state) => decorations(editor, state.doc, viewFoldKey.getState(state) ?? new Map()) },
      }),
    ];
  },
});
