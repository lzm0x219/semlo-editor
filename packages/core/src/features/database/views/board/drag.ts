import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { createDatabaseId, databaseBoardRecordIds, type DatabaseData, type DatabaseView } from "../../model";

const dragType = "application/x-semlo-database-record";

interface BoardDragState {
  node: ProseMirrorNode;
  databaseId: string;
  viewId: string;
  fieldId: string;
  recordId: string;
  groupId: string;
  token: string;
  source: HTMLElement;
}

interface BoardDragOptions {
  root: HTMLElement;
  snapshot: () => { node: ProseMirrorNode; data: DatabaseData; view: DatabaseView; editable: boolean };
  commit: (node: ProseMirrorNode, mutate: (data: DatabaseData, view: DatabaseView) => void) => boolean;
}

/** One drag belongs to exactly one node view, document and board view. */
export function createBoardDrag(options: BoardDragOptions) {
  const { root, snapshot, commit } = options;
  let drag: BoardDragState | null = null;
  let suppressClick = false;
  let clearClickTimer: number | undefined;
  let pointerCard: HTMLElement | null = null;

  const rememberPointer = (event: PointerEvent) => {
    const ElementType = root.ownerDocument.defaultView?.Element;
    const target = event.target;
    pointerCard =
      ElementType && target instanceof ElementType ? target.closest<HTMLElement>(".semlo-editor-database-card") : null;
    if (pointerCard && !root.contains(pointerCard)) pointerCard = null;
  };
  const preventOuterDrag = (event: DragEvent) => {
    const NodeType = root.ownerDocument.defaultView?.Node;
    if (!pointerCard || (NodeType && event.target instanceof NodeType && pointerCard.contains(event.target))) return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
  };
  root.addEventListener("pointerdown", rememberPointer, true);
  root.addEventListener("dragstart", preventOuterDrag, true);

  const clearIndicators = () => {
    root.querySelectorAll(".is-board-drop-before, .is-board-drop-after, .is-board-drop-empty").forEach((element) => {
      element.classList.remove("is-board-drop-before", "is-board-drop-after", "is-board-drop-empty");
    });
  };
  const cancel = () => {
    drag?.source.classList.remove("is-board-dragging");
    drag = null;
    clearIndicators();
    if (suppressClick) endClickSuppression();
  };
  const isBoardTransfer = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes(dragType);
  const valid = (event: DragEvent) => {
    if (!drag || !event.dataTransfer || !isBoardTransfer(event)) return false;
    const state = snapshot();
    return (
      state.editable &&
      state.node === drag.node &&
      state.data.id === drag.databaseId &&
      state.view.id === drag.viewId &&
      state.view.kind === "kanban" &&
      state.data.fields.some((field) => field.id === drag!.fieldId && field.type === "singleSelect") &&
      state.data.records.some(
        (record) => record.id === drag!.recordId && (record.values[drag!.fieldId] || "") === drag!.groupId,
      )
    );
  };
  const placement = (column: HTMLElement, event: DragEvent) => {
    const cards = Array.from(column.querySelectorAll<HTMLElement>(".semlo-editor-database-card")).filter(
      (card) => card.dataset.recordId !== drag?.recordId,
    );
    const next = cards.find(
      (card) => event.clientY < card.getBoundingClientRect().top + card.getBoundingClientRect().height / 2,
    );
    if (next) return { card: next, before: true };
    return cards.length ? { card: cards[cards.length - 1], before: false } : { card: null, before: false };
  };
  const endClickSuppression = () => {
    const win = root.ownerDocument.defaultView;
    if (clearClickTimer !== undefined) win?.clearTimeout(clearClickTimer);
    clearClickTimer = win?.setTimeout(() => {
      suppressClick = false;
      clearClickTimer = undefined;
    }, 0);
  };

  const bindCard = (card: HTMLButtonElement, fieldId: string, groupId: string, recordId: string) => {
    card.draggable = snapshot().editable;
    card.addEventListener("dragstart", (event) => {
      const state = snapshot();
      if (
        !state.editable ||
        !event.dataTransfer ||
        !root.contains(card) ||
        state.view.kind !== "kanban" ||
        !state.data.fields.some((field) => field.id === fieldId && field.type === "singleSelect") ||
        !state.data.records.some((record) => record.id === recordId && (record.values[fieldId] || "") === groupId)
      ) {
        event.preventDefault();
        return;
      }
      cancel();
      drag = {
        node: state.node,
        databaseId: state.data.id,
        viewId: state.view.id,
        fieldId,
        recordId,
        groupId,
        token: createDatabaseId("board-drag"),
        source: card,
      };
      suppressClick = true;
      card.classList.add("is-board-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(dragType, drag.token);
      event.stopPropagation();
    });
    card.addEventListener("dragend", (event) => {
      event.stopPropagation();
      if (drag?.source === card) cancel();
      endClickSuppression();
    });
  };

  const bindColumn = (column: HTMLElement, groupId: string, fieldId: string) => {
    column.dataset.groupId = groupId;
    column.addEventListener("dragover", (event) => {
      if (!isBoardTransfer(event)) return;
      event.preventDefault();
      event.stopPropagation();
      if (!valid(event) || drag?.fieldId !== fieldId) {
        if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
        clearIndicators();
        return;
      }
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      clearIndicators();
      const next = placement(column, event);
      if (next.card) next.card.classList.add(next.before ? "is-board-drop-before" : "is-board-drop-after");
      else column.classList.add("is-board-drop-empty");
    });
    column.addEventListener("dragleave", (event) => {
      const NodeType = root.ownerDocument.defaultView?.Node;
      if (!NodeType || !(event.relatedTarget instanceof NodeType) || !column.contains(event.relatedTarget))
        clearIndicators();
    });
    column.addEventListener("drop", (event) => {
      if (!isBoardTransfer(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const source = drag;
      if (
        !source ||
        !valid(event) ||
        source.fieldId !== fieldId ||
        event.dataTransfer?.getData(dragType) !== source.token
      ) {
        cancel();
        endClickSuppression();
        return;
      }
      const next = placement(column, event);
      const targetId = next.card?.dataset.recordId;
      cancel();
      commit(source.node, (data, view) => {
        const field = data.fields.find((item) => item.id === fieldId && item.type === "singleSelect");
        const record = data.records.find((item) => item.id === source.recordId);
        if (!field || !record || (groupId && !field.options.some((option) => option.id === groupId))) return;
        if ((record.values[fieldId] || "") !== source.groupId) return;
        const previousOrder = databaseBoardRecordIds(data, view);
        const order = previousOrder.filter((id) => id !== record.id);
        let destination = targetId ? order.indexOf(targetId) : -1;
        if (destination >= 0) {
          const target = data.records.find((item) => item.id === targetId);
          if (!target || (target.values[fieldId] || "") !== groupId) return;
          if (!next.before) destination++;
        } else {
          const groupRecords = order.filter(
            (id) => (data.records.find((item) => item.id === id)?.values[fieldId] || "") === groupId,
          );
          destination = groupRecords.length ? order.indexOf(groupRecords[groupRecords.length - 1]) + 1 : order.length;
        }
        order.splice(destination, 0, record.id);
        const moved = order.some((id, index) => id !== previousOrder[index]);
        if (!moved && (record.values[fieldId] || "") === groupId) return;
        record.values[fieldId] = groupId;
        if (moved) view.boardOrder = order;
      });
      endClickSuppression();
    });
  };

  return {
    bindCard,
    bindColumn,
    cancel,
    shouldSuppressClick: () => suppressClick,
    destroy() {
      cancel();
      root.removeEventListener("pointerdown", rememberPointer, true);
      root.removeEventListener("dragstart", preventOuterDrag, true);
      if (clearClickTimer !== undefined) root.ownerDocument.defaultView?.clearTimeout(clearClickTimer);
    },
  };
}
