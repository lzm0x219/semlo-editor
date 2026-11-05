import type { Editor } from "@tiptap/core";

import { runCleanupSteps } from "../runtime/cleanup";

// Tiptap stops emitting destroy events as soon as an earlier host handler throws.
// Keep our pending uploads independently cancellable before dispatching that event.
const pending = new WeakMap<Editor, Set<() => void>>();
const closed = new WeakSet<Editor>();

export function acceptsUpload(editor: Editor): boolean {
  return !closed.has(editor);
}

export function registerUploadCancellation(editor: Editor, cancel: () => void): () => void {
  // A host can synchronously destroy the editor while an upload starts.
  // Immediately cancel registrations that arrive after destruction began.
  if (closed.has(editor)) {
    cancel();
    return () => {};
  }
  let callbacks = pending.get(editor);
  if (!callbacks) {
    callbacks = new Set();
    pending.set(editor, callbacks);
  }
  callbacks.add(cancel);
  return () => {
    callbacks.delete(cancel);
    if (callbacks.size === 0 && pending.get(editor) === callbacks) pending.delete(editor);
  };
}

export function cancelUploadLifetimes(editor: Editor): void {
  // Permanently close the editor before callbacks or Tiptap's onDestroy event
  // can synchronously initiate another upload.
  closed.add(editor);
  const callbacks = pending.get(editor);
  if (!callbacks) return;
  // Remove the group first so a recursive destroy cannot dispatch it twice.
  pending.delete(editor);
  runCleanupSteps([...callbacks], "Upload cancellation failed");
}
