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
    mountUploadReentrantHost?: (kind: "image" | "attachment" | "image-throw" | "attachment-throw") => void;
    uploadReentrantHost?: Fixture;
  }
}

window.mountUploadReentrantHost = (kind) => {
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
      const file = kind.startsWith("image")
        ? new File(["late-image"], "late.png", { type: "image/png" })
        : new File(["late-attachment"], "late.txt", { type: "text/plain" });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      if (kind.startsWith("image")) {
        controller.editor.view.dom.dispatchEvent(
          new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }),
        );
      } else {
        const input = host.querySelectorAll<HTMLInputElement>('input[type="file"]')[1];
        input.files = transfer.files;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (kind.endsWith("-throw")) throw hostFailure;
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
  window.uploadReentrantHost = { controller, pending, errors, events, subscriptions, hostFailure };
};
