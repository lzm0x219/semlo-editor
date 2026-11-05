import { Node as TiptapNode } from "@tiptap/core";

import { createEditor } from "../../../packages/core/src/index";
import type { EditorController } from "../../../packages/core/src/types";

type HostFixture = {
  first: EditorController;
  second: EditorController;
  events: string[];
  failCreate: (value: boolean) => void;
  failDestroy: (value: boolean) => void;
};

declare global {
  interface Window {
    mountFoldRemountHost?: () => void;
    foldRemountHost?: HostFixture;
  }
}

window.mountFoldRemountHost = () => {
  const events: string[] = [];
  let failCreate = false;
  let failDestroy = false;
  const custom = TiptapNode.create({
    name: "hostRemountProbe",
    group: "block",
    atom: true,
    parseHTML() {
      return [{ tag: "div[data-remount-probe]" }];
    },
    renderHTML() {
      return ["div", { "data-remount-probe": "true" }, "Host node"];
    },
    addNodeView() {
      return () => {
        events.push("create");
        if (failCreate) throw new Error("host-nodeview-create");
        const dom = document.createElement("div");
        dom.dataset.remountProbe = "true";
        dom.textContent = "Host node";
        return {
          dom,
          destroy() {
            events.push("destroy");
            if (failDestroy) throw new Error("host-nodeview-destroy");
          },
        };
      };
    },
  });
  const firstHost = document.createElement("div");
  const secondHost = document.createElement("div");
  firstHost.id = "first-fold-host";
  secondHost.id = "second-fold-host";
  document.body.replaceChildren(firstHost, secondHost);
  const first = createEditor({
    element: firstHost,
    outline: false,
    content: '<h3>标题</h3><div data-remount-probe="true"></div><p>后文</p>',
    extensions: [custom],
  });
  const second = createEditor({ element: secondHost, outline: false, content: "<p>第二实例</p>" });
  window.foldRemountHost = {
    first,
    second,
    events,
    failCreate: (value) => {
      failCreate = value;
    },
    failDestroy: (value) => {
      failDestroy = value;
    },
  };
};
