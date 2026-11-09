import { expect, rstest, test } from "@rstest/core";
import { history, redo, undo } from "@tiptap/pm/history";
import { Schema, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Plugin, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { HeadingEndSelection } from "../../../packages/core/src/features/heading/end-selection";
import { HeadingHomeLineEvidence } from "../../../packages/core/src/features/heading/home-line-evidence";

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    heading: {
      group: "block",
      content: "inline*",
      attrs: { level: { default: 3 }, semloEditorHeadingNumbering: { default: null } },
    },
    paragraph: { group: "block", content: "inline*" },
    blockquote: { group: "block", content: "block+" },
    hardBreak: { group: "inline", inline: true },
    text: { group: "inline" },
  },
});

type Layout = "unverified" | "single" | "wrapped";

// 只提供生产处理器读取的几何接口；未模拟浏览器的排版、输入或选区同步。
class HeadingElement {
  readonly nodeType = 1;
  readonly currentCSSZoom = 1;
  parentElement: HeadingElement | null = null;
  childNodes: object[] = [];
  classList = { contains: () => false };
  getAttribute() {
    return null;
  }
  hasAttribute() {
    return false;
  }
  getBoundingClientRect() {
    return { left: 0, top: 0, right: 100, bottom: 40 };
  }
  getClientRects() {
    return [this.getBoundingClientRect()];
  }
}

function createHarness(
  options: {
    layout?: Layout;
    content?: string;
    quote?: boolean;
    hardBreak?: boolean;
    level?: number;
  } = {},
) {
  const content = options.content ?? "abcdefghij";
  const heading = schema.node(
    "heading",
    { level: options.level ?? 3 },
    options.hardBreak
      ? [schema.text("abc"), schema.node("hardBreak"), schema.text("def")]
      : content
        ? schema.text(content)
        : [],
  );
  const document = schema.node("doc", null, [
    options.quote ? schema.node("blockquote", null, heading) : heading,
    schema.node("paragraph", null, schema.text("必须保留的后文")),
  ]);
  const headingStart = options.quote ? 2 : 1;
  const paragraphStart = document.firstChild!.nodeSize + 1;
  const plugins = HeadingEndSelection.config.addProseMirrorPlugins!.call({} as never) as Plugin[];
  let state = EditorState.create({
    schema,
    doc: document,
    plugins: [...plugins, history()],
    selection: TextSelection.create(document, headingStart + Math.min(2, heading.content.size)),
  });
  const headingElement = new HeadingElement();
  const editorElement = new HeadingElement();
  headingElement.parentElement = editorElement;
  const text = { nodeType: 3, textContent: content, data: content, length: content.length };
  const paragraphText = { nodeType: 3 };
  const outsideText = { nodeType: 3 };
  headingElement.childNodes = [text];
  let nativeAnchor = headingStart + Math.min(2, heading.content.size),
    nativeHead = nativeAnchor;
  let nativeOutside = false,
    failMapping = false;
  let editable = true,
    focused = true,
    destroyed = false,
    composing = false;
  let nextDispatch: ((transaction: Transaction) => void) | undefined;
  let dispatches = 0;
  const layout = options.layout ?? "unverified";
  const nativeNode = (position: number) => (position < paragraphStart ? text : paragraphText);
  const nativeOffset = (position: number) => position - (position < paragraphStart ? headingStart : paragraphStart);
  const native = () => ({
    isCollapsed: nativeAnchor === nativeHead,
    anchorNode: nativeOutside ? outsideText : nativeNode(nativeAnchor),
    focusNode: nativeOutside ? outsideText : nativeNode(nativeHead),
    anchorOffset: nativeOffset(nativeAnchor),
    focusOffset: nativeOffset(nativeHead),
  });
  const style = {
    writingMode: "horizontal-tb",
    direction: "ltr",
    unicodeBidi: "normal",
    transform: "none",
    display: "block",
    columnCount: "auto",
    columnWidth: "auto",
    lineHeight: "20px",
    fontSize: "16px",
    position: "static",
    cssFloat: "none",
    rotate: "none",
    scale: "none",
    translate: "none",
    getPropertyValue: () => "none",
  };
  const coords = (position: number, side = 1) => {
    const offset = position - headingStart;
    const second = layout === "wrapped" && (offset > 5 || (offset === 5 && side > 0));
    return { left: offset * 10, right: offset * 10, top: second ? 20 : 0, bottom: second ? 40 : 20 };
  };
  const dispatch = (transaction: Transaction) => {
    dispatches++;
    const hook = nextDispatch;
    nextDispatch = undefined;
    if (hook) return hook(transaction);
    state = state.apply(transaction);
    nativeAnchor = state.selection.anchor;
    nativeHead = state.selection.head;
  };
  const view = {
    get state() {
      return state;
    },
    get editable() {
      return editable;
    },
    get isDestroyed() {
      return destroyed;
    },
    get composing() {
      return composing;
    },
    hasFocus: () => focused,
    dom: {
      contains: (node: unknown) => node === text || node === paragraphText,
      getRootNode() {
        return this.ownerDocument;
      },
      ownerDocument: {
        getSelection: native,
        defaultView: { HTMLElement: HeadingElement, Element: HeadingElement, getComputedStyle: () => style },
        createRange: () => ({
          selectNodeContents: () => {},
          setStart: () => {},
          setEnd: () => {},
          getClientRects: () => [
            { left: 0, right: 100, top: 0, bottom: 20, width: 100, height: 20 },
            ...(layout === "wrapped" ? [{ left: 0, right: 100, top: 20, bottom: 40, width: 100, height: 20 }] : []),
          ],
          cloneRange: () => {
            let atStart = false;
            return {
              collapse: (value: boolean) => {
                atStart = value;
              },
              getBoundingClientRect: () => ({ left: atStart ? 0 : 100, top: 0, width: 0, height: 20 }),
            };
          },
        }),
      },
    },
    domAtPos: (position: number) => ({ node: text, offset: position - headingStart }),
    posAtDOM: (node: unknown, offset: number) => {
      if (failMapping) throw new Error("选区映射已失效");
      return (node === text ? headingStart : paragraphStart) + offset;
    },
    nodeDOM: () => (layout === "unverified" ? null : headingElement),
    coordsAtPos: coords,
    focus: () => {
      nativeAnchor = state.selection.anchor;
      nativeHead = state.selection.head;
    },
    dispatch,
  } as unknown as EditorView;

  return {
    view,
    headingStart,
    paragraphStart,
    coords,
    dispatchCount: () => dispatches,
    press(key: string, shifted = false, overrides: Partial<KeyboardEvent> = {}) {
      let prevented = false;
      const event = {
        key,
        shiftKey: shifted,
        isTrusted: true,
        get defaultPrevented() {
          return prevented;
        },
        getModifierState: () => false,
        preventDefault: () => {
          prevented = true;
        },
        ...overrides,
      } as unknown as KeyboardEvent;
      const handled = plugins.some((plugin) => plugin.props.handleKeyDown?.call(plugin, view, event));
      return { handled, prevented };
    },
    select(anchor: number, head = anchor) {
      state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, anchor, head)));
      nativeAnchor = anchor;
      nativeHead = head;
    },
    nativeSelect(anchor: number, head = anchor) {
      nativeAnchor = anchor;
      nativeHead = head;
    },
    rejectNext() {
      nextDispatch = () => {};
    },
    replaceNext(doc: ProseMirrorNode) {
      nextDispatch = () => {
        state = EditorState.create({ schema, doc, plugins });
      };
    },
    redirectNext(position: number) {
      nextDispatch = () => {
        state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, position)));
      };
    },
    setEditable(value: boolean) {
      editable = value;
    },
    setFocused(value: boolean) {
      focused = value;
    },
    setDestroyed(value: boolean) {
      destroyed = value;
    },
    setComposing(value: boolean) {
      composing = value;
    },
    setOutside() {
      nativeOutside = true;
    },
    failMapping() {
      failMapping = true;
    },
  };
}

test.each([
  ["Home", false],
  ["Home", true],
  ["End", true],
] as const)("标题行位置无法验证时，%s（Shift=%s）不再回放到越界删除", (key, shifted) => {
  const h = createHarness();
  const initial = h.view.state.selection;
  const result = h.press(key, shifted);
  // 回放已有记录中默认处理跨到后文的结果，使用真实事务执行随后删除。
  if (!result.handled && !result.prevented)
    h.view.dispatch(
      h.view.state.tr.setSelection(TextSelection.create(h.view.state.doc, 1, h.view.state.doc.content.size - 1)),
    );
  h.view.dispatch(h.view.state.tr.deleteSelection());
  expect(h.view.state.doc.lastChild?.textContent).toBe("必须保留的后文");
  expect(h.view.state.selection.eq(initial)).toBe(true);
  expect(result).toEqual({ handled: true, prevented: true });
});

test.each([{ quote: true }, { hardBreak: true }, { content: "x".repeat(4097) }, { content: "abc\u202edef" }])(
  "无法验证的引用内、软换行、超长及双向标题保留选区：%j",
  (options) => {
    const h = createHarness(options);
    const before = h.view.state;
    expect(h.press("End", true)).toEqual({ handled: true, prevented: true });
    expect(h.view.state).toBe(before);
  },
);

test.each(["Home", "End"])("可验证的单行 %s 仍会按预期移动或扩选", (key) => {
  const h = createHarness({ layout: "single" });
  expect(h.press(key, key === "End").handled).toBe(true);
  expect(h.view.state.selection.anchor).toBe(key === "Home" ? 1 : 3);
  expect(h.view.state.selection.head).toBe(key === "Home" ? 1 : 11);
});

test.each(["Home", "End"])("已有单行文字选区按 Shift+%s 保留锚点并扩展到边缘", (key) => {
  const h = createHarness({ layout: "single" });
  h.select(4, 6);
  expect(h.press(key, true).prevented).toBe(true);
  expect(h.view.state.selection.anchor).toBe(4);
  expect(h.view.state.selection.head).toBe(key === "Home" ? 1 : 11);
});

test.each(["reject", "replace", "redirect"] as const)("Shift+Home 事务被宿主 %s 后不再执行默认扩选", (mode) => {
  const h = createHarness();
  const original = h.view.state;
  const replacement = schema.node("doc", null, schema.node("paragraph", null, schema.text("宿主新文档")));
  const prepare = rstest.spyOn(HeadingHomeLineEvidence.prototype, "prepare").mockReturnValue({
    document: original.doc,
    headingPos: 0,
    source: 3,
    start: 2,
    end: 11,
    before: h.coords(1),
    after: h.coords(2),
  });
  try {
    if (mode === "reject") h.rejectNext();
    else if (mode === "replace") h.replaceNext(replacement);
    else h.redirectNext(h.paragraphStart);
    expect(h.press("Home", true)).toEqual({ handled: true, prevented: true });
    expect(h.dispatchCount()).toBe(1);
    if (mode === "reject") expect(h.view.state).toBe(original);
    else if (mode === "replace") expect(h.view.state.doc).toBe(replacement);
    else expect(h.view.state.selection.anchor).toBe(h.paragraphStart);
  } finally {
    prepare.mockRestore();
  }
});

test.each(["reject", "replace", "redirect"] as const)(
  "多行非空选区的 Shift+End 被宿主 %s 后不再执行默认扩选",
  (mode) => {
    const h = createHarness({ layout: "wrapped" });
    h.select(7, 8);
    const before = h.view.state;
    const replacement = schema.node("doc", null, schema.node("paragraph", null, schema.text("宿主新文档")));
    if (mode === "reject") h.rejectNext();
    else if (mode === "replace") h.replaceNext(replacement);
    else h.redirectNext(h.paragraphStart);
    expect(h.press("End", true)).toEqual({ handled: true, prevented: true });
    expect(h.dispatchCount()).toBe(1);
    if (mode === "reject") expect(h.view.state).toBe(before);
    else if (mode === "replace") expect(h.view.state.doc).toBe(replacement);
    else expect(h.view.state.selection.anchor).toBe(h.paragraphStart);
  },
);

test.each(["Home", "End"])("已提交的跨块选区与旧 DOM 光标不同时，Shift+%s 保留宿主选区", (key) => {
  const h = createHarness({ layout: "single" });
  h.select(2, h.paragraphStart + 2);
  const before = h.view.state;
  h.nativeSelect(4);
  expect(h.press(key, true)).toEqual({ handled: true, prevented: true });
  expect(h.view.state).toBe(before);
  expect(h.dispatchCount()).toBe(0);
});

test("无法核实的正文和跨块行选区保留当前范围", () => {
  const h = createHarness();
  h.nativeSelect(h.paragraphStart + 1);
  expect(h.press("End", true)).toEqual({ handled: true, prevented: true });
  h.select(2, h.paragraphStart + 2);
  const before = h.view.state;
  expect(h.press("End", true)).toEqual({ handled: true, prevented: true });
  expect(h.view.state).toBe(before);
  expect(h.dispatchCount()).toBe(0);
});

test("无法核实跨标题选区的 Shift+Home 时保留原范围", () => {
  const h = createHarness();
  h.select(2, h.paragraphStart + 2);
  const before = h.view.state;
  expect(h.press("Home", true)).toEqual({ handled: true, prevented: true });
  expect(h.view.state).toBe(before);
  expect(h.dispatchCount()).toBe(0);
});

test.each([
  { metaKey: true },
  { ctrlKey: true },
  { altKey: true },
  { isComposing: true },
  { keyCode: 229 },
  { isTrusted: false },
  { getModifierState: () => true },
])("回退保护保留其他组合键和输入法行为：%j", (overrides) => {
  const h = createHarness();
  expect(h.press("End", true, overrides)).toEqual({ handled: false, prevented: false });
});

test.each(["readonly", "blurred", "destroyed", "composing", "outside"])(
  "回退保护不干预无效或非本实例输入：%s",
  (mode) => {
    const h = createHarness();
    if (mode === "readonly") h.setEditable(false);
    if (mode === "blurred") h.setFocused(false);
    if (mode === "destroyed") h.setDestroyed(true);
    if (mode === "composing") h.setComposing(true);
    if (mode === "outside") h.setOutside();
    expect(h.press("End", true)).toEqual({ handled: false, prevented: false });
  },
);

test("当前选区无法映射时停止该次行扩选并保留文档", () => {
  const h = createHarness();
  const before = h.view.state;
  h.failMapping();
  expect(h.press("End", true)).toEqual({ handled: true, prevented: true });
  expect(h.view.state).toBe(before);
});

test("空标题中的行选择保持空标题和后续正文", () => {
  const h = createHarness({ content: "" });
  const before = h.view.state;
  expect(h.press("Home")).toEqual({ handled: true, prevented: true });
  expect(h.press("End", true)).toEqual({ handled: true, prevented: true });
  expect(h.view.state).toBe(before);
  expect(h.view.state.doc.firstChild?.type.name).toBe("heading");
  expect(h.view.state.doc.lastChild?.textContent).toBe("必须保留的后文");
});

test.each([1, 6])("无法验证的 H%s 仍保留已有选区，删除与撤销仅影响所选标题文字", (level) => {
  const h = createHarness({ level });
  h.select(2, 5);
  const original = h.view.state.doc;
  expect(h.press("End", true)).toEqual({ handled: true, prevented: true });
  expect(h.view.state.selection.from).toBe(2);
  expect(h.view.state.selection.to).toBe(5);
  h.view.dispatch(h.view.state.tr.deleteSelection());
  expect(h.view.state.doc.firstChild?.attrs.level).toBe(level);
  expect(h.view.state.doc.lastChild?.textContent).toBe("必须保留的后文");
  expect(undo(h.view.state, (tr) => h.view.dispatch(tr))).toBe(true);
  expect(h.view.state.doc.eq(original)).toBe(true);
  expect(redo(h.view.state, (tr) => h.view.dispatch(tr))).toBe(true);
  expect(h.view.state.doc.lastChild?.textContent).toBe("必须保留的后文");
});

test("回退保护不新增历史事件；随后编辑的撤销重做与其他实例独立", () => {
  const first = createHarness();
  const second = createHarness();
  const original = first.view.state.doc;
  first.press("End", true);
  expect(undo(first.view.state, (tr) => first.view.dispatch(tr))).toBe(false);
  first.view.dispatch(first.view.state.tr.insertText("新"));
  expect(undo(first.view.state, (tr) => first.view.dispatch(tr))).toBe(true);
  expect(first.view.state.doc.eq(original)).toBe(true);
  expect(redo(first.view.state, (tr) => first.view.dispatch(tr))).toBe(true);
  expect(first.view.state.doc.textContent).toContain("新");
  expect(second.view.state.doc.eq(original)).toBe(true);
});
