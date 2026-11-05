import { closeHistory, isHistoryTransaction, undoDepth } from "@tiptap/pm/history";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { createComponent } from "solid-js";
import { render } from "solid-js/web";
import { createApp, h } from "vue";

import { createEditor } from "../../../packages/core/src/editor/create-editor";
import { slashHistoryProbeKey } from "../../../packages/core/src/features/insertion/keys";
import type { EditorController } from "../../../packages/core/src/types";
import { SemloEditor as ReactEditor } from "../../../packages/react/src/index";
import { SemloEditor as SolidEditor } from "../../../packages/solid/src/index";
import { SemloEditor as VueEditor } from "../../../packages/vue/src/index";

import "../../../demo/editor.css";
let vetoKey: PluginKey | undefined;
let beforeResult = "";
let other: EditorController | undefined;
let current: EditorController | undefined;
let destroy = () => {};
let changes: string[] = [];
let seen: string[] = [];
Object.assign(window, {
  slashCandidate: {
    async mount(name: string) {
      destroy();
      changes = [];
      seen = [];
      const host = document.createElement("div");
      host.id = "candidate-host";
      document.body.append(host);
      let dispose = () => {};
      current = await new Promise<EditorController>((resolve) => {
        const props = {
          content: "<p></p><p>乙</p>",
          outline: false,
          onReady: resolve,
          onChange: (snap: { html: string }) => changes.push(snap.html),
        };
        if (name === "core") {
          const c = createEditor({ element: host, ...props });
          dispose = () => c.destroy();
          resolve(c);
        } else if (name === "react") {
          const root = createRoot(host);
          root.render(createElement(ReactEditor, props));
          dispose = () => root.unmount();
        } else if (name === "vue") {
          const app = createApp({ render: () => h(VueEditor, props) });
          app.mount(host);
          dispose = () => app.unmount();
        } else {
          dispose = render(() => createComponent(SolidEditor, props), host);
        }
      });
      if (location.search.includes("baseline=1")) current.editor.unregisterPlugin(slashHistoryProbeKey);
      destroy = () => {
        dispose();
        host.remove();
      };
    },
    setCaret(pos: number) {
      current!.editor.commands.setTextSelection(pos);
    },
    historyDepth() {
      return undoDepth(current!.editor.state);
    },
    historyBurst(count: number) {
      const editor = current!.editor;
      for (let i = 0; i < count; i++) {
        const pos = editor.state.doc.child(0).nodeSize + 1;
        editor.view.dispatch(closeHistory(editor.state.tr.insertText("x", pos)));
      }
    },
    reorderHistoryPlugin() {
      const editor = current!.editor;
      const candidate = slashHistoryProbeKey.get(editor.state)!;
      editor.registerPlugin(new Plugin({}), (added, plugins) => [
        plugins[0],
        candidate,
        ...plugins.slice(1).filter((plugin) => plugin !== candidate),
        added,
      ]);
    },
    breakHistory() {
      const e = current!.editor;
      e.view.dispatch(closeHistory(e.state.tr));
    },
    installUndoVeto() {
      vetoKey = new PluginKey("hostVetoHistory");
      current!.editor.registerPlugin(
        new Plugin({
          key: vetoKey,
          filterTransaction(tr) {
            return !isHistoryTransaction(tr);
          },
        }),
      );
    },
    removeUndoVeto() {
      if (vetoKey) current!.editor.unregisterPlugin(vetoKey);
    },
    armBefore(mode: string) {
      const e = current!.editor;
      beforeResult = "";
      e.on("beforeTransaction", ({ transaction }) => {
        if (!isHistoryTransaction(transaction)) return;
        try {
          if (mode === "replace") current!.setContent("<p>宿主替换</p>");
          else if (mode === "destroy") e.destroy();
        } catch (err) {
          beforeResult = (err as Error).name;
        }
      });
    },
    runUndo() {
      try {
        current!.editor.commands.undo();
        return "ok";
      } catch (err) {
        return (err as Error).name;
      }
    },
    beforeResult() {
      return beforeResult;
    },
    isDestroyed() {
      return current!.editor.isDestroyed;
    },
    installAppendOnUndo() {
      current!.editor.registerPlugin(
        new Plugin({
          appendTransaction(trs, _old, state) {
            if (!trs.some(isHistoryTransaction) || !state.doc.textContent.startsWith("/p")) return null;
            return state.tr.insertText("甲", 3).setMeta("addToHistory", false);
          },
        }),
      );
    },
    installAppendMutation() {
      current!.editor.registerPlugin(
        new Plugin({
          appendTransaction(trs, _old, state) {
            if (
              trs.some((tr) => tr.getMeta("hostAppended")) ||
              !state.doc.textContent.startsWith("/p") ||
              state.doc.rangeHasMark(2, 3, current!.editor.schema.marks.bold)
            )
              return null;
            return state.tr.addMark(2, 3, current!.editor.schema.marks.bold.create()).setMeta("hostAppended", true);
          },
        }),
      );
    },
    installBoldMutation() {
      current!.editor.registerPlugin(
        new Plugin({
          filterTransaction(tr) {
            if (tr.docChanged && tr.doc.textContent.startsWith("/p")) {
              const pos = tr.selection.from;
              tr.addMark(pos - 1, pos, current!.editor.schema.marks.bold.create());
            }
            return true;
          },
        }),
      );
    },
    mountSecond() {
      const host = document.createElement("div");
      host.id = "candidate-host-b";
      document.body.append(host);
      other = createEditor({ element: host, outline: false, content: "<p>宿主</p>" });
    },
    otherHtml() {
      return other?.editor.getHTML();
    },
    destroySecond() {
      other?.destroy();
      document.getElementById("candidate-host-b")?.remove();
      other = undefined;
    },
    installHook() {
      current!.editor.registerPlugin(
        new Plugin({
          props: {
            handleTextInput(view, from, to, text) {
              seen.push(text);
              if (text === "q") {
                view.dispatch(view.state.tr.insertText("Q", from, to));
                return true;
              }
              return false;
            },
          },
        }),
      );
    },
    debug() {
      const x = slashHistoryProbeKey.getState(current!.editor.state);
      return {
        trusted: x.trusted,
        reopenFrom: x.reopenFrom,
        valid: x.valid,
        done: x.done.map(Boolean),
        undone: x.undone.map(Boolean),
        pending: !!x.pending,
      };
    },
    html() {
      return current!.editor.getHTML();
    },
    snapshot() {
      return current!.getSnapshot().html;
    },
    changes() {
      return changes;
    },
    seen() {
      return seen;
    },
    hostInsert(value: string, pos: number) {
      current!.editor.commands.insertContentAt(pos, value);
    },
    hostInsertBoundary(value: string, pos: number) {
      const e = current!.editor;
      e.view.dispatch(closeHistory(e.state.tr.insertText(value, pos)));
      e.view.dispatch(closeHistory(e.state.tr));
    },
    setContent(value: string) {
      current!.setContent(value);
    },
    destroy() {
      destroy();
    },
  },
});
