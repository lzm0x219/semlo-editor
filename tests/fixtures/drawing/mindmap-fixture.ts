import { Editor, Extension, Node } from "@tiptap/core";
import { history, undo, redo } from "@tiptap/pm/history";
import { Plugin } from "@tiptap/pm/state";

import { CanvasBoard } from "../../../packages/core/src/features/drawing/canvas/extension";
import { createCanvasContent } from "../../../packages/core/src/features/drawing/canvas/model";

import "../../../packages/core/src/features/drawing/canvas/board.css";
import "../../../packages/core/src/features/drawing/mindmap/mindmap.css";
import { Mindmap, createMindmapContent } from "../../../packages/core/src/features/drawing/mindmap/extension";

const Document = Node.create({ name: "doc", topNode: true, content: "block+" });
const Paragraph = Node.create({
  name: "paragraph",
  group: "block",
  content: "inline*",
  parseHTML: () => [{ tag: "p" }],
  renderHTML: () => ["p", 0],
});
const Text = Node.create({ name: "text", group: "inline" });
const History = Extension.create({ name: "history", addProseMirrorPlugins: () => [history()] });
const ReentrantTransaction = Extension.create({
  name: "canvasTestReentrantTransaction",
  onTransaction({ transaction }) {
    const mode = transaction.getMeta("canvas-test-reentrant");
    if (mode === "edit") {
      const { state, view } = this.editor;
      view.dispatch(state.tr.insert(state.doc.content.size, state.schema.nodes.paragraph.create()));
    } else if (mode) this.editor.view.dispatch(this.editor.state.tr);
  },
});
const editor = new Editor({
  element: document.querySelector("#root")!,
  extensions: [Document, Paragraph, Text, History, ReentrantTransaction, Mindmap, CanvasBoard],
  content: { type: "doc", content: [{ type: "semloEditorMindmap" }] },
});
editor.registerPlugin(
  new Plugin({
    appendTransaction(transactions, oldState, state) {
      const replacement = transactions.find(
        (transaction) =>
          transaction.getMeta("canvas-test-replacement") ||
          transaction.getMeta("canvas-test-intermediate") ||
          transaction.getMeta("canvas-test-reuse"),
      );
      if (!replacement) return null;
      const reuse = replacement.getMeta("canvas-test-reuse");
      const intermediate = replacement.getMeta("canvas-test-intermediate");
      const transaction = state.tr;
      if (intermediate || reuse?.intermediate) transaction.insertText("插件临时", state.doc.child(0).nodeSize + 1);
      const content = reuse
        ? oldState.doc.content
        : state.schema.nodeFromJSON(intermediate || replacement.getMeta("canvas-test-replacement")).content;
      return transaction.replaceWith(0, transaction.doc.content.size, content);
    },
  }),
);
Object.assign(window, {
  mindmapTest: {
    editor,
    createCanvasContent,
    createMindmapContent,
    undo: () => undo(editor.state, editor.view.dispatch),
    redo: () => redo(editor.state, editor.view.dispatch),
    appendReplace: (content: unknown) =>
      editor.view.dispatch(editor.state.tr.setMeta("canvas-test-replacement", content)),
    appendReplaceAfterEdit: (content: unknown) => {
      const position = editor.state.doc.child(0).nodeSize + 1;
      editor.view.dispatch(editor.state.tr.insertText("临时", position).setMeta("canvas-test-replacement", content));
    },
    appendReplaceWithIntermediate: (content: unknown) =>
      editor.view.dispatch(editor.state.tr.setMeta("canvas-test-intermediate", content)),
    appendReuse: (intermediate = false) =>
      editor.view.dispatch(editor.state.tr.setMeta("canvas-test-reuse", { intermediate })),
    appendReuseAfterEdit: () => {
      const position = editor.state.doc.child(0).nodeSize + 1;
      editor.view.dispatch(editor.state.tr.insertText("临时", position).setMeta("canvas-test-reuse", {}));
    },
    replaceFirstWithSelf: () => {
      const node = editor.state.doc.child(0);
      editor.view.dispatch(editor.state.tr.replaceWith(0, node.nodeSize, node));
    },
    rebuildFirstNode: (reentrant: boolean | "edit" = false) => {
      const node = editor.state.doc.child(0);
      const transaction = editor.state.tr.replaceWith(0, node.nodeSize, editor.schema.nodeFromJSON(node.toJSON()));
      editor.view.dispatch(reentrant ? transaction.setMeta("canvas-test-reentrant", reentrant) : transaction);
    },
    duplicateFirstNode: () => {
      const node = editor.state.doc.child(0);
      const paragraph = editor.schema.nodes.paragraph.create();
      editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, [node, paragraph, node]));
    },
    rebuildLastNode: () => {
      const first = editor.state.doc.child(0);
      const middle = editor.state.doc.child(1);
      const node = editor.state.doc.child(2);
      const position = first.nodeSize + middle.nodeSize;
      editor.view.dispatch(
        editor.state.tr.replaceWith(position, position + node.nodeSize, editor.schema.nodeFromJSON(node.toJSON())),
      );
    },
    moveFirstAfterParagraph: () => {
      const node = editor.state.doc.child(0);
      const paragraph = editor.schema.nodes.paragraph.create(null, editor.schema.text("前文"));
      editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, [paragraph, node]));
    },
    editLeadingText: () => editor.view.dispatch(editor.state.tr.insertText("增", 1)),
    rebuildNodeAfterTextEdit: () => {
      const transaction = editor.state.tr.insertText("增", 1);
      const position = transaction.doc.child(0).nodeSize;
      const node = transaction.doc.child(1);
      editor.view.dispatch(
        transaction.replaceWith(position, position + node.nodeSize, editor.schema.nodeFromJSON(node.toJSON())),
      );
    },
  },
});
