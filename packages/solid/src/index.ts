import { createEditor } from "@semlo-editor/core";
import type {
  EditorContent,
  EditorController,
  EditorControllerWithResults,
  EditorIntegrations,
  EditorOptions,
  EditorSnapshot,
} from "@semlo-editor/core";
import { createEffect, createComponent, mergeProps, onCleanup, onMount, splitProps, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";

type CompleteIntegrations = EditorIntegrations & Record<keyof EditorIntegrations, unknown>;
type AssertNever<T extends never> = T;

export interface SemloEditorProps
  extends
    Omit<
      JSX.HTMLAttributes<HTMLDivElement>,
      "onChange" | "onError" | "children" | "innerHTML" | "innerText" | "textContent" | "translate"
    >,
    EditorIntegrations {
  [attribute: `data-${string}`]: string | number | boolean | undefined;
  content?: EditorContent;
  editable?: boolean;
  placeholder?: string;
  toolbar?: EditorOptions["toolbar"];
  floatingToolbar?: EditorOptions["floatingToolbar"];
  outline?: boolean;
  extensions?: EditorOptions["extensions"];
  codeBlockPreferences?: EditorOptions["codeBlockPreferences"];
  headingFoldPreferences?: EditorOptions["headingFoldPreferences"];
  onChange?: (snapshot: EditorSnapshot) => void;
  onReady?: (controller: EditorController) => void;
  onError?: (error: Error) => void;
}

export function SemloEditor(props: SemloEditorProps): JSX.Element {
  const [, domProps] = splitProps(
    props as SemloEditorProps & {
      children?: unknown;
      dangerouslySetInnerHTML?: unknown;
      innerHTML?: unknown;
      innerText?: unknown;
      outerHTML?: unknown;
      outerText?: unknown;
      textContent?: unknown;
      "prop:innerHTML"?: unknown;
      "prop:innerText"?: unknown;
      "prop:outerHTML"?: unknown;
      "prop:outerText"?: unknown;
      "prop:textContent"?: unknown;
    },
    [
      "content",
      "editable",
      "placeholder",
      "toolbar",
      "floatingToolbar",
      "outline",
      "extensions",
      "codeBlockPreferences",
      "headingFoldPreferences",
      "uploadImage",
      "uploadAttachment",
      "resolveAttachmentPreview",
      "searchMentions",
      "encryptedTextProvider",
      "yuqueContentProvider",
      "runCode",
      "translate",
      "writingService",
      "writingFeedback",
      "databaseAiFill",
      "currentUser",
      "resolveEmbedMetadata",
      "interactiveCardHost",
      "onInteractiveCardAbandoned",
      "onChange",
      "onReady",
      "onError",
      "ref",
      "children",
      "dangerouslySetInnerHTML",
      "innerHTML",
      "innerText",
      "outerHTML",
      "outerText",
      "textContent",
      "prop:innerHTML",
      "prop:innerText",
      "prop:outerHTML",
      "prop:outerText",
      "prop:textContent",
    ],
  );
  type _DomPropsDoNotIncludeIntegrations = AssertNever<Extract<keyof typeof domProps, keyof EditorIntegrations>>;
  let host: HTMLDivElement | undefined;
  let editor: EditorControllerWithResults | undefined;
  let initialContent = props.content;
  onMount(() => {
    if (!host) return;
    const emitChange = (snapshot: EditorSnapshot) => props.onChange?.(snapshot);
    editor = createEditor({
      element: host,
      content: props.content,
      editable: props.editable,
      placeholder: props.placeholder,
      toolbar: props.toolbar,
      floatingToolbar: props.floatingToolbar,
      outline: props.outline,
      extensions: props.extensions,
      codeBlockPreferences: props.codeBlockPreferences,
      headingFoldPreferences: props.headingFoldPreferences,
      ...({
        uploadImage: props.uploadImage,
        uploadAttachment: props.uploadAttachment,
        resolveAttachmentPreview: props.resolveAttachmentPreview,
        searchMentions: props.searchMentions,
        encryptedTextProvider: props.encryptedTextProvider,
        yuqueContentProvider: props.yuqueContentProvider,
        runCode: props.runCode,
        translate: props.translate,
        writingService: props.writingService,
        writingFeedback: props.writingFeedback,
        databaseAiFill: props.databaseAiFill,
        currentUser: props.currentUser,
        resolveEmbedMetadata: props.resolveEmbedMetadata,
        interactiveCardHost: props.interactiveCardHost,
        onInteractiveCardAbandoned: props.onInteractiveCardAbandoned,
      } satisfies CompleteIntegrations),
      // 动态读取监听器，未订阅时不生成完整快照。
      get onChange() {
        return props.onChange ? emitChange : undefined;
      },
      onError: (error) => props.onError?.(error),
    });
    props.onReady?.(editor);
  });
  createEffect(() => {
    const content = props.content;
    if (content === initialContent) {
      // 挂载时的内容已用于创建编辑器，不再触发一次受控替换。
      initialContent = undefined;
      return;
    }
    initialContent = undefined;
    if (content !== undefined) editor?.setContent(content);
  });
  createEffect(() => {
    const editable = props.editable;
    editor?.setEditable(editable !== false);
  });
  createEffect(() => {
    const integrations = {
      uploadImage: props.uploadImage,
      uploadAttachment: props.uploadAttachment,
      resolveAttachmentPreview: props.resolveAttachmentPreview,
      searchMentions: props.searchMentions,
      encryptedTextProvider: props.encryptedTextProvider,
      yuqueContentProvider: props.yuqueContentProvider,
      runCode: props.runCode,
      translate: props.translate,
      writingService: props.writingService,
      writingFeedback: props.writingFeedback,
      databaseAiFill: props.databaseAiFill,
      currentUser: props.currentUser,
      resolveEmbedMetadata: props.resolveEmbedMetadata,
      interactiveCardHost: props.interactiveCardHost,
      onInteractiveCardAbandoned: props.onInteractiveCardAbandoned,
    } satisfies CompleteIntegrations;
    editor?.setIntegrations(integrations);
  });
  onCleanup(() => {
    editor?.destroy();
    editor = undefined;
  });
  return createComponent(
    Dynamic,
    mergeProps(domProps, {
      component: "div",
      ref: (element: HTMLDivElement) => {
        host = element;
        if (typeof props.ref === "function") props.ref(element);
      },
    }),
  );
}
