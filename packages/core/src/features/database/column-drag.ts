import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { createDatabaseId, orderedDatabaseFields, type DatabaseData, type DatabaseView } from "./model";

const transferType = "application/x-semlo-database-column";

interface ColumnDragOptions {
  root: HTMLElement;
  snapshot: () => { node: ProseMirrorNode; data: DatabaseData; view: DatabaseView; editable: boolean };
  commit: (node: ProseMirrorNode, mutate: (data: DatabaseData, view: DatabaseView) => void) => boolean;
}

/** A column drag belongs to one node and one view and never moves another editor's data. */
export function createColumnDrag({ root, snapshot, commit }: ColumnDragOptions) {
  let active: {
    node: ProseMirrorNode;
    databaseId: string;
    viewId: string;
    fieldId: string;
    token: string;
    source: HTMLElement;
  } | null = null;
  const clear = () => {
    active?.source.classList.remove("is-column-dragging");
    active = null;
    root
      .querySelectorAll(".is-column-drop-before, .is-column-drop-after")
      .forEach((element) => element.classList.remove("is-column-drop-before", "is-column-drop-after"));
  };
  const valid = (event: DragEvent) => {
    if (!active || !event.dataTransfer || event.dataTransfer.getData(transferType) !== active.token) return false;
    const current = snapshot();
    return (
      current.editable &&
      current.node === active.node &&
      current.data.id === active.databaseId &&
      current.view.id === active.viewId &&
      current.view.kind === "table" &&
      current.data.fields.some((field) => field.id === active!.fieldId) &&
      !current.view.hiddenFields.includes(active.fieldId)
    );
  };
  const bind = (cell: HTMLElement, fieldId: string) => {
    cell.draggable = snapshot().editable;
    cell.dataset.columnId = fieldId;
    cell.addEventListener("dragstart", (event) => {
      const current = snapshot();
      if (!current.editable || current.view.kind !== "table" || !event.dataTransfer || !root.contains(cell)) {
        event.preventDefault();
        return;
      }
      clear();
      const token = createDatabaseId("column-drag");
      active = {
        node: current.node,
        databaseId: current.data.id,
        viewId: current.view.id,
        fieldId,
        token,
        source: cell,
      };
      cell.classList.add("is-column-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(transferType, token);
      event.stopPropagation();
    });
    cell.addEventListener("dragover", (event) => {
      if (!active || !Array.from(event.dataTransfer?.types ?? []).includes(transferType)) return;
      event.preventDefault();
      event.stopPropagation();
      root
        .querySelectorAll(".is-column-drop-before, .is-column-drop-after")
        .forEach((element) => element.classList.remove("is-column-drop-before", "is-column-drop-after"));
      if (fieldId === active.fieldId) return;
      const before = event.clientX < cell.getBoundingClientRect().left + cell.getBoundingClientRect().width / 2;
      cell.classList.add(before ? "is-column-drop-before" : "is-column-drop-after");
    });
    cell.addEventListener("drop", (event) => {
      if (!active || !Array.from(event.dataTransfer?.types ?? []).includes(transferType)) return;
      event.preventDefault();
      event.stopPropagation();
      const state = active;
      const before = event.clientX < cell.getBoundingClientRect().left + cell.getBoundingClientRect().width / 2;
      if (fieldId !== state.fieldId && valid(event)) {
        commit(state.node, (data, view) => {
          if (
            data.id !== state.databaseId ||
            view.id !== state.viewId ||
            view.kind !== "table" ||
            view.hiddenFields.includes(fieldId)
          )
            return;
          const order = orderedDatabaseFields(data, view).map((field) => field.id);
          const original = order.join("\u0000");
          const from = order.indexOf(state.fieldId);
          if (from < 0 || !order.includes(fieldId)) return;
          order.splice(from, 1);
          const target = order.indexOf(fieldId);
          order.splice(target + (before ? 0 : 1), 0, state.fieldId);
          if (order.join("\u0000") !== original) view.fieldOrder = order;
        });
      }
      clear();
    });
    cell.addEventListener("dragend", (event) => {
      event.stopPropagation();
      clear();
    });
  };
  return { bind, cancel: clear, destroy: clear };
}
