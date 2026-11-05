import type { Editor } from "@tiptap/core";

/** Apply the remembered background color while the editor receives keyboard input. */
export function mountToolbarColorShortcuts(editor: Editor, applyBackground: () => void): () => void {
  let dom: HTMLElement | null = null;
  const onKeyDown = (event: KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      event.isComposing ||
      event.keyCode === 229 ||
      !editor.isEditable ||
      !event.altKey ||
      event.getModifierState("AltGraph") ||
      !(event.metaKey || event.ctrlKey) ||
      event.shiftKey ||
      event.key.toLowerCase() !== "h"
    )
      return;
    event.preventDefault();
    applyBackground();
  };
  const unbind = () => {
    dom?.removeEventListener("keydown", onKeyDown, true);
    dom = null;
  };
  const bind = () => {
    unbind();
    dom = editor.view.dom;
    dom.addEventListener("keydown", onKeyDown, true);
  };
  editor.on("mount", bind);
  editor.on("unmount", unbind);
  bind();
  return () => {
    unbind();
    editor.off("mount", bind);
    editor.off("unmount", unbind);
  };
}
