import type { Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Mark, Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection, type Selection, type Transaction } from "@tiptap/pm/state";
import { ReplaceStep } from "@tiptap/pm/transform";

import { readDocumentFont, type LocalFontVariants } from "../../features/text/document-font";

const markNames = ["bold", "italic", "underline", "strike", "highlight", "subscript", "superscript"] as const;
type MarkName = (typeof markNames)[number];
const mixed = Symbol("mixed format");
type Mixed = typeof mixed;
type FontValue = { family: string | null; name: string | null; variants: LocalFontVariants | null };
type ColorValue = { color: unknown; gradient: unknown };
type CapturedFormat = {
  marks: Record<MarkName, Mark | null>;
  font: FontValue | Mixed;
  fontSize: unknown;
  color: ColorValue;
};

function cssFamily(name: string): string {
  return `"${name.replace(/[\\"]/g, "\\$&")}"`;
}

function documentFont(node: ProseMirrorNode): FontValue {
  try {
    const font = readDocumentFont(node.attrs);
    return { family: font.family ? cssFamily(font.family) : null, name: font.name, variants: font.variants };
  } catch {
    return { family: null, name: null, variants: null };
  }
}

function nodeFormat(marks: readonly Mark[], inherited: FontValue): CapturedFormat {
  const captured = Object.fromEntries(
    markNames.map((name) => [name, marks.find((mark) => mark.type.name === name) ?? null]),
  ) as CapturedFormat["marks"];
  const textStyle = marks.find((mark) => mark.type.name === "textStyle");
  const inline = textStyle?.attrs.fontFamily;
  const inherits = typeof inline !== "string" || !inline.trim() || /^(inherit|unset)$/i.test(inline.trim());
  const font = inherits
    ? inherited
    : {
        family: inline,
        name: typeof textStyle?.attrs.semloEditorFontName === "string" ? textStyle.attrs.semloEditorFontName : null,
        variants: textStyle?.attrs.semloEditorFontVariants ?? null,
      };
  return {
    marks: captured,
    font,
    fontSize: textStyle?.attrs.fontSize ?? null,
    color: { color: textStyle?.attrs.color ?? null, gradient: textStyle?.attrs.semloEditorGradient ?? null },
  };
}

function sameValue(first: unknown, second: unknown): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

/** Text marks, font size and text color follow the first selected text. */
function captureFormat(editor: Editor): CapturedFormat | null {
  const { state } = editor,
    selection = state.selection,
    inherited = documentFont(state.doc);
  if (selection.empty) {
    if (!(selection instanceof TextSelection)) return null;
    return nodeFormat(state.storedMarks ?? selection.$from.marks(), inherited);
  }
  let result: CapturedFormat | null = null;
  for (const { $from, $to } of selection.ranges) {
    state.doc.nodesBetween($from.pos, $to.pos, (node) => {
      if (!node.isText) return;
      const next = nodeFormat(node.marks, inherited);
      if (!result) {
        result = next;
        return;
      }
      if (result.font !== mixed && !sameValue(result.font, next.font)) result.font = mixed;
    });
  }
  return result;
}

function updateTextStyle(attrs: Record<string, unknown>, source: CapturedFormat): Record<string, unknown> {
  const next = { ...attrs };
  if (source.font !== mixed) {
    next.fontFamily = source.font.family;
    next.semloEditorFontName = source.font.name;
    next.semloEditorFontVariants = source.font.variants;
  }
  next.fontSize = source.fontSize;
  next.color = source.color.color;
  next.semloEditorGradient = source.color.gradient;
  return next;
}

function updateStoredMarks(editor: Editor, selection: TextSelection, source: CapturedFormat, tr: Transaction): void {
  let marks: readonly Mark[] = selection.eq(editor.state.selection)
    ? (editor.state.storedMarks ?? selection.$from.marks())
    : selection.$from.marks();
  for (const name of markNames) {
    const type = editor.schema.marks[name],
      value = source.marks[name];
    if (!type) continue;
    marks = type.removeFromSet(marks);
    if (value && selection.$from.parent.type.allowsMarkType(type)) marks = value.addToSet(marks);
  }
  const textStyle = editor.schema.marks.textStyle;
  if (textStyle && selection.$from.parent.type.allowsMarkType(textStyle)) {
    const current = textStyle.isInSet(marks);
    const attrs = updateTextStyle(current?.attrs ?? {}, source);
    marks = textStyle.removeFromSet(marks);
    if (Object.values(attrs).some((value) => value !== null && value !== undefined))
      marks = textStyle.create(attrs).addToSet(marks);
  }
  tr.setStoredMarks(marks);
}

function applyFormat(editor: Editor, selection: Selection, source: CapturedFormat): boolean {
  if (editor.isDestroyed || !editor.isEditable) return false;
  const state = editor.state,
    tr = state.tr.setSelection(selection);
  if (selection.empty) {
    if (!(selection instanceof TextSelection)) return false;
    updateStoredMarks(editor, selection, source, tr);
    editor.view.dispatch(tr);
    return true;
  }
  let textFound = false;
  for (const { $from, $to } of selection.ranges) {
    state.doc.nodesBetween($from.pos, $to.pos, (node, pos, parent) => {
      if (!node.isText || !parent) return;
      const from = Math.max(pos, $from.pos),
        to = Math.min(pos + node.nodeSize, $to.pos);
      if (from >= to) return;
      textFound = true;
      for (const name of markNames) {
        const type = state.schema.marks[name],
          value = source.marks[name];
        if (!type) continue;
        const current = type.isInSet(node.marks);
        if (value === null ? !current : !!current?.eq(value)) continue;
        tr.removeMark(from, to, type);
        if (value && parent.type.allowsMarkType(type)) tr.addMark(from, to, value);
      }
      const textStyle = state.schema.marks.textStyle;
      if (!textStyle || !parent.type.allowsMarkType(textStyle)) return;
      const current = textStyle.isInSet(node.marks);
      const attrs = updateTextStyle(current?.attrs ?? {}, source);
      if (sameValue(attrs, current?.attrs ?? {})) return;
      tr.removeMark(from, to, textStyle);
      if (Object.values(attrs).some((value) => value !== null && value !== undefined))
        tr.addMark(from, to, textStyle.create(attrs));
    });
  }
  if (!textFound) return false;
  if (tr.docChanged) {
    editor.view.dispatch(closeHistory(tr));
    // Keep later typing or another brush stroke in a separate undo step.
    editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
  } else if (!selection.eq(state.selection)) editor.view.dispatch(tr);
  return true;
}

export function createFormatPainterButton(doc: Document): HTMLButtonElement {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "semlo-editor-button semlo-editor-format-painter";
  button.title = "格式刷 ⇧⌘S";
  button.setAttribute("aria-label", "格式刷");
  button.setAttribute("aria-pressed", "false");
  button.setAttribute("aria-keyshortcuts", "Meta+Shift+S Control+Shift+S");
  button.innerHTML =
    '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14v5H5zM7 9v2a2 2 0 0 0 2 2h7M16 13a2 2 0 0 1 2 2v1"/><path d="M16 16h4v4a2 2 0 0 1-4 0z"/></svg>';
  return button;
}

export type FormatPainterOptions = { syncSelection?: () => void; beforeActivate?: () => void };

/** 格式刷可只绑定快捷键；默认按钮存在时同步管理按钮状态。 */
export function mountFormatPainter(
  editor: Editor,
  button: HTMLButtonElement | undefined,
  options: FormatPainterOptions = {},
): () => void {
  if (editor.isDestroyed) {
    if (button) button.disabled = true;
    return () => {};
  }
  const doc = button?.ownerDocument ?? editor.view.dom.ownerDocument;
  let view = editor.view,
    viewDocument = view.dom.ownerDocument,
    win = viewDocument.defaultView;
  let source: CapturedFormat | null = null,
    continuous = false,
    applying = false,
    disposed = false;
  let pointer: { id: number; x: number; y: number } | null = null;
  let keyboardSelecting = false,
    keyboardMoved = false;
  let frame: number | undefined;
  const cancelFrame = () => {
    if (frame !== undefined) win?.cancelAnimationFrame(frame);
    frame = undefined;
  };
  const cancel = () => {
    cancelFrame();
    source = null;
    continuous = false;
    pointer = null;
    keyboardSelecting = false;
    keyboardMoved = false;
    button?.setAttribute("aria-pressed", "false");
    button?.removeAttribute("data-semlo-editor-painter-continuous");
    view.dom.classList.remove("semlo-editor-format-painter-active");
  };
  const refresh = () => {
    const disabled = !editor.isEditable || editor.isDestroyed;
    if (button) button.disabled = disabled;
    if (disabled) cancel();
  };
  const activate = (locked: boolean) => {
    if (disposed || editor.isDestroyed || !editor.isEditable) return;
    const activatingView = view;
    options.syncSelection?.();
    if (disposed || editor.isDestroyed || !editor.isEditable || view !== activatingView) return;
    const captured = captureFormat(editor);
    if (!captured) return;
    options.beforeActivate?.();
    if (disposed || editor.isDestroyed || !editor.isEditable || view !== activatingView) return;
    source = captured;
    continuous = locked;
    button?.setAttribute("aria-pressed", "true");
    if (locked) button?.setAttribute("data-semlo-editor-painter-continuous", "true");
    else button?.removeAttribute("data-semlo-editor-painter-continuous");
    view.dom.classList.add("semlo-editor-format-painter-active");
  };
  const domSelection = (): Selection | null => {
    const selected = viewDocument.getSelection();
    if (
      !selected?.anchorNode ||
      !selected.focusNode ||
      !view.dom.contains(selected.anchorNode) ||
      !view.dom.contains(selected.focusNode)
    )
      return null;
    try {
      const anchor = view.posAtDOM(selected.anchorNode, selected.anchorOffset),
        head = view.posAtDOM(selected.focusNode, selected.focusOffset);
      return TextSelection.between(editor.state.doc.resolve(anchor), editor.state.doc.resolve(head));
    } catch {
      return null;
    }
  };
  const paint = (selection: Selection | null, allowEmpty: boolean) => {
    if (
      !source ||
      !selection ||
      (!allowEmpty && selection.empty) ||
      editor.isDestroyed ||
      !editor.isEditable ||
      view.composing
    )
      return;
    applying = true;
    try {
      if (applyFormat(editor, selection, source) && !continuous) cancel();
    } finally {
      applying = false;
    }
  };
  const pointerDown = (event: PointerEvent) => {
    if (!source || event.button !== 0) return;
    const target = event.target as globalThis.Node | null;
    if (!target || !view.dom.contains(target)) {
      if (!target || !button?.contains(target)) cancel();
      return;
    }
    const element = target.nodeType === 1 ? (target as Element) : target.parentElement;
    if (element?.closest('[contenteditable="false"]')) return;
    cancelFrame();
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const pointerUp = (event: PointerEvent) => {
    if (!source || !pointer || pointer.id !== event.pointerId) return;
    const dragged = Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) > 3;
    pointer = null;
    if (!win) return;
    cancelFrame();
    frame = win.requestAnimationFrame(() => {
      frame = undefined;
      const selection = domSelection();
      if (
        !dragged &&
        selection instanceof TextSelection &&
        selection.empty &&
        selection.$from.parent.type.name === "paragraph"
      ) {
        const { $from } = selection;
        if ($from.parent.content.size) {
          paint(TextSelection.create(editor.state.doc, $from.start(), $from.end()), false);
          return;
        }
        if (!continuous) cancel();
        return;
      }
      if (dragged) paint(selection, false);
    });
  };
  const pointerCancel = () => {
    pointer = null;
    cancelFrame();
  };
  const compositionStart = () => {
    pointer = null;
    keyboardSelecting = false;
    keyboardMoved = false;
    cancelFrame();
  };
  const keyDown = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229 || view.composing) return;
    const target = event.target as globalThis.Node | null;
    const inside = !!target && (view.dom.contains(target) || Boolean(button?.contains(target)));
    if (source && event.key === "Escape" && inside) {
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }
    if (
      inside &&
      event.shiftKey &&
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      event.key.toLowerCase() === "s"
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (source) cancel();
      else activate(false);
      return;
    }
    if (source && target && view.dom.contains(target)) {
      if (event.key === "Shift" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        keyboardSelecting = true;
        keyboardMoved = false;
      } else if (
        keyboardSelecting &&
        event.shiftKey &&
        /^(ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown)$/.test(event.key)
      )
        keyboardMoved = true;
    }
    if (
      source &&
      target &&
      view.dom.contains(target) &&
      event.key === "Enter" &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();
      event.stopPropagation();
      paint(domSelection() ?? editor.state.selection, true);
    }
  };
  const keyUp = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229 || view.composing) {
      if (event.key === "Shift") {
        keyboardSelecting = false;
        keyboardMoved = false;
      }
      return;
    }
    const target = event.target as globalThis.Node | null;
    if (
      !source ||
      event.key !== "Shift" ||
      !keyboardSelecting ||
      !keyboardMoved ||
      !target ||
      !view.dom.contains(target) ||
      !win
    )
      return;
    keyboardSelecting = false;
    keyboardMoved = false;
    cancelFrame();
    frame = win.requestAnimationFrame(() => {
      frame = undefined;
      paint(domSelection(), false);
    });
  };
  const click = (event: MouseEvent) => {
    if (event.detail >= 2 && source) {
      continuous = true;
      button?.setAttribute("data-semlo-editor-painter-continuous", "true");
      return;
    }
    if (source) cancel();
    else activate(false);
  };
  const buttonKey = (event: KeyboardEvent) => {
    if (event.isComposing || event.keyCode === 229 || view.composing) return;
    if (event.key === "Enter" && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      if (source) cancel();
      else activate(true);
    }
  };
  const transaction = ({
    transaction,
    appendedTransactions = [],
  }: {
    transaction: Transaction;
    appendedTransactions?: Transaction[];
  }) => {
    const transactions = [transaction, ...appendedTransactions];
    if (!source || applying || !transactions.some((item) => item.docChanged)) return;
    const replacesDocument =
      transactions.some((item) =>
        item.steps.some((step, index) => {
          const before = item.docs[index];
          const after = item.docs[index + 1] ?? item.doc;
          return step instanceof ReplaceStep && step.from === 0 && step.to === before.content.size && !before.eq(after);
        }),
      ) && !transaction.before.eq(editor.state.doc);
    if (!continuous || replacesDocument) cancel();
  };
  const destroy = () => {
    if (disposed) return;
    cancel();
    disposed = true;
    if (button) button.disabled = true;
    button?.removeEventListener("mousedown", preventFocus);
    button?.removeEventListener("click", click);
    button?.removeEventListener("keydown", buttonKey);
    detachDocument(doc);
    if (viewDocument !== doc) detachDocument(viewDocument);
    view.dom.removeEventListener("compositionstart", compositionStart);
    view.dom.removeEventListener("semlo-editor:editable", refresh);
    editor.off("transaction", transaction);
    editor.off("destroy", destroy);
    editor.off("unmount", unmount);
    editor.off("mount", mount);
  };
  const preventFocus = (event: MouseEvent) => event.preventDefault();
  const attachDocument = (target: Document) => {
    target.addEventListener("pointerdown", pointerDown, true);
    target.addEventListener("pointerup", pointerUp, true);
    target.addEventListener("pointercancel", pointerCancel, true);
    target.addEventListener("keydown", keyDown, true);
    target.addEventListener("keyup", keyUp, true);
  };
  const detachDocument = (target: Document) => {
    target.removeEventListener("pointerdown", pointerDown, true);
    target.removeEventListener("pointerup", pointerUp, true);
    target.removeEventListener("pointercancel", pointerCancel, true);
    target.removeEventListener("keydown", keyDown, true);
    target.removeEventListener("keyup", keyUp, true);
  };
  const unmount = () => {
    cancel();
    view.dom.removeEventListener("compositionstart", compositionStart);
    view.dom.removeEventListener("semlo-editor:editable", refresh);
    if (viewDocument !== doc) detachDocument(viewDocument);
    if (button) button.disabled = true;
  };
  const mount = () => {
    if (disposed || editor.isDestroyed) return;
    view = editor.view;
    viewDocument = view.dom.ownerDocument;
    win = viewDocument.defaultView;
    if (viewDocument !== doc) attachDocument(viewDocument);
    view.dom.addEventListener("compositionstart", compositionStart);
    view.dom.addEventListener("semlo-editor:editable", refresh);
    refresh();
  };
  button?.addEventListener("mousedown", preventFocus);
  button?.addEventListener("click", click);
  button?.addEventListener("keydown", buttonKey);
  attachDocument(doc);
  if (viewDocument !== doc) attachDocument(viewDocument);
  view.dom.addEventListener("compositionstart", compositionStart);
  view.dom.addEventListener("semlo-editor:editable", refresh);
  editor.on("transaction", transaction);
  editor.on("destroy", destroy);
  editor.on("unmount", unmount);
  editor.on("mount", mount);
  refresh();
  return destroy;
}
