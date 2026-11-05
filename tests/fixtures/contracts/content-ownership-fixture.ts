import { Extension } from "@tiptap/core";
import { reactive } from "vue";

import { createEditor } from "../../../packages/core/src/index";

type SourceKind = "plain" | "reactive" | "cross-realm-reactive";
type EntryKind = "initial" | "setContent";
type Shape = { id: string; shape: string; x: number; y: number; width: number; height: number; text: string };
type InputDocument = {
  type: "doc";
  attrs: { hostRoot: { nested: { value: string }[] } };
  content: [
    { type: "semloEditorCanvas"; attrs: { kind: "board"; data: { shapes: Shape[]; edges: [] } } },
    {
      type: "paragraph";
      attrs: { hostField: { nested: { value: string }[] } };
      content: [{ type: "text"; text: string; marks: [{ type: "textStyle"; attrs: { hostMark: { value: string } } }] }];
    },
  ];
};

declare global {
  interface Window {
    mountContentOwnershipFixture?: (sourceKind: SourceKind, entryKind: EntryKind) => void;
    contentOwnershipFixture?: {
      source: InputDocument;
      first: ReturnType<typeof createEditor>;
      second: ReturnType<typeof createEditor>;
      changes: number[];
      errors: string[];
    };
  }
}

const hostAttributes = Extension.create({
  name: "contentOwnershipHostAttributes",
  addGlobalAttributes() {
    return [
      { types: ["doc"], attributes: { hostRoot: { default: null, rendered: false } } },
      { types: ["paragraph"], attributes: { hostField: { default: null, rendered: false } } },
      { types: ["textStyle"], attributes: { hostMark: { default: null, rendered: false } } },
    ];
  },
});

window.mountContentOwnershipFixture = (sourceKind, entryKind) => {
  let source: InputDocument = {
    type: "doc",
    attrs: { hostRoot: { nested: [{ value: "初始根属性" }] } },
    content: [
      { type: "semloEditorCanvas", attrs: { kind: "board", data: { shapes: [], edges: [] } } },
      {
        type: "paragraph",
        attrs: { hostField: { nested: [{ value: "初始字段" }] } },
        content: [
          { type: "text", text: "原文", marks: [{ type: "textStyle", attrs: { hostMark: { value: "初始标记" } } }] },
        ],
      },
    ],
  };
  if (sourceKind === "cross-realm-reactive") {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    const foreignJSON = Reflect.get(frame.contentWindow!, "JSON") as JSON;
    source = foreignJSON.parse(JSON.stringify(source)) as InputDocument;
  }
  if (sourceKind !== "plain") source = reactive(source) as InputDocument;

  const changes = [0, 0];
  const errors: string[] = [];
  const hosts = [document.createElement("div"), document.createElement("div")];
  hosts.forEach((host) => document.body.append(host));
  const editors = hosts.map((element, index) =>
    createEditor({
      element,
      content: entryKind === "initial" ? source : undefined,
      toolbar: false,
      outline: false,
      extensions: [hostAttributes],
      onChange: () => changes[index]++,
      onError: (error) => errors.push(error.message),
    }),
  );
  if (entryKind === "setContent") editors.forEach((editor) => editor.setContent(source));
  window.contentOwnershipFixture = { source, first: editors[0], second: editors[1], changes, errors };
};

export type { EntryKind, SourceKind };
