import "./heading-restart-controlled-fixture";
import { closeHistory, isHistoryTransaction, redoDepth, undoDepth } from "@tiptap/pm/history";
import { Plugin, PluginKey } from "@tiptap/pm/state";

type Mode = "deletion" | "history";
type ControlledHistoryProbe = {
  closeInitialHistory(): void;
  rejectNext(mode: Mode): void;
  changeHeadingOutsideHistory(mode?: "markup" | "attribute"): void;
  rejections(): number;
  depths(): { undo: number; redo: number };
};
declare global {
  interface Window {
    controlledHistoryProbe?: ControlledHistoryProbe;
  }
}

const key = new PluginKey("controlledHeadingHistoryReject");
let rejections = 0;
window.controlledHistoryProbe = {
  closeInitialHistory() {
    const editor = window.__semloRequireFixture("restartControlledFixture").controller.editor;
    editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
  },
  rejectNext(mode) {
    const editor = window.__semloRequireFixture("restartControlledFixture").controller.editor;
    let pending = true;
    editor.registerPlugin(
      new Plugin({
        key,
        filterTransaction(transaction) {
          const matches =
            mode === "history" ? isHistoryTransaction(transaction) : !!transaction.getMeta("preventClearDocument");
          if (!pending || !transaction.docChanged || !matches) return true;
          pending = false;
          rejections += 1;
          return false;
        },
      }),
    );
  },
  changeHeadingOutsideHistory(mode = "markup") {
    const editor = window.__semloRequireFixture("restartControlledFixture").controller.editor;
    const heading = editor.state.doc.firstChild;
    if (!heading || heading.type.name !== "heading") throw new Error("Expected a root heading");
    const tr =
      mode === "attribute"
        ? editor.state.tr.setNodeAttribute(0, "textAlign", "center")
        : editor.state.tr.setNodeMarkup(0, undefined, { ...heading.attrs, textAlign: "center" });
    editor.view.dispatch(tr.setMeta("addToHistory", false));
  },
  rejections: () => rejections,
  depths: () => {
    const state = window.__semloRequireFixture("restartControlledFixture").controller.editor.state;
    return { undo: undoDepth(state), redo: redoDepth(state) };
  },
};
