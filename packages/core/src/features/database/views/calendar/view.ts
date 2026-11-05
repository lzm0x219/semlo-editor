import { dateFromISO, todayISO, toISO } from "../../../../shared/date/date-utils";
import {
  databaseValueText,
  type DatabaseData,
  type DatabaseField,
  type DatabaseRecord,
  type DatabaseView,
} from "../../model";
import { calendarLunarLabel } from "./lunar";

/** The currently displayed month belongs to the node view, not the document. */
export interface DatabaseCalendarMonth {
  year: number;
  /** JavaScript's zero-based month. */
  month: number;
}

export interface DatabaseCalendarOptions {
  doc: Document;
  container: HTMLElement;
  data: DatabaseData;
  view: DatabaseView;
  records: DatabaseRecord[];
  editable: boolean;
  month: DatabaseCalendarMonth;
  onMonthChange(year: number, month: number): void;
  onAdd(date: string, anchor: HTMLElement): void;
  onOpen(record: DatabaseRecord, index: number, anchor: HTMLElement): void;
}

const customColors = [
  "#e0f3e9",
  "#eef7d9",
  "#dcf4f3",
  "#dfedfb",
  "#e4e6fb",
  "#e9dff8",
  "#f9e5e8",
  "#eee8dc",
  "#fbf0d2",
  "#edf0ef",
];
const optionColors = ["#dbf2e6", "#fff0ca", "#d9eaff", "#f7dfe3", "#eae1fa", "#e3e6e8", "#ffe5d7", "#d7f1f0"];
const sundayFirstLabels = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
const mondayFirstLabels = [...sundayFirstLabels.slice(1), sundayFirstLabels[0]];

/** Return complete local weeks without converting calendar dates through UTC. */
export function databaseCalendarMonthGrid(year: number, month: number, sundayFirst: boolean) {
  const first = new Date(0);
  first.setFullYear(year, month, 1);
  first.setHours(12, 0, 0, 0);
  const last = new Date(0);
  last.setFullYear(year, month + 1, 0);
  last.setHours(12, 0, 0, 0);
  const offset = (first.getDay() + (sundayFirst ? 0 : 6)) % 7;
  const count = Math.ceil((offset + last.getDate()) / 7) * 7;
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(first);
    date.setDate(1 - offset + index);
    return { date: toISO(date), day: date.getDate(), current: date.getMonth() === first.getMonth() };
  });
}

function recordColor(field: DatabaseField | undefined, record: DatabaseRecord, customColor: number) {
  if (field && (field.type === "singleSelect" || field.type === "multiSelect")) {
    const value = record.values[field.id];
    const id = Array.isArray(value) ? value[0] : value;
    const option = field.options.find((entry) => entry.id === id);
    if (option) return optionColors[option.color] ?? optionColors[0];
  }
  return customColors[customColor] ?? customColors[0];
}

/** Paint a calendar for records already filtered by the active database view. */
export function paintDatabaseCalendar(options: DatabaseCalendarOptions) {
  const { doc, container, data, view, records, editable, month, onMonthChange, onAdd, onOpen } = options;
  const { calendar } = view;
  const titleField = data.fields.find((field) => field.id === calendar.titleFieldId);
  const dateField = (id: string) =>
    data.fields.find((field) => field.id === id && ["date", "createdTime", "modifiedTime"].includes(field.type));
  const startField = dateField(calendar.startFieldId);
  const endField = dateField(calendar.endFieldId);
  const calendarDate = (field: typeof startField, value: unknown) => {
    if (!field || typeof value !== "string" || !value) return "";
    if (field.type === "date") return dateFromISO(value) ? value : "";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : toISO(date);
  };
  const colorField = data.fields.find((field) => field.id === calendar.colorFieldId);
  const makeButton = (label: string, text: string, className: string, action: () => void) => {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = className;
    button.setAttribute("aria-label", label);
    button.textContent = text;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      action();
    });
    return button;
  };
  const moveMonth = (amount: number) => {
    const date = new Date(0);
    date.setFullYear(month.year, month.month + amount, 1);
    date.setHours(12, 0, 0, 0);
    onMonthChange(date.getFullYear(), date.getMonth());
  };

  const calendarRoot = doc.createElement("section");
  calendarRoot.className = "semlo-editor-database-calendar";
  calendarRoot.setAttribute("aria-label", "数据表日历");
  const header = doc.createElement("div");
  header.className = "semlo-editor-database-calendar-header";
  const title = doc.createElement("strong");
  title.className = "semlo-editor-database-calendar-month";
  title.textContent = `${month.year}年${month.month + 1}月`;
  const previous = makeButton("上个月", "‹", "semlo-editor-database-calendar-nav", () => moveMonth(-1));
  const next = makeButton("下个月", "›", "semlo-editor-database-calendar-nav", () => moveMonth(1));
  const today = makeButton("今天", "今天", "semlo-editor-database-calendar-today", () => {
    const date = new Date();
    onMonthChange(date.getFullYear(), date.getMonth());
  });
  header.append(title, previous, next, today);
  calendarRoot.append(header);

  if (!startField) {
    const notice = doc.createElement("p");
    notice.className = "semlo-editor-database-calendar-empty";
    notice.textContent = "请先添加日期字段，并在日历设置中选择开始日期。";
    calendarRoot.append(notice);
  }

  const grid = doc.createElement("div");
  grid.className = "semlo-editor-database-calendar-grid";
  grid.setAttribute("role", "grid");
  grid.setAttribute("aria-label", `${month.year}年${month.month + 1}月日历`);
  const weekdays = doc.createElement("div");
  weekdays.className = "semlo-editor-database-calendar-weekdays";
  weekdays.setAttribute("role", "row");
  for (const name of calendar.sundayFirst ? sundayFirstLabels : mondayFirstLabels) {
    const heading = doc.createElement("span");
    heading.setAttribute("role", "columnheader");
    heading.textContent = name;
    weekdays.append(heading);
  }
  grid.append(weekdays);

  const days = databaseCalendarMonthGrid(month.year, month.month, calendar.sundayFirst);
  const todayValue = todayISO();
  const ranges = startField
    ? records.flatMap((record, index) => {
        const start = calendarDate(startField, record.values[startField.id]);
        if (!start) return [];
        const end = endField ? calendarDate(endField, record.values[endField.id]) : "";
        const last = end && end >= start ? end : start;
        return [{ record, index, start, end: last }];
      })
    : [];

  for (let week = 0; week < days.length; week += 7) {
    const weekDays = days.slice(week, week + 7);
    const firstDate = weekDays[0].date;
    const lastDate = weekDays[weekDays.length - 1].date;
    const laneEnds: number[] = [];
    const occupiedLanes = Array<number>(7).fill(0);
    const segments = ranges
      .filter((range) => range.start <= lastDate && range.end >= firstDate)
      .map((range) => ({
        ...range,
        first: weekDays.findIndex((item) => item.date >= range.start),
        last: weekDays.reduce((last, item, index) => (item.date <= range.end ? index : last), -1),
      }))
      .sort((left, right) => left.first - right.first || left.index - right.index)
      .map((segment) => {
        let lane = laneEnds.findIndex((end) => end < segment.first);
        if (lane < 0) lane = laneEnds.length;
        laneEnds[lane] = segment.last;
        for (let index = segment.first; index <= segment.last; index++)
          occupiedLanes[index] = Math.max(occupiedLanes[index], lane + 1);
        return { ...segment, lane };
      });
    const row = doc.createElement("div");
    row.className = "semlo-editor-database-calendar-week";
    row.setAttribute("role", "row");
    for (const [dayIndex, item] of weekDays.entries()) {
      const cell = doc.createElement("div");
      cell.className = "semlo-editor-database-calendar-cell";
      cell.setAttribute("role", "gridcell");
      cell.setAttribute("aria-label", item.date);
      cell.dataset.date = item.date;
      cell.tabIndex = 0;
      cell.classList.toggle("is-outside", !item.current);
      const caption = doc.createElement("div");
      caption.className = "semlo-editor-database-calendar-day-line";
      const number = doc.createElement("span");
      number.className = "semlo-editor-database-calendar-day";
      number.textContent = String(item.day);
      number.classList.toggle("is-today", item.date === todayValue);
      caption.append(number);
      if (calendar.showLunar) {
        const lunarText = calendarLunarLabel(item.date);
        if (lunarText) {
          const lunar = doc.createElement("span");
          lunar.className = "semlo-editor-database-calendar-lunar";
          lunar.textContent = lunarText;
          caption.append(lunar);
        }
        const weekday = dateFromISO(item.date)?.getDay();
        cell.classList.toggle("is-weekend", weekday === 0 || weekday === 6);
      }
      cell.append(caption);
      const list = doc.createElement("div");
      list.className = "semlo-editor-database-calendar-events";
      list.style.setProperty("--semlo-editor-database-calendar-lanes", String(occupiedLanes[dayIndex]));
      if (editable && startField) {
        const add = makeButton(`${item.date} 添加日程`, "+ 添加日程", "semlo-editor-database-calendar-add", () =>
          onAdd(item.date, add),
        );
        list.append(add);
      }
      cell.append(list);
      row.append(cell);
    }
    const eventLayer = doc.createElement("div");
    eventLayer.className = "semlo-editor-database-calendar-week-events";
    for (const { record, index, start, end, first, last, lane } of segments) {
      const text = (titleField && databaseValueText(titleField, record.values[titleField.id])) || "添加日程标题";
      const event = makeButton(
        `日程：${text}`,
        text,
        "semlo-editor-database-card semlo-editor-database-calendar-event",
        () => onOpen(record, index, event),
      );
      event.dataset.recordId = record.id;
      event.dataset.date = weekDays[first].date;
      event.dataset.startDate = start;
      event.dataset.endDate = end;
      event.classList.toggle("continues-before", start < firstDate);
      event.classList.toggle("continues-after", end > lastDate);
      const label = doc.createElement("span");
      label.className = "semlo-editor-database-calendar-event-label";
      label.textContent = text;
      event.replaceChildren(label);
      if (editable && startField?.type === "date" && (!endField || endField.type === "date")) {
        const addHandle = (edge: "start" | "end") => {
          const handle = doc.createElement("span");
          handle.className = `semlo-editor-database-calendar-resize semlo-editor-database-calendar-resize-${edge}`;
          handle.dataset.calendarEdge = edge;
          handle.setAttribute("aria-hidden", "true");
          event.append(handle);
        };
        if (start >= firstDate) addHandle("start");
        if (end <= lastDate) addHandle("end");
      }
      event.style.gridColumn = `${first + 1} / ${last + 2}`;
      event.style.gridRow = String(lane + 1);
      event.style.setProperty(
        "--semlo-editor-database-calendar-event-color",
        recordColor(colorField, record, calendar.color),
      );
      eventLayer.append(event);
    }
    row.append(eventLayer);
    grid.append(row);
  }
  grid.addEventListener("keydown", (event) => {
    if (!(event.target instanceof (doc.defaultView?.HTMLElement ?? HTMLElement))) return;
    if (event.target.closest("button, input, select, textarea")) return;
    const amount =
      event.key === "ArrowLeft"
        ? -1
        : event.key === "ArrowRight"
          ? 1
          : event.key === "ArrowUp"
            ? -7
            : event.key === "ArrowDown"
              ? 7
              : 0;
    if (!amount) return;
    const cells = Array.from(grid.querySelectorAll<HTMLElement>(".semlo-editor-database-calendar-cell"));
    const index = cells.indexOf(event.target);
    if (index < 0 || !cells[index + amount]) return;
    event.preventDefault();
    event.stopPropagation();
    cells[index + amount].focus();
  });
  calendarRoot.append(grid);
  container.append(calendarRoot);
}
