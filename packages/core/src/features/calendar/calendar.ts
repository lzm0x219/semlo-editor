import { Node } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import type { Transaction } from "@tiptap/pm/state";

import { appendedReplacesSameNode, replacesSameNode } from "../../runtime/same-node-replacement";
import { dateFromISO, monthGrid, todayISO } from "../../shared/date/date-utils";
import { createStandaloneCalendarDrag } from "./calendar-drag";
import { layoutCalendarWeek } from "./calendar-layout";
import { createCalendarRangePicker } from "./calendar-range-picker";

interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  description: string;
  color: number;
}
// Preserve the original numeric colors for documents saved before the Yuque palette was measured.
const eventColors = [
  "#117cee",
  "#52a66b",
  "#e9a23b",
  "#df6674",
  "#8d7bd8",
  "#858b93",
  "#d22d8d",
  "#74b602",
  "#df2a3f",
  "#601bde",
  "#ecaa04",
] as const;
const newEventColors = [0, 6, 7, 8, 9, 10] as const;
function colorSequence(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value < newEventColors.length
    ? value
    : null;
}
function readColorSequence(element: HTMLElement): unknown {
  const original = element.getAttribute("data-next-color-index-json");
  if (original !== null) {
    try {
      return JSON.parse(original);
    } catch (error) {
      throw new Error("日历颜色顺序数据损坏", { cause: error });
    }
  }
  const value = element.getAttribute("data-next-color-index");
  if (value === null) return null;
  const number = Number(value);
  return /^\d+$/.test(value) && Number.isSafeInteger(number) ? number : value;
}
function colorSequenceWarning(value: unknown): string | null {
  return value === null || colorSequence(value) !== null
    ? null
    : "日历颜色顺序格式不受支持，暂不能新建日程；原始数据已保留。";
}
function eventsFrom(value: unknown): CalendarEvent[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item) =>
        item &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        dateFromISO(item.start) &&
        dateFromISO(item.end) &&
        item.start <= item.end,
    )
    .map((item) => ({
      id: item.id,
      title: typeof item.title === "string" ? item.title : "",
      start: item.start,
      end: item.end,
      description: typeof item.description === "string" ? item.description : "",
      color: Number.isInteger(item.color) && item.color >= 0 && item.color < eventColors.length ? item.color : 0,
    }));
}
function readEvents(value: string | null): unknown {
  if (value === null) return [];
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function eventsWarning(value: unknown): string | null {
  if (!Array.isArray(value)) return "日程数据格式不受支持，无法显示或新建日程；原始数据已保留。";
  if (eventsFrom(value).length !== value.length) return "部分日程数据格式不受支持，无法显示；原始数据已保留。";
  return null;
}

// The view uses a safe projection, but a write must retain records and fields
// that this version cannot interpret. Match duplicate IDs by occurrence.
function mergeEvents(raw: unknown, next: CalendarEvent[]): unknown[] {
  if (!Array.isArray(raw)) return next;
  const queues = new Map<string, number[]>();
  next.forEach((event, index) => {
    const queue = queues.get(event.id) ?? [];
    queue.push(index);
    queues.set(event.id, queue);
  });
  const used = new Set<number>();
  const result: unknown[] = [];
  const fields: Array<keyof CalendarEvent> = ["id", "title", "start", "end", "description", "color"];
  for (const value of raw) {
    const projected = eventsFrom([value])[0];
    if (!projected) {
      result.push(value);
      continue;
    }
    const index = queues.get(projected.id)?.shift();
    if (index === undefined) continue;
    used.add(index);
    const updated = next[index];
    const retained: Record<string, unknown> = { ...(value as Record<string, unknown>) };
    for (const field of fields) if (projected[field] !== updated[field]) retained[field] = updated[field];
    result.push(retained);
  }
  next.forEach((event, index) => {
    if (!used.has(index)) result.push(event);
  });
  return result;
}

export const Calendar = Node.create({
  name: "semloEditorCalendar",
  group: "block",
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      events: { default: [], rendered: false, parseHTML: (element) => readEvents(element.getAttribute("data-events")) },
      nextColorIndex: {
        default: null,
        rendered: false,
        parseHTML: readColorSequence,
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-semlo-editor-calendar]",
        getAttrs: (element: HTMLElement) =>
          readEvents(element.getAttribute("data-events")) === null ? { events: null } : {},
      },
    ];
  },
  renderText({ node }) {
    const warning = [eventsWarning(node.attrs.events), colorSequenceWarning(node.attrs.nextColorIndex)].filter(Boolean);
    return [...eventsFrom(node.attrs.events).map((event) => `${event.start} ${event.title}`), ...warning].join("\n");
  },
  renderHTML({ node }) {
    const events = eventsFrom(node.attrs.events);
    const warning = [eventsWarning(node.attrs.events), colorSequenceWarning(node.attrs.nextColorIndex)].filter(Boolean);
    return [
      "div",
      {
        "data-semlo-editor-calendar": "",
        "data-events": JSON.stringify(node.attrs.events) ?? "null",
        ...(colorSequence(node.attrs.nextColorIndex) !== null
          ? { "data-next-color-index": node.attrs.nextColorIndex }
          : node.attrs.nextColorIndex === null
            ? {}
            : { "data-next-color-index-json": JSON.stringify(node.attrs.nextColorIndex) }),
        class: "semlo-editor-calendar-export",
      },
      ["strong", "日历"],
      ...warning.map((message) => ["p", message!] as const),
      ...events.map(
        (event) => ["p", `${event.start}${event.end === event.start ? "" : ` – ${event.end}`} ${event.title}`] as const,
      ),
    ];
  },
  addNodeView() {
    return ({ editor, view, node: initial, getPos }) => {
      const doc = view.dom.ownerDocument;
      const dom = doc.createElement("div");
      dom.className = "semlo-editor-calendar-node";
      dom.contentEditable = "false";
      let current = initial;
      let selected = false;
      let closePopup: (() => void) | undefined;
      let activeEventId: string | undefined;
      let updatingEvent = false;
      let popupTransaction: Transaction | undefined;
      const now = new Date();
      let year = now.getFullYear(),
        month = now.getMonth();
      const getEvents = () => eventsFrom(current.attrs.events);
      const rawIds = () =>
        Array.isArray(current.attrs.events)
          ? current.attrs.events.flatMap((event: unknown) =>
              event && typeof event === "object" && typeof (event as { id?: unknown }).id === "string"
                ? [(event as { id: string }).id]
                : [],
            )
          : [];
      const idCount = (id: string) => rawIds().filter((value: string) => value === id).length;
      let nextEventId = 0;
      const allocateEventId = () => {
        const prefix = `e${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
        const ids = new Set(rawIds());
        let id: string;
        do id = `${prefix}-${nextEventId++}`;
        while (ids.has(id));
        return id;
      };
      const update = (next: CalendarEvent[], separateHistory = false, nextColorIndex?: number) => {
        if (!editor.isEditable || editor.isDestroyed) return;
        const pos = getPos();
        const node = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
        if (node && node.type === current.type && typeof pos === "number" && Array.isArray(node.attrs.events)) {
          updatingEvent = true;
          try {
            const transaction = view.state.tr.setNodeMarkup(pos, undefined, {
              ...node.attrs,
              events: mergeEvents(node.attrs.events, next),
              ...(nextColorIndex === undefined ? {} : { nextColorIndex }),
            });
            popupTransaction = transaction;
            view.dispatch(separateHistory ? closeHistory(transaction) : transaction);
            if (separateHistory && !editor.isDestroyed) view.dispatch(closeHistory(view.state.tr));
          } finally {
            popupTransaction = undefined;
            updatingEvent = false;
          }
        }
      };
      const calendarDrag = createStandaloneCalendarDrag({
        root: dom,
        snapshot: () => ({ node: current, editable: editor.isEditable && !editor.isDestroyed, events: getEvents() }),
        commit(expectedNode, id, originalStart, originalEnd, nextStart, nextEnd) {
          if (!editor.isEditable || editor.isDestroyed || current !== expectedNode) return false;
          const pos = getPos();
          if (typeof pos !== "number" || view.state.doc.nodeAt(pos) !== expectedNode) return false;
          const events = getEvents();
          const index = events.findIndex((event) => event.id === id);
          if (idCount(id) !== 1) return false;
          if (index < 0 || events[index].start !== originalStart || events[index].end !== originalEnd) return false;
          events[index] = { ...events[index], start: nextStart, end: nextEnd };
          update(events, true);
          return true;
        },
      });
      const move = (amount: number) => {
        const date = new Date(0);
        date.setFullYear(year, month + amount, 1);
        year = date.getFullYear();
        month = date.getMonth();
        paint();
      };
      const warnDuplicate = () => {
        let warning = dom.querySelector<HTMLElement>(".semlo-editor-calendar-duplicate-warning");
        if (!warning) {
          warning = doc.createElement("div");
          warning.className = "semlo-editor-calendar-duplicate-warning";
          warning.setAttribute("role", "alert");
          dom.append(warning);
        }
        warning.textContent = "日程标识重复，暂不能编辑、删除或拖动相关日程。请联系数据提供方处理。";
      };
      const editEvent = (id: string | undefined, date: string, anchor: HTMLElement) => {
        if (!Array.isArray(current.attrs.events)) {
          closePopup?.();
          let warning = dom.querySelector<HTMLElement>(".semlo-editor-calendar-payload-warning");
          if (!warning) {
            warning = doc.createElement("div");
            warning.className = "semlo-editor-calendar-payload-warning";
            warning.setAttribute("role", "alert");
            dom.append(warning);
          }
          warning.textContent = "日程数据格式无法识别，暂不能编辑。请联系数据提供方处理。";
          return;
        }
        if (id === undefined && colorSequenceWarning(current.attrs.nextColorIndex)) return;
        if (id !== undefined && idCount(id) > 1) {
          closePopup?.();
          warnDuplicate();
          return;
        }
        if (closePopup) {
          closePopup();
        }
        const found = getEvents().find((item) => item.id === id);
        if (!found && !editor.isEditable) return;
        if (editor.isEditable && !editor.isDestroyed) view.dispatch(closeHistory(view.state.tr));
        const nextColorIndex =
          colorSequence(current.attrs.nextColorIndex) ?? getEvents().length % newEventColors.length;
        let draft: CalendarEvent = found
          ? { ...found }
          : {
              id: allocateEventId(),
              title: "",
              start: date,
              end: date,
              description: "",
              color: newEventColors[nextColorIndex],
            };
        activeEventId = draft.id;
        for (const entry of dom.querySelectorAll<HTMLElement>(".semlo-editor-calendar-event"))
          entry.classList.toggle("is-active", entry.dataset.eventId === activeEventId);
        const panel = doc.createElement("div");
        panel.className = "semlo-editor-calendar-event-editor";
        panel.style.width = "min(330px, calc(100vw - 16px))";
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-label", found ? "编辑日程" : "添加日程");
        panel.tabIndex = -1;
        panel.addEventListener("click", () => {
          if (panel.isConnected && !panel.contains(doc.activeElement)) panel.focus({ preventScroll: true });
        });
        const actions = doc.createElement("div");
        actions.className = "semlo-editor-calendar-event-actions";
        const remove = doc.createElement("button");
        remove.type = "button";
        remove.setAttribute("aria-label", "删除日程");
        remove.textContent = "⌫";
        remove.disabled = !editor.isEditable;
        const dismiss = doc.createElement("button");
        dismiss.type = "button";
        dismiss.setAttribute("aria-label", "关闭日程");
        dismiss.textContent = "×";
        actions.append(remove, dismiss);
        const title = doc.createElement("textarea");
        title.className = "semlo-editor-calendar-event-title";
        title.placeholder = "添加日程标题";
        title.setAttribute("aria-label", "日程标题");
        title.rows = 1;
        title.value = draft.title;
        title.disabled = !editor.isEditable;
        const color = doc.createElement("select");
        color.setAttribute("aria-label", "日程颜色");
        color.disabled = !editor.isEditable;
        const palette: Array<[number, string]> = [
          [0, "蓝色"],
          [6, "玫红色"],
          [draft.color === 1 ? 1 : 7, "绿色"],
          [draft.color === 3 ? 3 : 8, "红色"],
          [draft.color === 4 ? 4 : 9, "紫色"],
          [10, "黄色"],
        ];
        if (draft.color === 2) palette.push([2, "橙色"]);
        if (draft.color === 5) palette.push([5, "灰色"]);
        for (const [index, label] of palette) {
          const option = doc.createElement("option");
          option.value = String(index);
          option.textContent = label;
          color.append(option);
        }
        // Keep programmatic selection of earlier numeric values available
        // without adding duplicate choices to the visible palette.
        for (const [index, label] of [
          [1, "绿色"],
          [2, "橙色"],
          [3, "红色"],
          [4, "紫色"],
          [5, "灰色"],
        ] as const) {
          if (palette.some(([value]) => value === index)) continue;
          const option = doc.createElement("option");
          option.value = String(index);
          option.textContent = label;
          option.hidden = true;
          color.append(option);
        }
        color.value = String(draft.color);
        color.tabIndex = -1;
        color.setAttribute("aria-hidden", "true");
        color.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;pointer-events:none";
        const colorControl = doc.createElement("div");
        colorControl.style.position = "relative";
        const colorTrigger = doc.createElement("button");
        colorTrigger.type = "button";
        colorTrigger.tabIndex = -1;
        colorTrigger.setAttribute("aria-label", "选择颜色");
        colorTrigger.setAttribute("aria-haspopup", "listbox");
        colorTrigger.setAttribute("aria-expanded", "false");
        colorTrigger.disabled = !editor.isEditable;
        colorTrigger.style.cssText =
          "display:flex;align-items:center;gap:12px;padding:4px 7px;border:1px solid #ddd;border-radius:4px;background:#fff;cursor:pointer";
        const colorSwatch = doc.createElement("span");
        colorSwatch.style.cssText = "width:9px;height:9px;display:block";
        const colorArrow = doc.createElement("span");
        colorArrow.textContent = "⌄";
        colorArrow.style.color = "#999";
        colorTrigger.append(colorSwatch, colorArrow);
        const colorMenu = doc.createElement("div");
        colorMenu.setAttribute("role", "listbox");
        colorMenu.setAttribute("aria-label", "颜色选项");
        colorMenu.style.cssText =
          "position:absolute;z-index:1;top:100%;left:0;min-width:120px;padding:4px 0;background:#fff;border:1px solid #eee;border-radius:5px;box-shadow:0 3px 12px #0002";
        colorMenu.hidden = true;
        for (const [index, label] of palette) {
          const choice = doc.createElement("button");
          choice.type = "button";
          choice.setAttribute("role", "option");
          choice.setAttribute("aria-label", label);
          choice.style.cssText =
            "display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;border:0;background:#fff;text-align:left;cursor:pointer";
          const square = doc.createElement("span");
          square.style.cssText = `width:8px;height:8px;background:${eventColors[index]}`;
          choice.append(square, doc.createTextNode(label));
          choice.addEventListener("click", () => {
            color.value = String(index);
            const EventConstructor = doc.defaultView?.Event ?? Event;
            color.dispatchEvent(new EventConstructor("change", { bubbles: true }));
            colorMenu.hidden = true;
            colorTrigger.setAttribute("aria-expanded", "false");
            colorTrigger.focus();
          });
          colorMenu.append(choice);
        }
        const paintColor = () => {
          colorSwatch.style.backgroundColor = eventColors[draft.color];
          const equivalent = draft.color === 1 ? 7 : draft.color === 3 ? 8 : draft.color === 4 ? 9 : draft.color;
          for (const [index, choice] of Array.from(colorMenu.children).entries())
            choice.setAttribute(
              "aria-selected",
              String(palette[index][0] === draft.color || palette[index][0] === equivalent),
            );
        };
        colorTrigger.addEventListener("click", () => {
          colorMenu.hidden = !colorMenu.hidden;
          colorTrigger.setAttribute("aria-expanded", String(!colorMenu.hidden));
        });
        colorTrigger.addEventListener("keydown", (event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          colorMenu.hidden = false;
          colorTrigger.setAttribute("aria-expanded", "true");
          const selected = colorMenu.querySelector<HTMLButtonElement>('[role="option"][aria-selected="true"]');
          const target = selected ?? colorMenu.querySelector<HTMLButtonElement>('[role="option"]');
          target?.focus();
        });
        colorMenu.addEventListener("keydown", (event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          const options = Array.from(colorMenu.querySelectorAll<HTMLButtonElement>('[role="option"]'));
          const index = options.indexOf(doc.activeElement as HTMLButtonElement);
          const next = Math.max(0, Math.min(options.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
          options[next]?.focus();
        });
        colorControl.append(colorTrigger, colorMenu, color);
        paintColor();
        const dates = doc.createElement("div");
        dates.className = "semlo-editor-calendar-event-dates";
        const start = doc.createElement("input");
        start.type = "text";
        start.setAttribute("aria-label", "开始日期");
        start.value = draft.start;
        start.disabled = !editor.isEditable;
        const end = doc.createElement("input");
        end.type = "text";
        end.setAttribute("aria-label", "结束日期");
        end.value = draft.end;
        end.disabled = !editor.isEditable;
        const separator = doc.createElement("span");
        separator.textContent = "→";
        dates.append(start, separator, end);
        const description = doc.createElement("textarea");
        description.className = "semlo-editor-calendar-event-description";
        description.placeholder = "添加说明";
        description.setAttribute("aria-label", "日程说明");
        description.rows = 2;
        description.value = draft.description;
        description.disabled = !editor.isEditable;
        panel.append(actions, title, colorControl, dates, description);
        doc.body.append(panel);
        const win = doc.defaultView;
        let frame: number | undefined;
        let rangePicker: ReturnType<typeof createCalendarRangePicker> | undefined;
        const position = () => {
          if (!panel.isConnected || !win) return;
          const entries = Array.from(dom.querySelectorAll<HTMLElement>(".semlo-editor-calendar-event"));
          const matching = entries.filter((entry) => entry.dataset.eventId === draft.id);
          const currentAnchor =
            matching.find((entry) => entry.dataset.date! <= date && entry.dataset.endDate! >= date) ??
            matching[0] ??
            anchor;
          const rect = currentAnchor.getBoundingClientRect();
          const width = panel.offsetWidth;
          const right = rect.right + 16;
          const preferred = right + width <= win.innerWidth - 8 ? right : rect.right - width - 16;
          panel.style.left = `${Math.max(8, Math.min(preferred, win.innerWidth - width - 8))}px`;
          panel.style.top = `${Math.max(8, Math.min(rect.top, win.innerHeight - panel.offsetHeight - 8))}px`;
          rangePicker?.position();
        };
        const schedulePosition = () => {
          if (!win || frame !== undefined) return;
          frame = win.requestAnimationFrame(() => {
            frame = undefined;
            position();
          });
        };
        position();
        let closed = false;
        let titleComposing = false;
        let descriptionComposing = false;
        title.addEventListener("compositionstart", () => {
          titleComposing = true;
        });
        title.addEventListener("compositionend", () => {
          titleComposing = false;
          if (!closed && title.value !== draft.title) title.value = draft.title;
        });
        description.addEventListener("compositionstart", () => {
          descriptionComposing = true;
        });
        description.addEventListener("compositionend", () => {
          descriptionComposing = false;
          if (!closed && description.value !== draft.description) description.value = draft.description;
        });
        const reconcile = (sent: CalendarEvent, creating = false) => {
          if (closed || editor.isDestroyed) return;
          const matches = getEvents().filter((item) => item.id === sent.id);
          const actual = matches[0];
          // A changed or duplicated just-created event may be an unrelated
          // host event with the same ID; its identity cannot be inferred.
          if (
            creating &&
            (idCount(sent.id) !== 1 || matches.length !== 1 || JSON.stringify(actual) !== JSON.stringify(sent))
          ) {
            close();
            return;
          }
          if (!actual) {
            close();
            return;
          }
          draft = { ...actual };
          if (actual.title !== sent.title && !titleComposing) title.value = actual.title;
          if (actual.description !== sent.description && !descriptionComposing) description.value = actual.description;
          if (actual.color !== sent.color) {
            color.value = String(actual.color);
            paintColor();
          }
          if (actual.start !== sent.start || actual.end !== sent.end) {
            rangePicker?.close();
            start.value = actual.start;
            end.value = actual.end;
          }
        };
        const updateAndReconcile = (sent: CalendarEvent, apply: () => void, creating = false) => {
          try {
            apply();
          } catch (error) {
            // Surface reconciliation failure without replacing the host's original error.
            try {
              reconcile(sent, creating);
            } catch (reconcileError) {
              const report = doc.defaultView?.reportError;
              if (typeof report === "function") {
                try {
                  report.call(doc.defaultView, reconcileError);
                } catch (reportError) {
                  queueMicrotask(() => {
                    throw new AggregateError([reconcileError, reportError], "日程同步异常报告失败", {
                      cause: reconcileError,
                    });
                  });
                }
              } else
                queueMicrotask(() => {
                  throw reconcileError;
                });
            }
            throw error;
          }
          reconcile(sent, creating);
        };
        const persist = (separateHistory = false) => {
          if (closed || !editor.isEditable || editor.isDestroyed) return;
          const events = getEvents(),
            index = events.findIndex((item) => item.id === draft.id);
          if (idCount(draft.id) > 1) {
            closePopup?.();
            warnDuplicate();
            return;
          }
          const sent = { ...draft };
          if (index >= 0) events[index] = sent;
          else events.push(sent);
          updateAndReconcile(sent, () => update(events, separateHistory));
          if (!closed) schedulePosition();
        };
        title.addEventListener("input", () => {
          draft = { ...draft, title: title.value };
          persist();
        });
        description.addEventListener("input", () => {
          draft = { ...draft, description: description.value };
          persist();
        });
        color.addEventListener("change", () => {
          draft = { ...draft, color: Number(color.value) };
          paintColor();
          persist();
        });
        rangePicker = createCalendarRangePicker({
          panel,
          start,
          end,
          value: () => ({ start: draft.start, end: draft.end }),
          commit: (nextStart, nextEnd) => {
            if (draft.start === nextStart && draft.end === nextEnd) return;
            draft = { ...draft, start: nextStart, end: nextEnd };
            persist(true);
          },
        });
        const outside = (event: Event) => {
          if (!panel.contains(event.target as globalThis.Node)) close();
          else {
            if (!colorControl.contains(event.target as globalThis.Node)) {
              colorMenu.hidden = true;
              colorTrigger.setAttribute("aria-expanded", "false");
            }
            if (
              rangePicker?.isOpen() &&
              event.target !== start &&
              event.target !== end &&
              !(event.target as Element).closest?.(".semlo-editor-calendar-range")
            )
              rangePicker.close();
          }
        };
        const key = (event: KeyboardEvent) => {
          if (event.isComposing || event.keyCode === 229) return;
          if (event.key === "Enter" && (event.target === title || event.target === description)) {
            event.preventDefault();
            event.stopPropagation();
            close();
            view.focus();
            return;
          }
          if (event.key === "Tab" && !event.shiftKey && event.target === description) {
            event.preventDefault();
            event.stopPropagation();
            close();
            view.focus();
            return;
          }
          if (event.key === "Escape") {
            if (!panel.contains(event.target as globalThis.Node)) return;
            event.preventDefault();
            event.stopPropagation();
            close();
            view.focus();
          }
        };
        const close = () => {
          if (closed) return;
          closed = true;
          rangePicker?.close();
          if (closePopup === close) closePopup = undefined;
          activeEventId = undefined;
          for (const entry of dom.querySelectorAll<HTMLElement>(".semlo-editor-calendar-event"))
            entry.classList.remove("is-active");
          panel.remove();
          doc.removeEventListener("pointerdown", outside, true);
          doc.removeEventListener("keydown", key, true);
          doc.removeEventListener("scroll", schedulePosition, true);
          win?.removeEventListener("resize", schedulePosition);
          if (frame !== undefined) win?.cancelAnimationFrame(frame);
        };
        remove.addEventListener("click", () => {
          if (closed || !editor.isEditable || editor.isDestroyed) return;
          const events = getEvents();
          if (idCount(draft.id) > 1) {
            close();
            warnDuplicate();
            return;
          }
          update(events.filter((item) => item.id !== draft.id));
          close();
          view.focus();
        });
        dismiss.addEventListener("click", () => {
          close();
          view.focus();
        });
        closePopup = close;
        doc.addEventListener("pointerdown", outside, true);
        doc.addEventListener("keydown", key, true);
        doc.addEventListener("scroll", schedulePosition, true);
        win?.addEventListener("resize", schedulePosition);
        if (!found && editor.isEditable) {
          const sent = { ...draft };
          updateAndReconcile(
            sent,
            () => update([...getEvents(), sent], true, (nextColorIndex + 1) % newEventColors.length),
            true,
          );
        }
        if (!closed) {
          schedulePosition();
          if (editor.isEditable) title.focus();
        }
      };
      const paint = () => {
        calendarDrag.cancel();
        dom.classList.toggle("is-selected", selected && editor.isEditable);
        dom.replaceChildren();
        const header = doc.createElement("div");
        header.className = "semlo-editor-calendar-header";
        const prev = doc.createElement("button");
        prev.type = "button";
        prev.setAttribute("aria-label", "日历上个月");
        prev.textContent = "‹";
        prev.addEventListener("click", () => {
          closePopup?.();
          move(-1);
        });
        const label = doc.createElement("strong");
        label.textContent = `${year} 年 ${month + 1} 月`;
        const next = doc.createElement("button");
        next.type = "button";
        next.setAttribute("aria-label", "日历下个月");
        next.textContent = "›";
        next.addEventListener("click", () => {
          closePopup?.();
          move(1);
        });
        const center = doc.createElement("div");
        center.className = "semlo-editor-calendar-month";
        center.append(prev, label, next);
        const today = doc.createElement("button");
        today.type = "button";
        today.className = "semlo-editor-calendar-today";
        today.textContent = "今天";
        today.addEventListener("click", () => {
          closePopup?.();
          const d = new Date();
          year = d.getFullYear();
          month = d.getMonth();
          paint();
        });
        header.append(center, today);
        dom.append(header);
        const warning = [eventsWarning(current.attrs.events), colorSequenceWarning(current.attrs.nextColorIndex)]
          .filter(Boolean)
          .join(" ");
        if (warning) {
          const message = doc.createElement("div");
          message.className = "semlo-editor-calendar-payload-warning";
          message.setAttribute("role", "status");
          message.textContent = warning;
          dom.append(message);
        }
        const weekdays = doc.createElement("div");
        weekdays.className = "semlo-editor-calendar-weekdays";
        for (const label of ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"]) {
          const span = doc.createElement("span");
          span.textContent = label;
          weekdays.append(span);
        }
        dom.append(weekdays);
        const grid = doc.createElement("div");
        grid.className = "semlo-editor-calendar-grid";
        grid.setAttribute("role", "grid");
        grid.setAttribute("aria-label", `${year}年${month + 1}月日历`);
        const events = getEvents(),
          todayValue = todayISO(),
          days = monthGrid(year, month);
        for (let offset = 0; offset < days.length; offset += 7) {
          const weekDays = days.slice(offset, offset + 7);
          const week = doc.createElement("div");
          week.className = "semlo-editor-calendar-week";
          for (const [column, item] of weekDays.entries()) {
            const cell = doc.createElement("div");
            cell.className = "semlo-editor-calendar-cell";
            cell.classList.toggle("is-outside", !item.current);
            cell.dataset.date = item.date;
            cell.style.gridColumn = String(column + 1);
            const number = doc.createElement("span");
            number.className = "semlo-editor-calendar-day";
            number.textContent = String(item.day);
            number.classList.toggle("is-today", item.date === todayValue);
            cell.append(number);
            if (
              editor.isEditable &&
              Array.isArray(current.attrs.events) &&
              !colorSequenceWarning(current.attrs.nextColorIndex)
            ) {
              const add = doc.createElement("button");
              add.type = "button";
              add.className = "semlo-editor-calendar-add";
              add.setAttribute("aria-label", `${item.date} 添加日程`);
              add.textContent = "+";
              add.addEventListener("click", () => editEvent(undefined, item.date, cell));
              cell.addEventListener("click", (event) => {
                if (!(event.target as Element).closest("button")) editEvent(undefined, item.date, cell);
              });
              cell.append(add);
            }
            week.append(cell);
          }
          for (const segment of layoutCalendarWeek(
            events,
            weekDays.map((item) => item.date),
          )) {
            const { event, startColumn, endColumn, lane, continuesBefore, continuesAfter } = segment;
            const entry = doc.createElement("button");
            entry.type = "button";
            entry.className = "semlo-editor-calendar-event";
            entry.classList.toggle("continues-before", continuesBefore);
            entry.classList.toggle("continues-after", continuesAfter);
            entry.classList.toggle("is-active", event.id === activeEventId);
            entry.style.gridColumn = `${startColumn + 1} / ${endColumn + 2}`;
            entry.style.marginTop = `${28 + lane * 27}px`;
            entry.style.setProperty("--semlo-editor-calendar-event-color", eventColors[event.color]);
            // Keep the browser from cancelling a touch drag in favour of page scrolling.
            // Read-only events retain the normal scrolling gesture.
            if (editor.isEditable) entry.style.touchAction = "none";
            entry.dataset.eventId = event.id;
            entry.dataset.date = weekDays[startColumn].date;
            entry.dataset.endDate = weekDays[endColumn].date;
            entry.dataset.lane = String(lane);
            if (continuesBefore) {
              const continuation = doc.createElement("span");
              continuation.className = "semlo-editor-calendar-continuation is-before";
              continuation.setAttribute("aria-hidden", "true");
              entry.append(continuation);
            }
            entry.append(doc.createTextNode(event.title || "添加日程标题"));
            if (continuesAfter) {
              const continuation = doc.createElement("span");
              continuation.className = "semlo-editor-calendar-continuation is-after";
              continuation.setAttribute("aria-hidden", "true");
              entry.append(continuation);
            } else if (editor.isEditable) {
              const resize = doc.createElement("span");
              resize.className = "semlo-editor-calendar-resize-end";
              resize.dataset.calendarEdge = "end";
              resize.setAttribute("aria-hidden", "true");
              entry.append(resize);
            }
            entry.setAttribute("aria-label", `日程：${event.title || "添加日程标题"}`);
            entry.addEventListener("click", () => editEvent(event.id, weekDays[startColumn].date, entry));
            week.append(entry);
          }
          grid.append(week);
        }
        dom.append(grid);
      };
      const editableChanged = () => {
        calendarDrag.cancel();
        closePopup?.();
        paint();
      };
      const replacedSameNodes = new WeakSet<Transaction>();
      const transaction = ({
        transaction,
        appendedTransactions = [],
      }: {
        transaction: Transaction;
        appendedTransactions?: Transaction[];
      }) => {
        if (editor.isDestroyed) return;
        const position = getPos();
        if (
          replacedSameNodes.has(transaction) ||
          (typeof position === "number" && appendedReplacesSameNode(appendedTransactions, position, current))
        ) {
          calendarDrag.cancel();
          closePopup?.();
        }
        if (updatingEvent) return;
        const pos = getPos();
        const node = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
        if (node && node.type === current.type && node !== current) {
          // ProseMirror can reuse a node view for an equal replacement without
          // calling update(); it still belongs to a different document node.
          calendarDrag.cancel();
          closePopup?.();
          current = node;
        }
      };
      const beforeTransaction = ({ transaction }: { transaction: Transaction }) => {
        const pos = getPos();
        if (typeof pos !== "number") return;
        const before = view.state.doc.nodeAt(pos);
        if (transaction !== popupTransaction && before === current && replacesSameNode(transaction, pos, current))
          replacedSameNodes.add(transaction);
        if (!updatingEvent || transaction === popupTransaction) return;
        const after = transaction.doc.nodeAt(pos);
        if (before && after && before !== after && before.type === current.type && before.eq(after)) closePopup?.();
      };
      view.dom.addEventListener("semlo-editor:editable", editableChanged);
      editor.on("beforeTransaction", beforeTransaction);
      editor.on("transaction", transaction);
      paint();
      return {
        dom,
        update(node) {
          if (node.type !== current.type) return false;
          if (node !== current) calendarDrag.cancel();
          if (node !== current && !updatingEvent) closePopup?.();
          current = node;
          paint();
          return true;
        },
        selectNode() {
          selected = true;
          dom.classList.toggle("is-selected", editor.isEditable);
        },
        deselectNode() {
          selected = false;
          dom.classList.remove("is-selected");
        },
        stopEvent(event) {
          const target = event.target as Element;
          return !!target.closest?.("button,input,textarea,select");
        },
        ignoreMutation: () => true,
        destroy() {
          calendarDrag.destroy();
          closePopup?.();
          editor.off("beforeTransaction", beforeTransaction);
          editor.off("transaction", transaction);
          view.dom.removeEventListener("semlo-editor:editable", editableChanged);
        },
      };
    };
  },
});
