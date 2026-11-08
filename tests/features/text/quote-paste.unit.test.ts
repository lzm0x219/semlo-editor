import { afterEach, expect, test } from "@rstest/core";
import { getSchema, type Editor } from "@tiptap/core";
import { history, redo, undo } from "@tiptap/pm/history";
import { DOMParser, DOMSerializer } from "@tiptap/pm/model";
import { AllSelection, EditorState, Plugin } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { Window } from "happy-dom";

import { createStarterKitWithCodeFonts } from "../../../packages/core/src/editor/starter-kit";
import { clipboardContents } from "../../../packages/core/src/features/blocks/actions/operations";
import type { Target } from "../../../packages/core/src/features/blocks/actions/target";
import {
  clipboardSourceAttribute,
  normalizeExternalQuoteHTML,
  QuotePaste,
} from "../../../packages/core/src/features/text/quote-paste";
import { nativeYuqueQuoteHTML } from "../../fixtures/text/yuque-quote-clipboard";

const schema = getSchema([createStarterKitWithCodeFonts([])]);
const windows: Window[] = [];

function createDocument() {
  // 仅使用 Node 内的 HTML DOM，不创建浏览器、访问网页或模拟原生剪贴板。
  const window = new Window({ settings: { disableJavaScriptEvaluation: true } });
  windows.push(window);
  return window.document as unknown as Document;
}

afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.close()));
});

function fragment(document: Document, html: string) {
  const template = document.createElement("template");
  template.innerHTML = html;
  return template.content;
}

function parse(document: Document, html: string) {
  return DOMParser.fromSchema(schema).parse(fragment(document, html));
}

function serialize(document: Document, state: EditorState) {
  const wrapper = document.createElement("div");
  wrapper.append(DOMSerializer.fromSchema(schema).serializeFragment(state.doc.content, { document }));
  return wrapper.innerHTML;
}

function pastedHTML(document: Document, html: string) {
  const [plugin] = QuotePaste.config.addProseMirrorPlugins!.call({} as never) as Plugin[];
  const view = { dom: document.body, state: EditorState.create({ schema }) } as EditorView;
  return plugin!.props.transformPastedHTML!.call(plugin!, html, view);
}

const samples = [
  {
    name: "顶层引用的正文、加粗、链接和三级标题",
    html: '<blockquote><p>正文 <strong>粗体</strong> <a href="https://example.com/">链接</a></p><h3>标题</h3></blockquote>',
    expected: '<p>正文 <strong>粗体</strong> <a href="https://example.com/">链接</a></p><h3>标题</h3>',
  },
  {
    name: "双层引用的段落顺序",
    html: "<blockquote><p>外层开头</p><blockquote><p><strong>内层引用</strong></p></blockquote><p>外层结尾</p></blockquote>",
    expected: "<p>外层开头</p><p><strong>内层引用</strong></p><p>外层结尾</p>",
  },
  {
    name: "三层无序列表内的引用",
    html: "<ul><li><p>祖父</p><ul><li><p>父列表</p><blockquote><p><strong>引用内容</strong></p></blockquote><ul><li><p>孙列表</p></li></ul></li><li><p>同级</p></li></ul></li></ul>",
    expected:
      "<ul><li><p>祖父</p><ul><li><p>父列表</p><p><strong>引用内容</strong></p><ul><li><p>孙列表</p></li></ul></li><li><p>同级</p></li></ul></li></ul>",
  },
  {
    name: "带起点的有序列表内的引用",
    html: '<ol start="7"><li><p>第七项</p><blockquote><p><em>引用段落</em></p></blockquote><ol><li><p>子项甲</p></li></ol></li><li><p>第八项</p></li></ol>',
    expected:
      '<ol start="7"><li><p>第七项</p><p><em>引用段落</em></p><ol><li><p>子项甲</p></li></ol></li><li><p>第八项</p></li></ol>',
  },
];

test("表格矩形保留外部引用的段落分组，普通正文仍展开", () => {
  const document = createDocument();
  const html = "<blockquote><p>引用甲</p><p><strong>引用乙</strong></p></blockquote>";
  expect(normalizeExternalQuoteHTML(html, document, true)).toBe(html);
  expect(normalizeExternalQuoteHTML(html, document)).toBe("<p>引用甲</p><p><strong>引用乙</strong></p>");
});

test("表格矩形仍将语雀可见引用转换为表格处理器可识别的分组", () => {
  const document = createDocument();
  const normalized = normalizeExternalQuoteHTML(nativeYuqueQuoteHTML, document, true);
  const content = fragment(document, normalized);
  expect(content.querySelectorAll("blockquote")).toHaveLength(1);
  expect(content.querySelector("div.ne-quote")).toBeNull();
  expect(content.textContent).toContain("语雀原生引用样本");
});

test("矩形选区粘贴外部表格时仍展开其单元格内部引用", () => {
  const document = createDocument();
  const html = "<table><tbody><tr><td><blockquote><p>格内引用</p></blockquote></td></tr></tbody></table>";
  expect(normalizeExternalQuoteHTML(html, document, true)).toBe(
    "<table><tbody><tr><td><p>格内引用</p></td></tr></tbody></table>",
  );
});

for (const sample of samples) {
  test(`外部粘贴展开${sample.name}`, () => {
    const document = createDocument();
    const normalized = pastedHTML(document, sample.html);
    expect(normalized).toBe(sample.expected);
    expect(parse(document, normalized).toJSON()).toEqual(parse(document, sample.expected).toJSON());
    expect(normalizeExternalQuoteHTML(normalized, document)).toBe(normalized);
  });

  test(`展开${sample.name}后状态替换可撤销、重做及往返`, () => {
    const document = createDocument();
    const original = parse(document, "<p>原文</p>");
    let state = EditorState.create({ schema, doc: original, plugins: [history()] });
    state = state.apply(state.tr.setSelection(new AllSelection(state.doc)));
    const slice = DOMParser.fromSchema(schema).parseSlice(fragment(document, pastedHTML(document, sample.html)));
    state = state.apply(state.tr.replaceSelection(slice).setMeta("paste", true).setMeta("uiEvent", "paste"));
    const saved = state.doc;
    expect(saved.toJSON()).toEqual(parse(document, sample.expected).toJSON());
    expect(parse(document, serialize(document, state)).toJSON()).toEqual(saved.toJSON());
    expect(schema.nodeFromJSON(saved.toJSON()).eq(saved)).toBe(true);
    expect(undo(state, (transaction) => (state = state.apply(transaction)))).toBe(true);
    expect(state.doc.eq(original)).toBe(true);
    expect(redo(state, (transaction) => (state = state.apply(transaction)))).toBe(true);
    expect(state.doc.eq(saved)).toBe(true);
  });
}

test("嵌套引用展开后保留三个段落和内层粗体", () => {
  const document = createDocument();
  const doc = parse(document, pastedHTML(document, samples[1]!.html));
  expect(doc.childCount).toBe(3);
  expect(doc.child(0).textContent).toBe("外层开头");
  expect(doc.child(1).firstChild!.marks.map((mark) => mark.type.name)).toEqual(["bold"]);
  expect(doc.child(2).textContent).toBe("外层结尾");
});

test("语雀实际复制的 div.ne-quote 转成可编辑引用并可往返", () => {
  const document = createDocument();
  const normalized = pastedHTML(document, nativeYuqueQuoteHTML);
  const content = fragment(document, normalized);
  expect(content.querySelectorAll("blockquote")).toHaveLength(1);
  expect(content.querySelector("div.ne-quote")).toBeNull();
  const doc = parse(document, normalized);
  expect(doc.firstChild!.type.name).toBe("blockquote");
  expect(doc.textContent).toBe("语雀原生引用样本");
  expect(parse(document, serialize(document, EditorState.create({ doc }))).eq(doc)).toBe(true);
  expect(pastedHTML(document, normalized)).toBe(normalized);
});

test("语雀可见 HTML 的嵌套引用保留相邻段落、标题、列表与内联格式", () => {
  const document = createDocument();
  const html =
    '<ne-clipboard source="https://www.yuque.com/test/doc" data="%invalid"></ne-clipboard><div class="lake-content"><p>前文</p><div class="ne-quote"><h3>标题</h3><div class="ne-quote"><p><strong>内层</strong> <a href="https://example.com/">链接</a></p></div><ol start="7"><li><p>第七项</p></li></ol></div><p>后文</p></div>';
  const normalized = pastedHTML(document, html);
  const doc = parse(document, normalized);
  expect(doc.childCount).toBe(3);
  expect(doc.child(0).textContent).toBe("前文");
  expect(doc.child(2).textContent).toBe("后文");
  const quote = doc.child(1);
  expect(quote.type.name).toBe("blockquote");
  expect(quote.child(0).type.name).toBe("heading");
  expect(quote.child(0).attrs.level).toBe(3);
  expect(quote.child(1).type.name).toBe("blockquote");
  expect(quote.child(1).firstChild!.firstChild!.marks[0]!.type.name).toBe("bold");
  expect(quote.child(2).type.name).toBe("orderedList");
  expect(quote.child(2).attrs.start).toBe(7);
  expect(fragment(document, normalized).querySelector("blockquote blockquote a")?.textContent).toBe("链接");
});

for (const source of [null, "%malformed", "https://yuque.com.example.com/doc", "https://example.com/doc"]) {
  test(`没有已知语雀来源时不提升 ne-quote 类名 ${source}`, () => {
    const document = createDocument();
    const metadata = source === null ? "" : `<ne-clipboard source="${source}"></ne-clipboard>`;
    const html = `${metadata}<div class="ne-quote"><p>普通内容</p></div>`;
    expect(pastedHTML(document, html)).toBe(html);
    expect(parse(document, pastedHTML(document, html)).firstChild!.type.name).toBe("paragraph");
  });
}

test("原生引用替换可以撤销、重做且不会更改直接载入语义", () => {
  const document = createDocument();
  expect(parse(document, nativeYuqueQuoteHTML).firstChild!.type.name).toBe("paragraph");
  const original = parse(document, "<p>原文</p>");
  let state = EditorState.create({ schema, doc: original, plugins: [history()] });
  const slice = DOMParser.fromSchema(schema).parseSlice(fragment(document, pastedHTML(document, nativeYuqueQuoteHTML)));
  state = state.apply(
    state.tr.setSelection(new AllSelection(state.doc)).replaceSelection(slice).setMeta("paste", true),
  );
  const saved = state.doc;
  expect(saved.firstChild!.type.name).toBe("blockquote");
  expect(
    undo(state, (tr) => {
      state = state.apply(tr);
    }),
  ).toBe(true);
  expect(state.doc.eq(original)).toBe(true);
  expect(
    redo(state, (tr) => {
      state = state.apply(tr);
    }),
  ).toBe(true);
  expect(state.doc.eq(saved)).toBe(true);
});

test("引用外的相邻正文、空段落、换行和中文空格不被合并", () => {
  const document = createDocument();
  const html = "<p>前文</p><BLOCKQUOTE class='old'><p></p><p>中文　空格<br>下一行</p></BLOCKQUOTE><p>后文</p>";
  const content = fragment(document, pastedHTML(document, html));
  expect(Array.from(content.children).map((element) => element.tagName)).toEqual(["P", "P", "P", "P"]);
  expect(content.querySelectorAll("br")).toHaveLength(1);
  expect(content.textContent).toBe("前文中文　空格下一行后文");
});

for (const html of ["<p>没有引用</p>", "<p>&lt;blockquote&gt;代码&lt;/blockquote&gt;</p>", "<!-- <blockquote> -->"]) {
  test(`无实际引用时原样返回 ${html}`, () => {
    expect(normalizeExternalQuoteHTML(html, createDocument())).toBe(html);
  });
}

for (const marker of ['data-pm-slice="0 0 []"', `${clipboardSourceAttribute}="1"`]) {
  test(`结构化复制标记保留嵌套引用 ${marker}`, () => {
    const document = createDocument();
    const html = `<ul ${marker}><li>${samples[1]!.html}</li></ul>`;
    expect(pastedHTML(document, html)).toBe(html);
    expect(fragment(document, pastedHTML(document, html)).querySelectorAll("blockquote")).toHaveLength(2);
  });
}

for (const source of ["https://www.yuque.com/test/doc", encodeURIComponent("https://yuque.com/test/doc")]) {
  test(`已知语雀来源标记保留标准引用 ${source}`, () => {
    const document = createDocument();
    const html = `<ne-clipboard source="${source}">${samples[1]!.html}</ne-clipboard>`;
    expect(pastedHTML(document, html)).toBe(html);
  });
}

for (const source of ["%malformed", "https://yuque.com.example.com/doc", "https://example.com/doc"]) {
  test(`无效或外部来源仍展开引用 ${source}`, () => {
    const document = createDocument();
    const html = `<ne-clipboard source="${source}"><blockquote><p>正文</p></blockquote></ne-clipboard>`;
    const result = fragment(document, pastedHTML(document, html));
    expect(result.querySelector("blockquote")).toBeNull();
    expect(result.querySelector("p")?.textContent).toBe("正文");
  });
}

test("块菜单复制携带来源并可粘回嵌套引用", () => {
  const document = createDocument();
  const doc = parse(document, `<ul><li><p>父项</p>${samples[1]!.html}</li></ul>`);
  const state = EditorState.create({ schema, doc });
  const node = doc.firstChild!;
  const dom = document.createElement("ul");
  const target: Target = {
    pos: 0,
    node,
    rootPos: 0,
    rootNode: node,
    kind: "block",
    parentPos: -1,
    dom,
    rootDOM: dom,
    heading: null,
  };
  const editor = { state, schema, view: { dom: document.body } } as Editor;
  const copied = clipboardContents(editor, target)!;
  expect(copied.html).toContain(`${clipboardSourceAttribute}="1"`);
  expect(copied.text).toContain("内层引用");
  expect(pastedHTML(document, copied.html)).toBe(copied.html);
  expect(parse(document, copied.html).eq(doc)).toBe(true);
});

test("外部引用展开只作用于粘贴，直接加载旧 HTML 保留引用", () => {
  const document = createDocument();
  const original = parse(document, samples[0]!.html);
  expect(original.firstChild!.type.name).toBe("blockquote");
  expect(parse(document, serialize(document, EditorState.create({ doc: original }))).eq(original)).toBe(true);
  expect(parse(document, pastedHTML(document, samples[0]!.html)).firstChild!.type.name).toBe("paragraph");
});

test("宿主拒绝粘贴事务后保留原文和撤销历史", () => {
  const document = createDocument();
  const original = parse(document, "<p>原文</p>");
  const state = EditorState.create({
    doc: original,
    plugins: [new Plugin({ filterTransaction: (transaction) => !transaction.getMeta("paste") }), history()],
  });
  const slice = DOMParser.fromSchema(schema).parseSlice(fragment(document, pastedHTML(document, samples[0]!.html)));
  const result = state.applyTransaction(
    state.tr.setSelection(new AllSelection(state.doc)).replaceSelection(slice).setMeta("paste", true),
  );
  expect(result.transactions).toHaveLength(0);
  expect(result.state).toBe(state);
  expect(undo(result.state)).toBe(false);
});

test("不同文档的来源标记不会影响另一次外部粘贴", () => {
  const first = createDocument();
  const second = createDocument();
  const marked = `<blockquote ${clipboardSourceAttribute}="1"><p>内部</p></blockquote>`;
  expect(pastedHTML(first, marked)).toBe(marked);
  expect(pastedHTML(second, samples[1]!.html)).toBe(samples[1]!.expected);
  expect(pastedHTML(first, samples[1]!.html)).toBe(samples[1]!.expected);
});

test("DOM 解析失败时交回原 HTML，不输出部分处理结果", () => {
  const document = {
    createElement: () => {
      throw new Error("文档不可用");
    },
  } as unknown as Document;
  expect(normalizeExternalQuoteHTML(samples[0]!.html, document)).toBe(samples[0]!.html);
});
