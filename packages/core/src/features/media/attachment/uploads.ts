import { Extension, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, PluginKey, type EditorState, type Transaction } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

import { acceptsUpload, registerUploadCancellation } from "../../../integrations/upload-cancellation";
import { cancelFailedUpload, clearFailedUploadBatch } from "../../../integrations/upload-failure";
import { runCleanupSteps } from "../../../runtime/cleanup";
import type { AttachmentUpload } from "../../../types";
import { safeAttachmentURL } from "../shared/attachment-url";

type UploadAnchor = { id: object; pos: number; name: string };
type UploadTask = { id: object; file: File; controller: AbortController; invalidated: boolean; finished: boolean };
type UploadMeta = {
  add?: UploadAnchor[];
  restore?: UploadAnchor[];
  remove?: object;
  removeMany?: object[];
  clear?: boolean;
};
export type AttachmentKind = "file" | "video" | "audio";
type UploadState = {
  decorations: DecorationSet;
  batch?: { root: Transaction; baseline: DecorationSet; eligible: boolean };
};
const attachmentKey = new PluginKey<UploadState>("semlo-editor-attachment-upload");
const decorations = (state: EditorState) => attachmentKey.getState(state)?.decorations;
// Experimental only: retain cancelled IDs across failed transaction and remount.
const hiddenUploads = new WeakMap<Editor, WeakSet<object>>();
const activeTasks = new WeakMap<Editor, Set<UploadTask>>();
function abortTasks(tasks: readonly UploadTask[]) {
  const pending = tasks.filter((task) => !task.finished && !task.controller.signal.aborted);
  for (const task of pending) task.invalidated = true;
  for (const task of pending) task.controller.abort();
}
const lastUploadBatch = new WeakMap<Editor, { id: object; doc: Editor["state"]["doc"] }>();
function activeDecorations(editor: Editor, state: EditorState) {
  const set = decorations(state);
  const hidden = hiddenUploads.get(editor);
  return set && hidden ? set.remove(set.find(undefined, undefined, (spec) => hidden.has(spec.id))) : set;
}
function hideUploads(editor: Editor, ids: object[]) {
  let hidden = hiddenUploads.get(editor);
  if (!hidden) hiddenUploads.set(editor, (hidden = new WeakSet()));
  for (const id of ids) hidden.add(id);
  if (!editor.isDestroyed) editor.view.updateState(editor.state);
}

export function uploadAttachments(
  editor: Editor,
  files: File[],
  position: number,
  upload: AttachmentUpload | undefined,
  report: (error: unknown) => void,
  kind: AttachmentKind = "file",
) {
  if (!acceptsUpload(editor) || !editor.isEditable || !files.length) return;
  if (!upload) {
    report(new Error("请先配置附件上传"));
    return;
  }
  // Media and attachment nodes cannot live inside a code block. Anchor them
  // after the code block instead of splitting it when the upload completes.
  const resolved = editor.state.doc.resolve(position);
  for (let depth = resolved.depth; depth > 0; depth--) {
    if (resolved.node(depth).type.spec.code) {
      position = resolved.after(depth);
      break;
    }
  }
  const tasks: UploadTask[] = files.map((file) => ({
    id: {},
    file,
    controller: new AbortController(),
    invalidated: false,
    finished: false,
  }));
  const batchId = {};
  let destroyed = false;
  let resume: ((mounted: boolean) => void) | undefined;
  let unregister = () => {};
  const onDestroy = () => {
    if (destroyed) return;
    destroyed = true;
    runCleanupSteps(
      [
        unregister,
        () => editor.off("destroy", onDestroy),
        () => editor.off("transaction", onTransaction),
        () => editor.off("update", onEditable),
        () => abortTasks(tasks),
        () => resume?.(false),
      ],
      "Attachment upload cancellation failed",
    );
  };
  const onTransaction = () => {
    if (destroyed || editor.isDestroyed) return;
    const current = activeDecorations(editor, editor.state);
    const lost = tasks.filter(
      (task) =>
        !task.finished &&
        !task.invalidated &&
        !current?.find(undefined, undefined, (spec) => spec.id === task.id).length,
    );
    if (!lost.length) return;
    for (const task of lost) task.invalidated = true;
    // 避免在事务回调中同步触发宿主的中止监听器。
    queueMicrotask(() => abortTasks(lost));
  };
  const onEditable = () => {
    if (destroyed || editor.isEditable) return;
    const pending = tasks.filter((task) => !task.finished && !task.invalidated);
    if (!pending.length) return;
    for (const task of pending) task.invalidated = true;
    queueMicrotask(() =>
      runCleanupSteps(
        [
          () => {
            const ids = pending.map((task) => task.id);
            if (destroyed) return;
            if (editor.isDestroyed) hideUploads(editor, ids);
            else
              editor.view.dispatch(
                editor.state.tr.setMeta(attachmentKey, { removeMany: ids }).setMeta("addToHistory", false),
              );
          },
          () => abortTasks(pending),
        ],
        "Attachment upload cancellation failed",
      ),
    );
  };
  editor.on("destroy", onDestroy);
  unregister = registerUploadCancellation(editor, onDestroy);
  if (destroyed) return;
  try {
    editor.view.dispatch(
      editor.state.tr
        .setMeta(attachmentKey, {
          add: tasks.map(({ id, file }) => ({ id, pos: position, name: file.name })),
        } satisfies UploadMeta)
        .setMeta("addToHistory", false),
    );
  } catch (error) {
    runCleanupSteps(
      [
        () => {
          throw error;
        },
        unregister,
        () => editor.off("destroy", onDestroy),
      ],
      "Attachment upload setup failed",
    );
    throw error;
  }
  let active = activeTasks.get(editor);
  if (!active) activeTasks.set(editor, (active = new Set()));
  for (const task of tasks) active.add(task);
  editor.on("transaction", onTransaction);
  editor.on("update", onEditable);
  onTransaction();
  onEditable();
  const waitForMount = async () => {
    if (destroyed) return false;
    if (!editor.isDestroyed) return true;
    return await new Promise<boolean>((resolve) => {
      let finished = false;
      const finish = (mounted: boolean) => {
        if (finished) return;
        finished = true;
        resume = undefined;
        runCleanupSteps(
          [() => editor.off("mount", onMount), () => editor.off("destroy", onDestroyed), () => resolve(mounted)],
          "Attachment upload wait failed",
        );
      };
      const onMount = () => finish(true);
      const onDestroyed = () => finish(false);
      resume = finish;
      editor.on("mount", onMount);
      editor.on("destroy", onDestroyed);
      if (destroyed) finish(false);
      else if (!editor.isDestroyed) finish(true);
    });
  };
  let batchFailed = false;
  const cleanupBatch = () => {
    if (!destroyed && acceptsUpload(editor)) {
      const ids = tasks.map((task) => task.id);
      clearFailedUploadBatch(
        () =>
          editor.view.dispatch(
            editor.state.tr.setMeta(attachmentKey, { removeMany: ids }).setMeta("addToHistory", false),
          ),
        () => hideUploads(editor, ids),
        "Attachment cleanup and redraw failed",
      );
    }
  };
  const removeOrCancel = (id: object) => {
    try {
      editor.view.dispatch(editor.state.tr.setMeta(attachmentKey, { remove: id }).setMeta("addToHistory", false));
    } catch (error) {
      batchFailed = true;
      cancelFailedUpload(error, cleanupBatch, "Attachment upload removal failed");
    }
  };
  void (async () => {
    try {
      for (const task of tasks) {
        const { id, file, controller } = task;
        // Clearing placeholders invalidates the queue (for example when the
        // document is replaced or made read-only). Do not start another host
        // upload after that; an already-running upload cannot be cancelled here.
        while (!destroyed && editor.isDestroyed) await waitForMount();
        if (destroyed) return;
        if (task.invalidated) continue;
        if (!activeDecorations(editor, editor.state)?.find(undefined, undefined, (spec) => spec.id === id).length)
          continue;
        if (!editor.isEditable) {
          removeOrCancel(id);
          continue;
        }
        try {
          const value = await upload(file, { signal: controller.signal });
          if (task.invalidated || controller.signal.aborted || destroyed) continue;
          const url = safeAttachmentURL(value);
          if (!url) throw new Error("上传成功，但返回的附件地址无效");
          while (!destroyed && editor.isDestroyed) await waitForMount();
          if (destroyed) return;
          const placeholder = activeDecorations(editor, editor.state)?.find(
            undefined,
            undefined,
            (spec) => spec.id === id,
          )[0];
          if (!placeholder) continue;
          if (!editor.isEditable) {
            removeOrCancel(id);
            continue;
          }
          const attachment =
            kind === "file"
              ? editor.schema.nodes.semloEditorAttachment.create({
                  href: url,
                  name: file.name,
                  size: file.size,
                  mimeType: file.type,
                })
              : editor.schema.nodes[kind === "video" ? "semloEditorVideo" : "semloEditorAudio"].create({
                  src: url,
                  name: file.name,
                  size: file.size,
                  mimeType: file.type,
                });
          const siblings =
            activeDecorations(editor, editor.state)?.find(
              placeholder.from,
              placeholder.from,
              (spec) => spec.id !== id,
            ) ?? [];
          const tr = editor.state.tr.replaceRangeWith(placeholder.from, placeholder.from, attachment);
          // Inserting a block can replace an empty paragraph and make ProseMirror
          // drop its other widgets. Keep the remaining queue anchored after it.
          const restore = siblings.map((decoration) => ({
            id: decoration.spec.id as object,
            name: decoration.spec.name as string,
            pos: tr.mapping.map(decoration.from, 1),
          }));
          const insertion = tr.setMeta(attachmentKey, { remove: id, restore } satisfies UploadMeta);
          const lastBatch = lastUploadBatch.get(editor);
          const beforeState = editor.state;
          let marked: { id: object; doc: EditorState["doc"] } | undefined;
          const beforeInsertion = (event: { transaction: Transaction; nextState: EditorState }) => {
            if (event.transaction === insertion && event.nextState !== beforeState) {
              marked = { id: batchId, doc: event.nextState.doc };
              lastUploadBatch.set(editor, marked);
            }
          };
          editor.on("beforeTransaction", beforeInsertion);
          try {
            task.finished = true;
            editor.view.dispatch(
              lastBatch?.id === batchId && lastBatch.doc === beforeState.doc ? insertion : closeHistory(insertion),
            );
            if (editor.state === beforeState && !destroyed && acceptsUpload(editor))
              throw new Error(`${kind === "file" ? "附件" : kind === "audio" ? "音频" : "视频"}插入被宿主拒绝`);
            if (!marked && editor.state !== beforeState)
              lastUploadBatch.set(editor, { id: batchId, doc: editor.state.doc });
          } catch (dispatchError) {
            if (marked && editor.state === beforeState && lastUploadBatch.get(editor) === marked) {
              if (lastBatch) lastUploadBatch.set(editor, lastBatch);
              else lastUploadBatch.delete(editor);
            }
            throw dispatchError;
          } finally {
            editor.off("beforeTransaction", beforeInsertion);
          }
        } catch (error) {
          if (batchFailed) throw error;
          if (task.invalidated || controller.signal.aborted) continue;
          while (!destroyed && editor.isDestroyed) await waitForMount();
          if (destroyed) return;
          if (!activeDecorations(editor, editor.state)?.find(undefined, undefined, (spec) => spec.id === id).length)
            continue;
          task.finished = true;
          removeOrCancel(id);
          if (error instanceof Error && error.name === "AbortError") continue;
          try {
            report(error);
          } catch (reportError) {
            // A failing host error handler stops this batch. Remove only its
            // remaining placeholders, even when the view was unmounted by the handler.
            batchFailed = true;
            cancelFailedUpload(reportError, cleanupBatch, "Attachment upload error handling failed");
          }
        }
      }
    } finally {
      runCleanupSteps(
        [
          unregister,
          () => editor.off("destroy", onDestroy),
          () => editor.off("transaction", onTransaction),
          () => editor.off("update", onEditable),
          () => {
            for (const task of tasks) active.delete(task);
            if (!active.size) activeTasks.delete(editor);
          },
          () => abortTasks(tasks),
        ],
        "Attachment upload cleanup failed",
      );
    }
  })();
}
export function clearAttachments(editor: Editor, allowUnmounted = false) {
  const pending = [...(activeTasks.get(editor) ?? [])];
  runCleanupSteps(
    [
      () => {
        if (!editor.isDestroyed || allowUnmounted)
          editor.view.dispatch(editor.state.tr.setMeta(attachmentKey, { clear: true }).setMeta("addToHistory", false));
      },
      () => abortTasks(pending),
    ],
    "Attachment upload cancellation failed",
  );
}
export const attachmentUploadExtension = Extension.create({
  name: "semloEditorAttachmentUpload",
  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin<UploadState>({
        key: attachmentKey,
        filterTransaction(transaction, state) {
          const last = lastUploadBatch.get(editor);
          if (transaction.docChanged && !transaction.getMeta(attachmentKey) && last?.doc === state.doc)
            closeHistory(transaction);
          return true;
        },
        state: {
          init: () => ({ decorations: DecorationSet.empty }),
          apply(transaction, previous) {
            const hidden = hiddenUploads.get(editor);
            const withoutHidden = (set: DecorationSet) =>
              hidden ? set.remove(set.find(undefined, undefined, (spec) => hidden.has(spec.id))) : set;
            let set = withoutHidden(previous.decorations);
            const previousBatch = previous.batch && {
              ...previous.batch,
              baseline: withoutHidden(previous.batch.baseline),
            };
            const action = transaction.getMeta(attachmentKey) as UploadMeta | undefined;
            const root = transaction.getMeta("appendedTransaction") as Transaction | undefined;
            // Appended transactions can change and then restore the whole
            // document. Keep the root's anchors so a net-equal batch does not
            // lose them, while honoring explicit removals and clears.
            let batch =
              root && previousBatch?.root === root
                ? previousBatch
                : !root && set !== DecorationSet.empty
                  ? { root: transaction, baseline: set, eligible: true }
                  : undefined;
            if (batch && (action?.clear || action?.add)) batch = { ...batch, eligible: false };
            else if (batch && (action?.remove || action?.removeMany?.length)) {
              const removed = new Set([...(action.removeMany ?? []), ...(action.remove ? [action.remove] : [])]);
              batch = {
                ...batch,
                baseline: batch.baseline.remove(
                  batch.baseline.find(undefined, undefined, (spec) => removed.has(spec.id)),
                ),
              };
            }
            if (root && batch?.root === root && batch.eligible && transaction.doc.eq(root.before)) {
              set = batch.baseline;
            } else {
              // A whole-document replacement can have identical content (for
              // example, a host plugin's normalization). Mapping widgets through
              // it would discard pending uploads despite no effective change.
              if (set === DecorationSet.empty || !transaction.docChanged || !transaction.before.eq(transaction.doc))
                set = set.map(transaction.mapping, transaction.doc);
            }
            if (action?.clear) return { decorations: DecorationSet.empty, batch };
            if (action?.remove || action?.removeMany?.length) {
              const removed = new Set([...(action.removeMany ?? []), ...(action.remove ? [action.remove] : [])]);
              set = set.remove(set.find(undefined, undefined, (spec) => removed.has(spec.id)));
            }
            for (const anchor of [...(action?.add ?? []), ...(action?.restore ?? [])]) {
              const { id, pos, name } = anchor;
              if (hidden?.has(id)) continue;
              if (set.find(undefined, undefined, (spec) => spec.id === id).length) continue;
              const widget = (view: EditorView) => {
                const element = view.dom.ownerDocument.createElement("span");
                element.className = "semlo-editor-uploading";
                element.textContent = `正在上传 ${name || "附件"}…`;
                element.contentEditable = "false";
                element.setAttribute("role", "status");
                return element;
              };
              set = set.add(transaction.doc, [
                Decoration.widget(Math.max(0, Math.min(pos, transaction.doc.content.size)), widget, {
                  id,
                  name,
                  side: 1,
                }),
              ]);
            }
            if (!root && action?.add && !transaction.docChanged) {
              batch = { root: transaction, baseline: set, eligible: true };
            }
            return {
              decorations: withoutHidden(set),
              batch: batch && { ...batch, baseline: withoutHidden(batch.baseline) },
            };
          },
        },
        props: {
          decorations: (state) => activeDecorations(editor, state),
        },
      }),
    ];
  },
});
