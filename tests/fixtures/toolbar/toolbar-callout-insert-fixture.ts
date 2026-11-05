import type { Editor } from "@tiptap/core";
import { Schema } from "@tiptap/pm/model";
import { EditorState } from "@tiptap/pm/state";

import { createEditor } from "../../../packages/core/src/editor/create-editor";
import { insertCalloutSiblingFromSlash } from "../../../packages/core/src/features/blocks/toolbar-callout-insert";
import {
  readCalloutTonePreference,
  rememberCalloutTone,
} from "../../../packages/core/src/features/blocks/toolbar-callout-preference";

const paragraph = (text: string) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
let mounted: ReturnType<typeof createEditor> | undefined;
const storageDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");

Object.assign(window, {
  calloutFixture: {
    readTone: () => readCalloutTonePreference(document),
    rememberTone: (value: string) => rememberCalloutTone(document, value),
    blockStorage() {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        get: () => {
          throw new Error("unavailable");
        },
      });
    },
    restoreStorage() {
      if (storageDescriptor) Object.defineProperty(window, "localStorage", storageDescriptor);
      else if (!Reflect.deleteProperty(window, "localStorage")) throw new TypeError("Unable to restore localStorage");
    },
    appendPlain() {
      if (!mounted) return;
      const editor = mounted.editor;
      editor.commands.insertContentAt(editor.state.doc.content.size, paragraph(""));
    },
    unavailableStorage() {
      const win = Object.defineProperty({}, "localStorage", {
        get: () => {
          throw new Error("unavailable");
        },
      }) as Window;
      const doc = { defaultView: win } as Document;
      rememberCalloutTone(doc, "cyan");
      rememberCalloutTone(doc, "invalid");
      return readCalloutTonePreference(doc);
    },
    mountQuote() {
      mounted?.destroy();
      document.querySelector("#callout-fixture")?.remove();
      const host = document.createElement("div");
      host.id = "callout-fixture";
      document.body.append(host);
      mounted = createEditor({
        element: host,
        outline: false,
        content: {
          type: "doc",
          content: [
            {
              type: "blockquote",
              content: [
                paragraph("引用"),
                { type: "callout", attrs: { tone: "purple" }, content: [paragraph("前文"), paragraph("")] },
              ],
            },
          ],
        },
      });
    },
    mountPlain() {
      mounted?.destroy();
      document.querySelector("#callout-fixture")?.remove();
      const host = document.createElement("div");
      host.id = "callout-fixture";
      document.body.append(host);
      mounted = createEditor({ element: host, outline: false, content: { type: "doc", content: [paragraph("")] } });
      mounted.editor.commands.focus();
    },
    mount(insideDetails: boolean, middle: boolean) {
      mounted?.destroy();
      document.querySelector("#callout-fixture")?.remove();
      const host = document.createElement("div");
      host.id = "callout-fixture";
      document.body.append(host);
      const card = {
        type: "callout",
        attrs: { tone: "purple" },
        content: [paragraph("前文"), paragraph(""), ...(middle ? [paragraph("后文")] : [])],
      };
      const content = insideDetails
        ? [
            {
              type: "details",
              attrs: { open: true },
              content: [{ type: "detailsSummary" }, { type: "detailsContent", content: [card] }],
            },
          ]
        : [card];
      mounted = createEditor({ element: host, outline: false, content: { type: "doc", content } });
      let from = -1;
      mounted.editor.state.doc.descendants((node, pos, parent) => {
        if (node.type.name === "paragraph" && !node.content.size && parent?.type.name === "callout") from = pos + 1;
      });
      mounted.editor.commands.focus();
      mounted.editor.commands.setTextSelection(from);
    },
    snapshot() {
      return mounted?.editor.getJSON();
    },
    undo() {
      return mounted?.editor.commands.undo();
    },
    blocked() {
      const schema = new Schema({
        nodes: {
          doc: { content: "single" },
          single: { content: "callout" },
          callout: { content: "paragraph+" },
          paragraph: { content: "text*" },
          text: {},
        },
      });
      const doc = schema.node("doc", null, [
        schema.node("single", null, [
          schema.node("callout", null, [
            schema.node("paragraph", null, [schema.text("前文")]),
            schema.node("paragraph", null, [schema.text("/高亮")]),
          ]),
        ]),
      ]);
      let from = -1;
      doc.descendants((node, pos) => {
        if (node.type.name === "paragraph") from = pos + 1;
      });
      const state = EditorState.create({ doc });
      const editor = { state, isEditable: true } as Editor;
      const result = insertCalloutSiblingFromSlash(editor, { from, to: from + 3 });
      return { result, unchanged: editor.state.doc.eq(doc) };
    },
    run(insideDetails: boolean, middle: boolean) {
      const host = document.createElement("div");
      document.body.append(host);
      const card = {
        type: "callout",
        attrs: { tone: "purple" },
        content: [paragraph("前文"), paragraph("/高亮"), ...(middle ? [paragraph("后文")] : [])],
      };
      const content = insideDetails
        ? [
            {
              type: "details",
              attrs: { open: true },
              content: [{ type: "detailsSummary" }, { type: "detailsContent", content: [card] }],
            },
          ]
        : [card];
      const controller = createEditor({ element: host, outline: false, content: { type: "doc", content } });
      const editor = controller.editor;
      let from = -1;
      editor.state.doc.descendants((node, pos) => {
        if (node.type.name === "paragraph" && node.textContent === "/高亮") from = pos + 1;
      });
      editor.commands.setTextSelection({ from, to: from + 3 });
      const before = editor.getJSON();
      const result = insertCalloutSiblingFromSlash(editor, { from, to: from + 3 }, { tone: "gray" });
      const after = editor.getJSON();
      const selectionParent = editor.state.selection.$from.parent.type.name;
      const focusInside = editor.state.selection.$from.node(editor.state.selection.$from.depth - 1).type.name;
      const undone = editor.commands.undo();
      const restored = editor.getJSON();
      controller.destroy();
      host.remove();
      return { before, result, after, selectionParent, focusInside, undone, restored };
    },
  },
});
