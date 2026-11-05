import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

import type { ImageUpload } from "../../../types";
import type { GalleryData, GalleryImage } from "./extension";

/** The gallery accepts the same image URL schemes as the editor's image uploader. */
export function safeGalleryUploadURL(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 4096) return null;
  if (Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127))
    return null;
  const source = value.trim();
  if (source.startsWith("/") && !source.startsWith("//") && !source.startsWith("/\\")) return source;
  try {
    const parsed = new URL(source);
    if (["https:", "http:", "blob:"].includes(parsed.protocol)) return source;
  } catch {
    /* Invalid or relative URLs are rejected. */
  }
  return null;
}

type UploadResult = { file: File; url: string };
export interface GalleryUploadsOptions {
  getUpload: () => ImageUpload | undefined;
  onSuccess: (result: UploadResult) => void;
  onError: (error: unknown) => void;
  onPendingChange?: (pending: number) => void;
}
export interface GalleryUploads {
  /** Add one selection in order. Calling the returned function cancels that selection. */
  add(files: readonly File[]): () => void;
  /** Stop all pending work. No callbacks run after destruction. */
  destroy(): void;
}

type UploadJob = {
  file: File;
  controller: AbortController;
  state: "pending" | "success" | "error" | "cancelled";
  url?: string;
  error?: unknown;
};
const noop = () => {};
const markupUpdateMeta = "semlo-editor:gallery-markup-update";

/** Identify a single in-place update made by the gallery itself. */
export function markGalleryMarkupUpdate(transaction: Transaction, position: number, galleryId: string): Transaction {
  return transaction.setMeta(markupUpdateMeta, { position, galleryId });
}

/** Upload concurrently while delivering successful images in selection order. */
export function createGalleryUploads(options: GalleryUploadsOptions): GalleryUploads {
  let disposed = false;
  let pending = 0;
  const queue: UploadJob[] = [];
  const report = (error: unknown) => {
    try {
      options.onError(error);
    } catch {
      // A host callback must not leave other uploads unresolved or unhandled.
    }
  };
  const notify = () => {
    if (disposed) return;
    try {
      options.onPendingChange?.(pending);
    } catch (error) {
      report(error);
    }
  };
  const flush = () => {
    while (!disposed && queue.length && queue[0].state !== "pending") {
      const job = queue.shift()!;
      if (job.state === "error") report(job.error);
      else if (job.state === "success" && job.url) {
        try {
          options.onSuccess({ file: job.file, url: job.url });
        } catch (error) {
          report(error);
        }
      }
    }
  };
  const settle = (job: UploadJob, state: "success" | "error" | "cancelled", result: unknown) => {
    if (disposed || job.state !== "pending") return;
    job.state = state;
    if (state === "success") job.url = result as string;
    else if (state === "error") job.error = result;
    pending--;
    flush();
    notify();
  };

  return {
    add(files) {
      if (disposed) return noop;
      const jobs: UploadJob[] = files
        .filter((file) => file.type.startsWith("image/"))
        .map((file) => ({ file, controller: new AbortController(), state: "pending" }));
      if (!jobs.length) return noop;
      queue.push(...jobs);
      pending += jobs.length;
      notify();
      for (const job of jobs) {
        void Promise.resolve()
          .then(() => {
            if (disposed || job.state !== "pending") return null;
            const upload = options.getUpload();
            if (!upload) throw new Error("请先配置图片上传");
            return upload(job.file, { signal: job.controller.signal });
          })
          .then((value) => {
            if (disposed || job.state !== "pending") return;
            const url = safeGalleryUploadURL(value);
            if (!url) throw new Error("上传成功，但返回的图片地址无效");
            settle(job, "success", url);
          })
          .catch((error: unknown) =>
            settle(
              job,
              job.controller.signal.aborted || (error instanceof Error && error.name === "AbortError")
                ? "cancelled"
                : "error",
              error,
            ),
          );
      }
      let cancelled = false;
      return () => {
        if (disposed || cancelled) return;
        cancelled = true;
        const pendingJobs = jobs.filter((job) => job.state === "pending");
        for (const job of jobs) {
          if (job.state === "pending") pending--;
          job.state = "cancelled";
        }
        for (const job of pendingJobs) job.controller.abort();
        flush();
        notify();
      };
    },
    destroy() {
      if (disposed) return;
      disposed = true;
      const pendingJobs = queue.filter((job) => job.state === "pending");
      queue.length = 0;
      pending = 0;
      for (const job of pendingJobs) job.controller.abort();
    },
  };
}

type DirectSession = {
  editor: Editor;
  galleryId: string;
  pos: number;
  active: boolean;
  queue: GalleryUploads;
  getUpload: () => ImageUpload | undefined;
  report: (error: unknown) => void;
  progress: Set<(pending: number) => void>;
  stop(): void;
};
const directSessions = new WeakMap<Editor, Set<DirectSession>>();
let imageCounter = 0;
function imageId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `image-${Date.now().toString(36)}-${(++imageCounter).toString(36)}`;
}

function galleryData(editor: Editor, pos: number, expectedId: string): GalleryData | undefined {
  const node = editor.state.doc.nodeAt(pos);
  if (node?.type.name !== "semloEditorGallery") return;
  const data: unknown = node.attrs.data;
  if (!data || typeof data !== "object" || (data as GalleryData).id !== expectedId) return;
  if (!Array.isArray((data as GalleryData).images)) return;
  return data as GalleryData;
}

/** Follow the original node, accepting only explicitly marked in-place updates. */
export function mapGalleryPosition(transaction: Transaction, position: number, galleryId: string): number | null {
  const update = transaction.getMeta(markupUpdateMeta) as { position?: unknown; galleryId?: unknown } | undefined;
  let pos = position;
  for (let index = 0; index < transaction.steps.length; index++) {
    const step = transaction.steps[index];
    const mapped = step.getMap().mapResult(pos, 1);
    if (mapped.deleted) {
      const original = transaction.docs[index].nodeAt(pos);
      let json: {
        stepType?: string;
        from?: number;
        to?: number;
        slice?: {
          content?: Array<{ type?: string; attrs?: { data?: { id?: string } } }>;
          openStart?: number;
          openEnd?: number;
        };
      };
      try {
        json = step.toJSON() as typeof json;
      } catch {
        return null;
      }
      const items = json.slice?.content;
      const markupUpdate =
        transaction.steps.length === 1 &&
        update?.position === pos &&
        update.galleryId === galleryId &&
        original?.type.name === "semloEditorGallery" &&
        original.attrs.data?.id === galleryId &&
        json.stepType === "replace" &&
        json.from === pos &&
        json.to === pos + original.nodeSize &&
        !json.slice?.openStart &&
        !json.slice?.openEnd &&
        items?.length === 1 &&
        items[0].type === "semloEditorGallery" &&
        items[0].attrs?.data?.id === galleryId;
      if (!markupUpdate) return null;
    }
    pos = mapped.pos;
  }
  return pos;
}

/** Cancel all in-flight gallery uploads before document replacement or read-only/destroy. */
export function clearGalleryUploads(editor: Editor) {
  // 中止回调可能同步创建新会话；只处理本次清理开始前的会话。
  for (const session of Array.from(directSessions.get(editor) ?? [])) session.stop();
}

/** Upload into the same gallery, merging each result with its latest document data. */
export function uploadGalleryImages(
  editor: Editor,
  galleryPos: number,
  files: readonly File[],
  getUpload: () => ImageUpload | undefined,
  report: (error: unknown) => void,
  onPendingChange?: (pending: number) => void,
): () => void {
  if (editor.isDestroyed || !editor.isEditable || !files.some((file) => file.type.startsWith("image/"))) return noop;
  const node = editor.state.doc.nodeAt(galleryPos);
  const initial: unknown = node?.attrs.data;
  if (node?.type.name !== "semloEditorGallery" || !initial || typeof initial !== "object") return noop;
  const galleryId = (initial as GalleryData).id;
  if (!galleryId || !galleryData(editor, galleryPos, galleryId)) return noop;
  let sessions = directSessions.get(editor);
  if (!sessions) directSessions.set(editor, (sessions = new Set()));
  let session = [...sessions].find((item) => item.active && item.galleryId === galleryId && item.pos === galleryPos);
  if (!session) {
    const viewDOM = editor.view.dom;
    const activeSessions = sessions;
    let pendingCount = 0;
    const created: DirectSession = {
      editor,
      galleryId,
      pos: galleryPos,
      active: true,
      queue: undefined as unknown as GalleryUploads,
      getUpload,
      report,
      progress: new Set(),
      stop: noop,
    };
    const notifyProgress = (pending: number) => {
      for (const listener of created.progress) {
        try {
          listener(pending);
        } catch (error) {
          try {
            created.report(error);
          } catch {
            /* A host callback cannot prevent cleanup. */
          }
        }
      }
    };
    const stop = () => {
      if (!created.active) return;
      created.active = false;
      created.queue.destroy();
      if (pendingCount) {
        pendingCount = 0;
        notifyProgress(0);
      }
      editor.off("transaction", onTransaction);
      editor.off("update", onEditable);
      editor.off("destroy", stop);
      viewDOM.removeEventListener("semlo-editor:editable", onEditable);
      activeSessions.delete(created);
      if (!activeSessions.size) directSessions.delete(editor);
    };
    const onTransaction = ({
      transaction,
      appendedTransactions = [],
    }: {
      transaction: Transaction;
      appendedTransactions?: Transaction[];
    }) => {
      if (!created.active) return;
      const finalDoc = appendedTransactions.at(-1)?.doc ?? transaction.doc;
      if (transaction.before.eq(finalDoc) && transaction.before.nodeAt(created.pos) === finalDoc.nodeAt(created.pos))
        return;
      let changed = false;
      for (const part of [transaction, ...appendedTransactions]) {
        if (!part.docChanged) continue;
        changed = true;
        if (part.before.eq(part.doc) && part.before.nodeAt(created.pos) === part.doc.nodeAt(created.pos)) continue;
        const pos = mapGalleryPosition(part, created.pos, created.galleryId);
        if (pos === null) return stop();
        created.pos = pos;
      }
      if (changed && !galleryData(editor, created.pos, created.galleryId)) stop();
    };
    const onEditable = () => {
      if (!editor.isEditable) stop();
    };
    created.stop = stop;
    created.queue = createGalleryUploads({
      getUpload: () => created.getUpload(),
      onSuccess: ({ url }) => {
        if (!created.active || editor.isDestroyed || !editor.isEditable) return stop();
        const data = galleryData(editor, created.pos, created.galleryId);
        if (!data) return stop();
        const target = editor.state.doc.nodeAt(created.pos);
        if (!target) return stop();
        let id = imageId();
        while (data.images.some((image) => image && typeof image === "object" && image.id === id)) id = imageId();
        const image: GalleryImage = { id, src: url, title: "", href: "" };
        editor.view.dispatch(
          markGalleryMarkupUpdate(
            editor.state.tr.setNodeMarkup(created.pos, undefined, {
              ...target.attrs,
              data: { ...data, images: [...data.images, image] },
            }),
            created.pos,
            created.galleryId,
          ),
        );
      },
      onError: (error) => created.report(error),
      onPendingChange: (pending) => {
        pendingCount = pending;
        notifyProgress(pending);
        if (!pending) stop();
      },
    });
    activeSessions.add(created);
    editor.on("transaction", onTransaction);
    editor.on("update", onEditable);
    editor.on("destroy", stop);
    viewDOM.addEventListener("semlo-editor:editable", onEditable);
    session = created;
  }
  session.getUpload = getUpload;
  session.report = report;
  if (onPendingChange) session.progress.add(onPendingChange);
  session.queue.add(files);
  return session.stop;
}
