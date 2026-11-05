import { Fragment } from "@tiptap/pm/model";
import { Plugin, TextSelection } from "@tiptap/pm/state";

import { createEditor } from "../../../packages/core/src/editor/create-editor";
import { openEmojiPicker } from "../../../packages/core/src/features/insertion/emoji";
import { openCardMenu } from "../../../packages/core/src/features/insertion/menu";

import "../../../packages/core/src/styles/style.css";
import "../../../packages/core/src/ui/controls/color-picker.css";
import "../../../packages/core/src/features/insertion/recent.css";

const destroyOnTransaction = [false, false];
const destroyOnChange = [false, false];
const beforeClicks: (HTMLElement | undefined)[] = [undefined, undefined];
const clickOnTransaction: (HTMLElement | undefined)[] = [undefined, undefined];
const replaceOnTransaction = [false, false];
const replaceSameOnTransaction = [false, false];
const replaceAsyncOnTransaction = [false, false];
const replaceAsyncSameOnTransaction = [false, false];
const beginOtherOnTransaction = [false, false];
type ExtraMode = "direct-different" | "direct-same" | "double" | "atomic-different" | "atomic-same" | "atomic-double";
const extraReplaceOnTransaction: (ExtraMode | undefined)[] = [undefined, undefined];
const events: { docChanged: boolean; appendedChanges: number; appendedCount: number; slashVisible: boolean }[][] = [
  [],
  [],
];
const changes: string[][] = [[], []];
const instances = ["a", "b"].map((name, index) => {
  const host = document.createElement("div");
  host.id = `editor-${name}`;
  document.body.append(host);
  let controller!: ReturnType<typeof createEditor>;
  controller = createEditor({
    element: host,
    outline: false,
    content: "<p></p>",
    onChange: (snapshot) => {
      changes[index].push(snapshot.html);
      if (destroyOnChange[index]) {
        destroyOnChange[index] = false;
        controller.destroy();
      }
    },
  });
  controller.editor.on("beforeTransaction", () => {
    const stale = beforeClicks[index];
    beforeClicks[index] = undefined;
    stale?.click();
  });
  controller.editor.on("transaction", ({ transaction, appendedTransactions = [] }) => {
    events[index].push({
      docChanged: transaction.docChanged,
      appendedChanges: appendedTransactions.filter((tr) => tr.docChanged).length,
      appendedCount: appendedTransactions.length,
      slashVisible: Array.from(document.querySelectorAll<HTMLElement>(".semlo-editor-slash-menu")).some(
        (menu) => !menu.hidden,
      ),
    });
    const stale = clickOnTransaction[index];
    clickOnTransaction[index] = undefined;
    stale?.click();
    if (beginOtherOnTransaction[index]) {
      beginOtherOnTransaction[index] = false;
      const other = instances[1 - index];
      other.setContent("<p>/h1</p>");
      other.editor.commands.focus();
      other.editor.commands.setTextSelection(4);
    }
    if (replaceAsyncOnTransaction[index] || replaceAsyncSameOnTransaction[index]) {
      const same = replaceAsyncSameOnTransaction[index];
      replaceAsyncOnTransaction[index] = false;
      replaceAsyncSameOnTransaction[index] = false;
      queueMicrotask(() => {
        if (controller.editor.isDestroyed) return;
        controller.setContent(same ? "<p>临时</p>" : "<p>/h1</p>");
        if (same) controller.setContent("<p>/p</p>");
        controller.editor.commands.setTextSelection(same ? 3 : 4);
      });
    }
    const extra = extraReplaceOnTransaction[index];
    extraReplaceOnTransaction[index] = undefined;
    if (extra) {
      const atomic = extra.startsWith("atomic-");
      if (atomic) {
        const editor = controller.editor;
        const replace = (text: string) => {
          const doc = editor.state.schema.nodeFromJSON({
            type: "doc",
            content: [
              { type: "paragraph", content: [{ type: "text", text }] },
              { type: "paragraph", content: [{ type: "text", text: "乙" }] },
            ],
          });
          const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, doc.content);
          editor.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, text.length + 1)));
        };
        if (extra === "atomic-double") replace("/h1");
        replace(extra === "atomic-different" ? "/h1" : "/p");
      } else {
        if (extra === "double") {
          controller.setContent("<p>/h1</p><p>甲</p>");
          controller.editor.commands.setTextSelection(4);
        }
        const same = extra !== "direct-different";
        controller.setContent(same ? "<p>/p</p><p>乙</p>" : "<p>/h1</p><p>乙</p>");
        controller.editor.commands.setTextSelection(same ? 3 : 4);
      }
    }
    if (replaceOnTransaction[index] || replaceSameOnTransaction[index]) {
      const same = replaceSameOnTransaction[index];
      replaceOnTransaction[index] = false;
      replaceSameOnTransaction[index] = false;
      controller.setContent("<p>临时</p>");
      controller.setContent(same ? "<p>/p</p>" : "<p>/h1</p>");
      controller.editor.commands.setTextSelection(same ? 3 : 4);
    }
    if (!destroyOnTransaction[index]) return;
    destroyOnTransaction[index] = false;
    controller.destroy();
  });
  controller.editor.registerPlugin(
    new Plugin({
      filterTransaction(tr) {
        return !tr.getMeta("toolbar-isolation-reject");
      },
      appendTransaction(transactions, _oldState, state) {
        const trigger = transactions.find((tr) => tr.getMeta("toolbar-isolation-split"));
        if (!trigger) return null;
        const original = trigger.getMeta("toolbar-isolation-split");
        const temporary = original.append(
          Fragment.from(state.schema.node("paragraph", null, state.schema.text("临时"))),
        );
        const tr = state.tr.replaceWith(0, state.doc.content.size, temporary);
        return tr.setSelection(TextSelection.create(tr.doc, 3)).setMeta("toolbar-isolation-restore", original);
      },
    }),
    (plugin, plugins) => [plugin, ...plugins],
  );
  controller.editor.registerPlugin(
    new Plugin({
      appendTransaction(transactions, _oldState, state) {
        const restoring = transactions.find((tr) => tr.getMeta("toolbar-isolation-restore"));
        if (restoring) {
          const tr = state.tr.replaceWith(0, state.doc.content.size, restoring.getMeta("toolbar-isolation-restore"));
          return tr.setSelection(TextSelection.create(tr.doc, 3));
        }
        if (transactions.some((tr) => tr.getMeta("toolbar-isolation-rebuild"))) {
          const rebuilt = state.schema.nodeFromJSON(state.doc.toJSON());
          return state.tr.replaceWith(0, state.doc.content.size, rebuilt.content);
        }
        if (transactions.some((tr) => tr.getMeta("toolbar-isolation-equal"))) {
          const original = state.doc.content;
          const tr = state.tr.replaceWith(
            0,
            state.doc.content.size,
            state.schema.node("paragraph", null, state.schema.text("临时")),
          );
          return tr.replaceWith(0, tr.doc.content.size, original);
        }
        if (transactions.some((tr) => tr.getMeta("toolbar-isolation-local"))) return state.tr.insertText("字", 2);
        if (!transactions.some((tr) => tr.getMeta("toolbar-isolation-replace"))) return null;
        return state.tr.replaceWith(
          0,
          state.doc.content.size,
          state.schema.node("paragraph", null, state.schema.text("新文档")),
        );
      },
    }),
  );
  return controller;
});
Object.assign(window, {
  toolbarIsolation: {
    openEmoji: (index: number) => openEmojiPicker(instances[index].editor),
    openBlockBelow: (index: number) => {
      const editor = instances[index].editor;
      const noop = () => {};
      return openCardMenu(editor, noop, noop, noop, noop, noop, editor.view.dom, { blockBelow: true });
    },
    setEditable: (index: number, value: boolean) => instances[index].setEditable(value),
    setContent: (index: number, value: string) => instances[index].setContent(value),
    selectText: (index: number, from: number, to: number) =>
      instances[index].editor.commands.setTextSelection({ from, to }),
    appendReplace: (index: number) => {
      const editor = instances[index].editor;
      editor.view.dispatch(editor.state.tr.setMeta("toolbar-isolation-replace", true));
    },
    rejectReplace: (index: number) => {
      const editor = instances[index].editor;
      const tr = editor.state.tr.replaceWith(
        0,
        editor.state.doc.content.size,
        editor.state.schema.node("paragraph", null, editor.state.schema.text("拒绝")),
      );
      editor.view.dispatch(tr.setMeta("toolbar-isolation-reject", true));
    },
    appendEqual: (index: number) => {
      const editor = instances[index].editor;
      editor.view.dispatch(editor.state.tr.setMeta("toolbar-isolation-equal", true));
    },
    appendRebuild: (index: number) => {
      const editor = instances[index].editor;
      editor.view.dispatch(editor.state.tr.setMeta("toolbar-isolation-rebuild", true));
    },
    rootReplaceThenRestore: (index: number) => {
      const editor = instances[index].editor;
      const original = editor.state.doc.content;
      const tr = editor.state.tr.replaceWith(
        0,
        editor.state.doc.content.size,
        editor.state.schema.node("paragraph", null, editor.state.schema.text("临时")),
      );
      editor.view.dispatch(tr.setMeta("toolbar-isolation-restore", original));
    },
    rootReplaceActiveThenRestore: (index: number) => {
      const editor = instances[index].editor;
      const original = editor.state.doc.content;
      const appended = original.append(
        Fragment.from(editor.state.schema.node("paragraph", null, editor.state.schema.text("临时"))),
      );
      const tr = editor.state.tr.replaceWith(0, editor.state.doc.content.size, appended);
      editor.view.dispatch(
        tr.setSelection(TextSelection.create(tr.doc, 3)).setMeta("toolbar-isolation-restore", original),
      );
    },
    appendSplitRestore: (index: number) => {
      const editor = instances[index].editor;
      editor.view.dispatch(editor.state.tr.setMeta("toolbar-isolation-split", editor.state.doc.content));
    },
    appendLocal: (index: number) => {
      const editor = instances[index].editor;
      editor.view.dispatch(editor.state.tr.setMeta("toolbar-isolation-local", true));
    },
    destroyNextChange: (index: number) => {
      destroyOnChange[index] = true;
    },
    destroy: (index: number) => instances[index].destroy(),
    destroyNextTransaction: (index: number) => {
      destroyOnTransaction[index] = true;
    },
    clickStaleOnTransaction: (index: number) => {
      clickOnTransaction[index] =
        document.querySelector<HTMLElement>('.semlo-editor-slash-menu [data-command="paragraph"]') ?? undefined;
    },
    clickSelectorOnTransaction: (index: number, selector: string) => {
      const target = document.querySelector<HTMLElement>(selector);
      if (!target) throw new Error(`Missing stale-control target: ${selector}`);
      clickOnTransaction[index] = target;
    },
    clickStaleColorOnTransaction: (index: number) => {
      clickOnTransaction[index] =
        document.querySelector<HTMLElement>('.semlo-editor-palette button[aria-label="浅蓝 #117cee"]') ?? undefined;
    },
    clickStaleColorBeforeTransaction: (index: number) => {
      beforeClicks[index] =
        document.querySelector<HTMLElement>('.semlo-editor-palette button[aria-label="浅蓝 #117cee"]') ?? undefined;
    },
    clickStaleCardOnTransaction: (index: number) => {
      clickOnTransaction[index] =
        document.querySelector<HTMLElement>(
          '[role="dialog"][aria-label="插入内容"] [role="option"][data-command="callout"]',
        ) ?? undefined;
    },
    replaceNextTransaction: (index: number) => {
      replaceOnTransaction[index] = true;
    },
    replaceSameNextTransaction: (index: number) => {
      replaceSameOnTransaction[index] = true;
    },
    replaceAsyncNextTransaction: (index: number) => {
      replaceAsyncOnTransaction[index] = true;
    },
    replaceAsyncSameNextTransaction: (index: number) => {
      replaceAsyncSameOnTransaction[index] = true;
    },
    beginOtherNextTransaction: (index: number) => {
      beginOtherOnTransaction[index] = true;
    },
    replaceExtraNextTransaction: (index: number, mode: ExtraMode) => {
      extraReplaceOnTransaction[index] = mode;
    },
    changes: (index: number) => changes[index],
    clearEvents: (index: number) => {
      changes[index] = [];
      events[index] = [];
    },
    events: (index: number) => events[index],
    snapshot: (index: number) => instances[index].editor.getJSON(),
  },
});
