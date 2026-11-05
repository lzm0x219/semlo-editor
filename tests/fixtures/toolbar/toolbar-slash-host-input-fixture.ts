import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

import { createEditor } from "../../../packages/core/src/editor/create-editor";

import "../../../packages/core/src/styles/style.css";

const mode = new URL(location.href).searchParams.get("mode");
const seen: string[] = [];
const extension = Extension.create({
  name: "slashHostInputProbe",
  priority: 10,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleTextInput(view, from, to, text) {
            seen.push(text);
            if (mode === "transform" && text === "/") {
              view.dispatch(view.state.tr.insertText("X", from, to));
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});
const host = document.createElement("div");
host.id = "slash-host-input";
document.body.append(host);
const controller = createEditor({ element: host, outline: false, content: "<p></p>", extensions: [extension] });
Object.assign(window, { slashHostInput: { seen, controller } });
