import { TextSelection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

/** 行位置无法验证时保留原选区，避免原生行选择越过标题并误删后文。 */
export function stopUnverifiedHeadingLineSelection(view: EditorView, event: KeyboardEvent): boolean {
  if (
    !event.isTrusted ||
    event.defaultPrevented ||
    (event.key !== "Home" && !(event.key === "End" && event.shiftKey)) ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.getModifierState("AltGraph") ||
    event.isComposing ||
    event.keyCode === 229 ||
    view.composing ||
    view.isDestroyed ||
    !view.editable ||
    !view.hasFocus() ||
    !(view.state.selection instanceof TextSelection)
  )
    return false;

  try {
    const native = view.dom.ownerDocument.getSelection();
    if (
      !native?.anchorNode ||
      !native.focusNode ||
      !view.dom.contains(native.anchorNode) ||
      !view.dom.contains(native.focusNode)
    )
      return false;
    // 以当前 DOM 选区判断归属，避免使用尚未同步的旧模型光标拦截其他段落。
    const anchor = view.state.doc.resolve(view.posAtDOM(native.anchorNode, native.anchorOffset));
    const head = view.state.doc.resolve(view.posAtDOM(native.focusNode, native.focusOffset));
    if (
      anchor.parent.type.name !== "heading" ||
      !Number.isInteger(anchor.parent.attrs.level) ||
      anchor.parent.attrs.level < 1 ||
      anchor.parent.attrs.level > 6 ||
      !anchor.sameParent(head)
    )
      return false;

    event.preventDefault();
    return true;
  } catch {
    // 编辑器持有焦点却无法读取或映射选区时，也不能继续执行不受控的行扩选。
    event.preventDefault();
    return true;
  }
}
