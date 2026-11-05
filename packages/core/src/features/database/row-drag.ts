import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import {
  createDatabaseId,
  databaseTableRecordIds,
  databaseGroupKey,
  type DatabaseData,
  type DatabaseView,
  type DatabaseValue,
} from "./model";

const transferType = "application/x-semlo-database-row";
interface RowDragOptions {
  root: HTMLElement;
  snapshot: () => { node: ProseMirrorNode; data: DatabaseData; view: DatabaseView; editable: boolean };
  commit: (node: ProseMirrorNode, mutate: (data: DatabaseData, view: DatabaseView) => void) => boolean;
  groupValue: (
    recordId: string,
    viewId: string,
    fieldId: string,
    value: DatabaseValue | undefined,
  ) => DatabaseValue | undefined;
  clearProjection: (recordId: string) => void;
}

export function createRowDrag({ root, snapshot, commit, groupValue, clearProjection }: RowDragOptions) {
  let active: {
    node: ProseMirrorNode;
    databaseId: string;
    viewId: string;
    recordId: string;
    token: string;
    source: HTMLElement;
  } | null = null;
  const canMove = (view: DatabaseView) => view.kind === "table" && !view.sorts.length;
  const clear = () => {
    active?.source.classList.remove("is-row-dragging");
    active = null;
    root
      .querySelectorAll(".is-row-drop-before, .is-row-drop-after")
      .forEach((element) => element.classList.remove("is-row-drop-before", "is-row-drop-after"));
  };
  const bind = (row: HTMLElement, handle: HTMLButtonElement, recordId: string) => {
    handle.draggable = snapshot().editable && canMove(snapshot().view);
    handle.disabled = !handle.draggable;
    handle.addEventListener("dragstart", (event) => {
      const current = snapshot();
      if (!current.editable || !canMove(current.view) || !event.dataTransfer || !root.contains(handle)) {
        event.preventDefault();
        return;
      }
      clear();
      const token = createDatabaseId("row-drag");
      active = {
        node: current.node,
        databaseId: current.data.id,
        viewId: current.view.id,
        recordId,
        token,
        source: handle,
      };
      handle.classList.add("is-row-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(transferType, token);
      event.stopPropagation();
    });
    row.addEventListener("dragover", (event) => {
      if (!active || !Array.from(event.dataTransfer?.types ?? []).includes(transferType)) return;
      event.preventDefault();
      event.stopPropagation();
      root
        .querySelectorAll(".is-row-drop-before, .is-row-drop-after")
        .forEach((element) => element.classList.remove("is-row-drop-before", "is-row-drop-after"));
      if (recordId === active.recordId) return;
      const marker = row.querySelector<HTMLElement>(".semlo-editor-database-record-index");
      if (!marker) return;
      const rect = marker.getBoundingClientRect();
      marker.classList.add(event.clientY < rect.top + rect.height / 2 ? "is-row-drop-before" : "is-row-drop-after");
    });
    row.addEventListener("drop", (event) => {
      if (!active || !Array.from(event.dataTransfer?.types ?? []).includes(transferType)) return;
      event.preventDefault();
      event.stopPropagation();
      const state = active;
      const current = snapshot();
      const marker = row.querySelector<HTMLElement>(".semlo-editor-database-record-index");
      const rect = marker?.getBoundingClientRect();
      const before = !!rect && event.clientY < rect.top + rect.height / 2;
      if (
        rect &&
        recordId !== state.recordId &&
        current.editable &&
        current.node === state.node &&
        current.data.id === state.databaseId &&
        current.view.id === state.viewId &&
        canMove(current.view) &&
        event.dataTransfer?.getData(transferType) === state.token
      ) {
        let moveOutOfProjection = false;
        const applied = commit(state.node, (data, view) => {
          if (data.id !== state.databaseId || view.id !== state.viewId || !canMove(view)) return;
          const order = databaseTableRecordIds(data, view);
          const original = order.join("\u0000");
          const from = order.indexOf(state.recordId);
          if (from < 0 || !order.includes(recordId)) return;
          const field = data.fields.find((item) => item.id === view.groupFieldId);
          const source = data.records.find((item) => item.id === state.recordId);
          const target = data.records.find((item) => item.id === recordId);
          if (!source || !target) return;
          const sourceValue = field ? groupValue(source.id, view.id, field.id, source.values[field.id]) : undefined;
          const targetValue = field ? groupValue(target.id, view.id, field.id, target.values[field.id]) : undefined;
          if (field && databaseGroupKey(field, sourceValue) !== databaseGroupKey(field, targetValue)) {
            if (["createdTime", "modifiedTime", "createdBy", "modifiedBy"].includes(field.type)) return;
            source.values[field.id] = structuredClone(targetValue ?? "");
            moveOutOfProjection = true;
          }
          order.splice(from, 1);
          order.splice(order.indexOf(recordId) + (before ? 0 : 1), 0, state.recordId);
          if (order.join("\u0000") !== original) view.recordOrder = order;
        });
        if (applied && moveOutOfProjection) clearProjection(state.recordId);
      }
      clear();
    });
    handle.addEventListener("dragend", (event) => {
      event.stopPropagation();
      clear();
    });
  };
  return { bind, cancel: clear, destroy: clear };
}
