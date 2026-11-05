import { describe, expect, test } from "@rstest/core";
import type { Editor } from "@tiptap/core";
import { history, redo, undo } from "@tiptap/pm/history";
import { Schema } from "@tiptap/pm/model";
import { EditorState, Plugin, PluginKey, type Transaction } from "@tiptap/pm/state";

import {
  attachmentUploadExtension,
  clearAttachments,
  uploadAttachments,
} from "../../../packages/core/src/features/media/attachment/uploads";
import { safeAttachmentURL } from "../../../packages/core/src/features/media/shared/attachment-url";

function makeEditor() {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      paragraph: { group: "block", content: "inline*" },
      text: { group: "inline" },
      semloEditorAttachment: { group: "inline", inline: true, attrs: { href: {}, name: {}, size: {}, mimeType: {} } },
      semloEditorVideo: { group: "block", attrs: { src: {}, name: {}, size: {}, mimeType: {} } },
      semloEditorAudio: { group: "block", attrs: { src: {}, name: {}, size: {}, mimeType: {} } },
    },
  });
  const listeners = new Map<string, Set<() => void>>();
  let destroyed = false;
  const editor = {
    schema,
    isEditable: true,
    get isDestroyed() {
      return destroyed;
    },
    set isDestroyed(value: boolean) {
      destroyed = value;
      if (value) for (const listener of Array.from(listeners.get("destroy") ?? [])) listener();
    },
    on(event: string, listener: () => void) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    },
    off(event: string, listener: () => void) {
      listeners.get(event)?.delete(listener);
    },
    state: undefined as unknown as EditorState,
    view: {
      dispatch: (tr: Transaction) => {
        editor.state = editor.state.apply(tr);
      },
    },
  };
  const plugin = attachmentUploadExtension.config.addProseMirrorPlugins!.call({ editor } as never)!;
  editor.state = EditorState.create({ schema, plugins: [...plugin, history()] });
  return editor as unknown as Editor;
}

const file = (name: string) => new File(["data"], name, { type: "text/plain" });
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("attachment upload queue", () => {
  test("attachment URL length accepts 4096 characters and rejects 4097", () => {
    const maximum = `/${"x".repeat(4095)}`;
    expect(safeAttachmentURL(maximum)).toBe(maximum);
    expect(safeAttachmentURL(`${maximum}x`)).toBe(null);
  });
  test("a reentrant clear during placeholder setup cancels the entire batch", async () => {
    const editor = makeEditor();
    const dispatch = editor.view.dispatch.bind(editor.view);
    let cleared = false;
    editor.view.dispatch = (transaction) => {
      dispatch(transaction);
      if (!cleared) {
        cleared = true;
        clearAttachments(editor);
      }
    };
    const started: string[] = [];
    uploadAttachments(
      editor,
      [file("first.txt"), file("second.txt")],
      1,
      async (item) => {
        started.push(item.name);
        return "https://example.com/file.txt";
      },
      () => {},
    );
    await flush();
    expect(started).toEqual([]);
    expect(editor.state.doc.firstChild!.childCount).toBe(0);
  });
  test("explicit clear in an appended transaction is not undone by a net-equal batch", async () => {
    const editor = makeEditor();
    let finish!: (url: string) => void;
    uploadAttachments(
      editor,
      [file("old.txt")],
      1,
      () => new Promise((resolve) => (finish = resolve)),
      () => {},
    );
    const attachmentPlugin = editor.state.plugins.find((plugin) =>
      (plugin as unknown as { key: string }).key.startsWith("semlo-editor-attachment-upload"),
    )!;
    const marker = new PluginKey("clear-upload-probe");
    const clear = new Plugin({
      appendTransaction(transactions, _oldState, state) {
        if (!transactions.some((transaction) => transaction.getMeta(marker) === "root")) return null;
        return state.tr.setMeta(attachmentPlugin, { clear: true }).setMeta(marker, "cleared");
      },
    });
    const restore = new Plugin({
      appendTransaction(transactions, oldState, state) {
        if (!transactions.some((transaction) => transaction.getMeta(marker) === "cleared")) return null;
        return state.tr.replaceWith(0, state.doc.content.size, oldState.doc.content);
      },
    });
    Object.assign(editor, { state: editor.state.reconfigure({ plugins: [...editor.state.plugins, clear, restore] }) });
    editor.view.dispatch(editor.state.tr.insertText("临时", 1).setMeta(marker, "root"));
    finish("https://example.com/old.txt");
    await flush();
    expect(editor.state.doc.firstChild!.childCount).toBe(0);
  });

  test("net-equal appended work after adding an upload preserves its placeholder", async () => {
    const editor = makeEditor();
    let finish!: (url: string) => void;
    const attachmentPlugin = editor.state.plugins.find((plugin) =>
      (plugin as unknown as { key: string }).key.startsWith("semlo-editor-attachment-upload"),
    )!;
    const marker = new PluginKey("add-upload-probe");
    const mutate = new Plugin({
      appendTransaction(transactions, _oldState, state) {
        if (!transactions.some((transaction) => transaction.getMeta(attachmentPlugin)?.add)) return null;
        return state.tr.insertText("临时", 1).setMeta(marker, "changed");
      },
    });
    const restore = new Plugin({
      appendTransaction(transactions, oldState, state) {
        if (!transactions.some((transaction) => transaction.getMeta(marker) === "changed")) return null;
        return state.tr.replaceWith(0, state.doc.content.size, oldState.doc.content);
      },
    });
    Object.assign(editor, { state: editor.state.reconfigure({ plugins: [...editor.state.plugins, mutate, restore] }) });
    uploadAttachments(
      editor,
      [file("new.txt")],
      1,
      () => new Promise((resolve) => (finish = resolve)),
      () => {},
    );
    finish("https://example.com/new.txt");
    await flush();
    expect(editor.state.doc.firstChild!.firstChild!.attrs.name).toBe("new.txt");
  });

  test("net-equal appended replacement preserves other uploads without reviving a completed one", async () => {
    const editor = makeEditor();
    const finish: Array<(url: string) => void> = [];
    const upload = () => new Promise<string>((resolve) => finish.push(resolve));
    uploadAttachments(editor, [file("first.mp4")], 1, upload, () => {}, "video");
    uploadAttachments(editor, [file("second.mp4")], 1, upload, () => {}, "video");
    const attachmentPlugin = editor.state.plugins.find((plugin) =>
      (plugin as unknown as { key: string }).key.startsWith("semlo-editor-attachment-upload"),
    )!;
    let restored = false;
    const plugin = new Plugin({
      appendTransaction(transactions, oldState, state) {
        if (restored || !transactions.some((transaction) => transaction.getMeta(attachmentPlugin)?.remove)) return null;
        restored = true;
        return state.tr.replaceWith(0, state.doc.content.size, oldState.doc.content);
      },
    });
    Object.assign(editor, { state: editor.state.reconfigure({ plugins: [...editor.state.plugins, plugin] }) });
    finish[0]("https://example.com/first.mp4");
    await flush();
    expect(editor.state.doc.firstChild!.type.name).toBe("paragraph");
    finish[1]("https://example.com/second.mp4");
    await flush();
    expect(editor.state.doc.firstChild!.type.name).toBe("semloEditorVideo");
    expect(editor.state.doc.firstChild!.attrs.name).toBe("second.mp4");
  });
  test("does not start queued uploads after placeholders are cleared", async () => {
    const editor = makeEditor();
    const calls: string[] = [];
    let finish!: (url: string) => void;
    const upload = (item: File) => {
      calls.push(item.name);
      return new Promise<string>((resolve) => {
        finish = resolve;
      });
    };
    uploadAttachments(editor, [file("first.txt"), file("second.txt")], 1, upload, () => {});
    expect(calls).toEqual(["first.txt"]);
    clearAttachments(editor);
    finish("https://example.com/first.txt");
    await flush();
    expect(calls).toEqual(["first.txt"]);
    expect(editor.state.doc.textContent).toBe("");
  });

  test("keeps all queued attachment placeholders through an equal document replacement", async () => {
    const editor = makeEditor();
    const calls: string[] = [];
    const finish: Array<(url: string) => void> = [];
    uploadAttachments(
      editor,
      [file("first.txt"), file("second.txt")],
      1,
      (item) => {
        calls.push(item.name);
        return new Promise((resolve) => finish.push(resolve));
      },
      () => {},
    );
    editor.view.dispatch(editor.state.tr.replaceWith(0, editor.state.doc.content.size, editor.state.doc.content));
    finish[0]("https://example.com/first.txt");
    await flush();
    expect(calls).toEqual(["first.txt", "second.txt"]);
    finish[1]("https://example.com/second.txt");
    await flush();
    const paragraph = editor.state.doc.firstChild!;
    expect([paragraph.child(0).attrs.name, paragraph.child(1).attrs.name]).toEqual(["first.txt", "second.txt"]);
  });

  test("continues in order and inserts each successful upload", async () => {
    const editor = makeEditor();
    const calls: string[] = [];
    const upload = async (item: File) => {
      calls.push(item.name);
      return `https://example.com/${item.name}`;
    };
    uploadAttachments(editor, [file("first.txt"), file("second.txt")], 1, upload, () => {});
    await flush();
    expect(calls).toEqual(["first.txt", "second.txt"]);
    const nodes = editor.state.doc.firstChild!.content;
    expect([nodes.child(0).attrs.name, nodes.child(1).attrs.name]).toEqual(["first.txt", "second.txt"]);
    expect(undo(editor.state, editor.view.dispatch)).toBe(true);
    expect(editor.state.doc.firstChild!.childCount).toBe(0);
    expect(redo(editor.state, editor.view.dispatch)).toBe(true);
    expect(editor.state.doc.firstChild!.childCount).toBe(2);
  });

  test("reports a failed upload and continues the remaining queue", async () => {
    const editor = makeEditor();
    const errors: unknown[] = [];
    uploadAttachments(
      editor,
      [file("bad.txt"), file("good.txt")],
      1,
      async (item) => (item.name === "bad.txt" ? "javascript:alert(1)" : "https://example.com/good.txt"),
      (error) => errors.push(error),
    );
    await flush();
    expect(errors).toHaveLength(1);
    expect(editor.state.doc.firstChild!.childCount).toBe(1);
    expect(editor.state.doc.firstChild!.firstChild!.attrs.name).toBe("good.txt");
  });

  test("inserts uploaded media as a block and restores it after undo", async () => {
    for (const kind of ["video", "audio"] as const) {
      const editor = makeEditor();
      uploadAttachments(
        editor,
        [file(`${kind}.mp4`)],
        1,
        async () => `https://example.com/${kind}`,
        () => {},
        kind,
      );
      await flush();
      expect(editor.state.doc.firstChild!.type.name).toBe(kind === "video" ? "semloEditorVideo" : "semloEditorAudio");
      expect(editor.state.doc.firstChild!.attrs.src).toBe(`https://example.com/${kind}`);
      expect(undo(editor.state, editor.view.dispatch)).toBe(true);
      expect(redo(editor.state, editor.view.dispatch)).toBe(true);
      expect(editor.state.doc.firstChild!.type.name).toBe(kind === "video" ? "semloEditorVideo" : "semloEditorAudio");
    }
  });

  test("keeps queued media in order while earlier block insertions move placeholders", async () => {
    for (const kind of ["video", "audio"] as const) {
      const editor = makeEditor();
      const names = ["first", "second", "third"].map((name) => file(`${name}.bin`));
      uploadAttachments(
        editor,
        names,
        1,
        async (item) => `https://example.com/${item.name}`,
        () => {},
        kind,
      );
      await flush();
      const inserted: string[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === (kind === "video" ? "semloEditorVideo" : "semloEditorAudio"))
          inserted.push(node.attrs.name);
      });
      expect(inserted).toEqual(["first.bin", "second.bin", "third.bin"]);
    }
  });

  test("preserves concurrent media uploads at the same position regardless of completion order", async () => {
    for (const order of [
      [0, 1],
      [1, 0],
    ]) {
      const editor = makeEditor();
      const finish: Array<(url: string) => void> = [];
      const upload = () => new Promise<string>((resolve) => finish.push(resolve));
      uploadAttachments(editor, [file("first.mp4")], 1, upload, () => {}, "video");
      uploadAttachments(editor, [file("second.mp4")], 1, upload, () => {}, "video");
      finish[order[0]](`https://example.com/${order[0] === 0 ? "first" : "second"}.mp4`);
      await flush();
      finish[order[1]](`https://example.com/${order[1] === 0 ? "first" : "second"}.mp4`);
      await flush();
      const names: string[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === "semloEditorVideo") names.push(`${node.attrs.name}:${node.attrs.src}`);
      });
      expect(names.sort()).toEqual([
        "first.mp4:https://example.com/first.mp4",
        "second.mp4:https://example.com/second.mp4",
      ]);
    }
  });

  test("preserves an attachment pending beside an inserted video", async () => {
    const editor = makeEditor();
    const finish: Array<(url: string) => void> = [];
    const upload = () => new Promise<string>((resolve) => finish.push(resolve));
    uploadAttachments(editor, [file("video.mp4")], 1, upload, () => {}, "video");
    uploadAttachments(editor, [file("notes.txt")], 1, upload, () => {});
    finish[0]("https://example.com/video.mp4");
    await flush();
    finish[1]("https://example.com/notes.txt");
    await flush();
    const nodes: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "semloEditorVideo" || node.type.name === "semloEditorAttachment")
        nodes.push(node.attrs.name);
    });
    expect(nodes).toEqual(["video.mp4", "notes.txt"]);
  });

  test("preserves concurrent audio and video at the same position", async () => {
    for (const order of [
      [0, 1],
      [1, 0],
    ]) {
      const editor = makeEditor();
      const finish: Array<(url: string) => void> = [];
      const upload = () => new Promise<string>((resolve) => finish.push(resolve));
      uploadAttachments(editor, [file("voice.wav")], 1, upload, () => {}, "audio");
      uploadAttachments(editor, [file("video.mp4")], 1, upload, () => {}, "video");
      const urls = ["https://example.com/voice.wav", "https://example.com/video.mp4"];
      finish[order[0]](urls[order[0]]);
      await flush();
      finish[order[1]](urls[order[1]]);
      await flush();
      const nodes: string[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === "semloEditorAudio" || node.type.name === "semloEditorVideo")
          nodes.push(`${node.type.name}:${node.attrs.src}`);
      });
      expect(nodes.sort()).toEqual([
        "semloEditorAudio:https://example.com/voice.wav",
        "semloEditorVideo:https://example.com/video.mp4",
      ]);
    }
  });

  test("undoing one completed upload preserves a separate pending upload", async () => {
    const editor = makeEditor();
    const finish: Array<(url: string) => void> = [];
    const upload = () => new Promise<string>((resolve) => finish.push(resolve));
    uploadAttachments(editor, [file("first.mp4")], 1, upload, () => {}, "video");
    uploadAttachments(editor, [file("second.mp4")], 1, upload, () => {}, "video");
    finish[0]("https://example.com/first.mp4");
    await flush();
    expect(undo(editor.state, editor.view.dispatch)).toBe(true);
    finish[1]("https://example.com/second.mp4");
    await flush();
    const names: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "semloEditorVideo") names.push(node.attrs.name);
    });
    expect(names).toEqual(["second.mp4"]);
  });

  test("clears restored placeholders after a concurrent video is inserted", async () => {
    const editor = makeEditor();
    const finish: Array<(url: string) => void> = [];
    const upload = () => new Promise<string>((resolve) => finish.push(resolve));
    uploadAttachments(editor, [file("video.mp4")], 1, upload, () => {}, "video");
    uploadAttachments(editor, [file("notes.txt")], 1, upload, () => {});
    finish[0]("https://example.com/video.mp4");
    await flush();
    clearAttachments(editor);
    finish[1]("https://example.com/notes.txt");
    await flush();
    const nodes: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "semloEditorVideo" || node.type.name === "semloEditorAttachment")
        nodes.push(node.attrs.name);
    });
    expect(nodes).toEqual(["video.mp4"]);
  });

  test("retains concurrent uploads when video insertion splits a text paragraph", async () => {
    const editor = makeEditor();
    editor.view.dispatch(editor.state.tr.insertText("abcd", 1));
    const finish: Array<(url: string) => void> = [];
    const upload = () => new Promise<string>((resolve) => finish.push(resolve));
    uploadAttachments(editor, [file("video.mp4")], 3, upload, () => {}, "video");
    uploadAttachments(editor, [file("notes.txt")], 3, upload, () => {});
    finish[0]("https://example.com/video.mp4");
    await flush();
    finish[1]("https://example.com/notes.txt");
    await flush();
    const names: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "semloEditorVideo" || node.type.name === "semloEditorAttachment")
        names.push(node.attrs.name);
    });
    expect(names).toEqual(["video.mp4", "notes.txt"]);
    expect(editor.state.doc.textContent).toBe("abcd");
  });

  test("maps a pending upload at another position when video splits its paragraph", async () => {
    const editor = makeEditor();
    editor.view.dispatch(editor.state.tr.insertText("abcd", 1));
    const finish: Array<(url: string) => void> = [];
    const upload = () => new Promise<string>((resolve) => finish.push(resolve));
    uploadAttachments(editor, [file("video.mp4")], 2, upload, () => {}, "video");
    uploadAttachments(editor, [file("notes.txt")], 4, upload, () => {});
    finish[0]("https://example.com/video.mp4");
    await flush();
    finish[1]("https://example.com/notes.txt");
    await flush();
    const doc = editor.state.doc;
    expect([doc.child(0).type.name, doc.child(1).type.name, doc.child(2).type.name]).toEqual([
      "paragraph",
      "semloEditorVideo",
      "paragraph",
    ]);
    expect(doc.child(0).textContent).toBe("a");
    const tail = doc.child(2);
    expect([tail.child(0).text, tail.child(1).attrs.name, tail.child(2).text]).toEqual(["bc", "notes.txt", "d"]);
  });

  test("clearing one editor does not cancel another editor's upload", async () => {
    const first = makeEditor();
    const second = makeEditor();
    const finish: Array<(url: string) => void> = [];
    const upload = () => new Promise<string>((resolve) => finish.push(resolve));
    uploadAttachments(first, [file("first.txt")], 1, upload, () => {});
    uploadAttachments(second, [file("second.txt")], 1, upload, () => {});
    clearAttachments(first);
    finish[0]("https://example.com/first.txt");
    finish[1]("https://example.com/second.txt");
    await flush();
    expect(first.state.doc.firstChild!.childCount).toBe(0);
    expect(second.state.doc.firstChild!.firstChild!.attrs.name).toBe("second.txt");
  });

  test("maps the upload position through intervening edits", async () => {
    const editor = makeEditor();
    editor.view.dispatch(editor.state.tr.insertText("abcd", 1));
    let finish!: (url: string) => void;
    uploadAttachments(
      editor,
      [file("mapped.txt")],
      3,
      () => new Promise((resolve) => (finish = resolve)),
      () => {},
    );
    editor.view.dispatch(editor.state.tr.insertText("X", 1));
    finish("https://example.com/mapped.txt");
    await flush();
    const paragraph = editor.state.doc.firstChild!;
    expect(paragraph.child(0).text).toBe("Xab");
    expect(paragraph.child(1).attrs.name).toBe("mapped.txt");
    expect(paragraph.child(2).text).toBe("cd");
  });

  test("ignores a failed upload after its placeholder is cleared", async () => {
    const editor = makeEditor();
    const errors: unknown[] = [];
    let reject!: (error: Error) => void;
    uploadAttachments(
      editor,
      [file("old.txt")],
      1,
      () => new Promise((_, fail) => (reject = fail)),
      (error) => errors.push(error),
    );
    clearAttachments(editor);
    reject(new Error("old request failed"));
    await flush();
    expect(errors).toEqual([]);
    expect(editor.state.doc.firstChild!.childCount).toBe(0);
  });

  test("does not insert or start later media when made read-only during upload", async () => {
    const editor = makeEditor();
    const calls: string[] = [];
    let finish!: (url: string) => void;
    uploadAttachments(
      editor,
      [file("first.mp4"), file("second.mp4")],
      1,
      (item) => {
        calls.push(item.name);
        return new Promise((resolve) => (finish = resolve));
      },
      () => {},
      "video",
    );
    Object.assign(editor, { isEditable: false });
    finish("https://example.com/first.mp4");
    await flush();
    expect(calls).toEqual(["first.mp4"]);
    expect(editor.state.doc.firstChild!.type.name).toBe("paragraph");
    expect(editor.state.doc.firstChild!.childCount).toBe(0);
  });

  test("ignores a media upload completion after its editor is destroyed", async () => {
    const editor = makeEditor();
    const errors: unknown[] = [];
    let finish!: (url: string) => void;
    uploadAttachments(
      editor,
      [file("video.mp4")],
      1,
      () => new Promise((resolve) => (finish = resolve)),
      (error) => errors.push(error),
      "video",
    );
    Object.assign(editor, { isDestroyed: true });
    finish("https://example.com/video.mp4");
    await flush();
    expect(editor.state.doc.firstChild!.type.name).toBe("paragraph");
    expect(errors).toEqual([]);
  });

  test("ignores a media upload rejection after its editor is destroyed", async () => {
    const editor = makeEditor();
    const errors: unknown[] = [];
    let reject!: (error: Error) => void;
    uploadAttachments(
      editor,
      [file("video.mp4")],
      1,
      () => new Promise((_, fail) => (reject = fail)),
      (error) => errors.push(error),
      "video",
    );
    Object.assign(editor, { isDestroyed: true });
    reject(new Error("late failure"));
    await flush();
    expect(editor.state.doc.firstChild!.type.name).toBe("paragraph");
    expect(errors).toEqual([]);
  });

  test("reports consecutive media upload failures and still inserts the next success", async () => {
    const editor = makeEditor();
    const calls: string[] = [];
    const errors: unknown[] = [];
    uploadAttachments(
      editor,
      [file("first.mp4"), file("second.mp4"), file("third.mp4")],
      1,
      async (item) => {
        calls.push(item.name);
        if (item.name !== "third.mp4") throw new Error(`failed ${item.name}`);
        return "https://example.com/third.mp4";
      },
      (error) => errors.push(error),
      "video",
    );
    await flush();
    expect(calls).toEqual(["first.mp4", "second.mp4", "third.mp4"]);
    expect(errors.map((error) => (error as Error).message)).toEqual(["failed first.mp4", "failed second.mp4"]);
    expect(editor.state.doc.firstChild!.type.name).toBe("semloEditorVideo");
    expect(editor.state.doc.firstChild!.attrs.name).toBe("third.mp4");
  });
});
