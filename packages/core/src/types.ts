import type { Editor, Extensions, JSONContent } from "@tiptap/core";

import type { EncryptedTextProvider } from "./features/cards/encrypted-text";
import type { CodeRunner } from "./features/code-block/runner";
import type { CodeBlockPreferencesAdapter } from "./features/code-block/settings";
import type { HeadingFoldPreferencesAdapter } from "./features/heading/fold";
import type { InteractiveCardHost } from "./features/interactive/interactive-card-host";
import type { InteractiveInsertOptions } from "./features/interactive/interactive-card-insert";
import type { EmbedMetadataResolver } from "./features/references/embed-bookmark";
import type { ContentPickerProvider } from "./features/references/yuque-content-picker";
import type { TranslationService } from "./ui/toolbar/translation";

/** Structured ProseMirror JSON is the canonical format; HTML can also be imported. */
export type EditorContent = JSONContent | string;
export interface EditorSnapshot {
  json: JSONContent;
  html: string;
  text: string;
}
export type ContentReplacementResult =
  | { status: "applied" }
  | { status: "unchanged" }
  | { status: "unavailable" }
  | {
      status: "interrupted";
      reason: "reentrant" | "destroyed" | "unmounted" | "aborted" | "superseded" | "not-applied";
      error?: Error;
    }
  | { status: "parse-failed" | "failed"; error: Error };
export type ImageUpload = (file: File, context?: { signal: AbortSignal }) => Promise<string>;
export type AttachmentUpload = (file: File, context?: { signal: AbortSignal }) => Promise<string>;
export interface MentionItem {
  id: string;
  label: string;
  kind: "person" | "document";
  href?: string;
}
export type MentionSearch = (query: string, signal: AbortSignal) => MentionItem[] | Promise<MentionItem[]>;
export interface EditorUser {
  id: string;
  label: string;
}

/** 自定义工具栏的容器与对应编辑器实例。 */
export interface ToolbarContext {
  element: HTMLElement;
  controller: EditorControllerWithResults;
  /** 执行基于浏览器选区的命令前同步文本选区。 */
  syncSelection(): void;
  /** 订阅事务与控制器只读状态变化；返回退订函数。 */
  subscribe(listener: () => void): () => void;
}

/** 在编辑器创建时挂载工具栏，返回的函数负责释放宿主资源。 */
export type ToolbarFactory = (context: ToolbarContext) => void | (() => void);

/** 自定义浮动工具栏可使用编辑器现有的链接弹层。 */
export interface FloatingToolbarContext extends ToolbarContext {
  /** 同步选区并在锚点处打开链接弹层；未提供锚点时使用浮动工具栏容器。 */
  openLink(anchor?: HTMLElement): void;
}

/** 在编辑器创建时挂载浮动工具栏，返回的函数负责释放宿主资源。 */
export type FloatingToolbarFactory = (context: FloatingToolbarContext) => void | (() => void);
export interface EditorIntegrations {
  runCode?: CodeRunner;
  translate?: TranslationService;
  currentUser?: () => EditorUser | null;
  resolveEmbedMetadata?: EmbedMetadataResolver;
  uploadImage?: ImageUpload;
  uploadAttachment?: AttachmentUpload;
  searchMentions?: MentionSearch;
  /** Search and resolve accessible content via the integrating application; no Yuque API is built in. */
  yuqueContentProvider?: ContentPickerProvider | null;
  encryptedTextProvider?: EncryptedTextProvider | null;
  interactiveCardHost?: InteractiveCardHost | null;
  onInteractiveCardAbandoned?: InteractiveInsertOptions["onAbandoned"];
}

export interface EditorOptions extends EditorIntegrations {
  element: HTMLElement;
  content?: EditorContent;
  editable?: boolean;
  placeholder?: string;
  toolbar?: boolean | ToolbarFactory;
  floatingToolbar?: boolean | FloatingToolbarFactory;
  outline?: boolean;
  extensions?: Extensions;
  codeBlockPreferences?: CodeBlockPreferencesAdapter;
  /** Optional host-owned, document-scoped heading fold view state. */
  headingFoldPreferences?: HeadingFoldPreferencesAdapter;
  onChange?: (snapshot: EditorSnapshot) => void;
  onError?: (error: Error) => void;
}
export interface EditorController {
  readonly editor: Editor;
  getSnapshot(): EditorSnapshot;
  /** 未提交事务内的不同文档替换和提交前销毁会分别抛出事务异常。 */
  setContent(content: EditorContent): void;
  setEditable(editable: boolean): void;
  /** 整体替换集成选项；省略的选项会被清除，需保留的选项应一并传入。 */
  setIntegrations(integrations: EditorIntegrations): void;
  focus(): void;
  destroy(): void;
}

export interface EditorControllerWithResults extends EditorController {
  /** 返回内容替换结果；事务冲突和销毁中断以 interrupted 表示。 */
  trySetContent(content: EditorContent): ContentReplacementResult;
}

/** 判断现有控制器是否提供内容替换结果接口。 */
export function isEditorControllerWithResults(controller: EditorController): controller is EditorControllerWithResults {
  return typeof (controller as Partial<EditorControllerWithResults>).trySetContent === "function";
}
