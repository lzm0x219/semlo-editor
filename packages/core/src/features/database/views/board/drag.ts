import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import { createDatabaseId, databaseBoardRecordIds, type DatabaseData, type DatabaseView } from "../../model";

const dragType = "application/x-semlo-database-record";
const cardSelector = ".semlo-editor-database-card";
const columnSelector = ".semlo-editor-database-board-column";
const touchDelay = 350;
const touchSlop = 8;
const scrollEdge = 28;

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

interface BoardTouch {
  id: number;
  source: BoardDragState;
  scroller: HTMLElement;
  x: number;
  y: number;
  moved: boolean;
  timer: number;
}

/** 拖动只作用于发起手势的节点视图及原看板。 */
export function createBoardDrag(options: BoardDragOptions) {
  const { root, snapshot, commit } = options;
  const win = root.ownerDocument.defaultView;
  let drag: BoardDragState | null = null;
  let touch: BoardTouch | null = null;
  let scrollFrame: number | undefined;
  let suppressClick = false;
  let clearClickTimer: number | undefined;
  let pointerCard: HTMLElement | null = null;

  const rememberPointer = (event: PointerEvent) => {
    const ElementType = root.ownerDocument.defaultView?.Element;
    const target = event.target;
    pointerCard = ElementType && target instanceof ElementType ? target.closest<HTMLElement>(cardSelector) : null;
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
    if (touch) {
      win?.clearTimeout(touch.timer);
      root.removeEventListener("touchmove", moveTouch);
      root.removeEventListener("touchend", finishTouch);
      root.removeEventListener("touchcancel", cancel);
    }
    if (scrollFrame !== undefined) win?.cancelAnimationFrame(scrollFrame);
    touch = null;
    scrollFrame = undefined;
    drag?.source.classList.remove("is-board-dragging");
    drag = null;
    clearIndicators();
    if (suppressClick) endClickSuppression();
  };
  const isBoardTransfer = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes(dragType);
  const isCurrent = (source: BoardDragState) => {
    const state = snapshot();
    return (
      state.editable &&
      root.contains(source.source) &&
      state.node === source.node &&
      state.data.id === source.databaseId &&
      state.view.id === source.viewId &&
      state.view.kind === "kanban" &&
      state.data.fields.some((field) => field.id === source.fieldId && field.type === "singleSelect") &&
      state.data.records.some(
        (record) => record.id === source.recordId && (record.values[source.fieldId] || "") === source.groupId,
      )
    );
  };
  const placement = (column: HTMLElement, y: number) => {
    const cards = Array.from(column.querySelectorAll<HTMLElement>(cardSelector)).filter(
      (card) => card.dataset.recordId !== drag?.recordId,
    );
    const next = cards.find((card) => {
      const bounds = card.getBoundingClientRect();
      return y < bounds.top + bounds.height / 2;
    });
    if (next) return { card: next, before: true };
    return cards.length ? { card: cards[cards.length - 1], before: false } : { card: null, before: false };
  };
  const indicate = (column: HTMLElement | null, y: number) => {
    clearIndicators();
    if (!column) return;
    const next = placement(column, y);
    if (next.card) next.card.classList.add(next.before ? "is-board-drop-before" : "is-board-drop-after");
    else column.classList.add("is-board-drop-empty");
  };
  const endClickSuppression = () => {
    if (clearClickTimer !== undefined) win?.clearTimeout(clearClickTimer);
    clearClickTimer = win?.setTimeout(() => {
      suppressClick = false;
      clearClickTimer = undefined;
    }, 0);
  };

  const start = (source: BoardDragState) => {
    if (clearClickTimer !== undefined) win?.clearTimeout(clearClickTimer);
    clearClickTimer = undefined;
    drag = source;
    suppressClick = true;
    source.source.classList.add("is-board-dragging");
  };

  const columnAt = (active: BoardTouch, x: number, y: number) => {
    const tree = root.getRootNode() as Document | ShadowRoot;
    const column = tree.elementFromPoint(x, y)?.closest<HTMLElement>(columnSelector);
    return column?.parentElement === active.source.source.closest(".semlo-editor-database-board") ? column : null;
  };

  const scrollTouch = () => {
    scrollFrame = undefined;
    if (!touch || !drag || !win) return;
    const { scroller, x, y } = touch;
    const bounds = scroller.getBoundingClientRect();
    const left = Math.max(0, bounds.left);
    const right = Math.min(win.innerWidth, bounds.right);
    if (y < bounds.top || y >= bounds.bottom || x < left || x >= right) return;
    const delta = x < left + scrollEdge ? -8 : x >= right - scrollEdge ? 8 : 0;
    const before = scroller.scrollLeft;
    scroller.scrollLeft += delta;
    if (scroller.scrollLeft === before) return;
    indicate(columnAt(touch, x, y), y);
    scrollFrame = win.requestAnimationFrame(scrollTouch);
  };

  const touchPoint = (event: TouchEvent, id: number) =>
    Array.from(event.changedTouches).find((point) => point.identifier === id);
  const moveTouch = (event: TouchEvent) => {
    if (!touch) return;
    if (event.touches.length !== 1) {
      cancel();
      return;
    }
    const point = touchPoint(event, touch.id);
    if (!point) return;
    const { clientX: x, clientY: y } = point;
    if (!drag) {
      // 长按之前的滑动仍交给浏览器滚动。
      if (Math.hypot(x - touch.x, y - touch.y) >= touchSlop) cancel();
      return;
    }
    if (!event.cancelable || !isCurrent(drag)) {
      cancel();
      return;
    }
    event.preventDefault();
    if (!touch.moved && Math.hypot(x - touch.x, y - touch.y) < touchSlop) return;
    touch.moved = true;
    touch.x = x;
    touch.y = y;
    indicate(columnAt(touch, x, y), y);
    if (scrollFrame === undefined) scrollTouch();
  };
  const finishTouch = (event: TouchEvent) => {
    if (!touch) return;
    const point = touchPoint(event, touch.id);
    if (!point) return;
    const source = drag;
    const column = source && touch.moved && isCurrent(source) ? columnAt(touch, point.clientX, point.clientY) : null;
    if (source && event.cancelable) event.preventDefault();
    if (source && column) drop(source, column, point.clientY);
    else cancel();
  };
  const cancelMultipleTouches = (event: TouchEvent) => {
    if (touch && event.touches.length !== 1) cancel();
  };
  const preventTouchMenu = (event: Event) => {
    if (touch?.source === drag) event.preventDefault();
  };
  root.addEventListener("touchstart", cancelMultipleTouches, { capture: true, passive: true });
  root.addEventListener("contextmenu", preventTouchMenu);

  const bindCard = (card: HTMLButtonElement, fieldId: string, groupId: string, recordId: string) => {
    card.draggable = snapshot().editable;
    const readSource = () => {
      const state = snapshot();
      if (
        !state.editable ||
        !root.contains(card) ||
        state.view.kind !== "kanban" ||
        !state.data.fields.some((field) => field.id === fieldId && field.type === "singleSelect") ||
        !state.data.records.some((record) => record.id === recordId && (record.values[fieldId] || "") === groupId)
      )
        return null;
      return {
        node: state.node,
        databaseId: state.data.id,
        viewId: state.view.id,
        fieldId,
        recordId,
        groupId,
        token: createDatabaseId("board-drag"),
        source: card,
      } satisfies BoardDragState;
    };
    card.addEventListener(
      "touchstart",
      (event) => {
        if (!win || event.touches.length !== 1 || touch || drag) return;
        const source = readSource();
        const scroller = card.closest<HTMLElement>(".semlo-editor-database-body");
        if (!source || !scroller) return;
        const point = event.touches[0];
        touch = {
          id: point.identifier,
          x: point.clientX,
          y: point.clientY,
          moved: false,
          source,
          scroller,
          timer: win.setTimeout(() => {
            if (isCurrent(source)) start(source);
            else cancel();
          }, touchDelay),
        };
        // 仅卡片手势期间接管触摸，其他浏览路径保持原生滚动。
        root.addEventListener("touchmove", moveTouch, { passive: false });
        root.addEventListener("touchend", finishTouch, { passive: false });
        root.addEventListener("touchcancel", cancel);
      },
      { passive: true },
    );
    card.addEventListener("dragstart", (event) => {
      const source = touch ? null : readSource();
      if (!source || !event.dataTransfer) {
        event.preventDefault();
        return;
      }
      cancel();
      start(source);
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData(dragType, source.token);
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
      if (!drag || drag.fieldId !== fieldId || !isCurrent(drag)) {
        if (event.dataTransfer) event.dataTransfer.dropEffect = "none";
        clearIndicators();
        return;
      }
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      indicate(column, event.clientY);
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
        !isCurrent(source) ||
        source.fieldId !== fieldId ||
        event.dataTransfer?.getData(dragType) !== source.token
      ) {
        cancel();
        endClickSuppression();
        return;
      }
      drop(source, column, event.clientY);
    });
  };
  const drop = (source: BoardDragState, column: HTMLElement, y: number) => {
    const fieldId = source.fieldId;
    const groupId = column.dataset.groupId ?? "";
    const next = placement(column, y);
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
      root.removeEventListener("touchstart", cancelMultipleTouches, true);
      root.removeEventListener("contextmenu", preventTouchMenu);
      if (clearClickTimer !== undefined) win?.clearTimeout(clearClickTimer);
    },
  };
}
