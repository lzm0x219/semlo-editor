import { Extension } from "@tiptap/core";

import { createEditor } from "../../../packages/core/src/index";
import type { EditorController } from "../../../packages/core/src/types";

type Subscription = { name: string; callback: unknown; removed: boolean };
type Fixture = {
  controller: EditorController;
  pending: Array<{ resolve: (url: string) => void; reject: (error: Error) => void }>;
  errors: string[];
  events: string[];
  hostFailure: Error;
  subscriptions: Subscription[];
};
declare global {
  interface Window {
    mountUploadLifetimeHost?: (kind: "normal" | "throw" | "recursive") => void;
    uploadLifetimeHost?: Fixture;
  }
}

window.mountUploadLifetimeHost = (kind) => {
  const host = document.createElement("div");
  host.id = "upload-lifetime-host";
  document.body.replaceChildren(host);
  const pending: Fixture["pending"] = [],
    errors: string[] = [],
    events: string[] = [],
    subscriptions: Subscription[] = [];
  const upload = () =>
    new Promise<string>((resolve, reject) => {
      pending.push({ resolve, reject });
    });
  const hostFailure = new Error("host-destroy-failure");
  let controller: EditorController;
  const hostExtension = Extension.create({
    name: "uploadLifetimeEarlyHost",
    priority: 2000,
    onDestroy() {
      events.push("host-destroy");
      if (kind === "throw") throw hostFailure;
      if (kind === "recursive") controller.editor.destroy();
    },
  });
  controller = createEditor({
    element: host,
    outline: false,
    content: "<p>原文</p>",
    extensions: [hostExtension],
    uploadImage: upload,
    uploadAttachment: upload,
    onError: (error) => errors.push(error.message),
  });
  const editor = controller.editor;
  const methods = editor as unknown as {
    on: (name: string, callback: (...args: never[]) => unknown) => unknown;
    off: (name: string, callback: (...args: never[]) => unknown) => unknown;
  };
  const on = methods.on.bind(editor),
    off = methods.off.bind(editor);
  methods.on = (name, callback) => {
    if (name === "mount" || name === "destroy") subscriptions.push({ name, callback, removed: false });
    return on(name, callback);
  };
  methods.off = (name, callback) => {
    for (const item of subscriptions) if (item.name === name && item.callback === callback) item.removed = true;
    return off(name, callback);
  };
  window.uploadLifetimeHost = { controller, pending, errors, events, subscriptions, hostFailure };
};
