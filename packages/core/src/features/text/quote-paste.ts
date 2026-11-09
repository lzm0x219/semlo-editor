import { Extension } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, Slice, type Mark, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, PluginKey, TextSelection, type Transaction } from "@tiptap/pm/state";
import { CellSelection } from "@tiptap/pm/tables";
import type { EditorView } from "@tiptap/pm/view";

import { slashHistoryProbeKey } from "../insertion/keys";

export const clipboardSourceAttribute = "data-semlo-editor-clipboard";
const quotePasteHistoryKey = new PluginKey("semloEditorQuotePasteHistory");

function hasYuqueSource(fragment: DocumentFragment): boolean {
  for (const metadata of fragment.querySelectorAll("ne-clipboard[source]")) {
    const source = metadata.getAttribute("source");
    if (!source) continue;
    try {
      const host = new URL(decodeURIComponent(source)).hostname.toLowerCase();
      if (host === "yuque.com" || host.endsWith(".yuque.com")) return true;
    } catch {
      // 无效来源不具有保留结构化引用的含义，继续按外部 HTML 处理。
    }
  }
  return false;
}

function isYuqueEmptyParagraph(element: Element | undefined): element is HTMLElement {
  if (
    !element ||
    element.tagName !== "P" ||
    element.getAttribute("class") !== "ne-p" ||
    element.getAttributeNames().some((name) => !["id", "class", "style"].includes(name)) ||
    (element.hasAttribute("id") && !/^u[\da-f]{8}$/i.test(element.id)) ||
    element.childNodes.length !== 1
  )
    return false;
  const child = element.firstElementChild;
  if (
    !child ||
    child.tagName !== "SPAN" ||
    child.getAttribute("class") !== "ne-text" ||
    child.getAttributeNames().some((name) => name !== "class") ||
    child.childNodes.length !== 0
  )
    return false;
  const style = (element as HTMLElement).style;
  return Array.from(style).every((name) => {
    const value = style.getPropertyValue(name);
    if (style.getPropertyPriority(name)) return false;
    return /^(margin|padding)(?:-(top|right|bottom|left))?$/.test(name) && (value === "0" || value === "0px")
      ? true
      : name === "min-height" && value === "24px";
  });
}

type YuqueQuoteTarget = "empty" | "suffix" | "end" | null;

function isYuqueQuoteBoundarySlice(slice: Slice, target: Exclude<YuqueQuoteTarget, null>): boolean {
  const content = slice.content;
  if (!content.childCount) return false;
  const last = content.childCount - 1;
  const quoteIndex = target === "suffix" ? last - 1 : last;
  if (quoteIndex < 0 || ((target === "suffix" || target === "end") && quoteIndex === 0)) return false;
  const quote = content.child(quoteIndex);
  if (
    quote.type.name !== "blockquote" ||
    quote.childCount !== 1 ||
    quote.firstChild?.type.name !== "paragraph" ||
    slice.openEnd !== (target === "suffix" ? 1 : 2) ||
    slice.openStart !== (quoteIndex === 0 ? 2 : 1)
  )
    return false;
  if (target === "suffix" && (content.child(last).type.name !== "paragraph" || content.child(last).content.size !== 0))
    return false;
  for (let index = 0; index < quoteIndex; index++) {
    const paragraph = content.child(index);
    if (paragraph.type.name !== "paragraph" || paragraph.content.size !== 0) return false;
  }
  return true;
}

function applyQuoteBold(slice: Slice, target: Exclude<YuqueQuoteTarget, null>, bold: Mark | undefined): Slice {
  if (!bold) return slice;
  const quoteIndex = slice.content.childCount - (target === "suffix" ? 2 : 1);
  const quote = slice.content.child(quoteIndex);
  const paragraph = quote.firstChild!;
  if (!paragraph.type.allowsMarkType(bold.type)) return slice;
  const children: ProseMirrorNode[] = [];
  paragraph.forEach((node) => {
    const marks = bold.addToSet(node.marks);
    children.push(node.isText && node.marks.every((mark) => mark.isInSet(marks)) ? node.mark(marks) : node);
  });
  const blocks: ProseMirrorNode[] = [];
  slice.content.forEach((node, _offset, index) => {
    blocks.push(index === quoteIndex ? quote.copy(Fragment.from(paragraph.copy(Fragment.fromArray(children)))) : node);
  });
  return new Slice(Fragment.fromArray(blocks), slice.openStart, slice.openEnd);
}

function hasOnlyElementsAndWhitespace(parent: ParentNode): boolean {
  return Array.from(parent.childNodes).every(
    (node) => node.nodeType === 1 || (node.nodeType === 3 && !node.textContent?.trim()),
  );
}

function yuqueQuoteTarget(view: EditorView): YuqueQuoteTarget {
  const { selection } = view.state;
  const paragraph = selection.$from.parent;
  if (
    !(selection instanceof TextSelection) ||
    selection.$from.depth !== 1 ||
    !selection.$from.sameParent(selection.$to) ||
    paragraph.type.name !== "paragraph"
  )
    return null;
  try {
    if (!paragraph.sameMarkup(paragraph.type.create())) return null;
    if (selection.$from.parentOffset === 0 && selection.$to.parentOffset === paragraph.content.size) return "empty";
    if (selection.$to.parentOffset < paragraph.content.size) return "suffix";
    return selection.empty && paragraph.content.size > 0 ? "end" : null;
  } catch {
    // 自定义 schema 的默认属性不可用时，保留原始剪贴板内容。
    return null;
  }
}

function adjustYuqueQuoteBoundary(fragment: DocumentFragment, target: YuqueQuoteTarget): void {
  if (!target) return;
  if (fragment.querySelector(`[data-pm-slice],[${clipboardSourceAttribute}="1"]`)) return;
  const roots = Array.from(fragment.children);
  const contents = roots.filter((element) => element.tagName === "DIV" && element.classList.contains("lake-content"));
  if (
    contents.length !== 1 ||
    roots.some((element) => element !== contents[0] && (element.tagName !== "NE-CLIPBOARD" || element.hasChildNodes()))
  )
    return;
  if (!hasOnlyElementsAndWhitespace(fragment) || !hasOnlyElementsAndWhitespace(contents[0])) return;
  const blocks = Array.from(contents[0].children);
  if (!isYuqueEmptyParagraph(blocks[0])) return;
  let next = 1;
  while (isYuqueEmptyParagraph(blocks[next])) next++;
  if (next !== blocks.length - 1 || blocks[next]?.tagName !== "DIV" || !blocks[next].classList.contains("ne-quote"))
    return;
  const quote = blocks[next];
  if (
    quote.children.length !== 1 ||
    !hasOnlyElementsAndWhitespace(quote) ||
    quote.firstElementChild?.tagName !== "P" ||
    !quote.firstElementChild.classList.contains("ne-p") ||
    quote.querySelector("blockquote, div, ol, ul, table, img, video, audio, iframe")
  )
    return;
  if (target === "empty") blocks[0].remove();
  else if (target === "suffix") {
    // 开放的末段使目标文字后缀留在引用外；片段中其余空段仍保留。
    contents[0].appendChild(fragment.ownerDocument.createElement("p"));
  }
}

/** 按来源处理引用粘贴；不改变文档载入规则，也不读取语雀私有载荷。 */
export function normalizeExternalQuoteHTML(
  html: string,
  document: Document,
  preserveCellGrouping = false,
  target: YuqueQuoteTarget = null,
): string {
  if (!/<blockquote(?:\s|>)|\bne-quote\b/i.test(html)) return html;
  try {
    const template = document.createElement("template");
    template.innerHTML = html;
    if (hasYuqueSource(template.content)) {
      const quotes = Array.from(template.content.querySelectorAll("div.ne-quote"));
      if (!quotes.length) return html;
      // 仅修正语雀所测的前缀空段加引用；保留后续空段及其他来源。
      adjustYuqueQuoteBoundary(template.content, target);
      for (const quote of quotes) {
        const blockquote = document.createElement("blockquote");
        // 原生复制的可见 HTML 使用 div.ne-quote，按其嵌套关系转成 schema 可读的引用。
        while (quote.firstChild) blockquote.appendChild(quote.firstChild);
        quote.parentNode?.replaceChild(blockquote, quote);
      }
      return template.innerHTML;
    }
    if (template.content.querySelector(`[data-pm-slice],[${clipboardSourceAttribute}="1"]`)) return html;
    // 只保留表格处理器能识别的单个引用分组；表格内部的外部引用仍按正文规则展开。
    const roots = Array.from(template.content.children);
    if (
      preserveCellGrouping &&
      roots.length === 1 &&
      roots[0].tagName === "BLOCKQUOTE" &&
      Array.from(roots[0].children).every((block) => /^(P|H[1-6]|PRE)$/.test(block.tagName))
    )
      return html;
    const quotes = Array.from(template.content.querySelectorAll("blockquote"));
    if (!quotes.length) return html;
    for (const quote of quotes) {
      const parent = quote.parentNode;
      if (!parent) continue;
      // 挪动原有子节点，保留正文、标题、内联格式及列表层级。
      while (quote.firstChild) parent.insertBefore(quote.firstChild, quote);
      parent.removeChild(quote);
    }
    return template.innerHTML;
  } catch {
    // 解析失败时交回正常粘贴流程，避免以半处理的内容替换当前选区。
    return html;
  }
}

export const QuotePaste = Extension.create({
  name: "semloEditorQuotePaste",
  priority: 50,
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          transformPastedHTML(html, view) {
            return normalizeExternalQuoteHTML(
              html,
              view.dom.ownerDocument,
              view.state.selection instanceof CellSelection,
              yuqueQuoteTarget(view),
            );
          },
        },
      }),
    ];
  },
});

/** 让其他粘贴处理器先处理，仅为所测引用片段划定撤销边界。 */
export const QuotePasteHistory = Extension.create({
  name: "semloEditorQuotePasteHistory",
  priority: -1,
  addProseMirrorPlugins() {
    let pending: { transaction: Transaction; before: ProseMirrorNode; expected: ProseMirrorNode } | null = null;
    let continuation: { doc: ProseMirrorNode; position: number; insertAt: number; armed: boolean } | null = null;
    let plugin: Plugin;
    plugin = new Plugin({
      key: quotePasteHistoryKey,
      state: {
        init: () => null,
        apply(transaction, value) {
          if (continuation && transaction.getMeta(quotePasteHistoryKey) && transaction.doc === continuation.doc)
            continuation.armed = true;
          if (
            continuation &&
            !transaction.getMeta(quotePasteHistoryKey) &&
            (transaction.docChanged || transaction.selectionSet)
          )
            continuation = null;
          return value;
        },
      },
      props: {
        handleTextInput(view, from, to, text) {
          const candidate = continuation;
          continuation = null;
          const { state } = view;
          if (
            !candidate ||
            !candidate.armed ||
            !view.editable ||
            view.composing ||
            !text ||
            /[\r\n]/.test(text) ||
            from !== to ||
            state.doc !== candidate.doc ||
            !state.selection.empty ||
            state.selection.from !== from ||
            from !== candidate.position
          )
            return false;
          const paragraph = state.schema.nodes.paragraph;
          if (!paragraph) return false;
          let transaction: Transaction;
          try {
            const marks = state.storedMarks ?? state.selection.$from.marks();
            const block = paragraph.create(null, state.schema.text(text, paragraph.allowedMarks(marks)));
            const $insert = state.doc.resolve(candidate.insertAt);
            if ($insert.depth !== 0 || !$insert.parent.canReplaceWith($insert.index(), $insert.index(), paragraph))
              return false;
            transaction = state.tr.insert(candidate.insertAt, block);
            transaction.setSelection(TextSelection.create(transaction.doc, candidate.insertAt + 1 + text.length));
          } catch {
            // 自定义 schema 无法插入普通正文时保留默认输入行为。
            return false;
          }
          view.dispatch(transaction.scrollIntoView());
          return true;
        },
        handlePaste(view, event, slice) {
          const html = event.clipboardData?.getData("text/html");
          const target = yuqueQuoteTarget(view);
          if (!view.editable || event.defaultPrevented || !html || !target || !isYuqueQuoteBoundarySlice(slice, target))
            return false;
          const index = view.state.plugins.indexOf(plugin);
          // 斜杠探针只在撤销事务时追加处理，不影响粘贴历史分组。
          const slashHistoryProbe = slashHistoryProbeKey.get(view.state);
          if (
            index < 0 ||
            view.state.plugins
              .slice(index + 1)
              .some((other) => other.props.handlePaste || (other.spec.appendTransaction && other !== slashHistoryProbe))
          )
            return false;
          const document = view.dom.ownerDocument;
          const probeTarget = target === "end" ? "suffix" : target;
          if (
            normalizeExternalQuoteHTML(html, document, false, probeTarget) ===
            normalizeExternalQuoteHTML(html, document)
          )
            return false;
          let transaction: Transaction;
          try {
            const bold = view.state.storedMarks?.find((mark) => mark.type.name === "bold");
            transaction = closeHistory(view.state.tr).replaceSelection(applyQuoteBold(slice, target, bold));
          } catch {
            // 自定义 schema 无法安全构造粘贴事务时交回正常流程。
            return false;
          }
          const input = { transaction, before: view.state.doc, expected: transaction.doc };
          pending = input;
          queueMicrotask(() => {
            if (pending === input) pending = null;
          });
          view.dispatch(transaction.scrollIntoView().setMeta("paste", true).setMeta("uiEvent", "paste"));
          return true;
        },
      },
      appendTransaction(transactions, _oldState, newState) {
        const input = pending;
        if (!input) return null;
        const pasted = transactions.some(
          (transaction) =>
            transaction === input.transaction &&
            transaction.docChanged &&
            transaction.before === input.before &&
            transaction.doc.eq(input.expected) &&
            transaction.getMeta("uiEvent") === "paste" &&
            transaction.getMeta("paste") === true &&
            transaction.getMeta("addToHistory") !== false &&
            !transaction.getMeta("appendedTransaction"),
        );
        if (!pasted) return null;
        pending = null;
        const { selection } = newState;
        if (selection instanceof TextSelection && selection.empty) {
          const $from = selection.$from;
          const insertAt =
            $from.depth === 1 &&
            $from.parent.type.name === "paragraph" &&
            $from.parentOffset === 0 &&
            $from.index(0) > 0 &&
            newState.doc.child($from.index(0) - 1).type.name === "blockquote"
              ? $from.before(1)
              : $from.depth === 2 &&
                  $from.node(1).type.name === "blockquote" &&
                  $from.parentOffset === $from.parent.content.size
                ? $from.after(1)
                : null;
          if (insertAt !== null) continuation = { doc: newState.doc, position: selection.from, insertAt, armed: false };
        }
        // 所测粘贴与其后的输入分别撤销；宿主拒绝或替换事务时不修改历史。
        return closeHistory(newState.tr).setMeta("addToHistory", false).setMeta(quotePasteHistoryKey, true);
      },
    });
    return [plugin];
  },
});
