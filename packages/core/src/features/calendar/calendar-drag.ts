import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { calendarDayNumber, shiftCalendarDate } from "../../shared/date/civil-date";

export interface StandaloneCalendarDragEvent {
  id: string;
  start: string;
  end: string;
}

export interface StandaloneCalendarDragSnapshot {
  node: ProseMirrorNode;
  editable: boolean;
  events: readonly StandaloneCalendarDragEvent[];
}

interface StandaloneCalendarDragOptions {
  root: HTMLElement;
  snapshot: () => StandaloneCalendarDragSnapshot;
  commit: (
    expectedNode: ProseMirrorNode,
    id: string,
    originalStart: string,
    originalEnd: string,
    nextStart: string,
    nextEnd: string,
  ) => boolean;
}

interface DragState extends StandaloneCalendarDragEvent {
  node: ProseMirrorNode;
  source: HTMLElement;
  pointerId: number;
  originX: number;
  originY: number;
  anchor: string;
  mode: "move" | "end";
  moved: boolean;
}

/** The cells remain available beneath the event overlay, even for multi-day segments. */
function dateAt(root: HTMLElement, x: number, y: number): { date: string; cell: HTMLElement } | null {
  for (const cell of root.querySelectorAll<HTMLElement>(".semlo-editor-calendar-cell[data-date]")) {
    const rect = cell.getBoundingClientRect();
    const date = cell.dataset.date;
    if (date && x >= rect.left && x < rect.right && y >= rect.top && y < rect.bottom) return { date, cell };
  }
  return null;
}

/** Dragging remains scoped to the original calendar node and original event dates. */
export function createStandaloneCalendarDrag({ root, snapshot, commit }: StandaloneCalendarDragOptions) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  let drag: DragState | null = null;
  let suppressed = false;
  let suppressionTimer: number | undefined;

  const consumeClick = () => {
    const wasSuppressed = suppressed;
    suppressed = false;
    if (suppressionTimer !== undefined) win?.clearTimeout(suppressionTimer);
    suppressionTimer = undefined;
    return wasSuppressed;
  };
  const suppressClick = () => {
    suppressed = true;
    if (suppressionTimer !== undefined) win?.clearTimeout(suppressionTimer);
    suppressionTimer = win?.setTimeout(() => {
      suppressed = false;
      suppressionTimer = undefined;
    }, 250);
  };
  const clearIndicator = () => {
    root
      .querySelectorAll(".is-calendar-drop-target")
      .forEach((cell) => cell.classList.remove("is-calendar-drop-target"));
    drag?.source.classList.remove("is-calendar-dragging");
  };
  const detach = () => {
    win?.removeEventListener("pointermove", move);
    win?.removeEventListener("pointerup", finish);
    win?.removeEventListener("pointercancel", pointerCancel);
    win?.removeEventListener("blur", cancel);
    doc.removeEventListener("keydown", escape, true);
  };
  function cancel() {
    if (drag?.moved) suppressClick();
    clearIndicator();
    detach();
    drag = null;
  }
  function pointerCancel(event: PointerEvent) {
    if (drag && event.pointerId === drag.pointerId) cancel();
  }
  function escape(event: KeyboardEvent) {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    cancel();
  }
  function isCurrent(state: DragState) {
    if (!root.isConnected || !state.source.isConnected || !root.contains(state.source)) return false;
    const current = snapshot();
    const matches = current.events.filter((entry) => entry.id === state.id);
    const event = matches[0];
    return (
      matches.length === 1 &&
      current.editable &&
      current.node === state.node &&
      event?.start === state.start &&
      event.end === state.end
    );
  }
  function move(event: PointerEvent) {
    const state = drag;
    if (!state || event.pointerId !== state.pointerId) return;
    if (!isCurrent(state)) {
      cancel();
      return;
    }
    if (!state.moved && Math.hypot(event.clientX - state.originX, event.clientY - state.originY) < 5) return;
    state.moved = true;
    event.preventDefault();
    event.stopPropagation();
    clearIndicator();
    state.source.classList.add("is-calendar-dragging");
    dateAt(root, event.clientX, event.clientY)?.cell.classList.add("is-calendar-drop-target");
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
    const valid = isCurrent(state);
    const target = dateAt(root, event.clientX, event.clientY)?.date;
    clearIndicator();
    detach();
    drag = null;
    suppressClick();
    if (!valid || !target) return;
    const from = calendarDayNumber(state.anchor);
    const to = calendarDayNumber(target);
    if (from === null || to === null) return;
    let nextStart = state.start;
    let nextEnd = state.end;
    if (state.mode === "move") {
      const start = shiftCalendarDate(state.start, to - from);
      const end = shiftCalendarDate(state.end, to - from);
      if (!start || !end) return;
      nextStart = start;
      nextEnd = end;
    } else {
      nextEnd = target < state.start ? state.start : target;
    }
    if (nextStart !== state.start || nextEnd !== state.end)
      commit(state.node, state.id, state.start, state.end, nextStart, nextEnd);
  }
  function pointerDown(event: PointerEvent) {
    // A genuine new gesture must never inherit suppression from a previous
    // drag whose source disappeared during the committed repaint.
    if (suppressed) consumeClick();
    const ElementType = win?.Element;
    if (!ElementType || !(event.target instanceof ElementType) || event.button !== 0 || !event.isPrimary) return;
    const source = event.target.closest<HTMLElement>(".semlo-editor-calendar-event[data-event-id]");
    if (!source || !root.contains(source)) return;
    const current = snapshot();
    const id = source.dataset.eventId;
    const matches = current.events.filter((entry) => entry.id === id);
    const item = matches[0];
    if (!current.editable || matches.length !== 1 || !item || !id) return;
    if (calendarDayNumber(item.start) === null || calendarDayNumber(item.end) === null || item.end < item.start) return;
    const edge = event.target.closest<HTMLElement>('[data-calendar-edge="end"]');
    const mode = edge && source.contains(edge) ? "end" : "move";
    const anchor = dateAt(root, event.clientX, event.clientY)?.date ?? (mode === "end" ? item.end : undefined);
    if (!anchor || calendarDayNumber(anchor) === null) return;
    cancel();
    drag = {
      ...item,
      node: current.node,
      source,
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      anchor,
      mode,
      moved: false,
    };
    win?.addEventListener("pointermove", move);
    win?.addEventListener("pointerup", finish);
    win?.addEventListener("pointercancel", pointerCancel);
    win?.addEventListener("blur", cancel);
    doc.addEventListener("keydown", escape, true);
  }
  function preventOuterDrag(event: DragEvent) {
    if (!drag) return;
    event.preventDefault();
    event.stopPropagation();
  }
  function blockClick(event: MouseEvent) {
    if (!consumeClick()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  root.addEventListener("pointerdown", pointerDown, true);
  root.addEventListener("dragstart", preventOuterDrag, true);
  root.addEventListener("click", blockClick, true);
  return {
    cancel,
    consumeClick,
    destroy() {
      cancel();
      root.removeEventListener("pointerdown", pointerDown, true);
      root.removeEventListener("dragstart", preventOuterDrag, true);
      root.removeEventListener("click", blockClick, true);
      consumeClick();
    },
  };
}
