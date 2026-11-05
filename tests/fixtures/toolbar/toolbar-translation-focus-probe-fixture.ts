import { createEditor } from "../../../packages/core/src/editor/create-editor";
import { mountTranslationPanel } from "../../../packages/core/src/ui/toolbar/translation";
Object.assign(window, {
  translationFocusProbe: async (mode: string) => {
    const host = document.createElement("div");
    const external = document.createElement("button");
    document.body.append(host, external);
    let mount: HTMLElement;
    let c: ReturnType<typeof createEditor>;
    c = createEditor({
      element: host,
      outline: false,
      content: "<p>甲乙</p>",
      onChange() {
        if (mode === "remount") {
          c.editor.unmount();
          c.editor.mount(mount);
        }
        if (mode === "destroy") c.destroy();
        if (mode !== "normal") external.focus();
      },
    });
    mount = c.editor.view.dom.parentElement!;
    const panel = mountTranslationPanel(
      c.editor,
      host.querySelector(".semlo-editor-editor-body")!,
      () => async () => "译文",
    );
    const trigger = document.createElement("button");
    host.append(trigger);
    c.editor.commands.setTextSelection({ from: 1, to: 3 });
    panel.open(trigger);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    const button = [...host.querySelectorAll<HTMLButtonElement>(".semlo-editor-translation-insert")].at(-1)!;
    const old = c.editor.view;
    button.focus();
    button.click();
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const output = {
      externalFocused: document.activeElement === external,
      editorFocused: !c.editor.isDestroyed && c.editor.view.hasFocus(),
      oldDestroyed: old.isDestroyed,
      destroyed: c.editor.isDestroyed,
      html: c.editor.isDestroyed ? "" : c.editor.getHTML(),
    };
    panel.destroy();
    if (mode !== "destroy") c.destroy();
    host.remove();
    external.remove();
    return output;
  },
});
