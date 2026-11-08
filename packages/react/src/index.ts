import { createEditor } from "@semlo-editor/core";
import type {
  EditorContent,
  EditorController,
  EditorControllerWithResults,
  EditorIntegrations,
  EditorOptions,
  EditorSnapshot,
} from "@semlo-editor/core";
import { createElement, useEffect, useInsertionEffect, useLayoutEffect, useRef, type HTMLAttributes } from "react";

const useContentEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

type CompleteIntegrations = EditorIntegrations & Record<keyof EditorIntegrations, unknown>;
type AssertNever<T extends never> = T;

export interface SemloEditorProps
  extends
    Omit<
      HTMLAttributes<HTMLDivElement>,
      "onChange" | "onError" | "content" | "translate" | "children" | "dangerouslySetInnerHTML"
    >,
    EditorIntegrations {
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

/** placeholder、工具栏配置、outline 和 extensions 仅在创建时生效，变更时使用 key 重置实例。 */
export function SemloEditor(props: SemloEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<EditorControllerWithResults | null>(null);
  // 仅发布已提交的 props，避免并发渲染暂停时旧实例调用未提交的回调。
  const latest = useRef(props);
  useInsertionEffect(() => {
    latest.current = props;
  });
  const {
    content,
    editable,
    placeholder,
    toolbar,
    floatingToolbar,
    outline,
    extensions,
    codeBlockPreferences,
    headingFoldPreferences,
    uploadImage,
    uploadAttachment,
    resolveAttachmentPreview,
    searchMentions,
    encryptedTextProvider,
    yuqueContentProvider,
    runCode,
    translate,
    writingService,
    writingFeedback,
    databaseAiFill,
    currentUser,
    resolveEmbedMetadata,
    interactiveCardHost,
    onInteractiveCardAbandoned,
    onChange,
    onReady,
    onError,
    children: _children,
    dangerouslySetInnerHTML: _dangerouslySetInnerHTML,
    innerHTML: _innerHTML,
    innerText: _innerText,
    outerHTML: _outerHTML,
    outerText: _outerText,
    textContent: _textContent,
    ...domProps
  } = props as SemloEditorProps & {
    children?: unknown;
    dangerouslySetInnerHTML?: unknown;
    innerHTML?: unknown;
    innerText?: unknown;
    outerHTML?: unknown;
    outerText?: unknown;
    textContent?: unknown;
  };
  type _DomPropsDoNotIncludeIntegrations = AssertNever<Extract<keyof typeof domProps, keyof EditorIntegrations>>;
  useEffect(() => {
    if (!host.current) return;
    const emitChange = (snapshot: EditorSnapshot) => latest.current.onChange?.(snapshot);
    const current = createEditor({
      element: host.current,
      content: latest.current.content,
      editable: latest.current.editable,
      placeholder: latest.current.placeholder,
      toolbar: latest.current.toolbar,
      floatingToolbar: latest.current.floatingToolbar,
      outline: latest.current.outline,
      extensions: latest.current.extensions,
      codeBlockPreferences: latest.current.codeBlockPreferences,
      headingFoldPreferences: latest.current.headingFoldPreferences,
      ...({
        uploadImage: latest.current.uploadImage,
        uploadAttachment: latest.current.uploadAttachment,
        resolveAttachmentPreview: latest.current.resolveAttachmentPreview,
        searchMentions: latest.current.searchMentions,
        encryptedTextProvider: latest.current.encryptedTextProvider,
        yuqueContentProvider: latest.current.yuqueContentProvider,
        runCode: latest.current.runCode,
        translate: latest.current.translate,
        writingService: latest.current.writingService,
        writingFeedback: latest.current.writingFeedback,
        databaseAiFill: latest.current.databaseAiFill,
        currentUser: latest.current.currentUser,
        resolveEmbedMetadata: latest.current.resolveEmbedMetadata,
        interactiveCardHost: latest.current.interactiveCardHost,
        onInteractiveCardAbandoned: latest.current.onInteractiveCardAbandoned,
      } satisfies CompleteIntegrations),
      // 无监听时让核心跳过 JSON、HTML 和文本快照的构造。
      get onChange() {
        return latest.current.onChange ? emitChange : undefined;
      },
      onError: (error) => latest.current.onError?.(error),
    });
    instance.current = current;
    try {
      latest.current.onReady?.(current);
    } catch (error) {
      instance.current = null;
      try {
        current.destroy();
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], "编辑器初始化失败，清理实例时也发生错误", { cause: error });
      }
      throw error;
    }
    return () => {
      instance.current = null;
      current.destroy();
    };
  }, []);
  useContentEffect(() => {
    // 首次布局时实例尚未创建，初始内容由挂载处理；后续同步先于宿主布局回调，避免旧被动回写覆盖撤销。
    if (content !== undefined) instance.current?.setContent(content);
  }, [content]);
  useEffect(() => {
    instance.current?.setEditable(editable !== false);
  }, [editable]);
  useEffect(() => {
    const integrations = {
      uploadImage,
      uploadAttachment,
      resolveAttachmentPreview,
      searchMentions,
      encryptedTextProvider,
      yuqueContentProvider,
      runCode,
      translate,
      writingService,
      writingFeedback,
      databaseAiFill,
      currentUser,
      resolveEmbedMetadata,
      interactiveCardHost,
      onInteractiveCardAbandoned,
    } satisfies CompleteIntegrations;
    instance.current?.setIntegrations(integrations);
  }, [
    uploadImage,
    uploadAttachment,
    resolveAttachmentPreview,
    searchMentions,
    encryptedTextProvider,
    yuqueContentProvider,
    runCode,
    translate,
    writingService,
    writingFeedback,
    databaseAiFill,
    currentUser,
    resolveEmbedMetadata,
    interactiveCardHost,
    onInteractiveCardAbandoned,
  ]);
  return createElement("div", { ...domProps, ref: host });
}
