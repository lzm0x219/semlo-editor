import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

import { headingNumberingStyle } from "./numbering";
import { openHeadingNumberingMenu, type HeadingNumberingMenuClose, type HeadingNumberingStyle } from "./numbering-menu";
import { setHeadingNumberingStyle } from "./numbering-toggle";

/** Connect numbered heading markers to their editor-owned style menu. */
export function mountHeadingNumberingInteraction(editor: Editor): () => void {
  const view = editor.view;
  const dom = view.dom;
  let anchor: HTMLElement | undefined;
  let heading: HTMLElement | undefined;
  let headingPos: number | undefined;
  let close: HeadingNumberingMenuClose | undefined;

  const markerFor = (target: EventTarget | null): HTMLElement | null => {
    const ElementType = dom.ownerDocument.defaultView?.Element;
    if (!ElementType || !(target instanceof ElementType)) return null;
    const marker = target.closest<HTMLElement>(".semlo-editor-heading-number");
    return marker && dom.contains(marker) ? marker : null;
  };

  const setStyle = (style: HeadingNumberingStyle) => {
    setHeadingNumberingStyle(editor, style);
  };

  const show = (marker: HTMLElement, keyboard: boolean) => {
    if (editor.isDestroyed || !editor.isEditable || !marker.isConnected) return;
    if (anchor === marker && close) return;
    const pos = Number(marker.dataset.semloEditorHeadingNumberPos);
    const node = Number.isInteger(pos) ? editor.state.doc.nodeAt(pos) : undefined;
    const style = node?.type.name === "heading" ? headingNumberingStyle(node.attrs.semloEditorHeadingNumbering) : null;
    const owner = marker.closest<HTMLElement>("h1,h2,h3,h4,h5,h6");
    if (!style || !owner || !dom.contains(owner)) return;
    close?.();
    anchor = marker;
    heading = owner;
    headingPos = pos;
    close = openHeadingNumberingMenu({
      anchor: marker,
      value: style,
      focusOnOpen: keyboard,
      onSelect: setStyle,
      onClose: () => {
        anchor = undefined;
        heading = undefined;
        headingPos = undefined;
        close = undefined;
      },
    });
  };

  const mouseDown = (event: MouseEvent) => {
    if (editor.isEditable && markerFor(event.target)) event.preventDefault();
  };
  const click = (event: MouseEvent) => {
    const marker = markerFor(event.target);
    if (!marker || !editor.isEditable) return;
    event.preventDefault();
    event.stopPropagation();
    show(marker, event.detail === 0);
  };
  const keyDown = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229 || (event.key !== "Enter" && event.key !== " ")) return;
    const marker = markerFor(event.target);
    if (!marker || !editor.isEditable) return;
    event.preventDefault();
    event.stopPropagation();
    show(marker, true);
  };
  const editableChanged = () => {
    if (!editor.isEditable) close?.();
    for (const marker of dom.querySelectorAll<HTMLElement>(".semlo-editor-heading-number")) {
      marker.tabIndex = editor.isEditable ? 0 : -1;
      marker.setAttribute("aria-disabled", String(!editor.isEditable));
    }
  };
  const transaction = ({ transaction }: { transaction: Transaction }) => {
    if (!anchor || !heading || headingPos === undefined || !close) return;
    const mapped = transaction.mapping.mapResult(headingPos, 1);
    const node = editor.state.doc.nodeAt(mapped.pos);
    if (
      editor.isDestroyed ||
      !editor.isEditable ||
      mapped.deleted ||
      !heading.isConnected ||
      !dom.contains(heading) ||
      view.nodeDOM(mapped.pos) !== heading ||
      node?.type.name !== "heading" ||
      !headingNumberingStyle(node.attrs.semloEditorHeadingNumbering)
    ) {
      close();
      return;
    }
    headingPos = mapped.pos;
    if (anchor.isConnected && heading.contains(anchor)) return;
    const replacement = heading.querySelector<HTMLElement>(".semlo-editor-heading-number");
    if (!replacement || !close.reanchor(replacement)) {
      close?.();
      return;
    }
    anchor = replacement;
  };

  dom.addEventListener("mousedown", mouseDown, true);
  dom.addEventListener("click", click, true);
  dom.addEventListener("keydown", keyDown, true);
  dom.addEventListener("semlo-editor:editable", editableChanged);
  editor.on("transaction", transaction);
  return () => {
    close?.();
    editor.off("transaction", transaction);
    dom.removeEventListener("mousedown", mouseDown, true);
    dom.removeEventListener("click", click, true);
    dom.removeEventListener("keydown", keyDown, true);
    dom.removeEventListener("semlo-editor:editable", editableChanged);
  };
}
