import {
  createEditor,
  getBoldState,
  toggleBold,
  type BoldState,
  type EditorControllerWithResults,
  type ToolbarFactory,
} from "../../../packages/core/dist/index.js";

import "../../../packages/core/dist/style.css";

type Mode = "default" | "custom-main" | "custom-floating" | "custom-format";
let controller: EditorControllerWithResults;
let host: HTMLElement;
let mount: HTMLElement | null = null;

declare global {
  interface Window {
    boldCommandFixture: {
      mount(mode: Mode, content: string): void;
      select(from: number, to: number): void;
      selectAll(): void;
      selectCells(): void;
      selectNode(): void;
      state(): BoldState;
      snapshot(): unknown;
      selection(): string;
      range(): { from: number; to: number };
      execute(focus?: boolean): boolean;
      setContent(content: string): void;
      editable(value: boolean): void;
      undo(): boolean;
      redo(): boolean;
      unmount(): void;
      remount(): void;
      destroy(): void;
    };
  }
}

const custom =
  (label: string, compact = false): ToolbarFactory =>
  ({ element, controller: current, syncSelection, subscribe }) => {
    const button = element.ownerDocument.createElement("button");
    button.type = "button";
    button.textContent = compact ? "B" : label;
    button.setAttribute("aria-label", label);
    if (compact) button.className = "semlo-editor-button";
    button.addEventListener("mousedown", (event) => {
      event.preventDefault();
      syncSelection();
    });
    button.addEventListener("click", () => toggleBold(current.editor));
    element.append(button);
    const update = () => {
      const state = getBoldState(current.editor);
      button.disabled = !state.enabled;
      button.setAttribute("aria-pressed", String(state.active));
    };
    const unsubscribe = subscribe(update);
    update();
    return unsubscribe;
  };

window.boldCommandFixture = {
  mount(mode, content) {
    host = document.createElement("div");
    host.id = "bold-command-host";
    document.body.append(host);
    controller = createEditor({
      element: host,
      content,
      outline: false,
      toolbar: mode === "custom-main" ? custom("自定义主加粗") : true,
      floatingToolbar:
        mode === "custom-floating" ? custom("自定义浮动加粗") : mode === "custom-format" ? custom("加粗", true) : true,
    });
  },
  select(from, to) {
    controller.editor.chain().focus().setTextSelection({ from, to }).run();
  },
  selectAll() {
    controller.editor.chain().focus().selectAll().run();
  },
  selectCells() {
    const editor = controller.editor;
    const positions: number[] = [];
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell") positions.push(pos);
    });
    if (positions.length !== 2) throw new Error("测试需要两个表格单元格");
    editor.view.focus();
    editor.commands.setCellSelection({ anchorCell: positions[0], headCell: positions[1] });
  },
  selectNode() {
    controller.editor.view.focus();
    controller.editor.commands.setNodeSelection(0);
  },
  state() {
    return getBoldState(controller.editor);
  },
  snapshot() {
    return controller.getSnapshot().json;
  },
  selection() {
    return controller.editor.state.selection.constructor.name;
  },
  range() {
    const { from, to } = controller.editor.state.selection;
    return { from, to };
  },
  execute(focus = true) {
    return toggleBold(controller.editor, { focus });
  },
  setContent(content) {
    controller.setContent(content);
  },
  editable(value) {
    controller.setEditable(value);
  },
  undo() {
    return controller.editor.commands.undo();
  },
  redo() {
    return controller.editor.commands.redo();
  },
  unmount() {
    mount = controller.editor.view.dom.parentElement;
    controller.editor.unmount();
  },
  remount() {
    if (!mount) throw new Error("编辑器挂载节点不存在");
    controller.editor.mount(mount);
  },
  destroy() {
    controller.destroy();
    host.remove();
  },
};
