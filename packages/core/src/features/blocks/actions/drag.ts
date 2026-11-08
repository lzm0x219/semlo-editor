import type { Editor } from "@tiptap/core";
import { Fragment, type Node as ProseMirrorNode } from "@tiptap/pm/model";
import { Selection } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";

import { hasNumberingSequences } from "../../list/numbering-sequence-document";
import { orderedListSuffixAttrs } from "../../list/ordered-fragment";
import { normalizeOrderedAncestorPath } from "../../list/ordered-path";
import {
  listNodes,
  isFlatList,
  listHasRestarts,
  dispatchChange,
  rebaseOrderedListAfterChange,
  removal,
} from "./operations";
import { restartedDrag } from "./restarted-drag";
import { currentTarget, type Target } from "./target";

interface BlockDragContext {
  editor: Editor;
  view: EditorView;
  win: (Window & typeof globalThis) | null;
  handle: HTMLButtonElement;
  indicator: HTMLElement;
  getDrag(): { source: Target } | null;
  setDrag(value: { source: Target } | null): void;
  getTarget(): Target | null;
  getRootEntries(): Array<{ pos: number; node: ProseMirrorNode; dom: HTMLElement }>;
  resolveElement(element: Element | null): Target | null;
  closeMenu(): void;
  closeDrag(): void;
}

export function createBlockDrag({
  editor,
  view,
  win,
  handle,
  indicator,
  getDrag,
  setDrag,
  getTarget,
  getRootEntries,
  resolveElement,
  closeMenu,
  closeDrag,
}: BlockDragContext) {
  const dragTarget = (event: DragEvent): { pos: number; rect: DOMRect; before: boolean; over: Target } | null => {
    if (!getDrag()) return null;
    const element = event.target instanceof (win?.Element ?? Element) ? (event.target as Element) : null;
    let over = resolveElement(element);
    if (
      element &&
      view.dom.contains(element) &&
      (!over || (over.kind === "block" && listNodes.has(over.node.type.name)))
    ) {
      const candidates: Target[] = [];
      for (const root of getRootEntries()) {
        if (listNodes.has(root.node.type.name)) {
          for (const item of root.dom.querySelectorAll("li")) {
            const candidate = resolveElement(item);
            if (candidate?.kind === "item") candidates.push(candidate);
          }
          continue;
        }
        const candidate = currentTarget(view, root.pos, root.pos, root.dom, root.dom, false);
        if (candidate) candidates.push(candidate);
      }
      let distance = Infinity;
      let height = Infinity;
      for (const candidate of candidates) {
        const rect = candidate.dom.getBoundingClientRect();
        if (!rect.height || !rect.width) continue;
        const currentDistance =
          event.clientY < rect.top
            ? rect.top - event.clientY
            : event.clientY > rect.bottom
              ? event.clientY - rect.bottom
              : 0;
        if (currentDistance < distance || (currentDistance === distance && rect.height < height)) {
          distance = currentDistance;
          height = rect.height;
          over = candidate;
        }
      }
    }
    if (!over) return null;
    const rect = over.dom.getBoundingClientRect(),
      before = event.clientY < rect.top + rect.height / 2;
    return { pos: before ? over.pos : over.pos + over.node.nodeSize, rect, before, over };
  };
  const dragStart = (event: DragEvent) => {
    const target = getTarget();
    if (!target || !editor.isEditable || !event.dataTransfer || view.state.doc.nodeAt(target.pos) !== target.node) {
      event.preventDefault();
      return;
    }
    closeMenu();
    setDrag({ source: getTarget()! });
    handle.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-semlo-block", "move");
    event.stopPropagation();
  };
  const dragOver = (event: DragEvent) => {
    if (!getDrag()) return;
    const next = dragTarget(event);
    if (!next) {
      indicator.hidden = true;
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    indicator.hidden = false;
    indicator.style.left = `${next.rect.left}px`;
    indicator.style.width = `${next.rect.width}px`;
    indicator.style.top = `${next.before ? next.rect.top : next.rect.bottom}px`;
  };
  const drop = (event: DragEvent) => {
    if (!getDrag()) return;
    event.preventDefault();
    event.stopPropagation();
    const source = getDrag()!.source,
      next = dragTarget(event);
    closeDrag();
    if (
      !next ||
      !editor.isEditable ||
      view.state.doc.nodeAt(source.pos) !== source.node ||
      (next.pos >= source.pos && next.pos <= source.pos + source.node.nodeSize) ||
      (next.over.pos >= source.pos && next.over.pos < source.pos + source.node.nodeSize)
    )
      return;
    const sourceParent = view.state.doc.resolve(source.pos).parent;
    const sequenceSource = hasNumberingSequences(sourceParent) || listHasRestarts(sourceParent);
    const sequenceTargetParent = next.over.kind === "item" ? view.state.doc.resolve(next.over.pos).parent : null;
    if (
      source.kind === "item" &&
      next.over.kind === "item" &&
      (sequenceSource || (sequenceTargetParent && hasNumberingSequences(sequenceTargetParent)))
    ) {
      const transaction = restartedDrag(view.state, source.pos, next.over.pos, next.before);
      if (transaction) {
        dispatchChange(editor, transaction);
        if (!editor.isDestroyed && editor.view === view && !view.isDestroyed) view.focus();
      }
      return;
    }
    if (
      hasNumberingSequences(source.node) ||
      hasNumberingSequences(next.over.node) ||
      hasNumberingSequences(sourceParent) ||
      (sequenceTargetParent && hasNumberingSequences(sequenceTargetParent))
    )
      return;
    if (source.kind === "item" && listHasRestarts(sourceParent)) return;
    if (next.over.kind === "item" && listHasRestarts(view.state.doc.resolve(next.over.pos).parent)) return;
    const targetParent = next.over.kind === "item" ? view.state.doc.resolve(next.over.pos).parent : null;
    const continuedSource =
      source.kind === "item" &&
      sourceParent.type.name === "orderedList" &&
      sourceParent.attrs.semloEditorListFirstContinue === true;
    const continuedTarget =
      targetParent?.type.name === "orderedList" && targetParent.attrs.semloEditorListFirstContinue === true;
    if ((continuedSource || continuedTarget) && source.parentPos !== next.over.parentPos) return;
    if (
      source.kind === "item" &&
      next.over.kind === "item" &&
      source.parentPos === next.over.parentPos &&
      sourceParent.type.name === "orderedList"
    ) {
      const fromIndex = view.state.doc.resolve(source.pos).index();
      const targetIndex = view.state.doc.resolve(next.over.pos).index();
      const observedFlat =
        (sourceParent.attrs.semloEditorOrderedStyle == null ||
          sourceParent.attrs.semloEditorOrderedStyle === "mixed") &&
        Number(sourceParent.attrs.start ?? 1) === 1 &&
        sourceParent.attrs.semloEditorListLevelStarts == null &&
        sourceParent.attrs.semloEditorOrderedAncestorPath == null &&
        isFlatList(sourceParent) &&
        Array.from({ length: sourceParent.childCount }, (_, i) => sourceParent.child(i)).every(
          (item) => Number(item.attrs.semloEditorListIndent ?? 0) === 0,
        );
      if (continuedSource && !observedFlat && fromIndex > 0 && targetIndex === 0 && next.before) return;
      if (
        continuedSource &&
        (!isFlatList(sourceParent) ||
          Array.from({ length: sourceParent.childCount }, (_, i) => sourceParent.child(i)).some(
            (item) => Number(item.attrs.semloEditorListIndent ?? 0) !== 0,
          ))
      )
        return;
      if ((continuedSource || observedFlat) && fromIndex === 0 && next.before) return;
    }
    // Yuque moves a flat parent item together with its descendants.
    // Keep unsupported mixed-depth or seeded cases unchanged until verified.
    if (source.kind === "item" && isFlatList(sourceParent)) {
      const start = view.state.doc.resolve(source.pos).index();
      const level = Number(source.node.attrs.semloEditorListIndent ?? 0);
      const group: ProseMirrorNode[] = [source.node];
      let size = source.node.nodeSize;
      for (let index = start + 1; index < sourceParent.childCount; index++) {
        const child = sourceParent.child(index);
        if (Number(child.attrs.semloEditorListIndent ?? 0) <= level) break;
        group.push(child);
        size += child.nodeSize;
      }
      if (group.length > 1) {
        const targetParent = view.state.doc.resolve(next.over.pos).parent;
        if (
          next.over.kind !== "item" ||
          targetParent.type !== sourceParent.type ||
          !isFlatList(targetParent) ||
          Number(next.over.node.attrs.semloEditorListIndent ?? 0) !== level ||
          (next.pos >= source.pos && next.pos <= source.pos + size) ||
          (sourceParent.childCount !== group.length &&
            (sourceParent.attrs.semloEditorListLevelStarts != null ||
              sourceParent.attrs.semloEditorOrderedAncestorPath != null)) ||
          (source.parentPos !== next.over.parentPos &&
            (targetParent.attrs.semloEditorListLevelStarts != null ||
              targetParent.attrs.semloEditorOrderedAncestorPath != null))
        )
          return;
        const wholeList = group.length === sourceParent.childCount;
        const from = wholeList ? source.parentPos : source.pos;
        const to = wholeList ? source.parentPos + sourceParent.nodeSize : source.pos + size;
        let transaction = view.state.tr.delete(from, to);
        const destination = transaction.mapping.map(next.pos, 1);
        const resolvedDestination = transaction.doc.resolve(destination);
        const fragment = Fragment.fromArray(group);
        if (!resolvedDestination.parent.canReplace(resolvedDestination.index(), resolvedDestination.index(), fragment))
          return;
        transaction = transaction.insert(destination, fragment);
        transaction = transaction
          .setSelection(
            Selection.near(transaction.doc.resolve(Math.min(destination + 1, transaction.doc.content.size)), 1),
          )
          .scrollIntoView();
        dispatchChange(editor, transaction);
        if (!editor.isDestroyed) view.focus();
        return;
      }
    }
    const range = removal(view.state, source);
    if (!range || range.replaceWithParagraph) return;
    let tr = view.state.tr.delete(range.from, range.to);
    const mapped = tr.mapping.map(next.pos, 1),
      resolved = tr.doc.resolve(mapped);
    let movedSource = source.node;

    if (next.over.kind === "item" && source.kind === "item" && sourceParent.type === resolved.parent.type) {
      if (!resolved.parent.canReplaceWith(resolved.index(), resolved.index(), source.node.type)) return;
      // The observed flat, top-level bullet-list interaction adopts
      // the target item's indent. Nested lists retain prior behavior.
      const sourceAttrs = source.node.attrs,
        targetAttrs = next.over.node.attrs,
        targetParent = view.state.doc.resolve(next.over.pos).parent;
      const observedOrderedDrop =
        sourceParent.type.name === "orderedList" &&
        sourceParent.attrs.semloEditorOrderedStyle === "decimal" &&
        normalizeOrderedAncestorPath(sourceParent.attrs.semloEditorOrderedAncestorPath)?.length === 1 &&
        source.parentPos === next.over.parentPos &&
        view.state.doc.resolve(source.pos).index() === 0 &&
        sourceAttrs.semloEditorListIndent === 1 &&
        targetAttrs.semloEditorListIndent === 0 &&
        !next.before &&
        event.clientX <= (next.over.dom.querySelector("p")?.getBoundingClientRect().left ?? next.rect.left) + 10;
      const moved =
        (sourceParent.type.name === "bulletList" || observedOrderedDrop) &&
        source.parentPos === source.rootPos &&
        next.over.parentPos === next.over.rootPos &&
        isFlatList(sourceParent) &&
        isFlatList(targetParent) &&
        Object.hasOwn(sourceAttrs, "semloEditorListIndent") &&
        Object.hasOwn(targetAttrs, "semloEditorListIndent") &&
        sourceAttrs.semloEditorListIndent !== targetAttrs.semloEditorListIndent
          ? source.node.type.create(
              { ...sourceAttrs, semloEditorListIndent: targetAttrs.semloEditorListIndent },
              source.node.content,
              source.node.marks,
            )
          : source.node;
      movedSource = moved;
      tr = tr.insert(mapped, moved);
    } else {
      let inserted = source.node;
      if (source.kind === "item") {
        if (!listNodes.has(sourceParent.type.name) || !sourceParent.type.validContent(Fragment.from(inserted))) return;
        inserted = sourceParent.type.create(sourceParent.attrs, inserted);
      }

      if (next.over.kind === "item") {
        // A block or an item of another list type remains a separate block.
        // Split the target list on the chosen item boundary.
        const listPos = tr.mapping.map(next.over.parentPos, 1),
          list = tr.doc.nodeAt(listPos);
        if (!list || !listNodes.has(list.type.name) || resolved.parent !== list) return;
        const children: ProseMirrorNode[] = [];
        list.forEach((child) => children.push(child));
        const index = resolved.index(),
          before = children.slice(0, index),
          after = children.slice(index),
          afterAttrs = list.type.name === "orderedList" ? orderedListSuffixAttrs(list, children, index) : list.attrs,
          nodes = [
            ...(before.length ? [list.type.create(list.attrs, before)] : []),
            inserted,
            ...(after.length ? [list.type.create(afterAttrs, after)] : []),
          ],
          $list = tr.doc.resolve(listPos),
          replacement = Fragment.fromArray(nodes);
        if (!$list.parent.canReplace($list.index(), $list.index() + 1, replacement)) return;
        tr = tr.replaceWith(listPos, listPos + list.nodeSize, replacement);
      } else {
        if (!resolved.parent.canReplaceWith(resolved.index(), resolved.index(), inserted.type)) return;
        tr = tr.insert(mapped, inserted);
      }
    }
    if (
      source.kind === "item" &&
      next.over.kind === "item" &&
      source.parentPos === source.rootPos &&
      source.parentPos === next.over.parentPos &&
      sourceParent.type.name === "orderedList" &&
      (sourceParent.attrs.semloEditorListLevelStarts != null ||
        sourceParent.attrs.semloEditorOrderedAncestorPath != null)
    ) {
      const children: ProseMirrorNode[] = [];
      sourceParent.forEach((child) => children.push(child));
      const sourceIndex = view.state.doc.resolve(source.pos).index();
      const [removed] = children.splice(sourceIndex, 1);
      if (!removed) return;
      children.splice(resolved.index(), 0, movedSource);
      if (!rebaseOrderedListAfterChange(tr, sourceParent, source.parentPos, Fragment.fromArray(children))) return;
    }
    // A split ordered list stores its start relative to its first item's
    // level. Moving that item to another list must preserve the source's
    // per-level seeds just as deleting it does.
    if (
      source.kind === "item" &&
      source.parentPos === source.rootPos &&
      source.parentPos !== next.over.parentPos &&
      sourceParent.type.name === "orderedList" &&
      (sourceParent.attrs.semloEditorListLevelStarts != null ||
        sourceParent.attrs.semloEditorOrderedAncestorPath != null) &&
      sourceParent.childCount > 1 &&
      view.state.doc.resolve(source.pos).index() === 0 &&
      !rebaseOrderedListAfterChange(tr, sourceParent, source.parentPos, sourceParent.content.cut(source.node.nodeSize))
    )
      return;
    // Likewise, inserting a differently-indented item at the front
    // of another ordered list changes the meaning of its start.
    if (
      source.kind === "item" &&
      next.over.kind === "item" &&
      source.parentPos !== next.over.parentPos &&
      next.over.parentPos === next.over.rootPos &&
      sourceParent.type.name === "orderedList" &&
      next.before
    ) {
      const targetList = view.state.doc.nodeAt(next.over.parentPos);
      const targetIndex = view.state.doc.resolve(next.over.pos).index();
      if (
        targetList?.type === sourceParent.type &&
        (targetList.attrs.semloEditorListLevelStarts != null ||
          targetList.attrs.semloEditorOrderedAncestorPath != null) &&
        targetIndex === 0
      ) {
        const expected = Fragment.from(source.node).append(targetList.content);
        if (!rebaseOrderedListAfterChange(tr, targetList, next.over.parentPos, expected)) return;
      }
    }
    if (
      source.kind === "item" &&
      next.over.kind === "item" &&
      source.parentPos === next.over.parentPos &&
      sourceParent.type.name === "orderedList" &&
      (sourceParent.attrs.semloEditorOrderedStyle == null || sourceParent.attrs.semloEditorOrderedStyle === "mixed") &&
      view.state.doc.resolve(source.pos).index() === 0 &&
      !next.before &&
      Number(sourceParent.attrs.start ?? 1) === 1 &&
      isFlatList(sourceParent) &&
      sourceParent.attrs.semloEditorListLevelStarts == null &&
      sourceParent.attrs.semloEditorOrderedAncestorPath == null &&
      Array.from({ length: sourceParent.childCount }, (_, index) => sourceParent.child(index)).every(
        (item) => Number(item.attrs.semloEditorListIndent ?? 0) === 0,
      )
    ) {
      const position = tr.mapping.map(source.parentPos, -1);
      const list = tr.doc.nodeAt(position);
      if (!list || list.type !== sourceParent.type) return;
      tr.setNodeMarkup(position, undefined, { ...list.attrs, semloEditorListFirstContinue: true });
    }
    tr = tr.setSelection(Selection.near(tr.doc.resolve(Math.min(mapped + 1, tr.doc.content.size)), 1)).scrollIntoView();
    dispatchChange(editor, tr);
    if (!editor.isDestroyed) view.focus();
  };
  return { dragStart, dragOver, drop };
}
