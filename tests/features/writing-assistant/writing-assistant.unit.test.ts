import { expect, test } from "@rstest/core";
import type { Editor } from "@tiptap/core";
import { history, redo, undo } from "@tiptap/pm/history";
import { Schema } from "@tiptap/pm/model";
import { EditorState, type Transaction } from "@tiptap/pm/state";

import { siblingItemAttrs } from "../../../packages/core/src/features/insertion/sibling-item-attrs";
import { parseWritingResult } from "../../../packages/core/src/features/writing-assistant/content";
import { createWritingRequestRunner } from "../../../packages/core/src/features/writing-assistant/request";
import {
  installWritingAssistant,
  getWritingAssistant,
} from "../../../packages/core/src/features/writing-assistant/session";
import type {
  WritingAcceptMode,
  WritingRequest,
  WritingResult,
} from "../../../packages/core/src/features/writing-assistant/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("a successful request publishes exactly once", async () => {
  const runner = createWritingRequestRunner();
  const results: string[] = [];
  await runner.run(
    async () => "完成",
    (value) => results.push(value),
    () => {
      throw new Error("unexpected");
    },
  );
  expect(results).toEqual(["完成"]);
});
test("cancel ignores providers that resolve or reject after ignoring the signal", async () => {
  for (const failed of [false, true]) {
    const runner = createWritingRequestRunner();
    const pending = deferred<string>();
    const received: unknown[] = [];
    let signal!: AbortSignal;
    const work = runner.run(
      async (value) => {
        signal = value;
        return pending.promise;
      },
      (value) => received.push(value),
      (error) => received.push(error),
    );
    runner.cancel();
    expect(signal.aborted).toBe(true);
    if (failed) pending.reject(new Error("迟到的失败"));
    else pending.resolve("迟到的结果");
    await work;
    expect(received).toEqual([]);
  }
});
test("cancel settles the public operation even when a provider never settles", async () => {
  const runner = createWritingRequestRunner();
  const pending = runner.run(
    () => new Promise<string>(() => {}),
    () => {
      throw new Error("late");
    },
    () => {},
  );
  runner.cancel();
  await pending;
});
test("out of order responses publish only the newest request", async () => {
  const runner = createWritingRequestRunner();
  const first = deferred<string>(),
    second = deferred<string>();
  const received: string[] = [];
  const a = runner.run(
    () => first.promise,
    (value) => received.push(value),
    () => {},
  );
  const b = runner.run(
    () => second.promise,
    (value) => received.push(value),
    () => {},
  );
  second.resolve("新");
  await b;
  first.resolve("旧");
  await a;
  expect(received).toEqual(["新"]);
});
test("an abort listener can synchronously start a new request without being overwritten", async () => {
  const runner = createWritingRequestRunner();
  const first = deferred<string>();
  const received: string[] = [];
  let reentrant: Promise<void> | undefined;
  const a = runner.run(
    (signal) => {
      signal.addEventListener("abort", () => {
        reentrant = runner.run(
          async () => "重入",
          (value) => received.push(value),
          () => {},
        );
      });
      return first.promise;
    },
    (value) => received.push(value),
    () => {},
  );
  await runner.run(
    async () => "被取代",
    (value) => received.push(value),
    () => {},
  );
  await reentrant;
  first.resolve("旧");
  await a;
  expect(received).toEqual(["重入"]);
});
test("failure and validation exceptions remain retryable; instances cancel independently", async () => {
  const a = createWritingRequestRunner(),
    b = createWritingRequestRunner();
  const received: string[] = [];
  await a.run(
    async () => "不合法",
    () => {
      throw new Error("结构非法");
    },
    (error) => received.push((error as Error).message),
  );
  await a.run(
    async () => {
      throw new Error("服务失败");
    },
    () => {},
    (error) => received.push((error as Error).message),
  );
  a.cancel();
  await b.run(
    async () => "实例 B",
    (value) => received.push(value),
    () => {},
  );
  await a.run(
    async () => "重试",
    (value) => received.push(value),
    () => {},
  );
  expect(received).toEqual(["结构非法", "服务失败", "实例 B", "重试"]);
});

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: { group: "block", content: "text*", attrs: { textAlign: { default: null } } },
    text: { group: "inline" },
    heading: { group: "block", content: "text*", attrs: { level: { default: 1 } } },
    codeBlock: { group: "block", content: "text*", attrs: { language: { default: null } } },
    table: { group: "block", content: "row+" },
    row: { content: "cell+" },
    cell: { content: "paragraph+" },
  },
  marks: { bold: {}, italic: {} },
});
const editor = { schema, view: { dom: { ownerDocument: {} } } } as unknown as Editor;
test("text is literal text, including markup, and preserves line breaks", () => {
  const parsed = parseWritingResult(editor, { format: "text", text: "<script>alert(1)</script>\n下一行" });
  expect(parsed.parsed.childCount).toBe(2);
  expect(parsed.parsed.firstChild?.textContent).toBe("<script>alert(1)</script>");
});
test("structured code and tables use the current schema", () => {
  const parsed = parseWritingResult(editor, {
    format: "json",
    content: {
      type: "doc",
      content: [
        { type: "codeBlock", attrs: { language: "javascript" }, content: [{ type: "text", text: "const n = 1;" }] },
        {
          type: "table",
          content: [
            {
              type: "row",
              content: [{ type: "cell", content: [{ type: "paragraph", content: [{ type: "text", text: "表格" }] }] }],
            },
          ],
        },
      ],
    },
  });
  expect(parsed.parsed.child(0).type.name).toBe("codeBlock");
  expect(parsed.parsed.child(1).type.name).toBe("table");
});
test("unknown formats, attributes, nodes and invalid child structures are rejected", () => {
  for (const result of [
    { format: "html", text: "<p>不要解析</p>" },
    { format: "text", text: "" },
    { format: "text", text: "text", html: "<p>x</p>" },
    { format: "text", text: "text", feedbackId: 42 },
    { format: "json", content: { type: "paragraph" } },
    { format: "json", content: { type: "doc", content: [{ type: "paragraph", secret: true }] } },
    { format: "json", content: { type: "doc", attrs: { documentFont: "serif" }, content: [{ type: "paragraph" }] } },
    { format: "json", content: { type: "doc", content: [{ type: "paragraph" }] } },
    { format: "json", content: { type: "doc", content: [{ type: "paragraph", attrs: { value: new Date() } }] } },
    { format: "json", content: { type: "doc", content: [{ type: "unknown" }] } },
    { format: "json", content: { type: "doc", content: [{ type: "paragraph", attrs: { surprise: true } }] } },
    { format: "json", content: { type: "doc", content: [{ type: "table", content: [{ type: "paragraph" }] }] } },
    { format: "json", content: { type: "doc", content: [{ type: "paragraph", attrs: { callback: () => {} } }] } },
  ])
    expect(() => parseWritingResult(editor, result)).toThrow();
});
test("feedback identifier is retained for the host but excluded from parsed document content", () => {
  const parsed = parseWritingResult(editor, { format: "text", text: "生成", feedbackId: "response-1" });
  expect(parsed.result.feedbackId).toBe("response-1");
  expect(JSON.stringify(parsed.parsed.toJSON())).not.toContain("response-1");
});
test("the provider cannot mutate the parsed output through a shared JSON object", () => {
  const result = {
    format: "json",
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "原内容" }] }] },
  };
  const parsed = parseWritingResult(editor, result);
  result.content.content[0].content[0].text = "后改";
  expect(parsed.parsed.textContent).toBe("原内容");
});

/** 离线状态测试使用真实 PM 文档/历史和最小事件替身；完整核心、DOM 和适配器由 Chromium 专项验证。 */
function modelEditor(doc = schema.node("doc", null, [schema.node("paragraph", null, schema.text("原文"))])) {
  let state = EditorState.create({
    schema,
    doc,
    plugins: [history()],
  });
  type Listener = (payload?: unknown) => unknown;
  const listeners = new Map<string, Set<Listener>>();
  const dom = Object.assign(new EventTarget(), { ownerDocument: {} });
  const emit = (name: string, payload?: unknown) => {
    for (const listener of listeners.get(name) ?? []) listener(payload);
  };
  const editor = {
    schema,
    isDestroyed: false,
    isEditable: true,
    get state() {
      return state;
    },
    view: {
      dom,
      focus() {},
      dispatch(transaction: Transaction) {
        state = state.apply(transaction);
        emit("transaction", { transaction });
      },
    },
    on(name: string, listener: Listener) {
      let set = listeners.get(name);
      if (!set) listeners.set(name, (set = new Set()));
      set.add(listener);
      return this;
    },
    off(name: string, listener: Listener) {
      listeners.get(name)?.delete(listener);
      return this;
    },
  } as unknown as Editor;
  return { editor, emit };
}
test("offline session moves prompt → pending → ready → closed and accepts in one history event", async () => {
  const { editor } = modelEditor();
  const pending = deferred<WritingResult>();
  const session = installWritingAssistant(
    editor,
    () => async () => pending.promise,
    () => {},
    () => false,
  );
  // 服务引用属于会话契约，不能在 getter 中每次创建新函数。
  session.destroy();
  const service = async () => pending.promise;
  const live = installWritingAssistant(
    editor,
    () => service,
    () => {},
    () => false,
  );
  const assistant = getWritingAssistant(editor)!;
  expect(assistant.open()).toBe(true);
  expect(assistant.getSnapshot().status).toBe("prompt");
  const work = assistant.send("写作");
  expect(assistant.getSnapshot().status).toBe("pending");
  expect(editor.state.doc.textContent).toBe("原文");
  pending.resolve({ format: "text", text: "生成" });
  await work;
  expect(assistant.getSnapshot().status).toBe("ready");
  expect(assistant.accept()).toBe("applied");
  expect(assistant.getSnapshot().status).toBe("closed");
  expect(undo(editor.state, (transaction) => editor.view.dispatch(transaction))).toBe(true);
  expect(editor.state.doc.textContent).toBe("原文");
  live.destroy();
  expect(getWritingAssistant(editor)).toBeNull();
});
test("offline session preserves failures, stops waiting, and invalidates a draft on document edits", async () => {
  const { editor } = modelEditor();
  const pending = deferred<WritingResult>();
  let attempt = 0;
  const failures: unknown[] = [];
  const service = async (): Promise<WritingResult> => {
    if (++attempt === 1) throw new Error("失败");
    if (attempt === 2) return pending.promise;
    return { format: "text", text: "草稿" };
  };
  const session = installWritingAssistant(
    editor,
    () => service,
    (error) => failures.push(error),
    () => false,
  );
  const assistant = session.controller;
  assistant.open();
  await assistant.send("提问");
  expect(assistant.getSnapshot()).toMatchObject({ status: "error", prompt: "提问" });
  expect(failures).toHaveLength(1);
  const retry = assistant.retry();
  assistant.stop();
  await retry;
  expect(assistant.getSnapshot()).toMatchObject({ status: "stopped", prompt: "提问" });
  await assistant.retry();
  editor.view.dispatch(editor.state.tr.insertText("编辑", 1));
  expect(assistant.getSnapshot()).toMatchObject({ status: "stale", text: "草稿", canAccept: false });
  expect(assistant.accept()).toBe("unavailable");
  assistant.cancel();
  expect(assistant.getSnapshot()).toMatchObject({ status: "closed", result: null, text: "" });
  session.destroy();
});

test("new sibling attrs preserve formatting, clear per-item restart and reset task completion without mutating source", () => {
  const schema = new Schema({
    nodes: {
      doc: { content: "block+" },
      text: {},
      paragraph: { group: "block", content: "text*" },
      listItem: {
        group: "block",
        content: "paragraph+",
        attrs: {
          semloEditorListIndent: { default: 0 },
          semloEditorListRestart: { default: false },
          customFormat: { default: null },
        },
      },
      taskItem: {
        group: "block",
        content: "paragraph+",
        attrs: { semloEditorListIndent: { default: 0 }, checked: { default: false }, customFormat: { default: null } },
      },
    },
  });
  const source = schema.node(
    "listItem",
    { semloEditorListIndent: 2, semloEditorListRestart: true, customFormat: "keep" },
    schema.node("paragraph"),
  );
  expect(siblingItemAttrs(source)).toEqual({
    semloEditorListIndent: 2,
    semloEditorListRestart: false,
    customFormat: "keep",
  });
  expect(source.attrs.semloEditorListRestart).toBe(true);
  const task = schema.node(
    "taskItem",
    { semloEditorListIndent: 1, checked: true, customFormat: "task-format" },
    schema.node("paragraph"),
  );
  expect(siblingItemAttrs(task)).toEqual({ semloEditorListIndent: 1, checked: false, customFormat: "task-format" });
  expect(task.attrs.checked).toBe(true);
});

test("partial text replacement keeps the unselected paragraph suffix in the same paragraph", async () => {
  const { editor } = modelEditor();
  const service = async (): Promise<WritingResult> => ({ format: "text", text: "改写" });
  const session = installWritingAssistant(
    editor,
    () => service,
    () => {},
    () => false,
  );
  session.controller.open({ range: { from: 1, to: 2 } });
  await session.controller.send("改写选区");
  expect(session.controller.accept()).toBe("applied");
  expect(editor.state.doc.childCount).toBe(1);
  expect(editor.state.doc.firstChild!.textContent).toBe("改写文");
  session.destroy();
});

test("append inserts only the generated text at the saved selection end, selects it, and undoes once", async () => {
  const original = schema.node("doc", null, [
    schema.node("paragraph", { textAlign: "right" }, [
      schema.text("前", [schema.mark("italic")]),
      schema.text("选", [schema.mark("bold")]),
      schema.text("后", [schema.mark("italic")]),
    ]),
  ]);
  const { editor } = modelEditor(original);
  const service = async (): Promise<WritingResult> => ({ format: "text", text: "生成" });
  const session = installWritingAssistant(
    editor,
    () => service,
    () => {},
    () => false,
  );
  session.controller.open({ range: { from: 2, to: 3 } });
  await session.controller.send("追加");
  expect(session.controller.accept("after")).toBe("applied");
  expect(editor.state.doc.childCount).toBe(1);
  expect(editor.state.doc.firstChild!.attrs.textAlign).toBe("right");
  expect(editor.state.doc.textContent).toBe("前选生成后");
  expect({ from: editor.state.selection.from, to: editor.state.selection.to }).toEqual({ from: 3, to: 5 });
  expect(undo(editor.state, (tr) => editor.view.dispatch(tr))).toBe(true);
  expect(editor.state.doc.eq(original)).toBe(true);
  expect(redo(editor.state, (tr) => editor.view.dispatch(tr))).toBe(true);
  editor.view.dispatch(editor.state.tr.deleteSelection());
  expect(editor.state.doc.eq(original)).toBe(true);
  session.destroy();
});

test("closed structured results keep table, code and heading wrappers and unselected formatted siblings", async () => {
  const cases: { node: object; mode: WritingAcceptMode; type: string }[] = [
    {
      node: { type: "codeBlock", attrs: { language: "javascript" }, content: [{ type: "text", text: "const x = 1;" }] },
      mode: "default",
      type: "codeBlock",
    },
    {
      node: {
        type: "table",
        content: [
          {
            type: "row",
            content: [{ type: "cell", content: [{ type: "paragraph", content: [{ type: "text", text: "表格" }] }] }],
          },
        ],
      },
      mode: "after",
      type: "table",
    },
    {
      node: { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "标题" }] },
      mode: "default",
      type: "heading",
    },
    {
      node: { type: "paragraph", attrs: { textAlign: "center" }, content: [{ type: "text", text: "独立段落" }] },
      mode: "default",
      type: "paragraph",
    },
  ];
  for (const item of cases) {
    const original = schema.node("doc", null, [
      schema.node("paragraph", { textAlign: "right" }, [
        schema.text("前", [schema.mark("italic")]),
        schema.text("选", [schema.mark("bold")]),
        schema.text("后", [schema.mark("italic")]),
      ]),
    ]);
    const { editor } = modelEditor(original);
    const result = { format: "json", content: { type: "doc", content: [item.node] } } as WritingResult;
    const service = async () => result;
    const session = installWritingAssistant(
      editor,
      () => service,
      () => {},
      () => false,
    );
    session.controller.open({ range: { from: 2, to: 3 } });
    await session.controller.send("结构");
    expect(session.controller.accept(item.mode)).toBe("applied");
    const children = Array.from({ length: editor.state.doc.childCount }, (_, i) => editor.state.doc.child(i));
    expect(children).toHaveLength(3);
    expect(children[1].toJSON()).toEqual(schema.nodeFromJSON(item.node).toJSON());
    expect(children[0].textContent).toBe(item.mode === "after" ? "前选" : "前");
    expect(children[2].textContent).toBe("后");
    expect(children[0].attrs.textAlign).toBe("right");
    expect(children[2].attrs.textAlign).toBe("right");
    expect(children[2].firstChild!.marks[0].type.name).toBe("italic");
    expect(editor.state.selection.empty).toBe(true);
    editor.view.dispatch(editor.state.tr.insertText("光标"));
    expect(editor.state.doc.textContent).toContain("后");
    session.destroy();
  }
});

test("unknown modes and append without a selection do not consume the draft", async () => {
  const { editor } = modelEditor();
  const service = async (): Promise<WritingResult> => ({ format: "text", text: "生成" });
  const session = installWritingAssistant(
    editor,
    () => service,
    () => {},
    () => false,
  );
  session.controller.open();
  await session.controller.send("写作");
  expect(session.controller.accept("unknown" as WritingAcceptMode)).toBe("unavailable");
  expect(session.controller.accept("after")).toBe("unavailable");
  expect(session.controller.getSnapshot()).toMatchObject({ status: "ready", text: "生成", canAccept: true });
  expect(editor.state.doc.textContent).toBe("原文");
  session.destroy();
});

test("regeneration replays its request while follow-up receives a detached previous draft", async () => {
  const { editor } = modelEditor();
  const requests: WritingRequest[] = [];
  const service = async (request: WritingRequest): Promise<WritingResult> => {
    requests.push(request);
    return { format: "text", text: `草稿${requests.length}` };
  };
  const session = installWritingAssistant(
    editor,
    () => service,
    () => {},
    () => false,
  );
  const assistant = session.controller;
  assistant.open({ range: { from: 1, to: 2 } });
  await assistant.send("原指令");
  requests[0].context.selection.content[0].text = "宿主修改";
  requests[0].prompt = "宿主改动指令";
  await assistant.retry();
  expect(requests[1].prompt).toBe("原指令");
  expect(requests[1].previousDraft).toBeUndefined();
  expect(requests[1].context.selection.text).toBe("原");
  expect(JSON.stringify(requests[1].context.selection.content)).not.toContain("宿主修改");
  await assistant.followUp("基于草稿继续修改");
  expect(requests[2].previousDraft).toEqual({ format: "text", text: "草稿2" });
  (requests[2].previousDraft as { format: "text"; text: string }).text = "宿主修改草稿";
  requests[2].context.before = "宿主修改前文";
  await assistant.retry();
  expect(requests[3].previousDraft).toEqual({ format: "text", text: "草稿2" });
  expect(requests[3].prompt).toBe("基于草稿继续修改");
  expect(requests[3].context.before).toBe("");
  expect(assistant.getSnapshot().text).toBe("草稿4");
  expect(editor.state.doc.textContent).toBe("原文");
  session.destroy();
});

test("structured insertion at the start of a nonempty paragraph retains every generated block", async () => {
  const { editor } = modelEditor();
  const result: WritingResult = {
    format: "json",
    content: {
      type: "doc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "row",
              content: [{ type: "cell", content: [{ type: "paragraph", content: [{ type: "text", text: "表格" }] }] }],
            },
          ],
        },
        { type: "codeBlock", attrs: { language: "javascript" }, content: [{ type: "text", text: "const x = 1;" }] },
      ],
    },
  };
  const service = async () => result;
  const session = installWritingAssistant(
    editor,
    () => service,
    () => {},
    () => false,
  );
  session.controller.open({ range: { from: 1, to: 1 } });
  await session.controller.send("表格与代码");
  expect(session.controller.accept()).toBe("applied");
  expect(Array.from({ length: editor.state.doc.childCount }, (_, i) => editor.state.doc.child(i).type.name)).toEqual([
    "table",
    "codeBlock",
    "paragraph",
  ]);
  expect(editor.state.doc.lastChild!.textContent).toBe("原文");
  session.destroy();
});

test("a single paragraph inserted at an empty inline caret selects only its new content", async () => {
  const { editor } = modelEditor();
  const service = async (): Promise<WritingResult> => ({ format: "text", text: "生成" });
  const session = installWritingAssistant(
    editor,
    () => service,
    () => {},
    () => false,
  );
  session.controller.open({ range: { from: 2, to: 2 } });
  await session.controller.send("中间写作");
  expect(session.controller.accept()).toBe("applied");
  expect(editor.state.doc.childCount).toBe(1);
  expect(editor.state.doc.textContent).toBe("原生成文");
  expect({ from: editor.state.selection.from, to: editor.state.selection.to }).toEqual({ from: 2, to: 4 });
  expect(undo(editor.state, (tr) => editor.view.dispatch(tr))).toBe(true);
  expect(editor.state.doc.textContent).toBe("原文");
  expect(redo(editor.state, (tr) => editor.view.dispatch(tr))).toBe(true);
  editor.view.dispatch(editor.state.tr.deleteSelection());
  expect(editor.state.doc.textContent).toBe("原文");
  session.destroy();
});
