import type { Editor, Range } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment } from "@tiptap/pm/model";
import { NodeSelection, type Transaction } from "@tiptap/pm/state";

import { linkPopup } from "../../platform/dom/popup-owner";
import type { BlockInsertTarget } from "../blocks/actions/target";
import { isHeadingFolded, setHeadingFolded } from "../heading/fold";
import type { ContentPickerProvider } from "./yuque-content-picker";
import { createContentPickerView, isContentChoice } from "./yuque-content-picker-view";

interface ContentSessionContext {
  document: Document;
  shell: HTMLElement;
  getEditor(): Editor;
  getProvider(): ContentPickerProvider | null | undefined;
  closeOther(): void;
  closePopover(): void;
  registerPopover(element: HTMLElement, close: () => void): void;
  report(error: unknown): void;
}

/** 管理内容选择弹层及其对原始文档、选区和接入能力的有效性检查。 */
export function createYuqueContentSession({
  document: doc,
  shell,
  getEditor,
  getProvider,
  closeOther,
  closePopover,
  registerPopover,
  report,
}: ContentSessionContext) {
  let closeCurrent: (() => void) | undefined;

  const open = (range?: Range, target?: BlockInsertTarget, anchor?: HTMLElement) => {
    const editor = getEditor();
    const provider = getProvider();
    if (
      !provider ||
      typeof provider.search !== "function" ||
      typeof provider.resolveLink !== "function" ||
      !editor.isEditable ||
      editor.isDestroyed
    )
      return;
    closeOther();
    const originalDoc = editor.state.doc;
    const selection = editor.state.selection;
    const insertionRange = range ? { ...range } : { from: selection.from, to: selection.to };
    let closed = false;
    let unlink: (() => void) | undefined;
    const close = () => {
      if (closed) return;
      closed = true;
      if (closeCurrent === close) closeCurrent = undefined;
      editor.off("transaction", invalidate);
      doc.removeEventListener("pointerdown", outside, true);
      unlink?.();
      anchor?.setAttribute("aria-expanded", "false");
      picker.dispose();
    };
    const picker = createContentPickerView({
      document: doc,
      provider,
      onClose: (reason) => {
        close();
        if (reason === "user" && !editor.isDestroyed && editor.isEditable) {
          if (anchor?.isConnected) anchor.focus({ preventScroll: true });
          else editor.commands.focus();
        }
      },
      onChoose: (choice) => {
        if (
          closed ||
          editor.isDestroyed ||
          !editor.isEditable ||
          getProvider() !== provider ||
          editor.state.doc !== originalDoc ||
          (!target && !editor.state.selection.eq(selection)) ||
          !isContentChoice(choice)
        )
          return closePopover();
        const href = new URL(choice.href).href;
        closePopover();
        const reference = editor.schema.nodes.semloEditorContentReference;
        if (!reference) return report(new Error("内容引用功能不可用"));
        const referenceNode = reference.create({
          id: choice.id,
          title: choice.title,
          href,
          kind: choice.kind,
          description: choice.description ?? "",
        });
        if (target) {
          const { state } = editor;
          const original = state.doc.nodeAt(target.pos);
          if (original !== target.node || target.after !== target.pos + original.nodeSize) return;
          const $pos = state.doc.resolve(target.pos);
          const parent = $pos.parent;
          const index = $pos.index() + 1;
          const paragraph = state.schema.nodes.paragraph;
          if (!paragraph) return;
          let inserted = paragraph.create(null, referenceNode);
          if (target.kind === "item") {
            const attrs = { ...original.attrs, ...(original.type.name === "taskItem" ? { checked: false } : {}) };
            if (!original.type.validContent(Fragment.from(inserted))) return;
            inserted = original.type.create(attrs, inserted);
          }
          if (!parent.canReplaceWith(index, index, inserted.type)) return;
          editor.view.dispatch(closeHistory(state.tr.insert(target.after, inserted)));
          if (original.type.name === "heading" && isHeadingFolded(editor, target.pos))
            setHeadingFolded(editor, target.pos, false);
        } else {
          const { state, view } = editor;
          const from = state.doc.resolve(insertionRange.from);
          const to = state.doc.resolve(insertionRange.to);
          if (from.depth === 1 && from.parent.type.name === "paragraph" && from.sameParent(to)) {
            const paragraph = from.parent;
            const blocks = [];
            if (from.parentOffset > 0) blocks.push(paragraph.copy(paragraph.content.cut(0, from.parentOffset)));
            const prefixSize = blocks.reduce((total, block) => total + block.nodeSize, 0);
            blocks.push(paragraph.type.create(null, referenceNode));
            if (to.parentOffset < paragraph.content.size)
              blocks.push(paragraph.copy(paragraph.content.cut(to.parentOffset)));
            const start = from.before(1);
            const transaction = closeHistory(state.tr).replaceWith(
              start,
              start + paragraph.nodeSize,
              Fragment.fromArray(blocks),
            );
            transaction.setSelection(NodeSelection.create(transaction.doc, start + prefixSize + 1));
            view.dispatch(transaction);
            if (!editor.isDestroyed && editor.view === view && editor.state.doc.eq(transaction.doc))
              view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
          } else editor.commands.insertContentAt(insertionRange, referenceNode.toJSON());
        }
        if (!editor.isDestroyed && editor.isEditable) editor.commands.focus();
      },
    });
    const outside = (event: Event) => {
      if (!picker.element.contains(event.target as globalThis.Node)) closePopover();
    };
    const invalidate = ({ transaction }: { transaction: Transaction }) => {
      if (transaction.docChanged || (!target && !editor.state.selection.eq(selection))) closePopover();
    };
    shell.append(picker.element);
    try {
      const shellRect = shell.getBoundingClientRect();
      const contentRect = editor.view.dom.getBoundingClientRect();
      const point = editor.view.coordsAtPos(
        Math.min(target?.after ?? insertionRange.from, editor.state.doc.content.size),
      );
      const left = Math.max(8, contentRect.left - shellRect.left);
      picker.element.style.left = `${left}px`;
      picker.element.style.top = `${Math.max(8, point.top - shellRect.top + shell.scrollTop)}px`;
      picker.element.style.width = `${Math.max(0, Math.min(contentRect.width, shell.clientWidth - left - 8))}px`;
    } catch {
      // 无法获取当前选区几何时使用浮层的默认位置。
    }
    registerPopover(picker.element, close);
    closeCurrent = close;
    if (anchor) {
      unlink = linkPopup(anchor, picker.element);
      anchor.setAttribute("aria-expanded", "true");
    }
    doc.addEventListener("pointerdown", outside, true);
    editor.on("transaction", invalidate);
    picker.element.querySelector<HTMLInputElement>('input[type="search"]')?.focus();
  };

  return { open, close: () => closeCurrent?.() };
}
