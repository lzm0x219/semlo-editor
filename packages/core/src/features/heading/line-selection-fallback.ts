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
    const root = view.dom.getRootNode();
    let native: Selection | null;
    if (root === view.dom.ownerDocument) native = view.dom.ownerDocument.getSelection();
    else {
      const getSelection = Reflect.get(root, "getSelection");
      if (typeof getSelection !== "function" || !(native = getSelection.call(root) as Selection | null)) {
        // Shadow DOM 无法读取内部选区时，不能让原生行选择越出编辑器。
        event.preventDefault();
        return true;
      }
    }
    if (
      !native?.anchorNode ||
      !native.focusNode ||
      !view.dom.contains(native.anchorNode) ||
      !view.dom.contains(native.focusNode)
    ) {
      // Shadow DOM 可能只暴露重定向后的外层节点，无法确认真实选区时停止操作。
      if (root !== view.dom.ownerDocument) {
        event.preventDefault();
        return true;
      }
      return false;
    }
    // 以当前 DOM 选区判断归属，避免使用尚未同步的旧模型光标拦截其他段落。
    const anchor = view.state.doc.resolve(view.posAtDOM(native.anchorNode, native.anchorOffset));
    const head = view.state.doc.resolve(view.posAtDOM(native.focusNode, native.focusOffset));
    if (!anchor.sameParent(head)) {
      // 不能确认跨块行端点时，保留选区，避免原生扩选吞掉前后段落。
      if (event.shiftKey) {
        event.preventDefault();
        return true;
      }
      return false;
    }
    if (event.shiftKey && anchor.parent.type.name === "paragraph") {
      // 未核实的正文行选择也可能越块；保留选区而不是冒险误删。
      event.preventDefault();
      return true;
    }
    if (
      anchor.parent.type.name !== "heading" ||
      !Number.isInteger(anchor.parent.attrs.level) ||
      anchor.parent.attrs.level < 1 ||
      anchor.parent.attrs.level > 6
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
