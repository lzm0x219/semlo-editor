import { Extension } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

import { createEditor } from "../../../packages/core/src/editor/create-editor";
const tracked: { type: string; callback: EventListenerOrEventListenerObject; removed: boolean }[] = [];
const add = document.addEventListener.bind(document);
const remove = document.removeEventListener.bind(document);
document.addEventListener = function (type: any, callback: any, options: any) {
  if (["pointerup", "pointercancel"].includes(type) && options === true)
    tracked.push({ type, callback, removed: false });
  return add(type, callback, options);
} as typeof document.addEventListener;
document.removeEventListener = function (type: any, callback: any, options: any) {
  tracked
    .filter((item) => item.type === type && item.callback === callback && options === true)
    .forEach((item) => (item.removed = true));
  return remove(type, callback, options);
} as typeof document.removeEventListener;
const host = document.createElement("div");
document.body.append(host);
let failure = "";
try {
  createEditor({
    element: host,
    extensions: [
      Extension.create({
        name: "constructFailure",
        priority: 1,
        addProseMirrorPlugins() {
          return [
            new Plugin({
              view() {
                throw new Error("host constructor failure");
              },
            }),
          ];
        },
      }),
    ],
  });
} catch (error) {
  failure = (error as Error).message;
}
Object.assign(window, { constructorProbe: { failure, tracked, shellCount: host.children.length } });
