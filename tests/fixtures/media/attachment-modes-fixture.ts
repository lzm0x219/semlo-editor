import {
  createEditor,
  isEditorControllerWithResults,
  type ContentReplacementResult,
  type EditorContent,
} from "@semlo-editor/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

import "./attachment-preview-fixture";

declare global {
  interface Window {
    attachmentModeSetup(attrs?: Record<string, unknown>): Promise<void>;
    attachmentModeTryContent(content: EditorContent): ContentReplacementResult;
    attachmentModeBefore(action: "readonly" | "provider" | "reject"): void;
    attachmentModeInitialFailure(content: EditorContent): { message: string; cleaned: boolean };
    attachmentModeOldFrame?: HTMLIFrameElement;
    attachmentModePointer: number;
  }
}

window.attachmentModeSetup = async (attrs = {}) => {
  const json = window.attachmentEditor.getSnapshot().json;
  json.content![0].content![1].attrs = { ...json.content![0].content![1].attrs, ...attrs };
  window.attachmentChanges = 0;
  window.attachmentCalls = [];
  window.attachmentErrors = [];
  await window.attachmentSetContent(json);
};
window.attachmentModeTryContent = (content) => {
  if (!isEditorControllerWithResults(window.attachmentEditor)) throw new Error("缺少公开替换结果接口");
  return window.attachmentEditor.trySetContent(content);
};
window.attachmentModeBefore = (action) => {
  const editor = window.attachmentEditor.editor;
  if (action === "reject") {
    editor.registerPlugin(
      new Plugin({
        key: new PluginKey("attachmentModeReject"),
        filterTransaction: (transaction) => !transaction.docChanged,
      }),
    );
    return;
  }
  const before = ({ transaction }: { transaction: import("@tiptap/pm/state").Transaction }) => {
    if (!transaction.docChanged) return;
    editor.off("beforeTransaction", before);
    if (action === "readonly") window.attachmentEditor.setEditable(false);
    else void window.attachmentUpdate("b");
  };
  editor.on("beforeTransaction", before);
};
window.attachmentModeInitialFailure = (content) => {
  const host = document.createElement("div");
  document.body.append(host);
  let message = "";
  try {
    createEditor({ element: host, content, toolbar: false, outline: false });
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  const cleaned = host.querySelector(".semlo-editor") === null;
  host.remove();
  return { message, cleaned };
};
