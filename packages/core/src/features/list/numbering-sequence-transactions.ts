import { closeHistory, isHistoryTransaction } from "@tiptap/pm/history";
import { Fragment, Slice, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, type EditorState, type Transaction } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { markSequenceCopyHook } from "../../shared/clipboard-hooks";
import { isHeadingNumberingClipboardSerializer } from "../heading/numbering-clipboard";
import { planNestedLegacyPlainPaste } from "./nested-legacy-plain-paste";
import {
  projectNumberingSequenceClipboard,
  projectNumberingSequenceMixedCopy,
  projectNumberingSequenceMixedCut,
  projectNumberingSequenceRootCopy,
  serializeSequenceCopyHeadingsHTML,
} from "./numbering-sequence-clipboard";
import {
  planEmptySequenceBackspace,
  planSequenceContinuation,
  remapSequenceLinks,
} from "./numbering-sequence-continuation";
import {
  assertNumberingSequenceDocument,
  sequenceLists,
  sequenceLeaf,
  sequenceMemberAttribute,
  sequenceRegistryAttribute,
} from "./numbering-sequence-document";
import { planNumberingSequencePaste, planNumberingSequencePlainPaste } from "./numbering-sequence-paste";
import type { MaterializedNumberingSequences } from "./numbering-sequences";
import { serializeOrderedListStyles } from "./ordered-style";
import { serializeOrderedListOrdinals } from "./ordinals";

const operationMeta = "semloEditorNumberingSequenceOperation";

export function markSequenceOperation(tr: Transaction): Transaction {
  return tr.setMeta(operationMeta, true);
}

/** 只更新权威序列数据，保留旧字段供旧内容检查；旧 bool 不再参与 v1 计数。 */
export function applySequencePlan(tr: Transaction, listPos: number, plan: MaterializedNumberingSequences): Transaction {
  const list = tr.doc.nodeAt(listPos)!;
  tr.setNodeMarkup(listPos, undefined, { ...list.attrs, [sequenceRegistryAttribute]: plan.registry });
  list.forEach((item, offset, index) => {
    tr.setNodeMarkup(listPos + 1 + offset, undefined, {
      ...item.attrs,
      [sequenceMemberAttribute]: plan.sequenceIds[index],
    });
  });
  return markSequenceOperation(tr);
}

export { sequenceLeaf } from "./numbering-sequence-document";

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const items = (list: ProseMirrorNode) => {
  const result: ProseMirrorNode[] = [];
  list.forEach((item) => result.push(item));
  return result;
};

function sameListAttrs(before: ProseMirrorNode, after: ProseMirrorNode): boolean {
  // 样式是表现属性，不能在修改样式时重建或重新解释序列身份。
  const attrs = (node: ProseMirrorNode) => ({ ...node.attrs, semloEditorOrderedStyle: null, type: null });
  return before.type === after.type && equal(attrs(before), attrs(after));
}

function sameMember(before: ProseMirrorNode, after: ProseMirrorNode): boolean {
  return (
    before.type
      .create(
        { ...before.attrs, semloEditorListFolded: after.attrs.semloEditorListFolded },
        before.content,
        before.marks,
      )
      .sameMarkup(after) &&
    before.childCount === after.childCount &&
    before.firstChild?.type === after.firstChild?.type
  );
}

function permittedListEdit(before: ProseMirrorNode, after: ProseMirrorNode): boolean {
  if (!sameListAttrs(before, after)) return false;
  const oldItems = items(before),
    nextItems = items(after);
  if (oldItems.length === nextItems.length) return oldItems.every((item, index) => sameMember(item, nextItems[index]));
  if (nextItems.length === oldItems.length + 1) {
    // 块下方插入及写作回填可直接新增完整正文；源叶项和其余成员必须原样保留。
    const insertedSibling = nextItems.some((candidate, index) => {
      if (
        index === 0 ||
        !sequenceLeaf(before, index - 1) ||
        candidate.childCount !== 1 ||
        candidate.firstChild?.type.name !== "paragraph"
      )
        return false;
      const source = oldItems[index - 1];
      const attrs = (node: ProseMirrorNode) => ({ ...node.attrs, semloEditorListRestart: false });
      return (
        equal(attrs(source), attrs(candidate)) &&
        oldItems.every((item, oldIndex) => item.eq(nextItems[oldIndex < index ? oldIndex : oldIndex + 1]))
      );
    });
    if (insertedSibling) return true;
    // Enter 只允许把一个叶段落拆成两个同序列成员，不能借此改变层级或丢失正文/marks。
    return oldItems.some((item, index) => {
      if (!sequenceLeaf(before, index)) return false;
      const left = nextItems[index],
        right = nextItems[index + 1];
      const attrs = (node: ProseMirrorNode) => ({ ...node.attrs, semloEditorListRestart: false });
      return (
        left?.firstChild?.type === item.firstChild?.type &&
        right?.firstChild?.type === item.firstChild?.type &&
        left.childCount === 1 &&
        right.childCount === 1 &&
        equal(attrs(item), attrs(left)) &&
        equal(attrs(item), attrs(right)) &&
        item.firstChild!.content.eq(left.firstChild!.content.append(right.firstChild!.content)) &&
        oldItems.every(
          (other, oldIndex) => oldIndex === index || other.eq(nextItems[oldIndex < index ? oldIndex : oldIndex + 1]),
        )
      );
    });
  }
  if (nextItems.length === oldItems.length - 1)
    return oldItems.some(
      (_item, index) =>
        sequenceLeaf(before, index) &&
        nextItems.every((item, nextIndex) => item.eq(oldItems[nextIndex < index ? nextIndex : nextIndex + 1])),
    );
  return false;
}

function preservesSequences(tr: Transaction, state: EditorState): boolean {
  for (const { node, pos } of sequenceLists(state.doc)) {
    let mapped = tr.mapping.mapResult(pos, -1);
    let next = tr.doc.nodeAt(mapped.pos);
    if (!mapped.deletedAcross && (!next || next.type !== node.type)) {
      // 相邻正文包裹为列表会在边界插入闭合标记；仅在另一侧仍是完整原列表时采用正向映射。
      const forward = tr.mapping.mapResult(pos, 1);
      const candidate = tr.doc.nodeAt(forward.pos);
      if (!forward.deletedAcross && candidate?.eq(node)) {
        mapped = forward;
        next = candidate;
      }
    }
    if (mapped.deletedAcross || !next || next.type !== node.type) {
      if (state.selection.from <= pos && state.selection.to >= pos + node.nodeSize) continue;
      return false;
    }
    if (!permittedListEdit(node, next)) return false;
    // 物理列表被移入引用、标题或其他容器也属于尚未核验的结构操作。
    const beforePath = state.doc.resolve(pos),
      afterPath = tr.doc.resolve(mapped.pos);
    if (beforePath.depth !== afterPath.depth) return false;
    for (let depth = 0; depth <= beforePath.depth; depth++)
      if (beforePath.node(depth).type !== afterPath.node(depth).type) return false;
  }
  return true;
}

function partialSequenceTarget(state: EditorState): boolean {
  const { from, to } = state.selection;
  return sequenceLists(state.doc).some(
    ({ node, pos }) => from < pos + node.nodeSize && to > pos && !(from <= pos && to >= pos + node.nodeSize),
  );
}

const reservedPasteAttributes = new Set([
  "data-semlo-editor-list-sequence-conversion",
  "data-semlo-editor-list-sequences",
  "data-semlo-editor-list-sequence",
  "data-semlo-editor-list-sequence-link",
  "data-semlo-editor-list-restart",
  "data-semlo-editor-list-level-starts",
  "data-semlo-editor-ordered-ancestor-path",
  "data-semlo-editor-list-first-continue",
  "data-semlo-editor-list-quote-chain",
  "data-semlo-editor-list-task-chain",
]);
const pasteInlineTags = new Set([
  "A",
  "SPAN",
  "STRONG",
  "B",
  "EM",
  "I",
  "U",
  "S",
  "DEL",
  "STRIKE",
  "CODE",
  "MARK",
  "SUP",
  "SUB",
  "BR",
]);

/** 解析前检查保留字段，避免未知/错位身份被schema丢弃后冒充普通片段。 */
function rawSequencePaste(html: string, document: Document): "inline" | "list" | "reject" | { nativeStart: number } {
  const template = document.createElement("template");
  template.innerHTML = html;
  const elements = [...template.content.querySelectorAll("*")];
  if (
    elements.some((element) =>
      [...element.attributes].some((attribute) => reservedPasteAttributes.has(attribute.name.toLowerCase())),
    )
  )
    return "reject";
  if (!template.content.querySelector("ol")) return "inline";
  const meaningful = (parent: ParentNode) =>
    [...parent.childNodes].filter((node) => node.nodeType === 1 || (node.nodeType === 3 && !!node.textContent?.trim()));
  const roots = meaningful(template.content);
  const list = template.content.querySelector("ol")!;
  const native =
    roots.length === 2 &&
    roots[0].nodeType === 1 &&
    (roots[0] as Element).tagName === "NE-CLIPBOARD" &&
    meaningful(roots[0] as Element).length === 0 &&
    roots[1].nodeType === 1 &&
    (roots[1] as Element).tagName === "DIV" &&
    (roots[1] as Element).classList.contains("lake-content") &&
    meaningful(roots[1] as Element).length === 1 &&
    meaningful(roots[1] as Element)[0] === list;
  if (!native && (roots.length !== 1 || roots[0] !== list)) return "reject";
  const start = list.getAttribute("start");
  const nativeStart = start === null ? 1 : Number(start);
  if (
    start !== null &&
    (native
      ? !/^[1-9]\d*$/.test(start.trim()) || !Number.isSafeInteger(nativeStart) || nativeStart > 2_147_483_647
      : !/^[+]?0*1$/.test(start.trim()))
  )
    return "reject";
  const style = list.getAttribute("data-semlo-editor-ordered-style"),
    type = list.getAttribute("type");
  if (style !== null && !["mixed", "decimal", "chinese"].includes(style)) return "reject";
  if (type !== null && !["1", "a", "A", "i", "I"].includes(type)) return "reject";
  for (const element of elements) {
    const indent = element.getAttribute("data-semlo-editor-list-indent");
    if (
      indent !== null &&
      (element.tagName !== "LI" ||
        !indent.trim() ||
        !Number.isInteger(Number(indent)) ||
        Number(indent) < 0 ||
        Number(indent) > 8)
    )
      return "reject";
    const context = element.getAttribute("data-pm-slice");
    if (context !== null && (element !== list || !/^0 0 \[\s*\]$/.test(context))) return "reject";
  }
  for (const child of meaningful(list)) {
    if (child.nodeType !== 1 || (child as Element).tagName !== "LI") return "reject";
    const blocks = meaningful(child as Element);
    if (native) {
      if (
        blocks.some(
          (block) =>
            block.nodeType === 1 &&
            (!pasteInlineTags.has((block as Element).tagName) ||
              [...(block as Element).querySelectorAll("*")].some((element) => !pasteInlineTags.has(element.tagName))),
        )
      )
        return "reject";
    } else {
      if (blocks.length !== 1 || blocks[0].nodeType !== 1 || (blocks[0] as Element).tagName !== "P") return "reject";
      if ([...(blocks[0] as Element).querySelectorAll("*")].some((element) => !pasteInlineTags.has(element.tagName)))
        return "reject";
    }
  }
  return native ? { nativeStart } : "list";
}

/** 语雀标准 HTML 的开放片段保留来源起始值；目标列表使用自己的编号。 */
function normalizeNativeListSlice(slice: Slice, start: number): Slice | null {
  if (slice.openStart !== 3 || slice.openEnd !== 3 || slice.content.childCount !== 1) return null;
  const list = slice.content.firstChild;
  if (!list || list.type.name !== "orderedList" || list.attrs.start !== start) return null;
  const normalized = list.type.create({ ...list.attrs, start: 1 }, list.content, list.marks);
  return new Slice(Fragment.from(normalized), 0, 0);
}

/** 最后一道事务边界：未接入的旧命令不能静默抹掉或重解释新格式。 */
export function numberingSequencePolicy(): Plugin {
  let pastes = new WeakMap<
    ClipboardEvent,
    { view: EditorView; state: EditorState; structure: boolean; nativeStart?: number }
  >();
  let parsedPastes = new WeakMap<EditorView, { state: EditorState; plain: boolean }>();
  let notice: HTMLElement | undefined;
  const clearNotice = () => {
    notice?.remove();
    notice = undefined;
  };
  const announce = (view: EditorView, text: string) => {
    clearNotice();
    if (view.isDestroyed || !view.dom.parentElement) return;
    notice = view.dom.ownerDocument.createElement("div");
    notice.className = "semlo-editor-list-clipboard-status";
    notice.setAttribute("role", "status");
    notice.setAttribute("aria-live", "polite");
    notice.textContent = text;
    view.dom.after(notice);
  };
  const clipboard = (view: EditorView, event: ClipboardEvent, cut: boolean): boolean => {
    const state = view.state,
      selection = state.selection;
    if (!sequenceLists(state.doc).length || selection.empty) return false;
    const { $from, $to } = selection;
    if ($from.sameParent($to) && $from.parent.isTextblock) return false;
    const touched = sequenceLists(state.doc).filter(
      ({ node, pos }) => selection.from < pos + node.nodeSize && selection.to > pos,
    );
    if (touched.every(({ node, pos }) => selection.from <= pos && selection.to >= pos + node.nodeSize)) return false;
    event.preventDefault();
    clearNotice();
    if (cut && !view.editable) {
      announce(view, "当前为只读状态，无法剪切");
      return true;
    }
    let commit: Transaction | null = null;
    try {
      const cutPlan =
        projectNumberingSequenceClipboard(state) ?? (cut ? projectNumberingSequenceMixedCut(state) : null);
      const projected =
        cutPlan ??
        (!cut ? (projectNumberingSequenceMixedCopy(state) ?? projectNumberingSequenceRootCopy(state)) : null);
      if (!projected) {
        announce(view, cut ? "暂不支持此范围的剪切" : "暂不支持此范围的复制");
        return true;
      }
      const data = event.clipboardData;
      if (!data) {
        announce(view, "无法写入剪贴板，原文已保留");
        return true;
      }
      const { dom } = view.serializeForClipboard(projected.slice);
      const doc = view.dom.ownerDocument;
      const orderedHtml = serializeOrderedListStyles(
        serializeOrderedListOrdinals(dom.innerHTML, doc, projected.root),
        doc,
        projected.root,
      );
      const customSerializer =
        Boolean(view.props.clipboardSerializer) ||
        Boolean(view.props.plugins?.some((plugin) => plugin.props.clipboardSerializer)) ||
        state.plugins.some(
          (plugin) =>
            plugin.props.clipboardSerializer &&
            !isHeadingNumberingClipboardSerializer(plugin.props.clipboardSerializer),
        );
      // 宿主提供了序列化器时，其标题输出优先；内置序列化器才补充源标题编号。
      const html = customSerializer
        ? orderedHtml
        : serializeSequenceCopyHeadingsHTML(orderedHtml, doc, projected.headings);
      if (html === null) {
        announce(view, "无法完成剪贴板操作，原文已保留");
        return true;
      }
      const current = () => !view.isDestroyed && view.state === state && (!cut || view.editable);
      // 序列化与剪贴板写入都可能触发宿主同步回调，状态变更后不能再提交预先计划的删除。
      if (!current()) return true;
      data.clearData();
      if (!current()) return true;
      data.setData("text/html", html);
      if (!current()) return true;
      data.setData("text/plain", projected.text);
      if (!current()) return true;
      if (data.getData("text/html") !== html || data.getData("text/plain") !== projected.text) {
        announce(view, "无法写入剪贴板，原文已保留");
        return true;
      }
      if (!current()) return true;
      if (cut && cutPlan) commit = cutPlan.cut;
    } catch {
      announce(view, "无法完成剪贴板操作，原文已保留");
      return true;
    }
    if (commit && !view.isDestroyed && view.state === state && view.editable) {
      const tr = closeHistory(markSequenceOperation(commit)).setMeta("uiEvent", "cut").scrollIntoView();
      view.dispatch(tr);
      if (!view.isDestroyed && view.state.doc === tr.doc)
        view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
    }
    return true;
  };
  const capturePaste = (view: EditorView, event: ClipboardEvent) => {
    if (event.defaultPrevented || view.isDestroyed || !partialSequenceTarget(view.state)) return;
    const state = view.state;
    const current = () =>
      !view.isDestroyed && view.dom.isConnected && view.state === state && view.editable && !view.composing;
    try {
      const data = event.clipboardData;
      if (!data) throw new Error("missing-clipboard");
      // 文件粘贴属于已有上传/宿主入口，不能因没有HTML/plain而被列表预检抢占。
      if (data.files.length) return;
      const types = [...data.types].map((type) => type.toLowerCase());
      if (types.length && !types.some((type) => ["text/html", "text/plain", "text"].includes(type))) return;
      const html = data.getData("text/html"),
        text = data.getData("text/plain");
      if (!html && !text && types.some((type) => !["text/html", "text/plain", "text"].includes(type))) return;
      if (!current()) throw new Error("stale-paste");
      const raw = rawSequencePaste(html, view.dom.ownerDocument);
      if (!current() || (!html && !text) || raw === "reject") throw new Error("unsupported-paste");
      pastes.set(event, {
        view,
        state,
        structure: raw === "list" || typeof raw === "object",
        ...(typeof raw === "object" ? raw : {}),
      });
    } catch {
      event.preventDefault();
      announce(view, "无法安全粘贴列表，当前内容已保留");
    }
  };
  const commitPaste = (view: EditorView, transaction: Transaction) => {
    try {
      const tr = closeHistory(markSequenceOperation(transaction))
        .setMeta("paste", true)
        .setMeta("uiEvent", "paste")
        .scrollIntoView();
      view.dispatch(tr);
      if (!view.isDestroyed && view.dom.isConnected && view.state.doc === tr.doc)
        view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
      else announce(view, "列表粘贴已中断，请检查当前内容");
    } catch {
      announce(view, "列表粘贴处理被中断，请检查当前内容");
    }
  };
  const paste = (view: EditorView, event: ClipboardEvent, slice: Slice): boolean => {
    const captured = pastes.get(event);
    pastes.delete(event);
    const parsed = parsedPastes.get(view);
    parsedPastes.delete(view);
    let hasList = false;
    slice.content.descendants((node) => {
      if (node.type.name === "orderedList") hasList = true;
    });
    const origin = captured?.state ?? parsed?.state;
    if (parsed?.plain && !hasList && slice.content.childCount > 1 && origin && !partialSequenceTarget(origin)) {
      const transaction = planNestedLegacyPlainPaste(origin, slice);
      if (transaction) {
        clearNotice();
        if (view.isDestroyed || !view.dom.isConnected || view.state !== origin || !view.editable || view.composing)
          announce(view, "列表粘贴已中断，当前内容已保留");
        else commitPaste(view, transaction);
        return true;
      }
    }
    if (parsed?.plain && !hasList && slice.content.childCount > 1 && origin && partialSequenceTarget(origin)) {
      clearNotice();
      const current = () =>
        (!captured || captured.view === view) &&
        parsed.state === origin &&
        !view.isDestroyed &&
        view.dom.isConnected &&
        view.state === origin &&
        view.editable &&
        !view.composing;
      if (!current()) {
        announce(view, "列表粘贴已中断，当前内容已保留");
        return true;
      }
      const plan = planNumberingSequencePlainPaste(origin, slice);
      if (plan.kind !== "apply" || !current()) {
        announce(view, "暂不支持此列表粘贴范围或格式，当前内容已保留");
        return true;
      }
      commitPaste(view, plan.transaction);
      return true;
    }
    if (!hasList && !captured?.structure) return false;
    if (!captured && !partialSequenceTarget(view.state)) return false;
    clearNotice();
    const current = () =>
      captured?.view === view &&
      !view.isDestroyed &&
      view.dom.isConnected &&
      view.state === captured.state &&
      view.editable &&
      !view.composing;
    if (!captured?.structure || !current()) {
      announce(view, "列表粘贴已中断，当前内容已保留");
      return true;
    }
    const candidate =
      captured.nativeStart === undefined ? slice : normalizeNativeListSlice(slice, captured.nativeStart);
    const plan = candidate ? planNumberingSequencePaste(captured.state, candidate) : null;
    if (!plan || plan.kind !== "apply" || !current()) {
      announce(view, "暂不支持此列表粘贴范围或格式，当前内容已保留");
      return true;
    }
    commitPaste(view, plan.transaction);
    return true;
  };
  const plugin = new Plugin({
    filterTransaction(tr, state) {
      if (!tr.docChanged) return true;
      try {
        assertNumberingSequenceDocument(tr.doc);
        if (!planSequenceContinuation(tr.doc, state.doc)) return false;
      } catch {
        return false;
      }
      if (tr.getMeta(operationMeta) || tr.getMeta("preventUpdate") || isHistoryTransaction(tr)) return true;
      return preservesSequences(tr, state);
    },
    appendTransaction(transactions, oldState, state) {
      if (!transactions.some((transaction) => transaction.docChanged)) return null;
      const updates = planSequenceContinuation(state.doc, oldState.doc);
      if (!updates?.length) return null;
      const tr = markSequenceOperation(state.tr);
      for (const { pos, node } of updates) tr.setNodeMarkup(pos, undefined, node.attrs, node.marks);
      return tr;
    },
    view(view) {
      // 原生捕获先于PM解析和宿主变换；事件局部归属不依赖“最近一次粘贴”缓存。
      const capture = (event: Event) => capturePaste(view, event as ClipboardEvent);
      view.dom.addEventListener("paste", capture, true);
      return {
        update(view, previous) {
          if (view.state !== previous) clearNotice();
        },
        destroy() {
          view.dom.removeEventListener("paste", capture, true);
          pastes = new WeakMap();
          parsedPastes = new WeakMap();
          clearNotice();
        },
      };
    },
    props: {
      handlePaste: paste,
      handleKeyDown(view, event) {
        if (
          event.key !== "Backspace" ||
          event.defaultPrevented ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          event.isComposing ||
          view.composing ||
          view.isDestroyed ||
          !view.dom.isConnected ||
          !view.editable
        )
          return false;
        const transaction = planEmptySequenceBackspace(view.state);
        if (!transaction) return false;
        const tr = closeHistory(markSequenceOperation(transaction)).scrollIntoView();
        view.dispatch(tr);
        if (!view.isDestroyed && view.dom.isConnected && view.state.doc === tr.doc)
          view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
        return true;
      },
      transformPasted(slice, view, plain) {
        parsedPastes.set(view, { state: view.state, plain });
        return remapSequenceLinks(slice, view.state.doc);
      },
      handleDOMEvents: {
        copy: (view, event) => clipboard(view, event, false),
        cut: (view, event) => clipboard(view, event, true),
      },
      transformCopied(slice, view) {
        const { $from, $to } = view.state.selection;
        if (
          $from.sameParent($to) &&
          $from.parent.isTextblock &&
          sequenceLists(view.state.doc).some(({ node, pos }) => $from.pos > pos && $to.pos < pos + node.nodeSize)
        ) {
          // 单段文字复制没有成员身份；去掉由开放 slice 自动补出的列表壳。
          const content = $from.parent.content.cut($from.parentOffset, $to.parentOffset);
          return new Slice(content, 0, 0);
        }
        return remapSequenceLinks(slice, view.state.doc);
      },
    },
  });
  if (plugin.props.handleDOMEvents) markSequenceCopyHook(plugin.props.handleDOMEvents);
  if (plugin.props.transformCopied) markSequenceCopyHook(plugin.props.transformCopied);
  return plugin;
}
