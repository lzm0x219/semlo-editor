import { Extension, type Editor } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

import { trackPopupPosition } from "../../platform/dom/dropdown";
import { linkPopup } from "../../platform/dom/popup-owner";
import {
  sequenceConversionHintAttribute,
  sequenceConversionHintHTMLAttribute,
} from "./numbering-sequence-conversion-hint";
import {
  hasNumberingSequences,
  numberingSequenceInput,
  resolveListNumbering,
  parseSequenceRegistryAttribute,
  sequenceRegistryAttribute,
  sequenceMemberAttribute,
  sequenceRegistryHTMLAttribute,
  sequenceMemberHTMLAttribute,
  sequenceLinkAttribute,
  sequenceLinkHTMLAttribute,
} from "./numbering-sequence-document";
import { applySequencePlan, numberingSequencePolicy } from "./numbering-sequence-transactions";
import { changeNumberingSequence } from "./numbering-sequences";
import { orderedListSuffixAttrs } from "./ordered-fragment";
import { setOrderedListStyle } from "./ordered-style";
import { openOrderedListStyleMenu, type OrderedListStyleChoice } from "./ordered-style-menu";
import { taskNumberChainAt, type TaskNumberChain } from "./task-number-chain";

type Target = {
  list: ProseMirrorNode;
  listPos: number;
  index: number;
  previous: ProseMirrorNode | null;
  previousPos: number;
  multilevel: boolean;
  hasRestarts: boolean;
  taskChain: TaskNumberChain | null;
  sequence?: { restart: boolean; continue: boolean };
  quoteChain: { previous: ProseMirrorNode; following: ProseMirrorNode; followingPos: number } | null;
};
type ListShape = {
  valid: boolean;
  multilevel: boolean;
  hasRestarts: boolean;
  flat: boolean;
  directChildren: boolean;
  twoParentShape: boolean;
  restartIndex: number;
  restartCount: number;
};
type TargetCache = {
  shapes: WeakMap<ProseMirrorNode, ListShape>;
  compatible: WeakMap<ProseMirrorNode, WeakMap<ProseMirrorNode, boolean>>;
};

function supportsFirstMode(list: ProseMirrorNode): boolean {
  return list.attrs.semloEditorOrderedStyle == null || list.attrs.semloEditorOrderedStyle === "mixed";
}

function listShape(list: ProseMirrorNode, cache?: WeakMap<ProseMirrorNode, ListShape>): ListShape {
  const cached = cache?.get(list);
  if (cached) return cached;
  const result: ListShape = {
    valid: true,
    multilevel: false,
    hasRestarts: false,
    flat: true,
    directChildren: true,
    twoParentShape: list.childCount === 4 || list.childCount === 5,
    restartIndex: -1,
    restartCount: 0,
  };
  list.forEach((child, _offset, index) => {
    if (child.attrs.semloEditorListRestart === true) {
      result.hasRestarts = true;
      result.restartIndex = index;
      result.restartCount++;
    }
    const indent = Number(child.attrs.semloEditorListIndent ?? 0);
    if (Number.isInteger(indent) && indent > 0 && indent <= 8) result.multilevel = true;
    const paragraph = child.childCount === 1 && child.firstChild?.type.name === "paragraph";
    if (!Number.isInteger(indent) || indent < 0 || indent > 8 || !paragraph) result.valid = false;
    if (indent !== 0 || !paragraph) result.flat = false;
    if (indent !== (index === 0 ? 0 : 1)) result.directChildren = false;
    if (indent !== (index === 0 || index === 2 ? 0 : 1)) result.twoParentShape = false;
  });
  cache?.set(list, result);
  return result;
}

function targetAt(doc: ProseMirrorNode, pos: number, cache?: TargetCache): Target | null {
  const $pos = doc.resolve(pos),
    item = $pos.nodeAfter,
    list = $pos.parent;
  if (!item || item.type.name !== "listItem" || list.type.name !== "orderedList") return null;
  let quoteChain: Target["quoteChain"] = null;
  if ($pos.depth === 2 && $pos.node(1).type.name === "blockquote" && $pos.node(1).childCount === 1) {
    const quotePos = $pos.before(1);
    const quote = $pos.node(1);
    const previous = doc.resolve(quotePos).nodeBefore;
    const followingPos = quotePos + quote.nodeSize;
    const following = doc.resolve(followingPos).nodeAfter;
    const eligible = (node: ProseMirrorNode | null) =>
      !!node &&
      node.type.name === "orderedList" &&
      (node.attrs.semloEditorOrderedStyle == null || node.attrs.semloEditorOrderedStyle === "mixed") &&
      node.attrs.semloEditorListLevelStarts == null &&
      node.attrs.semloEditorOrderedAncestorPath == null &&
      listShape(node, cache?.shapes).flat &&
      !listShape(node, cache?.shapes).hasRestarts;
    if (
      typeof list.attrs.semloEditorListQuoteChain !== "string" ||
      !list.attrs.semloEditorListQuoteChain ||
      previous?.attrs.semloEditorListQuoteChain !== list.attrs.semloEditorListQuoteChain ||
      following?.attrs.semloEditorListQuoteChain !== list.attrs.semloEditorListQuoteChain ||
      !eligible(previous) ||
      !eligible(following) ||
      list.childCount !== 1 ||
      (list.attrs.semloEditorOrderedStyle != null && list.attrs.semloEditorOrderedStyle !== "mixed")
    )
      return null;
    quoteChain = { previous: previous!, following: following!, followingPos };
  } else if ($pos.depth !== 1) return null;
  const listPos = $pos.before($pos.depth);
  if (hasNumberingSequences(list)) {
    const resolved = resolveListNumbering(list);
    // 原生菜单证据只覆盖直接子项，保留根级首项及深层结构的旧保护。
    if (
      $pos.depth !== 1 ||
      Number(item.attrs.semloEditorListIndent ?? 0) !== 1 ||
      !resolved.ok ||
      resolved.value.kind !== "v1"
    )
      return null;
    return {
      list,
      listPos,
      index: $pos.index(),
      previous: null,
      previousPos: listPos,
      multilevel: true,
      hasRestarts: true,
      quoteChain: null,
      taskChain: null,
      sequence: resolved.value.controls[$pos.index()],
    };
  }
  const taskChain =
    list.childCount === 1 && typeof list.attrs.semloEditorListTaskChain === "string"
      ? taskNumberChainAt(doc, listPos)
      : null;
  if (taskChain) {
    return {
      list,
      listPos,
      index: $pos.index(),
      previous: null,
      previousPos: listPos,
      multilevel: true,
      hasRestarts: item.attrs.semloEditorListRestart === true,
      quoteChain: null,
      taskChain,
    };
  }
  if (list.attrs.semloEditorListLevelStarts != null || list.attrs.semloEditorOrderedAncestorPath != null) return null;
  const { valid, multilevel, hasRestarts, directChildren, twoParentShape, restartIndex, restartCount } = listShape(
    list,
    cache?.shapes,
  );
  if (!valid) return null;
  // A single decimal parent and its direct children have a verified restart path.
  // Keep other group shapes unavailable until their boundary migrations are verified.
  if (multilevel || hasRestarts) {
    const index = $pos.index();
    const observedTwoParentTarget =
      twoParentShape &&
      index === list.childCount - 1 &&
      (list.childCount === 5 || (restartCount === 1 && restartIndex === index));
    const restartedItem = item.attrs.semloEditorListRestart === true;
    const observedSingleParentTarget =
      directChildren &&
      restartCount <= 2 &&
      ((index >= 2 && (restartCount < 2 || restartedItem)) || (index === 1 && restartedItem));
    const supportedTwoParentTarget =
      observedTwoParentTarget && restartCount <= 1 && (restartCount === 0 || restartIndex === index);
    if (
      list.attrs.semloEditorOrderedStyle !== "decimal" ||
      Number(list.attrs.start ?? 1) !== 1 ||
      list.attrs.semloEditorListFirstContinue === true ||
      (!observedSingleParentTarget && !supportedTwoParentTarget)
    )
      return null;
  }
  const $list = doc.resolve(listPos),
    previous = $list.nodeBefore;
  let compatible = false;
  if (previous?.type === list.type && !hasNumberingSequences(previous) && listShape(previous, cache?.shapes).flat) {
    const cached = cache?.compatible.get(list)?.get(previous);
    if (cached !== undefined) compatible = cached;
    else {
      const children: ProseMirrorNode[] = [];
      previous.forEach((child) => children.push(child));
      list.forEach((child) => children.push(child));
      const attrs = orderedListSuffixAttrs(previous, children, previous.childCount);
      compatible = previous.type
        .create({ ...attrs, start: 1, semloEditorListFirstContinue: false }, list.content, previous.marks)
        .sameMarkup(list);
      if (cache) {
        let entries = cache.compatible.get(list);
        if (!entries) cache.compatible.set(list, (entries = new WeakMap()));
        entries.set(previous, compatible);
      }
    }
  }
  return {
    list,
    listPos,
    index: $pos.index(),
    previous: compatible ? previous : null,
    previousPos: compatible && previous ? listPos - previous.nodeSize : listPos,
    multilevel,
    hasRestarts,
    quoteChain,
    taskChain: null,
  };
}

function changeSequence(editor: Editor, target: Target, kind: "restart" | "continue"): boolean {
  if (!target.sequence?.[kind]) return false;
  const result = changeNumberingSequence(numberingSequenceInput(target.list), { kind, index: target.index });
  if (!result.ok) return false;
  editor.view.dispatch(closeHistory(applySequencePlan(editor.state.tr, target.listPos, result.value)));
  if (!editor.isDestroyed) editor.view.dispatch(closeHistory(editor.state.tr).setMeta("addToHistory", false));
  return true;
}

function restart(editor: Editor, pos: number): boolean {
  const state = editor.state,
    target = targetAt(state.doc, pos);
  if (!editor.isEditable || !target) return false;
  const { list, listPos, index } = target;
  if (target.sequence) return changeSequence(editor, target, "restart");
  if (target.taskChain) {
    if (state.doc.nodeAt(pos)?.attrs.semloEditorListRestart === true) return false;
    editor.view.dispatch(
      closeHistory(state.tr).setNodeMarkup(pos, undefined, {
        ...state.doc.nodeAt(pos)!.attrs,
        semloEditorListRestart: true,
      }),
    );
    return true;
  }
  if (target.quoteChain && index === 0 && list.attrs.semloEditorListFirstContinue === true) {
    const tr = closeHistory(state.tr).setNodeMarkup(listPos, undefined, {
      ...list.attrs,
      start: 1,
      semloEditorListFirstContinue: false,
    });
    if (target.quoteChain.following.attrs.semloEditorListFirstContinue === true)
      tr.setNodeMarkup(target.quoteChain.followingPos, undefined, { ...target.quoteChain.following.attrs, start: 2 });
    editor.view.dispatch(tr);
    return true;
  }
  if (target.multilevel || target.hasRestarts) {
    const item = state.doc.nodeAt(pos);
    if (!item || item.attrs.semloEditorListRestart === true) return false;
    editor.view.dispatch(
      closeHistory(state.tr).setNodeMarkup(pos, undefined, { ...item.attrs, semloEditorListRestart: true }),
    );
    return true;
  }
  if (index === 0) {
    if (
      !target.previous &&
      supportsFirstMode(list) &&
      Number(list.attrs.start ?? 1) === 1 &&
      list.attrs.semloEditorListFirstContinue === true
    ) {
      editor.view.dispatch(
        closeHistory(state.tr).setNodeMarkup(listPos, undefined, {
          ...list.attrs,
          semloEditorListFirstContinue: false,
        }),
      );
      return true;
    }
    if (Number(list.attrs.start ?? 1) === 1) return false;
    editor.view.dispatch(
      closeHistory(state.tr).setNodeMarkup(listPos, undefined, {
        ...list.attrs,
        start: 1,
        semloEditorListFirstContinue: false,
      }),
    );
    return true;
  }
  if (list.attrs.semloEditorListLevelStarts != null || list.attrs.semloEditorOrderedAncestorPath != null) return false;
  const children: ProseMirrorNode[] = [];
  list.forEach((item) => children.push(item));
  const afterAttrs = orderedListSuffixAttrs(list, children, index);
  const nodes = Fragment.fromArray([
    list.type.create(list.attrs, children.slice(0, index), list.marks),
    list.type.create(
      { ...afterAttrs, start: 1, semloEditorListFirstContinue: false },
      children.slice(index),
      list.marks,
    ),
  ]);
  const $list = state.doc.resolve(listPos);
  if (!$list.parent.canReplace($list.index(), $list.index() + 1, nodes)) return false;
  editor.view.dispatch(closeHistory(state.tr).replaceWith(listPos, listPos + list.nodeSize, nodes));
  return true;
}
function continueNumbering(editor: Editor, pos: number): boolean {
  const state = editor.state,
    target = targetAt(state.doc, pos);
  if (target?.sequence) return editor.isEditable && changeSequence(editor, target, "continue");
  if (editor.isEditable && target?.taskChain && state.doc.nodeAt(pos)?.attrs.semloEditorListRestart === true) {
    const item = state.doc.nodeAt(pos)!;
    const tr = closeHistory(state.tr)
      .setNodeMarkup(target.listPos, undefined, {
        ...target.list.attrs,
        start: target.taskChain.next,
        semloEditorOrderedStyle: "decimal",
      })
      .setNodeMarkup(pos, undefined, { ...item.attrs, semloEditorListRestart: false });
    editor.view.dispatch(tr);
    return true;
  }
  if (editor.isEditable && target?.quoteChain && target.list.attrs.semloEditorListFirstContinue !== true) {
    const start = Number(target.quoteChain.previous.attrs.start ?? 1) + target.quoteChain.previous.childCount;
    const tr = closeHistory(state.tr).setNodeMarkup(target.listPos, undefined, {
      ...target.list.attrs,
      start,
      semloEditorListFirstContinue: true,
    });
    if (target.quoteChain.following.attrs.semloEditorListFirstContinue === true)
      tr.setNodeMarkup(target.quoteChain.followingPos, undefined, {
        ...target.quoteChain.following.attrs,
        start: start + 1,
      });
    editor.view.dispatch(tr);
    return true;
  }
  if (
    editor.isEditable &&
    target &&
    target.index === 0 &&
    !target.previous &&
    supportsFirstMode(target.list) &&
    Number(target.list.attrs.start ?? 1) === 1 &&
    target.list.attrs.semloEditorListFirstContinue !== true
  ) {
    editor.view.dispatch(
      closeHistory(state.tr).setNodeMarkup(target.listPos, undefined, {
        ...target.list.attrs,
        semloEditorListFirstContinue: true,
      }),
    );
    return true;
  }
  if (editor.isEditable && target && state.doc.nodeAt(pos)?.attrs.semloEditorListRestart === true) {
    const item = state.doc.nodeAt(pos);
    if (!item || item.attrs.semloEditorListRestart !== true) return false;
    editor.view.dispatch(
      closeHistory(state.tr).setNodeMarkup(pos, undefined, { ...item.attrs, semloEditorListRestart: false }),
    );
    return true;
  }
  if (
    !editor.isEditable ||
    !target ||
    target.index !== 0 ||
    !target.previous ||
    Number(target.list.attrs.start ?? 1) !== 1
  )
    return false;
  const { list, listPos, previous, previousPos } = target;
  const combined = previous.type.create(previous.attrs, previous.content.append(list.content), previous.marks);
  const $previous = state.doc.resolve(previousPos);
  if (!$previous.parent.canReplaceWith($previous.index(), $previous.index() + 2, combined.type)) return false;
  editor.view.dispatch(closeHistory(state.tr).replaceWith(previousPos, listPos + list.nodeSize, combined));
  return true;
}

function openMenu(editor: Editor, pos: number, anchor: HTMLButtonElement, focusOnOpen: boolean): () => void {
  const doc = anchor.ownerDocument,
    popup = doc.createElement("div");
  popup.className = "semlo-editor-list-numbering-menu";
  popup.setAttribute("role", "menu");
  popup.setAttribute("aria-label", "设置列表编号");
  const target = targetAt(editor.state.doc, pos);
  const isRestart =
    !!target &&
    (target.list.child(target.index).attrs.semloEditorListRestart === true ||
      (target.index === 0 &&
        Number(target.list.attrs.start ?? 1) === 1 &&
        (!!target.previous ||
          (supportsFirstMode(target.list) && target.list.attrs.semloEditorListFirstContinue !== true))));
  const unsupportedRestart =
    !!target &&
    target.index > 0 &&
    (target.list.attrs.semloEditorListLevelStarts != null || target.list.attrs.semloEditorOrderedAncestorPath != null);
  let closed = false,
    stop = () => {},
    unlink = () => {},
    closeStyles: (() => void) | undefined;
  const outside = (event: Event) => {
    const element = event.target as Element;
    if (!popup.contains(element) && !anchor.contains(element) && !element.closest?.(".semlo-editor-ordered-style-menu"))
      close();
  };
  const keyboard = (event: KeyboardEvent) => {
    if (
      event.isComposing ||
      event.keyCode === 229 ||
      (doc.activeElement !== anchor && !popup.contains(doc.activeElement))
    )
      return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      if (anchor.isConnected) anchor.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const buttons = Array.from(popup.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    const current = buttons.indexOf(doc.activeElement as HTMLButtonElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? buttons.length - 1
          : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
    event.preventDefault();
    buttons[next]?.focus();
  };
  const close = () => {
    if (closed) return;
    closed = true;
    closeStyles?.();
    stop();
    unlink();
    doc.removeEventListener("pointerdown", outside, true);
    doc.removeEventListener("keydown", keyboard, true);
    anchor.setAttribute("aria-expanded", "false");
    popup.remove();
  };
  for (const [label, disabled, action] of [
    [
      "重新编号",
      target?.sequence
        ? !target.sequence.restart
        : isRestart ||
          unsupportedRestart ||
          (!!target &&
            target.index === 0 &&
            Number(target.list.attrs.start ?? 1) === 1 &&
            !target.previous &&
            !supportsFirstMode(target.list)),
      restart,
    ],
    ["继续编号", target?.sequence ? !target.sequence.continue : !isRestart, continueNumbering],
  ] as const) {
    const button = doc.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener("click", () => {
      close();
      action(editor, pos);
      if (!editor.isDestroyed) editor.view.focus();
    });
    popup.append(button);
  }
  const styles = doc.createElement("button");
  styles.type = "button";
  styles.setAttribute("role", "menuitem");
  styles.setAttribute("aria-haspopup", "menu");
  styles.textContent = "修改样式";
  styles.addEventListener("click", () => {
    closeStyles?.();
    const value = target?.list.attrs.semloEditorOrderedStyle;
    const current: OrderedListStyleChoice = value === "chinese" || value === "decimal" ? value : "mixed";
    closeStyles = openOrderedListStyleMenu(
      styles,
      current,
      (choice) => {
        if (editor.isDestroyed || !editor.isEditable || !targetAt(editor.state.doc, pos)) return;
        close();
        editor.view.dispatch(
          editor.state.tr
            .setSelection(TextSelection.near(editor.state.doc.resolve(pos + 2)))
            .setMeta("addToHistory", false),
        );
        setOrderedListStyle(editor, choice);
      },
      true,
      target?.taskChain ? ["chinese", "decimal"] : undefined,
    );
  });
  popup.append(styles);
  doc.body.append(popup);
  anchor.setAttribute("aria-expanded", "true");
  unlink = linkPopup(anchor, popup);
  const position = trackPopupPosition(anchor, popup, close);
  stop = position.stop;
  position.update();
  doc.addEventListener("pointerdown", outside, true);
  doc.addEventListener("keydown", keyboard, true);
  if (focusOnOpen) popup.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  return close;
}

export const OrderedListNumbering = Extension.create({
  name: "semloEditorOrderedListNumbering",
  addGlobalAttributes() {
    return [
      {
        types: ["orderedList"],
        attributes: {
          [sequenceRegistryAttribute]: {
            default: null,
            parseHTML: parseSequenceRegistryAttribute,
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes[sequenceRegistryAttribute] == null
                ? {}
                : { [sequenceRegistryHTMLAttribute]: JSON.stringify(attributes[sequenceRegistryAttribute]) },
          },
          [sequenceLinkAttribute]: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute(sequenceLinkHTMLAttribute),
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes[sequenceLinkAttribute] == null
                ? {}
                : { [sequenceLinkHTMLAttribute]: attributes[sequenceLinkAttribute] },
          },
          semloEditorListQuoteChain: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-semlo-editor-list-quote-chain"),
            renderHTML: (attributes: Record<string, unknown>) =>
              typeof attributes.semloEditorListQuoteChain === "string" && attributes.semloEditorListQuoteChain
                ? { "data-semlo-editor-list-quote-chain": attributes.semloEditorListQuoteChain }
                : {},
          },
          semloEditorListFirstContinue: {
            default: false,
            parseHTML: (element: HTMLElement) =>
              element.getAttribute("data-semlo-editor-list-first-continue") === "true",
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.semloEditorListFirstContinue === true
                ? { "data-semlo-editor-list-first-continue": "true" }
                : {},
          },
        },
      },
      {
        types: ["orderedList", "taskList"],
        attributes: {
          semloEditorListTaskChain: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-semlo-editor-list-task-chain"),
            renderHTML: (attributes: Record<string, unknown>) =>
              typeof attributes.semloEditorListTaskChain === "string" && attributes.semloEditorListTaskChain
                ? { "data-semlo-editor-list-task-chain": attributes.semloEditorListTaskChain }
                : {},
          },
        },
      },
      {
        types: ["listItem", "taskItem", "paragraph", "heading"],
        attributes: {
          [sequenceConversionHintAttribute]: {
            default: null,
            keepOnSplit: true,
            parseHTML: (element: HTMLElement) => element.getAttribute(sequenceConversionHintHTMLAttribute),
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes[sequenceConversionHintAttribute] == null
                ? {}
                : { [sequenceConversionHintHTMLAttribute]: attributes[sequenceConversionHintAttribute] },
          },
        },
      },
      {
        types: ["listItem"],
        attributes: {
          [sequenceMemberAttribute]: {
            default: null,
            keepOnSplit: true,
            parseHTML: (element: HTMLElement) => element.getAttribute(sequenceMemberHTMLAttribute),
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes[sequenceMemberAttribute] == null
                ? {}
                : { [sequenceMemberHTMLAttribute]: attributes[sequenceMemberAttribute] },
          },
          semloEditorListRestart: {
            default: false,
            keepOnSplit: false,
            parseHTML: (element: HTMLElement) => element.getAttribute("data-semlo-editor-list-restart") === "true",
            renderHTML: (attributes: Record<string, unknown>) =>
              attributes.semloEditorListRestart === true ? { "data-semlo-editor-list-restart": "true" } : {},
          },
        },
      },
    ];
  },
  addProseMirrorPlugins() {
    const editor = this.editor;
    let close: (() => void) | undefined;
    return [
      numberingSequencePolicy(),
      new Plugin({
        appendTransaction(transactions, _old, state) {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;
          const tr = state.tr;
          const chainMembers = new Map<string, Array<{ node: ProseMirrorNode; pos: number }>>();
          const taskMembers = new Map<string, Array<{ node: ProseMirrorNode; pos: number }>>();
          state.doc.descendants((node, pos) => {
            const taskId = node.attrs.semloEditorListTaskChain;
            if (
              (node.type.name === "orderedList" || node.type.name === "taskList") &&
              typeof taskId === "string" &&
              taskId
            ) {
              const members = taskMembers.get(taskId) ?? [];
              members.push({ node, pos });
              taskMembers.set(taskId, members);
            }
            const chain = node.attrs.semloEditorListQuoteChain;
            if (node.type.name === "orderedList" && typeof chain === "string" && chain) {
              const members = chainMembers.get(chain) ?? [];
              members.push({ node, pos });
              chainMembers.set(chain, members);
            }
            return !node.isTextblock;
          });
          if (chainMembers.size === 0 && taskMembers.size === 0) return null;
          const linkedPositions = new Set<number>();
          const cache: TargetCache = { shapes: new WeakMap(), compatible: new WeakMap() };
          state.doc.descendants((node, pos) => {
            if (node.type.name !== "listItem") return !node.isTextblock;
            const target = targetAt(state.doc, pos, cache);
            if (!target?.quoteChain || target.index !== 0) return true;
            const chain = target.quoteChain;
            const quotePos = state.doc.resolve(target.listPos).before(1);
            linkedPositions.add(quotePos - chain.previous.nodeSize);
            linkedPositions.add(target.listPos);
            linkedPositions.add(chain.followingPos);
            const previousStart = Number(chain.previous.attrs.start ?? 1);
            if (!Number.isSafeInteger(previousStart) || previousStart < 1) return true;
            const innerStart =
              target.list.attrs.semloEditorListFirstContinue === true ? previousStart + chain.previous.childCount : 1;
            if (Number(target.list.attrs.start ?? 1) !== innerStart)
              tr.setNodeMarkup(target.listPos, undefined, { ...target.list.attrs, start: innerStart });
            if (
              chain.following.attrs.semloEditorListFirstContinue === true &&
              Number(chain.following.attrs.start ?? 1) !== innerStart + 1
            )
              tr.setNodeMarkup(chain.followingPos, undefined, { ...chain.following.attrs, start: innerStart + 1 });
            return true;
          });
          for (const members of chainMembers.values()) {
            for (const { node, pos } of members) {
              if (!linkedPositions.has(pos))
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, semloEditorListQuoteChain: null });
            }
          }
          for (const members of taskMembers.values()) {
            const suffix = members.find(
              ({ node }) =>
                node.type.name === "orderedList" &&
                node.childCount === 1 &&
                Number(node.firstChild?.attrs.semloEditorListIndent ?? 0) === 1,
            );
            const taskChain = suffix ? taskNumberChainAt(state.doc, suffix.pos) : null;
            if (!taskChain || !suffix) {
              for (const { node, pos } of members)
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, semloEditorListTaskChain: null });
              continue;
            }
            if (
              suffix.node.firstChild?.attrs.semloEditorListRestart !== true &&
              Number(suffix.node.attrs.start ?? 1) !== taskChain.next
            )
              tr.setNodeMarkup(suffix.pos, undefined, { ...suffix.node.attrs, start: taskChain.next });
          }
          return tr.docChanged ? tr : null;
        },
        props: {
          decorations(state) {
            if (!editor.isEditable) return DecorationSet.empty;
            const result: Decoration[] = [];
            const cache: TargetCache = { shapes: new WeakMap(), compatible: new WeakMap() };
            state.doc.descendants((node, pos) => {
              if (node.type.name !== "listItem" || !targetAt(state.doc, pos, cache)) return true;
              result.push(
                Decoration.widget(
                  pos + 1,
                  (view) => {
                    const button = view.dom.ownerDocument.createElement("button");
                    button.type = "button";
                    button.className = "semlo-editor-list-numbering-trigger";
                    button.contentEditable = "false";
                    button.setAttribute("aria-label", `设置列表编号：${node.firstChild?.textContent ?? ""}`);
                    button.setAttribute("aria-haspopup", "menu");
                    button.setAttribute("aria-expanded", "false");
                    button.title = "设置编号";
                    button.addEventListener("mousedown", (event) => event.preventDefault());
                    button.addEventListener("click", (event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      close?.();
                      close = openMenu(editor, pos, button, event.detail === 0);
                    });
                    return button;
                  },
                  { side: -1, key: `list-numbering-${pos}-${node.textContent}`, stopEvent: () => true },
                ),
              );
              result.push(Decoration.node(pos, pos + node.nodeSize, { class: "semlo-editor-list-numbering-item" }));
              return true;
            });
            return DecorationSet.create(state.doc, result);
          },
        },
        view() {
          return {
            update(view, previous) {
              if (!editor.isEditable || view.state.doc !== previous.doc) {
                close?.();
                close = undefined;
              }
            },
            destroy() {
              close?.();
            },
          };
        },
      }),
    ];
  },
});
