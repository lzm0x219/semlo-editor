import { Extension, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";
import { Mapping } from "@tiptap/pm/transform";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";

import { acceptsUpload, registerUploadCancellation } from "../../../integrations/upload-cancellation";
import { cancelFailedUpload, clearFailedUploadBatch } from "../../../integrations/upload-failure";
import { runCleanupSteps } from "../../../runtime/cleanup";
import type { ImageUpload } from "../../../types";

type UploadWidget = { id: object; pos: number; name: string };
type UploadMeta = {
  add?: UploadWidget;
  additional?: UploadWidget[];
  remove?: object;
  removeMany?: object[];
  clear?: boolean;
};
type UploadBatch = { before: ProseMirrorNode; baseline: DecorationSet; mapping: Mapping };
type UploadTask = { id: object; file: File; controller: AbortController; invalidated: boolean; finished: boolean };
const uploadKey = new PluginKey<DecorationSet>("semlo-editor-image-upload");
const hiddenUploads = new WeakMap<Editor, WeakSet<object>>();
const activeTasks = new WeakMap<Editor, Set<UploadTask>>();
function abortTasks(tasks: readonly UploadTask[]) {
  const pending = tasks.filter((task) => !task.finished && !task.controller.signal.aborted);
  for (const task of pending) task.invalidated = true;
  for (const task of pending) task.controller.abort();
}
function isHidden(editor: Editor, id: object) {
  return hiddenUploads.get(editor)?.has(id) ?? false;
}
function filterHidden(editor: Editor, set: DecorationSet) {
  const hidden = hiddenUploads.get(editor);
  return hidden ? set.remove(set.find(undefined, undefined, (spec) => hidden.has(spec.id))) : set;
}
function hideUploads(editor: Editor, ids: object[]) {
  let hidden = hiddenUploads.get(editor);
  if (!hidden) hiddenUploads.set(editor, (hidden = new WeakSet()));
  for (const id of ids) hidden.add(id);
  if (!editor.isDestroyed) editor.view.updateState(editor.state);
}

function addUploadWidget(
  set: DecorationSet,
  doc: ProseMirrorNode,
  pos: number,
  id: object,
  name: string,
): DecorationSet {
  const widget = (view: EditorView) => {
    const element = view.dom.ownerDocument.createElement("span");
    element.className = "semlo-editor-uploading";
    element.textContent = `正在上传 ${name || "图片"}…`;
    element.setAttribute("contenteditable", "false");
    element.setAttribute("role", "status");
    return element;
  };
  return set.add(doc, [Decoration.widget(Math.max(0, Math.min(pos, doc.content.size)), widget, { id, name, side: 1 })]);
}

function uploadAnchor(doc: ProseMirrorNode, pos: number): ProseMirrorNode | undefined {
  if (pos < 0 || pos > doc.content.size) return;
  const resolved = doc.resolve(pos);
  if (resolved.parent.isTextblock) return resolved.parent;
  if (resolved.nodeAfter?.isTextblock) return resolved.nodeAfter;
  if (resolved.nodeBefore?.isTextblock) return resolved.nodeBefore;
}

function restoreUnmappedWidgets(
  original: DecorationSet,
  mapped: DecorationSet,
  before: ProseMirrorNode,
  after: ProseMirrorNode,
): DecorationSet {
  // A lost widget can return only to the same text block in a net-equal document.
  const live = new Set(mapped.find().map((decoration) => decoration.spec.id));
  let result = mapped;
  for (const decoration of original.find()) {
    if (live.has(decoration.spec.id)) continue;
    const anchor = uploadAnchor(before, decoration.from);
    if (!anchor || anchor !== uploadAnchor(after, decoration.from)) continue;
    result = addUploadWidget(result, after, decoration.from, decoration.spec.id, decoration.spec.name);
  }
  return result;
}

function validImageURL(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  if (Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
    return null;
  const source = value.trim();
  if (source.startsWith("/") && !source.startsWith("//") && !source.startsWith("/\\")) return source;
  try {
    const parsed = new URL(source);
    if (["https:", "http:", "blob:"].includes(parsed.protocol)) return source;
  } catch {
    /* rejected below */
  }
  return null;
}

/** Upload placeholders track document edits, so asynchronous results land at the original position. */
export function uploadImages(
  editor: Editor,
  files: File[],
  position: number,
  upload: ImageUpload | undefined,
  report: (error: unknown) => void,
  replaceSelection = false,
) {
  if (!acceptsUpload(editor) || !editor.isEditable || !files.length) return;
  if (!upload) {
    report(new Error("请先配置图片上传"));
    return;
  }
  const tasks: UploadTask[] = files
    .filter((file) => file.type.startsWith("image/"))
    .map((file) => ({
      id: {},
      file,
      controller: new AbortController(),
      invalidated: false,
      finished: false,
    }));
  if (!tasks.length) return;
  // Pasting or choosing an image replaces the selected content immediately,
  // just as a regular paste does. A drop uses its independent pointer position.
  const insideCode = (position: number) => {
    const resolved = editor.state.doc.resolve(position);
    for (let depth = resolved.depth; depth > 0; depth--) if (resolved.node(depth).type.spec.code) return depth;
    return 0;
  };
  if (
    replaceSelection &&
    !insideCode(position) &&
    !editor.state.selection.empty &&
    position === editor.state.selection.from
  ) {
    const transaction = closeHistory(editor.state.tr.deleteSelection());
    const nextPosition = transaction.selection.from;
    editor.view.dispatch(transaction);
    if (!acceptsUpload(editor) || editor.isDestroyed || !editor.isEditable || !editor.state.doc.eq(transaction.doc))
      return;
    position = nextPosition;
  }
  // Inline images cannot be inserted inside a code node. Keep the code block
  // intact and track the upload immediately after it instead.
  const resolved = editor.state.doc.resolve(position);
  const codeDepth = insideCode(position);
  if (codeDepth) position = resolved.after(codeDepth);
  const widgets = tasks.map(({ id, file }) => ({ id, pos: position, name: file.name }));
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
      "Image upload cancellation failed",
    );
  };
  const onTransaction = () => {
    if (destroyed || editor.isDestroyed) return;
    const decorations = uploadKey.getState(editor.state);
    const lost = tasks.filter(
      (task) =>
        !task.finished &&
        !task.invalidated &&
        !decorations?.find(undefined, undefined, (spec) => spec.id === task.id).length,
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
                editor.state.tr.setMeta(uploadKey, { removeMany: ids }).setMeta("addToHistory", false),
              );
          },
          () => abortTasks(pending),
        ],
        "Image upload cancellation failed",
      ),
    );
  };
  editor.on("destroy", onDestroy);
  unregister = registerUploadCancellation(editor, onDestroy);
  if (destroyed) return;
  let reportFailed = false;
  const cleanupBatch = () => {
    if (!destroyed && acceptsUpload(editor)) {
      const ids = tasks.map(({ id }) => id);
      clearFailedUploadBatch(
        () =>
          editor.view.dispatch(
            editor.state.tr.setMeta(uploadKey, { removeMany: ids } satisfies UploadMeta).setMeta("addToHistory", false),
          ),
        () => hideUploads(editor, ids),
        "Image cleanup and redraw failed",
      );
    }
  };
  const removeOrCancel = (id: object) => {
    try {
      editor.view.dispatch(editor.state.tr.setMeta(uploadKey, { remove: id }).setMeta("addToHistory", false));
    } catch (error) {
      reportFailed = true;
      cancelFailedUpload(error, cleanupBatch, "Image upload removal failed");
    }
  };
  const reportOrCancel = (error: unknown) => {
    try {
      report(error);
    } catch (failure) {
      reportFailed = true;
      cancelFailedUpload(failure, cleanupBatch, "Image upload error reporting failed");
    }
  };
  const waitForMount = () =>
    new Promise<boolean>((resolve) => {
      let finished = false;
      const finish = (mounted: boolean) => {
        if (finished) return;
        finished = true;
        resume = undefined;
        runCleanupSteps([() => editor.off("mount", onMount), () => resolve(mounted)], "Image upload wait failed");
      };
      const onMount = () => finish(!destroyed);
      resume = finish;
      editor.on("mount", onMount);
      if (destroyed) finish(false);
      else if (!editor.isDestroyed) finish(true);
    });
  const tr = editor.state.tr
    .setMeta(uploadKey, { add: widgets[0], additional: widgets.slice(1) } satisfies UploadMeta)
    .setMeta("addToHistory", false);
  try {
    editor.view.dispatch(tr);
  } catch (error) {
    runCleanupSteps(
      [
        () => {
          throw error;
        },
        unregister,
        () => editor.off("destroy", onDestroy),
      ],
      "Image upload setup failed",
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
  void (async () => {
    try {
      // Resolve in order so several files never appear in network-completion order.
      for (const task of tasks) {
        const { id, file, controller } = task;
        if (destroyed) return;
        if (task.invalidated) continue;
        if (isHidden(editor, id)) continue;
        while (editor.isDestroyed) if (!(await waitForMount()) || destroyed) return;
        // A previous file may have been in flight while the host replaced the
        // document or disabled editing. Do not start an upload whose placeholder
        // was already removed by that cancellation.
        if (!uploadKey.getState(editor.state)?.find(undefined, undefined, (spec) => spec.id === id).length) continue;
        if (!editor.isEditable) {
          removeOrCancel(id);
          reportOrCancel(new Error("编辑器已设为只读，图片未插入"));
          continue;
        }
        try {
          const value = await upload(file, { signal: controller.signal });
          if (task.invalidated || controller.signal.aborted || destroyed) continue;
          const url = validImageURL(value);
          if (!url) throw new Error("上传成功，但返回的图片地址无效");
          if (destroyed) return;
          while (editor.isDestroyed) if (!(await waitForMount()) || destroyed) return;
          if (isHidden(editor, id)) continue;
          const placeholder = uploadKey.getState(editor.state)?.find(undefined, undefined, (spec) => spec.id === id)[0];
          if (!placeholder) continue; // The document was replaced or the editor was destroyed.
          if (!editor.isEditable) {
            removeOrCancel(id);
            reportOrCancel(new Error("编辑器已设为只读，图片未插入"));
            continue;
          }
          const image = editor.schema.nodes.image.create({ src: url, alt: file.name });
          const tr = editor.state.tr
            .replaceRangeWith(placeholder.from, placeholder.from, image)
            .setMeta(uploadKey, { remove: id });
          task.finished = true;
          editor.view.dispatch(tr);
        } catch (error) {
          if (reportFailed) throw error;
          if (destroyed) return;
          if (task.invalidated || controller.signal.aborted) continue;
          while (editor.isDestroyed) if (!(await waitForMount()) || destroyed) return;
          if (isHidden(editor, id)) continue;
          if (!uploadKey.getState(editor.state)?.find(undefined, undefined, (spec) => spec.id === id).length) continue;
          task.finished = true;
          removeOrCancel(id);
          if (error instanceof Error && error.name === "AbortError") continue;
          reportOrCancel(error);
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
        "Image upload cleanup failed",
      );
    }
  })();
}

export function clearUploads(editor: Editor, allowUnmounted = false) {
  const pending = [...(activeTasks.get(editor) ?? [])];
  runCleanupSteps(
    [
      () => {
        if (!editor.isDestroyed || allowUnmounted)
          editor.view.dispatch(editor.state.tr.setMeta(uploadKey, { clear: true }).setMeta("addToHistory", false));
      },
      () => abortTasks(pending),
    ],
    "Image upload cancellation failed",
  );
}

export function imageUploadExtension(getUpload: () => ImageUpload | undefined, report: (error: unknown) => void) {
  return Extension.create({
    name: "semloEditorImageUpload",
    addProseMirrorPlugins() {
      const editor = this.editor;
      // ProseMirror applies root and appended transactions separately; weak keys
      // keep a batch baseline without retaining old transactions indefinitely.
      const batches = new WeakMap<Transaction, UploadBatch>();
      return [
        new Plugin<DecorationSet>({
          key: uploadKey,
          state: {
            init: () => DecorationSet.empty,
            apply(transaction, previous) {
              const action = transaction.getMeta(uploadKey) as UploadMeta | undefined;
              const appendedRoot = transaction.getMeta("appendedTransaction") as Transaction | undefined;
              previous = filterHidden(editor, previous);
              const rawBatch = appendedRoot ? batches.get(appendedRoot) : undefined;
              const previousBatch = rawBatch && { ...rawBatch, baseline: filterHidden(editor, rawBatch.baseline) };
              if (previous === DecorationSet.empty && !previousBatch && !action?.add) return previous;
              const batchKey = previousBatch && appendedRoot ? appendedRoot : transaction;
              const before = previousBatch?.before ?? transaction.before;
              const mapping = new Mapping();
              if (previousBatch) mapping.appendMapping(previousBatch.mapping);
              mapping.appendMapping(transaction.mapping);
              let baseline = previousBatch?.baseline ?? previous;
              let set = transaction.docChanged ? previous.map(transaction.mapping, transaction.doc) : previous;
              if (transaction.docChanged && transaction.before.eq(transaction.doc))
                set = restoreUnmappedWidgets(previous, set, transaction.before, transaction.doc);
              if (action?.clear) {
                set = DecorationSet.empty;
                baseline = DecorationSet.empty;
              }
              const removed = new Set([...(action?.remove ? [action.remove] : []), ...(action?.removeMany ?? [])]);
              if (removed.size) {
                set = set.remove(set.find(undefined, undefined, (spec) => removed.has(spec.id)));
                baseline = baseline.remove(baseline.find(undefined, undefined, (spec) => removed.has(spec.id)));
              }
              for (const { id, pos, name } of action?.add ? [action.add, ...(action.additional ?? [])] : []) {
                set = addUploadWidget(set, transaction.doc, pos, id, name);
                const original = mapping.invert().mapResult(pos, 1);
                if (!original.deleted) baseline = addUploadWidget(baseline, before, original.pos, id, name);
              }
              if (previousBatch && transaction.doc.eq(before))
                set = restoreUnmappedWidgets(baseline, set, before, transaction.doc);
              set = filterHidden(editor, set);
              baseline = filterHidden(editor, baseline);
              if (set === DecorationSet.empty && baseline === DecorationSet.empty) batches.delete(batchKey);
              else batches.set(batchKey, { before, baseline, mapping });
              return set;
            },
          },
          props: {
            decorations: (state) => {
              const set = uploadKey.getState(state);
              return set && filterHidden(editor, set);
            },
            handlePaste(view, event) {
              const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
                file.type.startsWith("image/"),
              );
              if (!files.length || !view.editable) return false;
              // If no upload handler exists, leave HTML/text paste behavior to ProseMirror.
              const upload = getUpload();
              if (!upload) {
                if (!event.clipboardData?.getData("text/html")) report(new Error("请先配置图片上传"));
                return false;
              }
              uploadImages(editor, files, view.state.selection.from, upload, report, true);
              return true;
            },
            handleDOMEvents: {
              dragover(_view, rawEvent) {
                const event = rawEvent as DragEvent;
                if (!event.dataTransfer?.types.includes("Files")) return false;
                event.preventDefault();
                return true;
              },
              drop(view, rawEvent) {
                const event = rawEvent as DragEvent;
                const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
                  file.type.startsWith("image/"),
                );
                if (!files.length) return false;
                // ProseMirror skips handleDrop in read-only mode; handle the native event to prevent navigation.
                event.preventDefault();
                if (!view.editable) return true;
                const upload = getUpload();
                if (!upload) {
                  report(new Error("请先配置图片上传"));
                  return true;
                }
                const pos =
                  view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from;
                uploadImages(editor, files, pos, upload, report);
                return true;
              },
            },
          },
        }),
      ];
    },
  });
}
