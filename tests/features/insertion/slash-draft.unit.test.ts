import { createRequire } from "node:module";
import { resolve } from "node:path";

import { afterEach, expect, rstest, test } from "@rstest/core";
import {
  getSchema,
  getText,
  getTextSerializersFromSchema,
  type AnyExtension,
  type Editor,
  type JSONContent,
} from "@tiptap/core";
import { closeHistory, history, redo, undo, undoDepth } from "@tiptap/pm/history";
import { DOMParser, DOMSerializer } from "@tiptap/pm/model";
import { EditorState, Plugin, TextSelection, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Window } from "happy-dom";

import { createContentReplacement } from "../../../packages/core/src/editor/content/replace";
import { getEditorSnapshot } from "../../../packages/core/src/editor/content/snapshot";
import { createStarterKitWithCodeFonts } from "../../../packages/core/src/editor/starter-kit";
import { Callout } from "../../../packages/core/src/features/blocks/callout";
import {
  SemloEditorDetails,
  SemloEditorDetailsContent,
  SemloEditorDetailsSummary,
} from "../../../packages/core/src/features/blocks/details";
import { slashSuggestionKey } from "../../../packages/core/src/features/insertion/keys";
import {
  documentWithoutSlashDraft,
  createSlashDraftCommitObserver,
} from "../../../packages/core/src/features/insertion/slash-draft";
import { slashHistoryCandidate } from "../../../packages/core/src/features/insertion/slash-history-candidate";
import { slashCommands } from "../../../packages/core/src/features/insertion/suggestion";
import { SemloEditorTable } from "../../../packages/core/src/features/table/extension";
import { applyDocumentFont, DocumentFontExtension } from "../../../packages/core/src/features/text/document-font";
import type { EditorContent, EditorSnapshot } from "../../../packages/core/src/types";
import { paragraph, slashDraftContexts as nestedContexts } from "../../fixtures/insertion/slash-draft-content";

// 复用核心包已声明的真实表格扩展，避免测试工作区新增依赖或另写替身 schema。
const coreRequire = createRequire(resolve("packages/core/package.json"));
const { TableCell, TableHeader, TableRow } = coreRequire("@tiptap/extension-table") as Record<
  "TableCell" | "TableHeader" | "TableRow",
  AnyExtension
>;

const windows: Window[] = [];
afterEach(async () => {
  rstest.unstubAllGlobals();
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.close()));
});

function createHarness(content: EditorContent = "<p></p><p>后文</p>", extraPlugins: Plugin[] = []) {
  // 在 Node DOM 中调用实际建议插件和快照，不启动浏览器或模拟原生排版。
  const window = new Window({ settings: { disableJavaScriptEvaluation: true } });
  windows.push(window);
  rstest.stubGlobal("window", window);
  const document = window.document as unknown as Document;
  const schema = getSchema([
    createStarterKitWithCodeFonts([]),
    DocumentFontExtension,
    Callout,
    SemloEditorDetails.configure({ persist: true }),
    SemloEditorDetailsSummary,
    SemloEditorDetailsContent,
    SemloEditorTable,
    TableRow,
    TableCell,
    TableHeader,
  ]);
  const template = document.createElement("template");
  if (typeof content === "string") template.innerHTML = content;
  const doc =
    typeof content === "string" ? DOMParser.fromSchema(schema).parse(template.content) : schema.nodeFromJSON(content);
  doc.check();
  let state: EditorState;
  const view = {
    dom: document.body,
    composing: false,
    get state() {
      return state;
    },
    dispatch(transaction: Transaction) {
      const result = state.applyTransaction(transaction);
      state = result.state;
      observeCommit(state, result.transactions);
    },
  } as unknown as EditorView;
  const editor = {
    schema,
    view,
    isEditable: true,
    isDestroyed: false,
    commands: {
      command(run: (props: { tr: Transaction }) => boolean) {
        const tr = state.tr;
        const result = run({ tr });
        if (result) view.dispatch(tr);
        return result;
      },
    },
    get state() {
      return state;
    },
    getJSON: () => state.doc.toJSON(),
    getText: () =>
      getText(state.doc, { blockSeparator: "\n\n", textSerializers: getTextSerializersFromSchema(schema) }),
    getHTML: () => {
      const wrapper = document.createElement("div");
      wrapper.append(DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content, { document }));
      return wrapper.innerHTML;
    },
  } as unknown as Editor;
  const noop = () => {};
  const extension = slashCommands(noop, noop, noop, noop, noop, noop, noop, () => false);
  const suggestions = extension.config.addProseMirrorPlugins!.call({ editor } as never) as Plugin[];
  const input = slashHistoryCandidate();
  state = EditorState.create({ schema, doc, plugins: [history(), ...suggestions, input, ...extraPlugins] });
  const commits: EditorSnapshot[] = [];
  let onCommit: (() => void) | undefined;
  const observeCommit = createSlashDraftCommitObserver(state, () => {
    commits.push(getEditorSnapshot(editor, document));
    onCommit?.();
  });
  const errors: unknown[] = [];
  const replacement = createContentReplacement({
    editor,
    doc: document,
    unavailable: () => false,
    closePopovers: noop,
    report: (error) => errors.push(error),
  });
  const textInput = (from: number, to: number, text: string) => {
    // 对齐 ProseMirror 的 DOM 变更接缝：输入范围和解析后的光标可能先于旧模型选区。
    const deflt = () => {
      const transaction = state.tr.insertText(text, from, to);
      return transaction.setSelection(TextSelection.create(transaction.doc, from + text.length));
    };
    if (!input.props.handleTextInput!.call(input, view, from, to, text, deflt)) view.dispatch(deflt());
  };
  return {
    editor,
    view,
    document,
    commits,
    errors,
    replacement,
    textInput,
    onCommit(callback: () => void) {
      onCommit = callback;
    },
    state: () => state,
    snapshot: () => getEditorSnapshot(editor, document),
    escape() {
      const plugin = suggestions[0]!;
      return plugin.props.handleKeyDown!.call(
        plugin,
        view,
        new window.KeyboardEvent("keydown", { key: "Escape" }) as unknown as KeyboardEvent,
      );
    },
    type(text: string) {
      for (const character of text) {
        const { from, to } = state.selection;
        textInput(from, to, character);
      }
    },
  };
}

test("活动斜杠查询不进入保存快照，但保留当前编辑内容", () => {
  const harness = createHarness("<p></p>");
  const before = harness.snapshot();
  harness.type("/p");
  expect(slashSuggestionKey.getState(harness.state())?.active).toBe(true);
  expect(harness.editor.getText()).toBe("/p");
  expect(harness.snapshot()).toEqual(before);
});

test("保存投影不改变后文、当前选区和撤销深度", () => {
  const harness = createHarness();
  const before = harness.snapshot();
  harness.type("/p");
  const state = harness.state();
  const depth = undoDepth(state);
  expect(harness.snapshot()).toEqual(before);
  expect(harness.state()).toBe(state);
  expect(harness.state().selection).toBe(state.selection);
  expect(undoDepth(harness.state())).toBe(depth);
});

test("真实建议处理器的 Esc 将查询提交为正文并只补发一次保存通知", () => {
  const harness = createHarness();
  harness.type("/p");
  const doc = harness.state().doc;
  const depth = undoDepth(harness.state());
  expect(harness.commits).toHaveLength(0);
  expect(harness.escape()).toBe(true);
  expect(slashSuggestionKey.getState(harness.state())?.active).toBe(false);
  expect(harness.state().doc).toBe(doc);
  expect(harness.snapshot().html).toBe("<p>/p</p><p>后文</p>");
  expect(harness.commits).toEqual([harness.snapshot()]);
  expect(undoDepth(harness.state())).toBe(depth);
  harness.view.dispatch(harness.state().tr.setMeta("addToHistory", false));
  expect(harness.commits).toHaveLength(1);
});

for (const format of ["json", "html"] as const) {
  test(`${format} 受控回写保存投影保留活动查询和选区`, () => {
    const harness = createHarness();
    harness.type("/p");
    const state = harness.state();
    expect(harness.replacement.trySetContent(harness.snapshot()[format])).toEqual({ status: "unchanged" });
    expect(harness.state()).toBe(state);
    expect(harness.editor.getText()).toBe("/p\n\n后文");
    expect(slashSuggestionKey.getState(harness.state())?.active).toBe(true);
    expect(harness.errors).toHaveLength(0);
  });
}

test("Esc 补发保存通知时宿主同步回写不会形成循环", () => {
  const harness = createHarness();
  harness.onCommit(() => {
    expect(harness.replacement.trySetContent(harness.snapshot().json)).toEqual({ status: "unchanged" });
  });
  harness.type("/p");
  harness.escape();
  expect(harness.commits).toHaveLength(1);
  expect(harness.editor.getText()).toBe("/p\n\n后文");
});

test("退出通知中宿主替换文档后不会被旧查询投影覆盖", () => {
  const harness = createHarness();
  harness.onCommit(() => {
    expect(harness.replacement.trySetContent("<p>宿主接管</p>")).toEqual({ status: "applied" });
  });
  harness.type("/p");
  harness.escape();
  expect(harness.commits).toHaveLength(1);
  expect(harness.snapshot().text).toBe("宿主接管");
  harness.view.dispatch(harness.state().tr);
  expect(harness.commits).toHaveLength(1);
});

test("宿主替换为不同正文会取消查询投影", () => {
  const harness = createHarness();
  harness.type("/p");
  expect(harness.replacement.trySetContent("<p>宿主新文档</p>")).toEqual({ status: "applied" });
  expect(harness.snapshot().text).toBe("宿主新文档");
  expect(harness.commits).toHaveLength(0);
});

test("载入已有 /p 不会被当成本次输入的临时查询", () => {
  const harness = createHarness("<p>/p</p>");
  harness.view.dispatch(harness.state().tr.setSelection(TextSelection.create(harness.state().doc, 3)));
  expect(harness.snapshot().text).toBe("/p");
});

test("粘贴及程序插入的 /p 保留为正文", () => {
  const harness = createHarness();
  harness.view.dispatch(harness.state().tr.insertText("/p").setMeta("paste", true));
  expect(slashSuggestionKey.getState(harness.state())?.active).toBe(true);
  expect(harness.snapshot().text).toBe("/p\n\n后文");
});

test("插入的裸斜杠再键入查询也不会隐藏已有正文", () => {
  const harness = createHarness();
  harness.view.dispatch(harness.state().tr.insertText("/"));
  harness.type("p");
  expect(harness.snapshot().text).toBe("/p\n\n后文");
});

test("从活动查询移开选区后保留文字并通知保存", () => {
  const harness = createHarness();
  harness.type("/p");
  harness.view.dispatch(harness.state().tr.setSelection(TextSelection.atEnd(harness.state().doc)));
  expect(harness.snapshot().text).toBe("/p\n\n后文");
  expect(harness.commits).toHaveLength(1);
});

test("宿主拒绝 Esc 退出事务时查询继续保持临时态", () => {
  const harness = createHarness(undefined, [
    new Plugin({ filterTransaction: (tr) => !tr.getMeta(slashSuggestionKey)?.exit }),
  ]);
  harness.type("/p");
  harness.escape();
  expect(slashSuggestionKey.getState(harness.state())?.active).toBe(true);
  expect(harness.snapshot().text).toBe("\n\n后文");
  expect(harness.commits).toHaveLength(0);
});

test("查询输入的撤销重做保留真实文档且不把载入文本误判为临时态", () => {
  const harness = createHarness();
  const before = harness.snapshot();
  harness.type("/p");
  expect(undo(harness.state(), harness.view.dispatch)).toBe(true);
  expect(harness.snapshot()).toEqual(before);
  expect(redo(harness.state(), harness.view.dispatch)).toBe(true);
  expect(harness.editor.getText()).toBe("/p\n\n后文");
  // 未经可信输入或命令撤销重新打开的内容，保守地作为正文输出。
  expect(harness.snapshot().text).toBe("/p\n\n后文");
});

test("退出查询后撤销和重做保持已提交正文的历史", () => {
  const harness = createHarness();
  harness.type("/p");
  harness.escape();
  expect(undo(harness.state(), harness.view.dispatch)).toBe(true);
  expect(harness.snapshot().text).toBe("\n\n后文");
  expect(redo(harness.state(), harness.view.dispatch)).toBe(true);
  expect(harness.snapshot().text).toBe("/p\n\n后文");
});

test("命令撤销重新打开的空查询只在保存投影中排除", () => {
  const harness = createHarness();
  const initial = harness.snapshot();
  harness.type("/p");
  const range = slashSuggestionKey.getState(harness.state()).range;
  const before = harness.state().doc;
  harness.view.dispatch(
    closeHistory(harness.state().tr.insertText("正文", range.from, range.to)).setMeta("semloEditorSlashHistoryProbe", {
      before,
      range,
    }),
  );
  expect(harness.snapshot().text).toBe("正文\n\n后文");
  expect(undo(harness.state(), harness.view.dispatch)).toBe(true);
  expect(harness.editor.getText()).toBe("/\n\n后文");
  expect(harness.snapshot()).toEqual(initial);
});

test("引用内查询投影保留后续标题和列表", () => {
  const harness = createHarness(
    "<blockquote><p></p></blockquote><h3>标题</h3><ol start='7'><li><p>第七项</p></li></ol>",
  );
  harness.type("/p");
  expect(harness.snapshot().html).toContain("<blockquote><p></p></blockquote>");
  expect(harness.editor.getHTML()).toContain("<blockquote><p>/p</p></blockquote>");
  expect(harness.snapshot().html).toContain("<h3>标题</h3>");
  expect(harness.snapshot().html).toContain('start="7"');
});

test("投影保留文档字体及后续标题、列表的序列化", () => {
  const harness = createHarness("<p></p><h3>标题</h3><ol start='7'><li><p>第七项</p></li></ol>");
  expect(applyDocumentFont(harness.editor, "Georgia", "Georgia")).toBe(true);
  const before = harness.snapshot();
  harness.type("/p");
  expect(harness.snapshot()).toEqual(before);
  expect(harness.snapshot().html).toContain('data-semlo-editor-document-font="Georgia"');
});

test("两个实例的查询投影与退出通知彼此隔离", () => {
  const first = createHarness();
  const second = createHarness();
  first.type("/p");
  second.type("/p");
  first.escape();
  expect(first.snapshot().text).toBe("/p\n\n后文");
  expect(first.commits).toHaveLength(1);
  expect(second.snapshot().text).toBe("\n\n后文");
  expect(second.commits).toHaveLength(0);
});

test("普通选区变化不会重复发出查询提交通知", () => {
  const harness = createHarness("<p>普通正文</p>");
  const raw = harness.state().doc;
  expect(documentWithoutSlashDraft(harness.state())).toBe(raw);
  harness.view.dispatch(harness.state().tr.setSelection(TextSelection.atEnd(raw)));
  expect(harness.commits).toHaveLength(0);
});

test("文章中间的空正文查询只投影当前段落", () => {
  const harness = createHarness("<p>前文</p><p></p><p>后文</p>");
  const before = harness.snapshot();
  const from = harness.state().doc.firstChild!.nodeSize + 1;
  harness.view.dispatch(harness.state().tr.setSelection(TextSelection.create(harness.state().doc, from)));
  harness.type("/p");
  expect(slashSuggestionKey.getState(harness.state())?.active).toBe(true);
  expect(harness.snapshot()).toEqual(before);
  expect(harness.editor.getText()).toBe("前文\n\n/p\n\n后文");
});

test("原生输入范围先于旧模型选区时仍跟踪空正文查询", () => {
  const harness = createHarness("<p>前文</p><p></p><p>后文</p>");
  const saved = harness.snapshot();
  harness.view.dispatch(harness.state().tr.setSelection(TextSelection.atEnd(harness.state().doc)));
  const from = harness.state().doc.firstChild!.nodeSize + 1;
  expect(harness.state().selection.from).not.toBe(from);
  harness.textInput(from, from, "/");
  harness.type("p");
  expect(slashSuggestionKey.getState(harness.state())?.active).toBe(true);
  expect(harness.editor.getText()).toBe("前文\n\n/p\n\n后文");
  expect(harness.snapshot()).toEqual(saved);
  const state = harness.state();
  expect(harness.replacement.trySetContent(saved.html)).toEqual({ status: "unchanged" });
  expect(harness.state()).toBe(state);
  expect(harness.escape()).toBe(true);
  expect(harness.snapshot().text).toBe("前文\n\n/p\n\n后文");
  expect(harness.commits).toEqual([harness.snapshot()]);
});

test("后续输入处理器接管的斜杠不能成为可信保存草稿", () => {
  const harness = createHarness(undefined, [
    new Plugin({
      props: {
        handleTextInput(view, from, to, text) {
          if (text !== "/") return false;
          view.dispatch(view.state.tr.insertText(text, from, to));
          return true;
        },
      },
    }),
  ]);
  harness.type("/p");
  expect(slashSuggestionKey.getState(harness.state())?.active).toBe(true);
  expect(harness.snapshot().text).toBe("/p\n\n后文");
});

test("宿主改写带输入标记的事务后保存全部输入与宿主正文", () => {
  const harness = createHarness(undefined, [
    new Plugin({
      filterTransaction(transaction) {
        if (transaction.getMeta("semloEditorTrustedSlashInput"))
          transaction.insertText("宿主", transaction.doc.content.size - 1);
        return true;
      },
    }),
  ]);
  harness.type("/p");
  expect(harness.snapshot().text).toBe("/p\n\n后文宿主宿主");
});

test("组合输入未形成可信查询时保留其输入内容", () => {
  const harness = createHarness();
  Object.defineProperty(harness.view, "composing", { value: true, configurable: true });
  harness.type("/p");
  expect(harness.snapshot().text).toBe("/p\n\n后文");
});

test("在活动查询内退格删除查询词后仍按临时空查询保存", () => {
  const harness = createHarness();
  const before = harness.snapshot();
  harness.type("/p");
  harness.view.dispatch(harness.state().tr.delete(2, 3));
  expect(slashSuggestionKey.getState(harness.state())?.active).toBe(true);
  expect(harness.editor.getText()).toBe("/\n\n后文");
  expect(harness.snapshot()).toEqual(before);
});

test("多步删除越出查询范围后保留剩余查询与后文", () => {
  const harness = createHarness();
  harness.type("/p");
  harness.view.dispatch(harness.state().tr.delete(2, 3).delete(4, 5));
  expect(harness.snapshot().text).toBe("/\n\n文");
});

test("宿主追加内容使输入证据失效时保留查询和宿主正文", () => {
  const harness = createHarness(undefined, [
    new Plugin({
      appendTransaction(transactions, _previous, state) {
        if (!transactions.some((tr) => tr.getMeta("semloEditorTrustedSlashInput"))) return null;
        return state.tr.insertText("甲", state.doc.content.size - 1).setMeta("addToHistory", false);
      },
    }),
  ]);
  harness.type("/p");
  expect(harness.snapshot().text).toBe("/p\n\n后文甲甲");
});

function createNestedHarness(node: JSONContent) {
  const harness = createHarness({ type: "doc", content: [node, paragraph("外部后文")] });
  let from = -1;
  harness.state().doc.descendants((child, position) => {
    if (from < 0 && child.type.name === "paragraph" && child.content.size === 0) from = position + 1;
  });
  expect(from).toBeGreaterThan(0);
  harness.view.dispatch(harness.state().tr.setSelection(TextSelection.create(harness.state().doc, from)));
  return { ...harness, from };
}

for (const context of nestedContexts) {
  test(`${context.name}内的活动查询保存投影保留容器、属性和后文`, () => {
    const harness = createNestedHarness(context.node());
    const saved = harness.snapshot();
    harness.type("/p");
    expect(slashSuggestionKey.getState(harness.state())?.active).toBe(true);
    expect(harness.editor.getText()).toContain("/p");
    expect(harness.snapshot()).toEqual(saved);
    const state = harness.state();
    expect(harness.replacement.trySetContent(saved.json)).toEqual({ status: "unchanged" });
    expect(harness.replacement.trySetContent(saved.html)).toEqual({ status: "unchanged" });
    expect(harness.state()).toBe(state);
    expect(harness.errors).toHaveLength(0);
    harness.view.dispatch(harness.state().tr.delete(harness.from + 1, harness.from + 2));
    expect(harness.snapshot()).toEqual(saved);
    expect(harness.editor.getText()).toContain("/");
  });

  test(`${context.name}内 Esc 将查询提交为正文并通知保存`, () => {
    const harness = createNestedHarness(context.node());
    harness.type("/p");
    const doc = harness.state().doc;
    expect(harness.escape()).toBe(true);
    expect(harness.state().doc).toBe(doc);
    expect(harness.snapshot().text).toContain("/p");
    expect(harness.commits).toEqual([harness.snapshot()]);
    expect(harness.snapshot().text).toContain("容器后文");
    expect(harness.snapshot().text).toContain("外部后文");
  });
}

for (const content of [
  "<h3></h3>",
  "<blockquote><h3></h3></blockquote>",
  "<ul><li><p></p></li></ul>",
  '<ol start="7"><li><p></p></li></ol>',
]) {
  test(`已有标题和列表的字面斜杠规则不变 ${content}`, () => {
    const harness = createHarness(content);
    harness.type("/p");
    expect(slashSuggestionKey.getState(harness.state())?.active).toBe(false);
    expect(harness.state().doc.textContent).toBe("/p");
    expect(harness.snapshot().text).toBe(harness.editor.getText());
    expect(harness.snapshot().json).toEqual(harness.editor.getJSON());
    expect(harness.commits).toHaveLength(0);
  });
}

test("折叠标题中的斜杠保留为正文", () => {
  const harness = createHarness({
    type: "doc",
    content: [
      {
        type: "details",
        attrs: { open: true },
        content: [{ type: "detailsSummary" }, { type: "detailsContent", content: [paragraph("折叠正文")] }],
      },
    ],
  });
  harness.type("/p");
  expect(slashSuggestionKey.getState(harness.state())?.active).toBe(false);
  expect(harness.snapshot().text).toContain("/p");
  expect(harness.snapshot().html).toBe(harness.editor.getHTML());
});

test("已有引用正文前插入斜杠仍保存完整正文", () => {
  const harness = createHarness("<blockquote><p>原文</p></blockquote>");
  harness.type("/p");
  expect(slashSuggestionKey.getState(harness.state())?.active).toBe(false);
  expect(harness.state().doc.textContent).toBe("/p原文");
  expect(harness.snapshot().text).toBe(harness.editor.getText());
});

test("折叠正文高亮块内粘贴的字面查询不会被隐藏", () => {
  const harness = createNestedHarness(nestedContexts[3]!.node());
  harness.view.dispatch(harness.state().tr.insertText("/p").setMeta("paste", true));
  expect(slashSuggestionKey.getState(harness.state())?.active).toBe(true);
  expect(harness.snapshot().text).toContain("/p");
  expect(harness.snapshot().html).toBe(harness.editor.getHTML());
});

test("未纳入保存投影的双层引用保留全部输入", () => {
  const harness = createHarness("<blockquote><blockquote><p></p></blockquote></blockquote>");
  harness.type("/p");
  expect(harness.state().doc.textContent).toBe("/p");
  expect(harness.snapshot().text).toBe(harness.editor.getText());
});

test("折叠正文内命令撤销重开查询时保留容器和历史", () => {
  const harness = createNestedHarness(nestedContexts[3]!.node());
  const saved = harness.snapshot();
  harness.type("/p");
  const before = harness.state().doc;
  const range = slashSuggestionKey.getState(harness.state()).range;
  harness.view.dispatch(
    closeHistory(harness.state().tr.insertText("正文", range.from, range.to)).setMeta("semloEditorSlashHistoryProbe", {
      before,
      range,
    }),
  );
  expect(harness.snapshot().text).toContain("正文");
  expect(undo(harness.state(), harness.view.dispatch)).toBe(true);
  expect(harness.editor.getText()).toContain("/");
  expect(harness.snapshot()).toEqual(saved);
  expect(redo(harness.state(), harness.view.dispatch)).toBe(true);
  expect(harness.snapshot().text).toContain("正文");
});

test("嵌套查询的多步删除跨入后文时保留剩余正文", () => {
  const harness = createNestedHarness(nestedContexts[3]!.node());
  harness.type("/p");
  const transaction = harness.state().tr.delete(harness.from + 1, harness.from + 2);
  let following = -1;
  transaction.doc.descendants((node, position) => {
    if (node.type.name === "paragraph" && node.textContent === "容器后文") following = position + 1;
  });
  expect(following).toBeGreaterThan(harness.from);
  harness.view.dispatch(transaction.delete(following, following + 1));
  expect(harness.snapshot().text).toContain("/");
  expect(harness.snapshot().text).toContain("器后文");
  expect(harness.snapshot().text).toContain("外部后文");
});

function tableNode(type: "tableCell" | "tableHeader" = "tableCell", body: JSONContent[] = [paragraph()]): JSONContent {
  return {
    type: "table",
    attrs: { semloEditorHeaderColumn: true, semloEditorHeaderBackground: "#E7EFFF" },
    content: [
      {
        type: "tableRow",
        content: [
          { type, attrs: { colwidth: [180] }, content: [paragraph("单元格甲")] },
          {
            type,
            attrs: {
              colwidth: [220],
              semloEditorCellBackground: "rgb(255, 242, 204)",
              semloEditorCellVerticalAlign: "top",
            },
            content: body,
          },
        ],
      },
    ],
  };
}

for (const cell of ["tableCell", "tableHeader"] as const) {
  test(`${cell}直接正文查询保存、纯删除、受控回写及 Esc 保留同表属性和其他单元格`, () => {
    const harness = createNestedHarness(tableNode(cell));
    const saved = harness.snapshot();
    harness.type("/pq");
    expect(slashSuggestionKey.getState(harness.state())?.active).toBe(true);
    expect(harness.editor.getText()).toContain("/pq");
    expect(harness.snapshot()).toEqual(saved);
    const state = harness.state();
    for (const format of ["json", "html"] as const)
      expect(harness.replacement.trySetContent(saved[format])).toEqual({ status: "unchanged" });
    expect(harness.state()).toBe(state);
    harness.view.dispatch(harness.state().tr.delete(harness.from + 2, harness.from + 3));
    expect(harness.editor.getText()).toContain("/p");
    expect(harness.snapshot()).toEqual(saved);
    expect(harness.escape()).toBe(true);
    expect(harness.snapshot().text).toContain("/p");
    expect(harness.commits).toEqual([harness.snapshot()]);
    expect(harness.snapshot().json.content?.[0].attrs).toEqual(saved.json.content?.[0].attrs);
    expect(harness.snapshot().json.content?.[0].content?.[0].content?.[0]).toEqual(
      saved.json.content?.[0].content?.[0].content?.[0],
    );
    expect(harness.errors).toEqual([]);
  });
}

test("表格查询的原生输入范围先于模型选区时仍保存空单元格", () => {
  const harness = createNestedHarness(tableNode());
  const saved = harness.snapshot();
  harness.view.dispatch(harness.state().tr.setSelection(TextSelection.atEnd(harness.state().doc)));
  harness.textInput(harness.from, harness.from, "/");
  harness.type("p");
  expect(harness.snapshot()).toEqual(saved);
  expect(harness.editor.getText()).toContain("/p");
});

for (const source of ["loaded", "paste", "programmatic"] as const) {
  test(`表格内 ${source} 的字面 /p 不被保存投影隐藏`, () => {
    const harness = createNestedHarness(
      tableNode("tableCell", source === "loaded" ? [paragraph(), paragraph("/p")] : [paragraph()]),
    );
    if (source !== "loaded") {
      const transaction = harness.state().tr.insertText("/p");
      if (source === "paste") transaction.setMeta("paste", true);
      harness.view.dispatch(transaction);
    } else {
      let from = -1;
      harness.state().doc.descendants((node, position) => {
        if (node.type.name === "paragraph" && node.textContent === "/p") from = position + 1;
      });
      harness.view.dispatch(harness.state().tr.setSelection(TextSelection.create(harness.state().doc, from + 2)));
    }
    expect(harness.snapshot().json).toEqual(harness.editor.getJSON());
    expect(harness.snapshot().text).toContain("/p");
    expect(harness.snapshot().html).toBe(harness.editor.getHTML());
  });
}

const unsupportedTableContexts: Array<[string, JSONContent]> = [
  ["单元格引用", tableNode("tableCell", [{ type: "blockquote", content: [paragraph()] }])],
  [
    "单元格列表",
    tableNode("tableCell", [{ type: "bulletList", content: [{ type: "listItem", content: [paragraph()] }] }]),
  ],
  ["嵌套表格", tableNode("tableCell", [tableNode()])],
  ["引用内表格", { type: "blockquote", content: [tableNode()] }],
];
for (const [name, node] of unsupportedTableContexts) {
  test(`${name}不扩大直接正文查询保存边界`, () => {
    const harness = createNestedHarness(node);
    harness.type("/p");
    expect(harness.snapshot().json).toEqual(harness.editor.getJSON());
    expect(harness.snapshot().text).toContain("/p");
  });
}

test("表格查询多步删除越入同表其他单元格时保留剩余正文", () => {
  const harness = createNestedHarness(tableNode("tableCell", [paragraph(), paragraph("单元格后文")]));
  harness.type("/p");
  const transaction = harness.state().tr.delete(harness.from + 1, harness.from + 2);
  let firstCell = -1;
  transaction.doc.descendants((node, position) => {
    if (node.type.name === "paragraph" && node.textContent === "单元格甲") firstCell = position + 1;
  });
  harness.view.dispatch(transaction.delete(firstCell, firstCell + 1));
  expect(harness.snapshot().text).toContain("/");
  expect(harness.snapshot().text).toContain("元格甲");
  expect(harness.snapshot().text).toContain("单元格后文");
  expect(harness.snapshot().json).toEqual(harness.editor.getJSON());
});

test("表格查询删去斜杠再程序重插同字后按失去证据的正文保存", () => {
  const harness = createNestedHarness(tableNode());
  harness.type("/p");
  const before = harness.state().doc;
  harness.view.dispatch(
    harness
      .state()
      .tr.delete(harness.from, harness.from + 1)
      .insertText("/", harness.from),
  );
  expect(harness.state().doc.eq(before)).toBe(true);
  expect(slashSuggestionKey.getState(harness.state())?.active).toBe(true);
  expect(harness.snapshot().json).toEqual(harness.editor.getJSON());
  expect(harness.snapshot().text).toContain("/p");
});

test("表格活动查询移开和历史重放后不丢失字面正文", () => {
  const harness = createNestedHarness(tableNode());
  const saved = harness.snapshot();
  harness.type("/p");
  harness.view.dispatch(harness.state().tr.setSelection(TextSelection.atEnd(harness.state().doc)));
  expect(harness.snapshot().text).toContain("/p");
  expect(harness.commits).toHaveLength(1);
  expect(undo(harness.state(), harness.view.dispatch)).toBe(true);
  expect(harness.snapshot()).toEqual(saved);
  expect(redo(harness.state(), harness.view.dispatch)).toBe(true);
  expect(harness.snapshot().text).toContain("/p");
});
