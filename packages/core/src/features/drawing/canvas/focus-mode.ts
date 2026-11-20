export function createCanvasFocusMode(root: HTMLElement, surface: HTMLElement, canOpen: () => boolean) {
  const doc = root.ownerDocument;
  const dialog = doc.createElement("dialog");
  dialog.className = "semlo-editor-canvas-focus-dialog";
  dialog.setAttribute("aria-label", "画布专注编辑");
  const header = doc.createElement("div");
  header.className = "semlo-editor-canvas-focus-header";
  const back = doc.createElement("button");
  back.type = "button";
  back.autofocus = true;
  back.textContent = "返回文档";
  header.append(back);
  dialog.append(header);

  const close = (returnFocus = false) => {
    if (dialog.parentElement !== root) return;
    // 先结束当前文字输入，让已有的失焦提交仍在同一画布和文档中完成。
    if (returnFocus) back.focus({ preventScroll: true });
    if (dialog.parentElement !== root) return;
    dialog.replaceWith(surface);
    dialog.close();
    if (returnFocus && canOpen())
      surface.querySelector<HTMLButtonElement>(".semlo-editor-canvas-focus-trigger")?.focus({ preventScroll: true });
  };

  back.addEventListener("click", () => close(true));
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close(true);
  });

  return {
    supported: typeof dialog.showModal === "function",
    open() {
      if (dialog.parentElement === root || !root.isConnected || !canOpen()) return;
      root.append(dialog);
      dialog.showModal();
      // 只移动节点视图内已有的画布，保留选区、编辑控件和事务归属。
      if (dialog.open) dialog.append(surface);
    },
    close,
  };
}
