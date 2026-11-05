import { createEditor } from "../../../packages/core/src/editor/create-editor";

import "../../../packages/core/src/styles/style.css";

const controllers = [0, 1].map((index) => {
  const host = document.createElement("div");
  host.id = `editor-${index}`;
  document.body.append(host);
  return createEditor({ element: host, outline: false, content: "<p>甲乙</p>" });
});
const lifecycle: string[] = [];
controllers[0].editor.on("unmount", () => lifecycle.push("unmount"));
controllers[0].editor.on("mount", () => lifecycle.push("mount"));
let oldDOM: HTMLElement | undefined;
let currentDOMBeforeDestroy: HTMLElement | undefined;

function keyboard(dom: HTMLElement) {
  const win = dom.ownerDocument.defaultView!;
  const event = new win.KeyboardEvent("keydown", {
    key: "h",
    altKey: true,
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  dom.dispatchEvent(event);
  return event.defaultPrevented;
}
Object.assign(window, {
  toolbarColorRemount: {
    select(index: number) {
      controllers[index].editor.view.dom.focus();
      controllers[index].editor.commands.setTextSelection({ from: 1, to: 3 });
    },
    remount(index: number) {
      const editor = controllers[index].editor;
      const mount = editor.view.dom.parentElement!;
      oldDOM = editor.view.dom;
      editor.unmount();
      editor.mount(mount);
    },
    remountInFrame() {
      const editor = controllers[0].editor;
      oldDOM = editor.view.dom;
      const frame = document.createElement("iframe");
      frame.id = "remount-frame";
      document.body.append(frame);
      editor.unmount();
      editor.mount(frame.contentDocument!.body);
    },
    currentDocumentIsFrame() {
      const frame = document.querySelector<HTMLIFrameElement>("#remount-frame");
      return controllers[0].editor.view.dom.ownerDocument === frame?.contentDocument;
    },
    press(index: number) {
      const dom = controllers[index].editor.view.dom;
      dom.focus();
      return { prevented: keyboard(dom), marks: dom.querySelectorAll("mark").length };
    },
    pressOld() {
      return oldDOM ? keyboard(oldDOM) : null;
    },
    clear(index: number) {
      controllers[index].editor.commands.unsetHighlight();
    },
    setEditable(index: number, editable: boolean) {
      controllers[index].setEditable(editable);
    },
    destroy(index: number) {
      currentDOMBeforeDestroy = controllers[index].editor.view.dom;
      controllers[index].destroy();
    },
    pressDestroyed() {
      return currentDOMBeforeDestroy ? keyboard(currentDOMBeforeDestroy) : null;
    },
    lifecycle() {
      return lifecycle;
    },
  },
});
