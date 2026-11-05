import { expect, test } from "@rstest/playwright";
import type { Editor } from "@tiptap/core";
import { Schema, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";

import type { GalleryData } from "../../../packages/core/src/features/media/gallery/extension";
import {
  clearGalleryUploads,
  createGalleryUploads,
  markGalleryMarkupUpdate,
  safeGalleryUploadURL,
  uploadGalleryImages,
} from "../../../packages/core/src/features/media/gallery/uploads";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*" },
    semloEditorGallery: { group: "block", atom: true, attrs: { data: { default: null } } },
    text: {},
  },
});

function gallery(id: string, images: GalleryData["images"] = []): ProseMirrorNode {
  return schema.node("semloEditorGallery", { data: { id, layout: "carousel", images } satisfies GalleryData });
}

function makeEditor() {
  const listeners = new Map<string, Set<(value: never) => void>>();
  const dom = new EventTarget();
  const fake = {
    state: EditorState.create({
      schema,
      doc: schema.node("doc", null, [schema.node("paragraph", null, schema.text("前文")), gallery("gallery-1")]),
    }),
    isEditable: true,
    isDestroyed: false,
    view: {
      dom,
      dispatch: (transaction: Transaction) => {
        fake.state = fake.state.apply(transaction);
        emit("transaction", { transaction });
        if (transaction.docChanged) emit("update", {});
      },
    },
    on: (event: string, listener: (value: never) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    off: (event: string, listener: (value: never) => void) => listeners.get(event)?.delete(listener),
  };
  function emit(event: string, value: unknown) {
    for (const listener of listeners.get(event) ?? []) listener(value as never);
  }
  const editor = fake as unknown as Editor;
  const pos = () => {
    let result = -1;
    fake.state.doc.descendants((node, position) => {
      if (node.type.name === "semloEditorGallery" && node.attrs.data?.id === "gallery-1") result = position;
    });
    return result;
  };
  return {
    editor,
    pos,
    data: () => fake.state.doc.nodeAt(pos())?.attrs.data as GalleryData | undefined,
    dispatch: (transaction: Transaction) => fake.view.dispatch(transaction),
    setEditable: (value: boolean) => {
      fake.isEditable = value;
      dom.dispatchEvent(new Event("semlo-editor:editable"));
    },
    destroy: () => {
      fake.isDestroyed = true;
      emit("destroy", {});
    },
  };
}

const image = (name: string) => new File(["image"], name, { type: "image/png" });
type Deferred = { resolve(value: string): void; reject(error: Error): void };
function deferredUploads() {
  const requests = new Map<string, Deferred>();
  const upload = (file: File) => new Promise<string>((resolve, reject) => requests.set(file.name, { resolve, reject }));
  return { requests, upload };
}

test("clearing gallery uploads preserves sessions created by an abort callback", async () => {
  const fixture = makeEditor();
  const requests: AbortSignal[] = [];
  const upload = (file: File, context?: { signal: AbortSignal }) => {
    if (!context) throw new Error("upload signal missing");
    const { signal } = context;
    requests.push(signal);
    if (file.name === "old.png") {
      signal.addEventListener(
        "abort",
        () => {
          uploadGalleryImages(
            fixture.editor,
            fixture.pos(),
            [image("new.png")],
            () => upload,
            () => {},
          );
        },
        { once: true },
      );
    }
    return new Promise<string>(() => {});
  };
  uploadGalleryImages(
    fixture.editor,
    fixture.pos(),
    [image("old.png")],
    () => upload,
    () => {},
  );
  await expect.poll(() => requests.length).toBe(1);
  clearGalleryUploads(fixture.editor);
  await expect.poll(() => requests.length).toBe(2);
  expect(requests.map((signal) => signal.aborted)).toEqual([true, false]);
  clearGalleryUploads(fixture.editor);
  expect(requests[1].aborted).toBe(true);
});

test("queue delivers concurrent selections in order and reads the current upload callback", async () => {
  const first = deferredUploads();
  const second = deferredUploads();
  let upload = first.upload;
  const results: string[] = [];
  const errors: unknown[] = [];
  const pending: number[] = [];
  const queue = createGalleryUploads({
    getUpload: () => upload,
    onSuccess: ({ file, url }) => results.push(`${file.name}:${url}`),
    onError: (error) => errors.push(error),
    onPendingChange: (count) => pending.push(count),
  });
  queue.add([image("one.png"), image("two.png")]);
  await expect.poll(() => first.requests.size).toBe(2);
  upload = second.upload;
  queue.add([image("three.png")]);
  await expect.poll(() => second.requests.size).toBe(1);
  second.requests.get("three.png")!.resolve("/three.png");
  first.requests.get("two.png")!.resolve("https://example.com/two.png");
  await expect.poll(() => pending.at(-1)).toBe(1);
  expect(results).toEqual([]);
  first.requests.get("one.png")!.resolve("blob:https://example.com/one");
  await expect.poll(() => results.length).toBe(3);
  expect(results).toEqual([
    "one.png:blob:https://example.com/one",
    "two.png:https://example.com/two.png",
    "three.png:/three.png",
  ]);
  expect(pending.at(-1)).toBe(0);
  expect(errors).toEqual([]);
  queue.destroy();
});

test("queue reports failures and rejects unsafe addresses without discarding later images", async () => {
  const results: string[] = [];
  const errors: unknown[] = [];
  const queue = createGalleryUploads({
    getUpload: () => async (file) => {
      if (file.name === "fail.png") throw new Error("上传失败");
      if (file.name === "unsafe.png") return "javascript:alert(1)";
      return "/safe.png";
    },
    onSuccess: ({ url }) => results.push(url),
    onError: (error) => errors.push(error),
  });
  queue.add([image("fail.png"), image("unsafe.png"), image("ok.png")]);
  await expect.poll(() => results.length).toBe(1);
  expect(results).toEqual(["/safe.png"]);
  expect(errors).toHaveLength(2);
  expect(errors.map((error) => String(error))).toEqual([
    expect.stringContaining("上传失败"),
    expect.stringContaining("无效"),
  ]);
  for (const value of [
    "javascript:alert(1)",
    "//example.com/a.png",
    "/\\example.com/a.png",
    "data:image/png;base64,AA",
  ])
    expect(safeGalleryUploadURL(value)).toBeNull();
  for (const value of ["/a.png", "https://example.com/a.png", "http://example.com/a.png", "blob:https://example.com/a"])
    expect(safeGalleryUploadURL(value)).toBe(value);
  queue.destroy();
});

test("a missing image upload callback reports the problem and clears pending state", async () => {
  const errors: unknown[] = [];
  const pending: number[] = [];
  const queue = createGalleryUploads({
    getUpload: () => undefined,
    onSuccess: () => {
      throw new Error("Unexpected upload success");
    },
    onError: (error) => errors.push(error),
    onPendingChange: (count) => pending.push(count),
  });
  queue.add([image("missing.png")]);
  await expect.poll(() => pending.at(-1)).toBe(0);
  expect(errors).toHaveLength(1);
  expect(String(errors[0])).toContain("请先配置图片上传");
  queue.destroy();
});

test("cancelling a selection or destroying a queue ignores late successes and failures", async () => {
  const tasks = deferredUploads();
  const results: string[] = [];
  const errors: unknown[] = [];
  const pending: number[] = [];
  const queue = createGalleryUploads({
    getUpload: () => tasks.upload,
    onSuccess: ({ url }) => results.push(url),
    onError: (error) => errors.push(error),
    onPendingChange: (count) => pending.push(count),
  });
  const cancel = queue.add([image("cancelled.png")]);
  await expect.poll(() => tasks.requests.size).toBe(1);
  cancel();
  expect(pending.at(-1)).toBe(0);
  tasks.requests.get("cancelled.png")!.reject(new Error("迟到失败"));
  queue.add([image("destroyed.png")]);
  await expect.poll(() => tasks.requests.size).toBe(2);
  queue.destroy();
  const before = pending.slice();
  tasks.requests.get("destroyed.png")!.resolve("/late.png");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(results).toEqual([]);
  expect(errors).toEqual([]);
  expect(pending).toEqual(before);
});

test("cancelling a slow selection releases later completed selections in order", async () => {
  const tasks = deferredUploads();
  const results: string[] = [];
  const pending: number[] = [];
  const queue = createGalleryUploads({
    getUpload: () => tasks.upload,
    onSuccess: ({ file }) => results.push(file.name),
    onError: () => {
      throw new Error("Unexpected upload error");
    },
    onPendingChange: (count) => pending.push(count),
  });
  const cancel = queue.add([image("one.png"), image("two.png")]);
  queue.add([image("three.png")]);
  await expect.poll(() => tasks.requests.size).toBe(3);
  tasks.requests.get("two.png")!.resolve("/two.png");
  tasks.requests.get("three.png")!.resolve("/three.png");
  await expect.poll(() => pending.at(-1)).toBe(1);
  expect(results).toEqual([]);
  cancel();
  expect(pending.at(-1)).toBe(0);
  expect(results).toEqual(["three.png"]);
  tasks.requests.get("one.png")!.resolve("/late.png");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(results).toEqual(["three.png"]);
  queue.destroy();
});

test("direct uploads follow the original node and merge later changes in selection order", async () => {
  const app = makeEditor();
  const tasks = deferredUploads();
  const errors: unknown[] = [];
  const pending: number[] = [];
  const updatePending = (count: number) => pending.push(count);
  uploadGalleryImages(
    app.editor,
    app.pos(),
    [image("one.png"), image("two.png")],
    () => tasks.upload,
    (e) => errors.push(e),
    updatePending,
  );
  uploadGalleryImages(
    app.editor,
    app.pos(),
    [image("three.png")],
    () => tasks.upload,
    (e) => errors.push(e),
    updatePending,
  );
  await expect.poll(() => tasks.requests.size).toBe(3);
  app.dispatch(
    app.editor.state.tr.insert(0, schema.node("paragraph", null, schema.text("插入前文"))).setMeta("uiEvent", "paste"),
  );
  const target = app.editor.state.doc.nodeAt(app.pos())!;
  const existing = { id: "existing", src: "/existing.png", title: "手动修改", href: "" };
  app.dispatch(
    markGalleryMarkupUpdate(
      app.editor.state.tr.setNodeMarkup(app.pos(), undefined, {
        data: { ...target.attrs.data, layout: "grid", images: [existing] },
      }),
      app.pos(),
      "gallery-1",
    ),
  );
  tasks.requests.get("three.png")!.resolve("/three.png");
  tasks.requests.get("two.png")!.resolve("/two.png");
  await expect.poll(() => pending.at(-1)).toBe(1);
  expect(app.data()?.images).toEqual([existing]);
  tasks.requests.get("one.png")!.resolve("/one.png");
  await expect.poll(() => app.data()?.images.length).toBe(4);
  expect(app.data()?.layout).toBe("grid");
  expect(app.data()?.images.map((item) => item.src)).toEqual(["/existing.png", "/one.png", "/two.png", "/three.png"]);
  expect(new Set(app.data()?.images.map((item) => item.id)).size).toBe(4);
  expect(pending.at(-1)).toBe(0);
  expect(errors).toEqual([]);
});

for (const source of ["paste", "drop", "programmatic"] as const) {
  test(`${source} replacing a gallery with the same ID cancels its pending uploads`, async () => {
    const app = makeEditor();
    const tasks = deferredUploads();
    const pending: number[] = [];
    uploadGalleryImages(
      app.editor,
      app.pos(),
      [image("one.png")],
      () => tasks.upload,
      () => {},
      (n) => pending.push(n),
    );
    await expect.poll(() => tasks.requests.size).toBe(1);
    const position = app.pos();
    const replacement = schema.node("semloEditorGallery", { data: { id: "gallery-1", layout: "grid", images: [] } });
    const transaction = app.editor.state.tr.replaceWith(position, position + 1, replacement);
    if (source !== "programmatic") transaction.setMeta("uiEvent", source);
    if (source === "paste") transaction.setMeta("paste", true);
    app.dispatch(transaction);
    expect(pending.at(-1)).toBe(0);
    tasks.requests.get("one.png")!.resolve("/late.png");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(app.data()).toEqual({ id: "gallery-1", layout: "grid", images: [] });
  });
}

for (const mismatch of ["position", "identity", "multiple steps"] as const) {
  test(`a markup update marker with the wrong ${mismatch} cannot transfer uploads`, async () => {
    const app = makeEditor();
    const tasks = deferredUploads();
    uploadGalleryImages(
      app.editor,
      app.pos(),
      [image("one.png")],
      () => tasks.upload,
      () => {},
    );
    await expect.poll(() => tasks.requests.size).toBe(1);
    const position = app.pos();
    const replacement = schema.node("semloEditorGallery", { data: { id: "gallery-1", layout: "grid", images: [] } });
    const transaction = app.editor.state.tr.replaceWith(position, position + 1, replacement);
    if (mismatch === "multiple steps") transaction.insert(0, schema.node("paragraph"));
    app.dispatch(
      markGalleryMarkupUpdate(
        transaction,
        mismatch === "position" ? position + 1 : position,
        mismatch === "identity" ? "other-gallery" : "gallery-1",
      ),
    );
    tasks.requests.get("one.png")!.resolve("/late.png");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(app.data()?.images).toEqual([]);
    expect(app.data()?.layout).toBe("grid");
  });
}

test("replacing a gallery does not cancel uploads in another editor with the same ID", async () => {
  const first = makeEditor();
  const second = makeEditor();
  const firstTasks = deferredUploads();
  const secondTasks = deferredUploads();
  uploadGalleryImages(
    first.editor,
    first.pos(),
    [image("first.png")],
    () => firstTasks.upload,
    () => {},
  );
  uploadGalleryImages(
    second.editor,
    second.pos(),
    [image("second.png")],
    () => secondTasks.upload,
    () => {},
  );
  await expect.poll(() => firstTasks.requests.size + secondTasks.requests.size).toBe(2);
  const position = first.pos();
  first.dispatch(first.editor.state.tr.replaceWith(position, position + 1, gallery("gallery-1")));
  firstTasks.requests.get("first.png")!.resolve("/first.png");
  secondTasks.requests.get("second.png")!.resolve("/second.png");
  await expect.poll(() => second.data()?.images.map((image) => image.src)).toEqual(["/second.png"]);
  expect(first.data()?.images).toEqual([]);
});

test("deleting a gallery cancels uploads even if an identical node is restored", async () => {
  const app = makeEditor();
  const tasks = deferredUploads();
  const errors: unknown[] = [];
  const pending: number[] = [];
  uploadGalleryImages(
    app.editor,
    app.pos(),
    [image("one.png")],
    () => tasks.upload,
    (e) => errors.push(e),
    (n) => pending.push(n),
  );
  await expect.poll(() => tasks.requests.size).toBe(1);
  const position = app.pos();
  app.dispatch(app.editor.state.tr.delete(position, position + 1));
  expect(pending.at(-1)).toBe(0);
  app.dispatch(app.editor.state.tr.insert(position, gallery("gallery-1")));
  tasks.requests.get("one.png")!.resolve("/late.png");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(app.data()?.images).toEqual([]);
  expect(errors).toEqual([]);
});

test("deleting one of two galleries with the same id cannot redirect a pending upload to the other", async () => {
  const app = makeEditor();
  const tasks = deferredUploads();
  const originalPosition = app.pos();
  app.dispatch(app.editor.state.tr.insert(originalPosition + 1, gallery("gallery-1")));
  const pending: number[] = [];
  uploadGalleryImages(
    app.editor,
    originalPosition,
    [image("one.png")],
    () => tasks.upload,
    () => {},
    (n) => pending.push(n),
  );
  await expect.poll(() => tasks.requests.size).toBe(1);
  app.dispatch(app.editor.state.tr.delete(originalPosition, originalPosition + 1));
  expect(pending.at(-1)).toBe(0);
  tasks.requests.get("one.png")!.resolve("/late.png");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(app.data()?.images).toEqual([]);
});

test("replacement, read-only, explicit cancellation and destruction discard pending results", async () => {
  for (const action of ["replace", "replace-transaction", "readonly", "cancel", "destroy"] as const) {
    const app = makeEditor();
    const tasks = deferredUploads();
    const errors: unknown[] = [];
    const pending: number[] = [];
    const cancel = uploadGalleryImages(
      app.editor,
      app.pos(),
      [image(`${action}.png`)],
      () => tasks.upload,
      (e) => errors.push(e),
      (n) => pending.push(n),
    );
    await expect.poll(() => tasks.requests.size).toBe(1);
    if (action === "replace" || action === "replace-transaction") {
      if (action === "replace") clearGalleryUploads(app.editor);
      const replacement = schema.node("doc", null, [schema.node("paragraph"), gallery("gallery-1")]);
      app.dispatch(app.editor.state.tr.replaceWith(0, app.editor.state.doc.content.size, replacement.content));
    } else if (action === "readonly") {
      app.setEditable(false);
      app.setEditable(true);
    } else if (action === "cancel") cancel();
    else app.destroy();
    expect(pending.at(-1)).toBe(0);
    tasks.requests.get(`${action}.png`)!.resolve("/late.png");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(app.data()?.images).toEqual([]);
    expect(errors).toEqual([]);
  }
});
