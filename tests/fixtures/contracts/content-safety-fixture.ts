import { Extension, type Editor } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";

import { createEditor, type EditorContent } from "../../../packages/core/src/index";

type InitializationResult = {
  error: string | null;
  snapshot: ReturnType<ReturnType<typeof createEditor>["getSnapshot"]> | null;
  changes: number;
  onErrors: string[];
  destroyEvents: number;
  pluginCreated: number;
  pluginDestroyed: number;
  editorDestroyed: boolean;
  shellPresent: boolean;
  sentinelPresent: boolean;
  inputUnchanged: boolean;
  otherText: string;
};

declare global {
  interface Window {
    contentSafetyFixture?: {
      initialize(content: EditorContent, customAttribute?: boolean): InitializationResult;
      replace(
        content: EditorContent,
        customAttribute?: boolean,
      ): {
        before: ReturnType<ReturnType<typeof createEditor>["getSnapshot"]>;
        after: ReturnType<ReturnType<typeof createEditor>["getSnapshot"]>;
        errors: string[];
      };
      roundtrip(): { jsonEqual: boolean; htmlText: string };
    };
  }
}

const customAttributeExtension = Extension.create({
  name: "contentSafetyHostAttribute",
  addGlobalAttributes() {
    return [
      { types: ["paragraph"], attributes: { hostField: { default: null } } },
      { types: ["textStyle"], attributes: { hostMark: { default: null } } },
    ];
  },
});

window.contentSafetyFixture = {
  initialize(content, customAttribute = false) {
    const otherHost = document.createElement("div");
    const host = document.createElement("div");
    const sentinel = document.createElement("span");
    host.append(sentinel);
    document.body.append(otherHost, host);
    const other = createEditor({ element: otherHost, content: "<p>独立实例</p>", toolbar: false, outline: false });
    let observed: Editor | undefined;
    let destroyEvents = 0;
    let pluginCreated = 0;
    let pluginDestroyed = 0;
    let changes = 0;
    const onErrors: string[] = [];
    const observer = Extension.create({
      name: "contentSafetyObserver",
      addProseMirrorPlugins() {
        const tiptap = this.editor;
        return [
          new Plugin({
            view() {
              observed = tiptap;
              pluginCreated++;
              return { destroy: () => pluginDestroyed++ };
            },
          }),
        ];
      },
      onDestroy() {
        destroyEvents++;
      },
    });
    const before = JSON.stringify(content);
    let controller: ReturnType<typeof createEditor> | undefined;
    let error: string | null = null;
    try {
      controller = createEditor({
        element: host,
        content,
        toolbar: false,
        outline: false,
        extensions: customAttribute ? [observer, customAttributeExtension] : [observer],
        onChange: () => changes++,
        onError: (cause) => onErrors.push(cause.message),
      });
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    other.setContent("<p>独立实例仍可编辑</p>");
    const result = {
      error,
      snapshot: controller?.getSnapshot() ?? null,
      changes,
      onErrors,
      destroyEvents,
      pluginCreated,
      pluginDestroyed,
      editorDestroyed: observed?.isDestroyed ?? false,
      shellPresent: !!host.querySelector(".semlo-editor"),
      sentinelPresent: host.contains(sentinel),
      inputUnchanged: JSON.stringify(content) === before,
      otherText: other.getSnapshot().text,
    };
    controller?.destroy();
    other.destroy();
    host.remove();
    otherHost.remove();
    return result;
  },
  replace(content, customAttribute = false) {
    const host = document.createElement("div");
    document.body.append(host);
    const errors: string[] = [];
    const controller = createEditor({
      element: host,
      content: "<p>原始内容</p>",
      toolbar: false,
      outline: false,
      extensions: customAttribute ? [customAttributeExtension] : [],
      onError: (cause) => errors.push(cause.message),
    });
    const before = controller.getSnapshot();
    controller.setContent(content);
    const after = controller.getSnapshot();
    controller.destroy();
    host.remove();
    return { before, after, errors };
  },
  roundtrip() {
    const sourceHost = document.createElement("div");
    const jsonHost = document.createElement("div");
    const htmlHost = document.createElement("div");
    document.body.append(sourceHost, jsonHost, htmlHost);
    const source = createEditor({
      element: sourceHost,
      content: '<h2>标题</h2><p><strong>正文</strong>和<span style="color: red">颜色</span></p>',
      toolbar: false,
      outline: false,
    });
    const snapshot = source.getSnapshot();
    const json = createEditor({ element: jsonHost, content: snapshot.json, toolbar: false, outline: false });
    const html = createEditor({ element: htmlHost, content: snapshot.html, toolbar: false, outline: false });
    const result = {
      jsonEqual: JSON.stringify(json.getSnapshot().json) === JSON.stringify(snapshot.json),
      htmlText: html.getSnapshot().text,
    };
    source.destroy();
    json.destroy();
    html.destroy();
    sourceHost.remove();
    jsonHost.remove();
    htmlHost.remove();
    return result;
  },
};
