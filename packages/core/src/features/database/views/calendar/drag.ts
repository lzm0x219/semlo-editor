import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { calendarDayNumber, shiftCalendarDate } from "../../../../shared/date/civil-date";
import { dateFromISO } from "../../../../shared/date/date-utils";
import { createDatabaseField, type DatabaseData, type DatabaseView } from "../../model";

type DragMode = "move" | "start" | "end";
type Snapshot = { node: ProseMirrorNode; data: DatabaseData; view: DatabaseView; editable: boolean };

interface CalendarDragOptions {
  root: HTMLElement;
  snapshot: () => Snapshot;
  commit: (node: ProseMirrorNode, mutate: (data: DatabaseData, view: DatabaseView) => void) => boolean;
}

interface CalendarDragState {
  node: ProseMirrorNode;
  databaseId: string;
  viewId: string;
  recordId: string;
  startFieldId: string;
  endFieldId: string;
  startValue: string;
  endValue: unknown;
  start: string;
  end: string;
  anchor: string;
  target: string | null;
  source: HTMLElement;
  calendar: HTMLElement;
  mode: DragMode;
  pointerId: number;
  x: number;
  y: number;
  moved: boolean;
}

function dateAt(calendar: HTMLElement, x: number, y: number): { date: string; cell: HTMLElement } | null {
  for (const cell of calendar.querySelectorAll<HTMLElement>(".semlo-editor-database-calendar-cell[data-date]")) {
    const bounds = cell.getBoundingClientRect();
    if (x >= bounds.left && x < bounds.right && y >= bounds.top && y < bounds.bottom && cell.dataset.date)
      return { date: cell.dataset.date, cell };
  }
  return null;
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** One drag is scoped to the current node, view, record, and original dates. */
export function createCalendarDrag(options: CalendarDragOptions) {
  const { root, snapshot, commit } = options;
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  let drag: CalendarDragState | null = null;
  let suppressed = false;
  let suppressTimer: number | undefined;

  const clearIndicator = () => {
    root
      .querySelectorAll(".is-calendar-drop-target")
      .forEach((cell) => cell.classList.remove("is-calendar-drop-target"));
    drag?.source.classList.remove("is-calendar-dragging");
  };
  const detach = () => {
    win?.removeEventListener("pointermove", move);
    win?.removeEventListener("pointerup", finish);
    win?.removeEventListener("pointercancel", cancel);
    doc.removeEventListener("keydown", escape, true);
  };
  const suppressClick = () => {
    suppressed = true;
    if (suppressTimer !== undefined) win?.clearTimeout(suppressTimer);
    suppressTimer = win?.setTimeout(() => {
      suppressed = false;
      suppressTimer = undefined;
    }, 250);
  };
  function cancel() {
    if (drag?.moved) suppressClick();
    clearIndicator();
    detach();
    drag = null;
  }
  function escape(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
  }
  const isCurrent = (state: CalendarDragState) => {
    const current = snapshot();
    if (
      !current.editable ||
      current.node !== state.node ||
      current.data.id !== state.databaseId ||
      current.view.id !== state.viewId ||
      current.view.kind !== "calendar" ||
      current.view.calendar.startFieldId !== state.startFieldId ||
      current.view.calendar.endFieldId !== state.endFieldId
    )
      return false;
    const start = current.data.fields.find((field) => field.id === state.startFieldId);
    const end = current.data.fields.find((field) => field.id === state.endFieldId);
    const record = current.data.records.find((item) => item.id === state.recordId);
    return (
      start?.type === "date" &&
      (!state.endFieldId || end?.type === "date") &&
      !!record &&
      record.values[state.startFieldId] === state.startValue &&
      sameValue(record.values[state.endFieldId], state.endValue)
    );
  };
  function move(event: PointerEvent) {
    const state = drag;
    if (!state || event.pointerId !== state.pointerId) return;
    if (!state.source.isConnected || !isCurrent(state)) {
      cancel();
      return;
    }
    if (!state.moved && Math.hypot(event.clientX - state.x, event.clientY - state.y) < 5) return;
    state.moved = true;
    event.preventDefault();
    event.stopPropagation();
    clearIndicator();
    state.source.classList.add("is-calendar-dragging");
    const target = dateAt(state.calendar, event.clientX, event.clientY);
    state.target = target?.date ?? null;
    target?.cell.classList.add("is-calendar-drop-target");
  }
  function finish(event: PointerEvent) {
    const state = drag;
    if (!state || event.pointerId !== state.pointerId) return;
    if (!state.moved) {
      cancel();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const target = dateAt(state.calendar, event.clientX, event.clientY)?.date ?? null;
    const valid = state.source.isConnected && isCurrent(state);
    clearIndicator();
    detach();
    drag = null;
    suppressClick();
    if (!target || !valid) return;
    const from = calendarDayNumber(state.anchor);
    const to = calendarDayNumber(target);
    if (from === null || to === null) return;
    let start = state.start;
    let end = state.end;
    let rawMovedEnd: string | null = null;
    if (state.mode === "move") {
      const nextStart = shiftCalendarDate(start, to - from);
      const nextEnd = shiftCalendarDate(end, to - from);
      if (!nextStart || !nextEnd) return;
      if (
        state.endFieldId &&
        state.endFieldId !== state.startFieldId &&
        typeof state.endValue === "string" &&
        dateFromISO(state.endValue)
      ) {
        rawMovedEnd = shiftCalendarDate(state.endValue, to - from);
        if (!rawMovedEnd) return;
      }
      start = nextStart;
      end = nextEnd;
    } else if (state.mode === "start") {
      start = target > end ? end : target;
    } else {
      end = target < start ? start : target;
    }
    if (start === state.start && end === state.end) return;
    commit(state.node, (data, view) => {
      const record = data.records.find((item) => item.id === state.recordId);
      const startField = data.fields.find((field) => field.id === state.startFieldId && field.type === "date");
      const endField = data.fields.find((field) => field.id === state.endFieldId && field.type === "date");
      if (
        data.id !== state.databaseId ||
        view.id !== state.viewId ||
        view.kind !== "calendar" ||
        view.calendar.startFieldId !== state.startFieldId ||
        view.calendar.endFieldId !== state.endFieldId ||
        !record ||
        !startField ||
        (state.endFieldId && !endField) ||
        record.values[state.startFieldId] !== state.startValue ||
        !sameValue(record.values[state.endFieldId], state.endValue)
      )
        return;

      record.values[state.startFieldId] = start;
      if (state.mode === "move") {
        // Preserve even a pre-existing reversed range by moving both dates together.
        if (rawMovedEnd) record.values[state.endFieldId] = rawMovedEnd;
        return;
      }
      let endId = state.endFieldId;
      if (!endId || endId === state.startFieldId) {
        // A range needs a separate end column. Give existing records empty values.
        let index = 1;
        while (data.fields.some((field) => field.name === `日期 ${index}`)) index++;
        const field = createDatabaseField(`日期 ${index}`, "date");
        data.fields.push(field);
        for (const item of data.records) item.values[field.id] = "";
        endId = field.id;
        view.calendar.endFieldId = endId;
      }
      record.values[endId] = end;
    });
  }
  const pointerDown = (event: PointerEvent) => {
    const ElementType = win?.Element;
    if (!ElementType || !(event.target instanceof ElementType) || event.button !== 0) return;
    const source = event.target.closest<HTMLElement>(".semlo-editor-database-calendar-event");
    if (!source || !root.contains(source)) return;
    const calendar = source.closest<HTMLElement>(".semlo-editor-database-calendar");
    if (!calendar) return;
    const current = snapshot();
    const { data, view } = current;
    if (!current.editable || view.kind !== "calendar") return;
    const startFieldId = view.calendar.startFieldId;
    const endFieldId = view.calendar.endFieldId;
    const record = data.records.find((item) => item.id === source.dataset.recordId);
    const start = record?.values[startFieldId];
    const endValue = record?.values[endFieldId];
    if (
      !record ||
      typeof start !== "string" ||
      !dateFromISO(start) ||
      !data.fields.some((field) => field.id === startFieldId && field.type === "date")
    )
      return;
    const end = typeof endValue === "string" && dateFromISO(endValue) && endValue >= start ? endValue : start;
    const anchor = dateAt(calendar, event.clientX, event.clientY)?.date;
    if (!anchor) return;
    const edge = event.target.closest<HTMLElement>("[data-calendar-edge]")?.dataset.calendarEdge;
    const mode: DragMode = edge === "start" || edge === "end" ? edge : "move";
    cancel();
    drag = {
      node: current.node,
      databaseId: data.id,
      viewId: view.id,
      recordId: record.id,
      startFieldId,
      endFieldId,
      startValue: start,
      endValue,
      start,
      end,
      anchor,
      target: anchor,
      source,
      calendar,
      mode,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    win?.addEventListener("pointermove", move);
    win?.addEventListener("pointerup", finish);
    win?.addEventListener("pointercancel", cancel);
    doc.addEventListener("keydown", escape, true);
  };
  const preventOuterDrag = (event: DragEvent) => {
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const blockClick = (event: MouseEvent) => {
    if (!suppressed) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressed = false;
    if (suppressTimer !== undefined) win?.clearTimeout(suppressTimer);
    suppressTimer = undefined;
  };
  root.addEventListener("pointerdown", pointerDown, true);
  root.addEventListener("dragstart", preventOuterDrag, true);
  root.addEventListener("click", blockClick, true);
  return {
    cancel,
    shouldSuppressClick: () => suppressed,
    destroy() {
      cancel();
      root.removeEventListener("pointerdown", pointerDown, true);
      root.removeEventListener("dragstart", preventOuterDrag, true);
      root.removeEventListener("click", blockClick, true);
      if (suppressTimer !== undefined) win?.clearTimeout(suppressTimer);
    },
  };
}
