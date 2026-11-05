// Use the full consumer-equivalent styles for real block-menu pointer movement.
import "../list/ordered-restart-controlled-fixture";
import "../../../demo/editor.css";
import { undoDepth } from "@tiptap/pm/history";
import { Plugin, PluginKey, TextSelection } from "@tiptap/pm/state";

type FilterCall = { docChanged: boolean; selectionSet: boolean; before: [number, number]; after: [number, number] };
declare global {
  interface Window {
    headingUndoProbe?: {
      setSelection(text: string, anchor: number, head: number): void;
      rejectChanges(): void;
      observeChanges(): void;
      pluginRevision(): number | undefined;
      historyDepth(): number;
      filterCalls: FilterCall[];
    };
  }
}

const filterCalls: FilterCall[] = [];
const key = new PluginKey<number>("headingUndoHostFixture");
function addHostPlugin(reject: boolean) {
  const editor = window.__semloRequireFixture("restartControlledFixture").controller.editor;
  editor.registerPlugin(
    new Plugin<number>({
      key,
      state: {
        init: () => 0,
        apply: (tr, value) => value + Number(tr.docChanged),
      },
      filterTransaction(tr, state) {
        filterCalls.push({
          docChanged: tr.docChanged,
          selectionSet: tr.selectionSet,
          before: [state.selection.anchor, state.selection.head],
          after: [tr.selection.anchor, tr.selection.head],
        });
        return !reject || !tr.docChanged;
      },
    }),
  );
}
window.headingUndoProbe = {
  setSelection(text, anchor, head) {
    const editor = window.__semloRequireFixture("restartControlledFixture").controller.editor;
    let start = -1;
    editor.state.doc.descendants((node, position) => {
      if (node.isTextblock && node.textContent === text) start = position + 1;
    });
    if (start < 0) throw new Error(`Missing textblock ${text}`);
    editor.view.focus();
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, start + anchor, start + head)),
    );
  },
  rejectChanges() {
    addHostPlugin(true);
  },
  observeChanges: () => addHostPlugin(false),
  pluginRevision: () => key.getState(window.__semloRequireFixture("restartControlledFixture").controller.editor.state),
  historyDepth: () => undoDepth(window.__semloRequireFixture("restartControlledFixture").controller.editor.state),
  filterCalls,
};
