import { expect, test } from "@rstest/playwright";
import type { Editor } from "@tiptap/core";
import { Schema } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";

import { clearGalleryUploads, uploadGalleryImages } from "../../../packages/core/src/features/media/gallery/uploads";

test("upload cancellation remains idempotent when its progress callback destroys the editor reentrantly", async () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { group: "block", content: "text*" },
      semloEditorGallery: { group: "block", atom: true, attrs: { data: { default: null } } },
      text: {},
    },
  });
  const data = { id: "gallery", layout: "grid", images: [] };
  const gallery = schema.node("semloEditorGallery", { data });
  const listeners = new Map<string, Set<(value: never) => void>>();
  const dom = new EventTarget();
  const emit = (event: string, value: unknown) => {
    for (const listener of listeners.get(event) ?? []) listener(value as never);
  };
  const fake = {
    state: EditorState.create({ schema, doc: schema.node("doc", null, [gallery, schema.node("paragraph")]) }),
    isEditable: true,
    isDestroyed: false,
    view: { dom },
    on: (event: string, listener: (value: never) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    off: (event: string, listener: (value: never) => void) => listeners.get(event)?.delete(listener),
  };
  const editor = fake as unknown as Editor;
  let resolveUpload: ((url: string) => void) | undefined;
  const progress: number[] = [];
  const errors: unknown[] = [];
  uploadGalleryImages(
    editor,
    0,
    [new File(["image"], "pending.png", { type: "image/png" })],
    () => () =>
      new Promise((resolve) => {
        resolveUpload = resolve;
      }),
    (error) => errors.push(error),
    (count) => {
      progress.push(count);
      if (count === 0) {
        fake.isDestroyed = true;
        emit("destroy", {});
        clearGalleryUploads(editor);
      }
    },
  );
  await expect.poll(() => Boolean(resolveUpload)).toBe(true);
  const root = fake.state.tr.setMeta("probe", true);
  const appended: Transaction = fake.state.tr.replaceWith(0, fake.state.doc.content.size, [
    gallery,
    schema.node("paragraph", null, schema.text("替换")),
  ]);
  fake.state = fake.state.apply(appended);
  emit("transaction", { transaction: root, appendedTransactions: [appended] });
  expect(progress).toEqual([1, 0]);
  resolveUpload!("/late.png");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(errors).toEqual([]);
  expect(fake.state.doc.nodeAt(0)?.attrs.data.images).toEqual([]);
  expect(listeners.get("transaction")?.size).toBe(0);
});
