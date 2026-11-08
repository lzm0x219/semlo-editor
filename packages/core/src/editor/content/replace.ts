import type { Editor } from "@tiptap/core";

import { documentWithoutSlashDraft } from "../../features/insertion/slash-draft";
import { clearAttachments } from "../../features/media/attachment/uploads";
import { clearGalleryUploads } from "../../features/media/gallery/uploads";
import { clearUploads } from "../../features/media/image/uploads";
import {
  assertTransactionMayStart,
  ReentrantTransactionError,
  TransactionAbortedError,
} from "../../runtime/transaction-guard";
import type { ContentReplacementResult, EditorContent } from "../../types";
import { serializeEditorHTML } from "./html-output";
import { createContentParser } from "./parse";

export function createContentReplacement(options: {
  editor: Editor;
  doc: Document;
  unavailable: () => boolean;
  closePopovers: () => void;
  report: (error: unknown) => void;
}) {
  const { editor, doc, unavailable, closePopovers, report } = options;
  const parseContent = createContentParser(editor, doc);

  const failure = (
    status: "parse-failed" | "failed",
    cause: unknown,
  ): { status: "parse-failed" | "failed"; error: Error } => {
    const error = cause instanceof Error ? cause : new Error(String(cause));
    report(error);
    return { status, error };
  };
  const interrupted = (error: unknown): ContentReplacementResult | undefined => {
    if (error instanceof ReentrantTransactionError) return { status: "interrupted", reason: "reentrant", error };
    if (error instanceof TransactionAbortedError)
      return {
        status: "interrupted",
        reason: unavailable() ? "destroyed" : editor.isDestroyed ? "unmounted" : "aborted",
        error,
      };
  };

  function trySetContent(content: EditorContent): ContentReplacementResult {
    if (unavailable()) return { status: "unavailable" };
    const beforeParsing = editor.state.doc;
    let parsed: ReturnType<typeof parseContent>["parsed"];
    try {
      ({ parsed } = parseContent(content));
    } catch (error) {
      const guarded = interrupted(error);
      if (guarded) return guarded;
      const reason = unavailable() ? "destroyed" : editor.state.doc !== beforeParsing ? "superseded" : undefined;
      const reported = failure("parse-failed", error);
      return reason ? { status: "interrupted", reason, error: reported.error } : reported;
    }
    try {
      if (unavailable()) return { status: "interrupted", reason: "destroyed" };
      if (editor.state.doc !== beforeParsing) return { status: "interrupted", reason: "superseded" };
      // 同一内容回写不替换文档；活动查询按保存投影比较，保留仍在编辑的查询。
      const state = editor.state;
      const current = state.doc;
      const projected = documentWithoutSlashDraft(state);
      if (parsed.eq(current) || parsed.eq(projected)) return { status: "unchanged" };
      // 普通文档只为有效挂载视图新增快路径；先前已卸载时仍允许原有的内容替换。
      if (typeof content === "string" && (projected !== current || !editor.isDestroyed)) {
        const view = editor.view;
        const serializationInterruption = (): "destroyed" | "unmounted" | "superseded" | undefined => {
          if (unavailable()) return "destroyed";
          if (editor.isDestroyed || view.isDestroyed || editor.view !== view) return "unmounted";
          if (editor.state !== state || editor.state.doc !== current) return "superseded";
        };
        let html: string;
        try {
          // 仅识别当前保存投影的精确自身输出，不改写合法 JSON 属性或泛化 HTML 等价。
          html = serializeEditorHTML(editor, doc, projected);
        } catch (error) {
          const reason = serializationInterruption();
          const guarded = interrupted(error);
          if (guarded) return guarded;
          const reported = failure("failed", error);
          return reason ? { status: "interrupted", reason, error: reported.error } : reported;
        }
        // renderHTML 属于宿主代码；匹配与否都不能让旧调用越过新的状态或视图。
        const reason = serializationInterruption();
        if (reason) return { status: "interrupted", reason };
        if (content === html) return { status: "unchanged" };
      }
      assertTransactionMayStart(editor);
      // Node views may retain asynchronous work even when their own content is
      // unchanged. Invalidate it before replacing the surrounding document.
      const beforeReplace = editor.state.doc;
      const interruption = (): ContentReplacementResult | undefined => {
        if (unavailable()) return { status: "interrupted", reason: "destroyed" };
        if (editor.state.doc !== beforeReplace) return { status: "interrupted", reason: "superseded" };
      };
      if (!editor.isDestroyed)
        editor.view.dom.dispatchEvent(
          new (doc.defaultView?.CustomEvent ?? CustomEvent)("semlo-editor:document-replace"),
        );
      let stopped = interruption();
      if (stopped) return stopped;
      closePopovers();
      stopped = interruption();
      if (stopped) return stopped;
      clearUploads(editor, true);
      stopped = interruption();
      if (stopped) return stopped;
      clearGalleryUploads(editor);
      stopped = interruption();
      if (stopped) return stopped;
      clearAttachments(editor, true);
      stopped = interruption();
      if (stopped) return stopped;
      editor.commands.command(({ tr }) => {
        if (!parsed.content.eq(tr.doc.content)) tr.replaceWith(0, tr.doc.content.size, parsed.content);
        // 根节点属性也可能由宿主扩展声明；逐项比较可避免无变化属性产生多余步骤。
        for (const [name, value] of Object.entries(parsed.attrs)) {
          const candidate = { ...tr.doc.attrs, [name]: value };
          if (!tr.doc.hasMarkup(tr.doc.type, candidate, tr.doc.marks)) tr.setDocAttribute(name, value);
        }
        tr.setMeta("preventUpdate", true);
        return true;
      });
      if (unavailable()) return { status: "interrupted", reason: "destroyed" };
      return parsed.eq(editor.state.doc) ? { status: "applied" } : { status: "interrupted", reason: "not-applied" };
    } catch (error) {
      return interrupted(error) ?? failure("failed", error);
    }
  }

  return {
    trySetContent,
    setContent(content: EditorContent): void {
      const result = trySetContent(content);
      if (
        result.status === "interrupted" &&
        (result.error instanceof ReentrantTransactionError || result.error instanceof TransactionAbortedError)
      )
        throw result.error;
    },
  };
}
