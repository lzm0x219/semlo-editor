import type { NodeViewRenderer } from "@tiptap/core";
import { closeHistory } from "@tiptap/pm/history";
import { type Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Transaction } from "@tiptap/pm/state";

import { dateFromISO, todayISO } from "../../shared/date/date-utils";
import { createColumnDrag } from "./column-drag";
import { createDatabaseEditSession } from "./edit-session";
import { createDatabaseCellInteractions } from "./interactions/cells";
import { createDatabaseFieldInteractions } from "./interactions/fields";
import { createDatabasePopover } from "./interactions/popover";
import { createDatabaseQueryPanels } from "./interactions/query-panels";
import { createDatabaseViewSettings } from "./interactions/view-settings";
import {
  createDatabaseRecord,
  DatabaseContentError,
  databaseValueText,
  visibleDatabaseRecords,
  type DatabaseData,
  type DatabaseField,
  type DatabaseFieldType,
  type DatabaseRecord,
  type DatabaseStatistic,
  type DatabaseView,
} from "./model";
import { readDatabaseActor, reportDatabaseError, type DatabaseOptions } from "./options";
import { captureDatabaseChange, finalizeDatabaseChange } from "./record-change";
import { createRowDrag } from "./row-drag";
import { validateDatabaseData } from "./validation";
import { getDatabaseViewProjection, setDatabaseViewProjection } from "./view-projection";
import { createDatabaseViewState } from "./view-state";
import { createBoardDrag } from "./views/board/drag";
import { createCalendarDrag } from "./views/calendar/drag";
import { paintDatabaseCalendar } from "./views/calendar/view";
import { createCardViews } from "./views/cards";
import { paintDatabaseCharts, type DatabaseChartsHandle } from "./views/chart/view";
import { createTableView } from "./views/table/view";

const fieldIcons: Record<DatabaseFieldType, string> = {
  text: "T",
  number: "#",
  singleSelect: "◉",
  multiSelect: "☷",
  person: "♙",
  image: "▧",
  attachment: "⌁",
  date: "▦",
  createdTime: "▦",
  modifiedTime: "▦",
  createdBy: "♙",
  modifiedBy: "♙",
  checkbox: "☑",
  link: "↗",
  email: "✉",
  phone: "☎",
  rating: "☆",
  progress: "▰",
};
const toolbarIcon = (path: string) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
const toolbarIcons = {
  table: toolbarIcon('<rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M2 6h12M2 10h12M6 2v12M10 2v12"/>'),
  gallery: toolbarIcon(
    '<rect x="2" y="2" width="12" height="12" rx="1.5"/><circle cx="5.3" cy="5.3" r="1.2"/><path d="m3.3 12 3.2-3.3 2.1 2 1.8-1.7 2.3 3"/>',
  ),
  kanban: toolbarIcon(
    '<rect x="2" y="2" width="12" height="12" rx="1.5"/><path d="M6 2v12M10 2v12M3.5 5h1M7.5 5h1M11.5 5h1"/>',
  ),
  calendar: toolbarIcon(
    '<rect x="2.5" y="3.5" width="11" height="10" rx="1.2"/><path d="M5 2v3M11 2v3M2.5 6.5h11M5.2 9h1M8 9h1M10.8 9h1M5.2 11.5h1M8 11.5h1"/>',
  ),
  chart: toolbarIcon('<path d="M2.5 2.5v11h11M5 11V7.5M8 11V4.5M11 11V6"/>'),
  fields: toolbarIcon(
    '<circle cx="8" cy="8" r="2.1"/><path d="M8 1.7v1.1M8 13.2v1.1M1.7 8h1.1M13.2 8h1.1M3.55 3.55l.8.8m7.3 7.3.8.8m0-8.9-.8.8m-7.3 7.3-.8.8"/><circle cx="8" cy="8" r="5.1"/>',
  ),
  filter: toolbarIcon('<path d="M2.5 4.5h11M4.5 8h7M6.5 11.5h3"/>'),
  group: toolbarIcon('<rect x="2.5" y="2.5" width="11" height="11" rx="1.2"/><path d="M5 6h6M5 9h6M5 11.5h4"/>'),
  sort: toolbarIcon('<path d="M5 2.5v10M3 4.5l2-2 2 2M11 13.5v-10M9 11.5l2 2 2-2"/>'),
  height: toolbarIcon('<path d="M3 4h7M3 8h7M3 12h7M12.5 3v10M11 4.5 12.5 3 14 4.5M11 11.5l1.5 1.5 1.5-1.5"/>'),
  fullscreen: toolbarIcon('<path d="M6 2.5H2.5V6M10 2.5h3.5V6M2.5 10v3.5H6M13.5 10v3.5H10"/>'),
  minimize: toolbarIcon('<path d="M2.5 6H6V2.5M10 2.5V6h3.5M2.5 10H6v3.5M13.5 10H10v3.5"/>'),
  search: toolbarIcon('<circle cx="7" cy="7" r="4.3"/><path d="m10.2 10.2 3.2 3.2"/>'),
};
const optionColors = ["#dbf2e6", "#fff0ca", "#d9eaff", "#f7dfe3", "#eae1fa", "#e3e6e8", "#ffe5d7", "#d7f1f0"];

export function createDatabaseNodeView(getOptions: () => DatabaseOptions): NodeViewRenderer {
  return ({ editor, view, node: initial, getPos }) => {
    const doc = view.dom.ownerDocument;
    const dom = doc.createElement("div");
    dom.className = "semlo-editor-database";
    dom.dataset.type = "semloEditorDatabase";
    dom.contentEditable = "false";
    const surface = doc.createElement("div");
    surface.className = "semlo-editor-database-surface";
    dom.append(surface);
    let current = initial;
    let writing = false;
    let expectedWriteNode: ProseMirrorNode | null = null;
    let expectedWriteTransaction: Transaction | null = null;
    let expectedWritePosition = 0;
    let destroyed = false;
    let query = "";
    let searchOpen = false;
    let maximized = false;
    let readonlyViewId = "";
    const viewState = createDatabaseViewState();
    const { calendarMonths, collapsedGroupsByView } = viewState;
    let lastEditingElement: HTMLElement | null = null;
    let pendingBodyRefresh = false;
    let paintingRowSnapshot:
      | { node: ProseMirrorNode; data: DatabaseData; view: DatabaseView; editable: boolean }
      | undefined;
    let refreshFrame: number | undefined;
    const pendingGroups = new Map<string, { viewId: string; fieldId: string; value: boolean | [] | "" }>();
    let selected = new Set<string>();
    let chartView: DatabaseChartsHandle | undefined;
    const reportContentError = (error: DatabaseContentError) => reportDatabaseError(getOptions(), error);
    const closeChartView = () => {
      chartView?.();
      chartView = undefined;
    };

    const guard =
      <EventType extends Event>(element: HTMLElement, action: (event: EventType) => void) =>
      (event: EventType) => {
        if (destroyed || !dom.contains(element)) return;
        action(event);
      };
    const getData = () => validateDatabaseData(current.attrs.data);
    const getView = (data: DatabaseData) =>
      data.views.find(
        (item) => item.id === (!editor.isEditable && readonlyViewId ? readonlyViewId : data.activeViewId),
      ) ?? data.views[0];
    const popovers = createDatabasePopover({
      doc,
      dom,
      editor,
      getOptions,
      reportContentError,
      isDestroyed: () => destroyed,
      scheduleBodyRefresh,
      button: (label, text, action, className, allowReadonly) => button(label, text, action, className, allowReadonly),
    });
    const { closePopup, panel, panelHeading, personSearch, filePicker } = popovers;
    const keyDown = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        event.keyCode === 229 ||
        event.key !== "Escape" ||
        !dom.contains(event.target as globalThis.Node)
      )
        return;
      if (popovers.current) {
        closePopup();
        event.stopPropagation();
      } else if (maximized) {
        maximized = false;
        dom.classList.remove("is-maximized");
        event.stopPropagation();
      }
    };
    doc.addEventListener("keydown", keyDown);
    const button = (label: string, text: string, action: () => void, className = "", allowReadonly = false) => {
      const item = doc.createElement("button");
      item.type = "button";
      item.className = className;
      item.setAttribute("aria-label", label);
      item.title = label;
      item.textContent = text;
      item.disabled = !editor.isEditable && !allowReadonly;
      item.addEventListener(
        "click",
        guard(item, (event) => {
          event.preventDefault();
          event.stopPropagation();
          action();
        }),
      );
      return item;
    };
    const option = (value: string, label: string) => {
      const item = doc.createElement("option");
      item.value = value;
      item.textContent = label;
      return item;
    };
    const label = (text: string, control: HTMLElement) => {
      const wrapper = doc.createElement("label");
      wrapper.className = "semlo-editor-database-label";
      const caption = doc.createElement("span");
      caption.textContent = text;
      wrapper.append(caption, control);
      return wrapper;
    };
    const dispatchWrite = (transaction: Transaction, pos: number) => {
      const previousWriting = writing;
      const previousExpected = expectedWriteNode;
      const previousTransaction = expectedWriteTransaction;
      const previousPosition = expectedWritePosition;
      writing = true;
      expectedWriteNode = transaction.doc.nodeAt(pos);
      expectedWriteTransaction = transaction;
      expectedWritePosition = pos;
      const projection = getDatabaseViewProjection(dom);
      const previousNode = transaction.before.nodeAt(pos);
      const nextExpected = expectedWriteNode;
      try {
        view.dispatch(transaction);
        const nextPos = getPos();
        const live = typeof nextPos === "number" ? view.state.doc.nodeAt(nextPos) : null;
        if (
          projection &&
          projection.node === previousNode &&
          getDatabaseViewProjection(dom) === projection &&
          live &&
          nextExpected &&
          live.eq(nextExpected)
        ) {
          setDatabaseViewProjection(dom, { ...projection, node: live });
          dom.dispatchEvent(
            new (doc.defaultView?.Event ?? Event)("semlo-editor:database-view-change", { bubbles: true }),
          );
        }
      } finally {
        writing = previousWriting;
        expectedWriteNode = previousExpected;
        expectedWriteTransaction = previousTransaction;
        expectedWritePosition = previousPosition;
      }
    };
    const change = (
      mutate: (data: DatabaseData, active: DatabaseView) => void,
      repaint = true,
      origin?: HTMLElement,
      onContentError?: (error: DatabaseContentError) => void,
    ) => {
      if (destroyed || editor.isDestroyed || !editor.isEditable || (origin && !dom.contains(origin))) return false;
      const pos = getPos();
      const live = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
      if (typeof pos !== "number" || !live || live.type !== current.type || live !== current) return false;
      const data = validateDatabaseData(live.attrs.data);
      const baseline = captureDatabaseChange(data);
      const rejectContent = (error: unknown): false => {
        if (!(error instanceof DatabaseContentError)) throw error;
        onContentError?.(error);
        reportContentError(error);
        return false;
      };
      try {
        mutate(data, getView(data));
      } catch (error) {
        return rejectContent(error);
      }
      let nextData: DatabaseData;
      try {
        nextData = finalizeDatabaseChange(data, baseline, () => readDatabaseActor(getOptions()));
      } catch (error) {
        return rejectContent(error);
      }
      if (JSON.stringify(nextData) === baseline.serialized) return false;
      // Host callbacks used while building the change may synchronously
      // replace the document, change editability, or destroy the editor.
      if (
        destroyed ||
        editor.isDestroyed ||
        !editor.isEditable ||
        getPos() !== pos ||
        view.state.doc.nodeAt(pos) !== live ||
        (origin && !dom.contains(origin))
      )
        return false;
      const input = origin instanceof (doc.defaultView?.HTMLInputElement ?? HTMLInputElement) ? origin : null;
      const continuous = !!input && !["checkbox", "radio"].includes(input.type);
      const transaction = view.state.tr.setNodeMarkup(pos, undefined, { ...live.attrs, data: nextData });
      if (!continuous || lastEditingElement !== input) closeHistory(transaction);
      lastEditingElement = continuous ? input : null;
      const changedPinnedGroups = [...pendingGroups].filter(([id, pin]) => {
        const previous = baseline.records.get(id);
        const record = nextData.records.find((entry) => entry.id === id);
        const checkboxGroup = nextData.fields.find((field) => field.id === pin.fieldId)?.type === "checkbox";
        return (
          (checkboxGroup && nextData.records.length < baseline.records.size) ||
          (previous && record && JSON.stringify(previous[pin.fieldId]) !== JSON.stringify(record.values[pin.fieldId]))
        );
      });
      dispatchWrite(transaction, pos);
      for (const [id, pin] of changedPinnedGroups) if (pendingGroups.get(id) === pin) pendingGroups.delete(id);
      if (repaint) paint();
      return true;
    };
    const boardDrag = createBoardDrag({
      root: dom,
      snapshot: () => {
        const data = getData();
        return {
          node: current,
          data,
          view: getView(data),
          editable: !destroyed && editor.isEditable,
        };
      },
      commit: (node, mutate) => node === current && change(mutate),
    });
    const columnDrag = createColumnDrag({
      root: dom,
      snapshot: () => {
        const data = getData();
        return { node: current, data, view: getView(data), editable: !destroyed && editor.isEditable };
      },
      commit: (node, mutate) => node === current && change(mutate),
    });
    const rowDrag = createRowDrag({
      root: dom,
      groupValue: (recordId, viewId, fieldId, value) => {
        const pin = pendingGroups.get(recordId);
        return pin?.viewId === viewId && pin.fieldId === fieldId ? pin.value : value;
      },
      clearProjection: (recordId) => {
        if (pendingGroups.delete(recordId)) paint();
      },
      snapshot: () => {
        if (paintingRowSnapshot?.node === current && paintingRowSnapshot.editable === (!destroyed && editor.isEditable))
          return paintingRowSnapshot;
        const data = getData();
        return { node: current, data, view: getView(data), editable: !destroyed && editor.isEditable };
      },
      commit: (node, mutate) => node === current && change(mutate),
    });
    const calendarDrag = createCalendarDrag({
      root: dom,
      snapshot: () => {
        const data = getData();
        return { node: current, data, view: getView(data), editable: !destroyed && editor.isEditable };
      },
      commit: (node, mutate) => node === current && change(mutate),
    });
    const cellSessions = createDatabaseEditSession({
      dom,
      editor,
      view,
      getPos,
      getCurrent: () => current,
      setCurrent: (node) => {
        current = node;
      },
      isDestroyed: () => destroyed,
      getData,
      getActor: () => readDatabaseActor(getOptions()),
      reportError: reportContentError,
      onValueApplied: (input) => {
        if (popovers.current?.contains(input)) repaintBody();
      },
      dispatchWrite,
      endContinuousEditing: () => {
        lastEditingElement = null;
      },
      finishEditing: (input) => finishEditing(input),
    });
    const { finishCellSession } = cellSessions;
    const { addFilter, filterPanel, groupPanel, sortPanel } = createDatabaseQueryPanels({
      doc,
      dom,
      editor,
      getData,
      getView,
      getPopup: () => popovers.current,
      endContinuousEditing: () => {
        lastEditingElement = null;
      },
      panel,
      panelHeading,
      closePopup,
      option,
      button,
      change,
    });

    const { editField, fieldMenu } = createDatabaseFieldInteractions({
      doc,
      optionColors,
      getData,
      change,
      panel,
      closePopup,
      button,
      option,
      label,
      addFilter,
      cancelPersonSearch: popovers.cancelPersonSearch,
      personSearch,
      filePicker,
    });

    const { fieldsPanel, calendarSettingsPanel, createViewPanel, viewPanel, heightPanel } = createDatabaseViewSettings({
      doc,
      dom,
      editor,
      fieldIcons,
      getData,
      getView,
      change,
      panel,
      panelHeading,
      closePopup,
      button,
      option,
      label,
      repaintBody,
      switchReadonlyView: (viewId) => {
        readonlyViewId = viewId;
        paint();
      },
    });

    const finishEditing = (input: HTMLElement) => {
      const active = getView(getData());
      if (
        input.dataset.semloEditorHistory !== "cell" ||
        active.kind !== "table" ||
        (!active.filters.length && !active.sorts.length && !active.groupFieldId)
      )
        return;
      pendingBodyRefresh = true;
      scheduleBodyRefresh();
    };

    function scheduleBodyRefresh() {
      const win = doc.defaultView;
      if (!pendingBodyRefresh || destroyed || !win) return;
      if (refreshFrame !== undefined) win.cancelAnimationFrame(refreshFrame);
      refreshFrame = win.requestAnimationFrame(() => {
        refreshFrame = undefined;
        const body = surface.querySelector<HTMLDivElement>(".semlo-editor-database-body");
        if (
          !pendingBodyRefresh ||
          destroyed ||
          popovers.current ||
          (doc.activeElement && body?.contains(doc.activeElement))
        )
          return;
        pendingBodyRefresh = false;
        repaintBody();
      });
    }

    function repaintBody() {
      boardDrag.cancel();
      columnDrag.cancel();
      rowDrag.cancel();
      calendarDrag.cancel();
      closeChartView();
      const data = getData();
      const active = getView(data);
      const records = visibleDatabaseRecords(data, active, query);
      const body = surface.querySelector<HTMLDivElement>(".semlo-editor-database-body");
      if (!body) return;
      body.replaceChildren();
      if (active.kind !== "table") setDatabaseViewProjection(dom, undefined);
      if (active.kind === "table") paintGrid(body, data, active, records);
      else if (active.kind === "calendar") paintCalendar(body, data, active, records);
      else if (active.kind === "chart") paintCharts(body, data, active, records);
      else paintCards(body, data, active, records);
      dom.dispatchEvent(new (doc.defaultView?.Event ?? Event)("semlo-editor:database-view-change", { bubbles: true }));
    }

    function paintCharts(container: HTMLElement, data: DatabaseData, active: DatabaseView, records: DatabaseRecord[]) {
      const expectedNode = current;
      chartView = paintDatabaseCharts({
        doc,
        container,
        data,
        view: active,
        records,
        editable: editor.isEditable,
        onCommit(charts) {
          if (destroyed || current !== expectedNode) return;
          change((next, nextView) => {
            if (next.id === data.id && nextView.id === active.id && nextView.kind === "chart") nextView.charts = charts;
          });
        },
      });
    }

    const { makeCell } = createDatabaseCellInteractions({
      doc,
      dom,
      editor,
      optionColors,
      cellSessions,
      getData,
      change,
      panel,
      panelHeading,
      closePopup,
      button,
      personSearch,
      filePicker,
    });

    const recordPanel = (anchor: HTMLElement, record: DatabaseRecord, index: number) => {
      const dialog = panel(anchor, "记录详情");
      panelHeading(dialog, "记录详情");
      for (const field of getData().fields) dialog.append(label(field.name, makeCell(field, record, index)));
      if (editor.isEditable)
        dialog.append(
          button("删除记录", "删除记录", () => {
            change((data) => {
              data.records = data.records.filter((entry) => entry.id !== record.id);
            });
            closePopup();
          }),
        );
    };

    const calendarRecordPanel = (anchor: HTMLElement, record: DatabaseRecord, index: number) => {
      const data = getData();
      const active = getView(data);
      const { titleFieldId, colorFieldId, startFieldId, endFieldId } = active.calendar;
      const titleField = data.fields.find((field) => field.id === titleFieldId);
      const title = (titleField && databaseValueText(titleField, record.values[titleField.id])) || "未命名日程";
      const dialog = panel(anchor, "日程详情");
      panelHeading(dialog, title);
      for (const id of new Set([titleFieldId, colorFieldId, startFieldId, endFieldId])) {
        const field = data.fields.find((item) => item.id === id);
        if (field) dialog.append(label(field.name, makeCell(field, record, index)));
      }
      dialog.append(
        button(
          "打开记录详情",
          "打开记录详情",
          () => {
            const fresh = getData();
            const target = fresh.records.find((entry) => entry.id === record.id);
            if (target) recordPanel(anchor, target, fresh.records.indexOf(target));
          },
          "",
          true,
        ),
      );
    };

    const addCalendarRecord = (date: string, anchor: HTMLElement) => {
      if (!dateFromISO(date) || !dom.contains(anchor)) return;
      let recordId = "";
      const added = change(
        (data, active) => {
          if (active.kind !== "calendar") return;
          const start = data.fields.find(
            (field) =>
              field.id === active.calendar.startFieldId && ["date", "createdTime", "modifiedTime"].includes(field.type),
          );
          if (!start) return;
          const record = createDatabaseRecord(data.fields, readDatabaseActor(getOptions()));
          recordId = record.id;
          if (start.type === "date") record.values[start.id] = date;
          const end = data.fields.find((field) => field.id === active.calendar.endFieldId && field.type === "date");
          if (end) record.values[end.id] = date;
          data.records.push(record);
        },
        true,
        anchor,
      );
      if (!added || !recordId || destroyed) return;
      const data = getData();
      const record = data.records.find((entry) => entry.id === recordId);
      if (!record) return;
      const event = Array.from(surface.querySelectorAll<HTMLElement>(".semlo-editor-database-calendar-event")).find(
        (item) => item.dataset.recordId === recordId && item.dataset.date === date,
      );
      const fallback = surface.querySelector<HTMLElement>('[aria-label="添加日程"]') ?? surface;
      const visible = visibleDatabaseRecords(data, getView(data), query);
      const index = visible.findIndex((item) => item.id === recordId);
      recordPanel(event ?? fallback, record, index < 0 ? data.records.indexOf(record) : index);
    };

    function paintCalendar(
      container: HTMLElement,
      data: DatabaseData,
      active: DatabaseView,
      records: DatabaseRecord[],
    ) {
      const today = new Date();
      // Duplicate database nodes can share IDs after copying. Scope the
      // remembered month to this editor host and this occurrence as well.
      const host = view.dom.closest(".semlo-editor")?.parentElement;
      const path: string[] = [];
      for (
        let element: Element | null = host ?? null;
        element && element !== doc.body;
        element = element.parentElement
      ) {
        if (element.id) {
          path.push(`#${element.id}`);
          break;
        }
        const parent: Element | null = element.parentElement;
        const index = parent ? Array.from(parent.children).indexOf(element) : 0;
        path.push(`${element.localName}:${index}`);
      }
      const position = getPos();
      let occurrence = 0;
      if (typeof position === "number")
        view.state.doc.descendants((node, pos) => {
          if (pos < position && node.type.name === "semloEditorDatabase" && node.attrs.data?.id === data.id)
            occurrence++;
          return true;
        });
      const scope = `${doc.location?.pathname ?? ""}:${path.reverse().join("/")}:${occurrence}`;
      const storageKey = `semlo-editor:database-calendar:${encodeURIComponent(scope)}:${data.id}:${active.id}`;
      let remembered: { year: number; month: number } | undefined;
      try {
        const saved = doc.defaultView?.sessionStorage.getItem(storageKey);
        const match = saved && /^(\d{4})-(\d{2})$/.exec(saved);
        if (match) {
          const year = Number(match[1]);
          const month = Number(match[2]) - 1;
          if (year >= 1 && year <= 9999 && month >= 0 && month <= 11) remembered = { year, month };
        }
      } catch {
        // Storage is optional; a blocked or unavailable session still works in memory.
      }
      const month = calendarMonths.get(active.id) ??
        remembered ?? { year: today.getFullYear(), month: today.getMonth() };
      calendarMonths.set(active.id, month);
      dom.dataset.semloEditorDatabaseCalendarMonth = `${String(month.year).padStart(4, "0")}-${String(month.month + 1).padStart(2, "0")}`;
      paintDatabaseCalendar({
        doc,
        container,
        data,
        view: active,
        records,
        editable: editor.isEditable,
        month,
        onMonthChange(year, nextMonth) {
          if (
            destroyed ||
            !dom.contains(container) ||
            year < 1 ||
            year > 9999 ||
            nextMonth < 0 ||
            nextMonth > 11 ||
            getData().id !== data.id ||
            getView(getData()).id !== active.id
          )
            return;
          calendarMonths.set(active.id, { year, month: nextMonth });
          try {
            doc.defaultView?.sessionStorage.setItem(
              storageKey,
              `${String(year).padStart(4, "0")}-${String(nextMonth + 1).padStart(2, "0")}`,
            );
          } catch {
            // A private or restricted environment can still keep this month in memory.
          }
          repaintBody();
          dom.dispatchEvent(
            new (doc.defaultView?.Event ?? Event)("semlo-editor:database-view-change", { bubbles: true }),
          );
        },
        onAdd(date, anchor) {
          if (getData().id === data.id && getView(getData()).id === active.id) addCalendarRecord(date, anchor);
        },
        onOpen(record, _index, anchor) {
          if (destroyed || calendarDrag.shouldSuppressClick() || !dom.contains(anchor)) return;
          const fresh = getData();
          const target = fresh.records.find((entry) => entry.id === record.id);
          const freshView = getView(fresh);
          if (fresh.id === data.id && freshView.id === active.id && target) {
            const index = visibleDatabaseRecords(fresh, freshView, query).findIndex((entry) => entry.id === target.id);
            calendarRecordPanel(anchor, target, index < 0 ? fresh.records.indexOf(target) : index);
          }
        },
      });
    }

    const statisticPanel = (anchor: HTMLElement, field: DatabaseField) => {
      const dialog = panel(anchor, `${field.name} 统计`);
      dialog.classList.add("semlo-editor-database-menu");
      const choices: [DatabaseStatistic, string][] = [
        ["none", "不展示"],
        ["count", "记录总数"],
        ["notEmpty", field.type === "checkbox" ? "已勾选" : "已填写数"],
        ["empty", field.type === "checkbox" ? "未勾选" : "未填写数"],
        ...(field.type === "checkbox" ? [] : ([["unique", "唯一数"]] as [DatabaseStatistic, string][])),
        ["notEmptyPercent", field.type === "checkbox" ? "已勾选占比" : "已填写占比"],
        ["emptyPercent", field.type === "checkbox" ? "未勾选占比" : "未填写占比"],
        ...(field.type === "checkbox" ? [] : ([["uniquePercent", "唯一数占比"]] as [DatabaseStatistic, string][])),
      ];
      if (field.type === "date" || field.type === "createdTime" || field.type === "modifiedTime")
        choices.push(
          ["earliestDate", "最早时间"],
          ["latestDate", "最晚时间"],
          ["dateRangeDays", "时间范围（日）"],
          ["dateRangeMonths", "时间范围（月）"],
        );
      if (field.type === "number" || field.type === "rating" || field.type === "progress")
        choices.push(["sum", "求和"], ["average", "平均值"]);
      if (field.type === "number") choices.push(["median", "中位数"], ["maximum", "最大值"], ["minimum", "最小值"]);
      for (const [value, name] of choices)
        dialog.append(
          button(name, name, () => {
            change((_data, active) => {
              active.statistics[field.id] = value;
            });
            closePopup();
          }),
        );
    };

    const renderGrid = createTableView({
      doc,
      dom,
      editor,
      columnDrag,
      rowDrag,
      fieldIcons,
      optionColors,
      collapsedGroupsByView,
      pendingGroups,
      getCurrent: () => current,
      getSelected: () => selected,
      isDestroyed: () => destroyed,
      getOptions,
      paint: () => paint(),
      button,
      fieldMenu,
      editField,
      makeCell,
      statisticPanel,
      change,
    });
    const paintGrid = (container: HTMLElement, data: DatabaseData, active: DatabaseView, records: DatabaseRecord[]) => {
      // 每行绑定拖动时会读取快照；本次绘制共享已校验数据，事件发生时仍重新读取文档。
      const previous = paintingRowSnapshot;
      paintingRowSnapshot = { node: current, data, view: active, editable: !destroyed && editor.isEditable };
      try {
        renderGrid(container, data, active, records);
      } finally {
        paintingRowSnapshot = previous;
      }
    };

    const paintCards = createCardViews({
      doc,
      dom,
      editor,
      boardDrag,
      optionColors,
      getOptions,
      recordPanel,
      button,
      change,
    });

    const paint = () => {
      if (destroyed) return;
      boardDrag.cancel();
      columnDrag.cancel();
      rowDrag.cancel();
      calendarDrag.cancel();
      closeChartView();
      pendingBodyRefresh = false;
      const data = getData();
      if (viewState.resetForDatabase(data.id)) {
        readonlyViewId = "";
        query = "";
        searchOpen = false;
        maximized = false;
      }
      const active = getView(data);
      viewState.prune(data);
      const viewChanged = dom.dataset.semloEditorDatabaseViewId !== active.id;
      if (viewChanged) pendingGroups.clear();
      for (const [id, pin] of pendingGroups)
        if (
          !data.records.some((record) => record.id === id) ||
          pin.viewId !== active.id ||
          pin.fieldId !== active.groupFieldId
        )
          pendingGroups.delete(id);
      dom.dataset.semloEditorDatabaseViewId = active.id;
      dom.dataset.semloEditorDatabaseViewKind = active.kind;
      if (active.kind !== "calendar") delete dom.dataset.semloEditorDatabaseCalendarMonth;
      const records = visibleDatabaseRecords(data, active, query);
      selected = new Set([...selected].filter((id) => data.records.some((record) => record.id === id)));
      dom.classList.toggle("is-readonly", !editor.isEditable);
      dom.classList.toggle("is-maximized", maximized);
      surface.replaceChildren();
      const toolbar = doc.createElement("div");
      toolbar.className = "semlo-editor-database-toolbar";
      const viewButton = button(
        "切换视图",
        active.kind === "gallery" ? "▧" : active.kind === "kanban" ? "▥" : "▦",
        () => viewPanel(viewButton),
        "semlo-editor-database-view-icon",
        true,
      );
      viewButton.innerHTML = toolbarIcons[active.kind];
      const name = doc.createElement("input");
      name.className = "semlo-editor-database-view-name";
      name.value = active.name;
      name.readOnly = !editor.isEditable;
      name.setAttribute("aria-label", "视图名称");
      name.dataset.semloEditorHistory = "view-name";
      name.addEventListener("focus", () => {
        lastEditingElement = null;
      });
      name.addEventListener("input", () =>
        change(
          (_data, view) => {
            view.name = name.value;
          },
          false,
          name,
          () => {
            name.value = getView(getData()).name;
          },
        ),
      );
      name.addEventListener("change", () => finishEditing(name));
      const addView = button(
        "新建视图",
        "+ 新建视图",
        () => createViewPanel(addView),
        "semlo-editor-database-new-view",
      );
      const spacer = doc.createElement("div");
      spacer.className = "semlo-editor-database-spacer";
      const fields = button(active.kind === "calendar" ? "日历设置" : "字段配置", "⚙", () => {
        if (active.kind === "calendar") calendarSettingsPanel(fields);
        else fieldsPanel(fields);
      });
      const filter = button("筛选", active.filters.length ? `☰ ${active.filters.length}` : "☰", () =>
        filterPanel(filter),
      );
      const group = button("分组", "▤", () => groupPanel(group));
      const sort = button("排序", "↕", () => sortPanel(sort));
      const height = button("行高", "☷", () => heightPanel(height));
      const full = button(
        maximized ? "退出全屏" : "全屏",
        maximized ? "⊟" : "⛶",
        () => {
          maximized = !maximized;
          paint();
        },
        "",
        true,
      );
      const search = button(
        "搜索",
        "⌕",
        () => {
          searchOpen = !searchOpen;
          if (!searchOpen) query = "";
          paint();
          if (searchOpen) surface.querySelector<HTMLInputElement>('[aria-label="搜索记录"]')?.focus();
        },
        "",
        true,
      );
      fields.innerHTML = toolbarIcons.fields;
      filter.innerHTML = toolbarIcons.filter;
      if (active.filters.length) {
        const count = doc.createElement("span");
        count.className = "semlo-editor-database-toolbar-count";
        count.textContent = String(active.filters.length);
        filter.append(count);
      }
      group.innerHTML = toolbarIcons.group;
      sort.innerHTML = toolbarIcons.sort;
      height.innerHTML = toolbarIcons.height;
      full.innerHTML = maximized ? toolbarIcons.minimize : toolbarIcons.fullscreen;
      search.innerHTML = toolbarIcons.search;
      toolbar.append(viewButton, name, addView, spacer);
      if (active.kind !== "chart") toolbar.append(fields);
      toolbar.append(filter);
      if (active.kind !== "calendar" && active.kind !== "chart") toolbar.append(group, sort, height);
      toolbar.append(full, search);
      if (searchOpen) {
        const input = doc.createElement("input");
        input.type = "search";
        input.className = "semlo-editor-database-search";
        input.placeholder = "搜索记录";
        input.setAttribute("aria-label", "搜索记录");
        input.value = query;
        input.addEventListener("input", () => {
          if (!dom.contains(input)) return;
          query = input.value;
          repaintBody();
        });
        toolbar.append(input);
      }
      const addRecord = button(
        active.kind === "calendar" ? "添加日程" : "添加记录",
        active.kind === "calendar" ? "+ 添加日程" : "+ 添加记录",
        () => {
          if (active.kind === "calendar") addCalendarRecord(todayISO(), addRecord);
          else
            change((next) => {
              next.records.push(createDatabaseRecord(next.fields, readDatabaseActor(getOptions())));
            });
        },
        "semlo-editor-database-add-record",
      );
      if (active.kind === "calendar" && !active.calendar.startFieldId) addRecord.disabled = true;
      if (active.kind === "chart") {
        const addChart = button(
          "添加组件",
          "+ 添加组件",
          () => chartView?.openPicker(addChart),
          "semlo-editor-database-add-record",
        );
        toolbar.append(addChart);
      } else toolbar.append(addRecord);
      if (selected.size)
        toolbar.append(
          button(
            "删除选中记录",
            `删除 ${selected.size} 条`,
            () => {
              change((next) => {
                next.records = next.records.filter((record) => !selected.has(record.id));
              });
              selected.clear();
              paint();
            },
            "semlo-editor-database-delete-selected",
          ),
        );
      surface.append(toolbar);
      const body = doc.createElement("div");
      body.className = "semlo-editor-database-body";
      if (active.kind !== "table") setDatabaseViewProjection(dom, undefined);
      if (active.kind === "table") paintGrid(body, data, active, records);
      else if (active.kind === "calendar") paintCalendar(body, data, active, records);
      else if (active.kind === "chart") paintCharts(body, data, active, records);
      else paintCards(body, data, active, records);
      surface.append(body);
      dom.dispatchEvent(new (doc.defaultView?.Event ?? Event)("semlo-editor:database-view-change", { bubbles: true }));
    };
    dom.addEventListener("focusout", scheduleBodyRefresh);

    const findKey = (event: KeyboardEvent) => {
      if (
        event.isComposing ||
        event.keyCode === 229 ||
        event.altKey ||
        event.shiftKey ||
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "f"
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      finishCellSession();
      closePopup();
      if (!searchOpen) {
        searchOpen = true;
        paint();
      }
      const input = surface.querySelector<HTMLInputElement>('[aria-label="搜索记录"]');
      input?.focus();
      input?.select();
    };
    dom.addEventListener("keydown", findKey);

    const historyKey = (event: KeyboardEvent) => {
      const input = event.target;
      const Input = doc.defaultView?.HTMLInputElement;
      if (
        !Input ||
        !(input instanceof Input) ||
        !input.dataset.semloEditorHistory ||
        event.isComposing ||
        event.keyCode === 229
      )
        return;
      const key = event.key.toLowerCase();
      if (!(event.metaKey || event.ctrlKey) || event.altKey || (key !== "z" && key !== "y")) return;
      event.preventDefault();
      event.stopPropagation();
      const kind = input.dataset.semloEditorHistory;
      const isRedo = key === "y" || event.shiftKey;
      if (kind === "cell" && cellSessions.handleHistory(input, isRedo)) return;
      const recordId = input.dataset.recordId;
      const fieldId = input.dataset.fieldId;
      const filterId = input.dataset.filterId;
      const fromDialog = !!popovers.current?.contains(input);
      const start = input.selectionStart;
      const end = input.selectionEnd;
      lastEditingElement = null;
      const changed = isRedo ? editor.commands.redo() : editor.commands.undo();
      if (!changed || destroyed) return;
      let replacement: HTMLInputElement | undefined;
      if (kind === "cell") {
        if (fromDialog) {
          const data = getData();
          const active = getView(data);
          const records = visibleDatabaseRecords(data, active, query);
          const record = data.records.find((entry) => entry.id === recordId);
          const card = Array.from(dom.querySelectorAll<HTMLButtonElement>(".semlo-editor-database-card")).find(
            (entry) => entry.dataset.recordId === recordId,
          );
          if (record && card)
            recordPanel(
              card,
              record,
              records.findIndex((entry) => entry.id === record.id),
            );
        }
        replacement = Array.from(
          dom.querySelectorAll<HTMLInputElement>('input[data-semlo-editor-history="cell"]'),
        ).find((entry) => entry.dataset.recordId === recordId && entry.dataset.fieldId === fieldId);
      } else if (kind === "view-name") {
        replacement = dom.querySelector<HTMLInputElement>('input[data-semlo-editor-history="view-name"]') ?? undefined;
      } else if (kind === "filter" && getView(getData()).filters.some((filter) => filter.id === filterId)) {
        const control = surface.querySelector<HTMLButtonElement>('button[aria-label="筛选"]');
        if (control) filterPanel(control);
        replacement = Array.from(
          dom.querySelectorAll<HTMLInputElement>('input[data-semlo-editor-history="filter"]'),
        ).find((entry) => entry.dataset.filterId === filterId);
      }
      if (replacement) {
        replacement.focus();
        if (start !== null && end !== null) {
          try {
            replacement.setSelectionRange(
              Math.min(start, replacement.value.length),
              Math.min(end, replacement.value.length),
            );
          } catch {
            // Date and other native controls do not support text selection.
          }
        }
      } else view.focus();
    };
    dom.addEventListener("keydown", historyKey);

    const editableChanged = () => {
      boardDrag.cancel();
      columnDrag.cancel();
      rowDrag.cancel();
      calendarDrag.cancel();
      finishCellSession();
      closePopup();
      readonlyViewId = "";
      paint();
    };
    const resetTransientState = () => {
      pendingGroups.clear();
      selected.clear();
      boardDrag.cancel();
      columnDrag.cancel();
      rowDrag.cancel();
      calendarDrag.cancel();
      cellSessions.reset();
      closePopup();
    };
    const transaction = ({
      transaction,
      appendedTransactions = [],
    }: {
      transaction: Transaction;
      appendedTransactions?: Transaction[];
    }) => {
      if (destroyed || editor.isDestroyed) return;
      if (writing) {
        let pos = expectedWritePosition;
        const own = transaction === expectedWriteTransaction;
        if (own) pos = transaction.mapping.map(pos, -1);
        const parts = own ? appendedTransactions : [transaction, ...appendedTransactions];
        for (const part of parts) {
          const previous = part.before.nodeAt(pos);
          // Insertions at this position are before the database node; follow
          // the node to its new position instead of treating them as replacement.
          const nextPos = part.mapping.map(pos, 1);
          const next = part.doc.nodeAt(nextPos);
          if (previous !== next) {
            resetTransientState();
            paint();
            break;
          }
          pos = nextPos;
        }
        return;
      }
      const pos = getPos();
      const live = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
      if (live && live.type === current.type && live !== current) {
        resetTransientState();
        current = live;
        paint();
      }
    };
    view.dom.addEventListener("semlo-editor:editable", editableChanged);
    editor.on("transaction", transaction);
    paint();
    return {
      dom,
      update(node) {
        if (node.type !== current.type) return false;
        if (node === current) return true;
        // Applying a transaction may reconstruct the node, so compare its
        // content with the node produced by our transaction rather than its
        // object identity. A later edit to this database must still invalidate
        // the UI state even when it happens inside our dispatch.
        const ownWrite = writing && !!expectedWriteNode && node.eq(expectedWriteNode);
        if (!ownWrite) {
          resetTransientState();
        }
        current = node;
        if (!ownWrite) paint();
        return true;
      },
      selectNode() {
        dom.classList.add("is-selected");
      },
      deselectNode() {
        dom.classList.remove("is-selected");
      },
      stopEvent(event) {
        const target = event.target as Element;
        return !!target.closest?.(
          "button,input,textarea,select,.semlo-editor-database-popover,.semlo-editor-database-column-head",
        );
      },
      ignoreMutation: () => true,
      destroy() {
        destroyed = true;
        setDatabaseViewProjection(dom, undefined);
        pendingGroups.clear();
        closeChartView();
        calendarMonths.clear();
        collapsedGroupsByView.clear();
        boardDrag.destroy();
        columnDrag.destroy();
        rowDrag.destroy();
        calendarDrag.destroy();
        cellSessions.reset();
        closePopup();
        if (refreshFrame !== undefined) doc.defaultView?.cancelAnimationFrame(refreshFrame);
        dom.removeEventListener("focusout", scheduleBodyRefresh);
        editor.off("transaction", transaction);
        dom.removeEventListener("keydown", findKey);
        dom.removeEventListener("keydown", historyKey);
        doc.removeEventListener("keydown", keyDown);
        view.dom.removeEventListener("semlo-editor:editable", editableChanged);
      },
    };
  };
}
