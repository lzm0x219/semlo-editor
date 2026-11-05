import { dateFromISO, monthGrid, todayISO } from "../../shared/date/date-utils";

/** A draft range is committed only when both endpoints have been selected. */
export function createCalendarRangePicker(options: {
  panel: HTMLElement;
  start: HTMLInputElement;
  end: HTMLInputElement;
  value: () => { start: string; end: string };
  commit: (start: string, end: string) => void;
}) {
  const { panel, start, end, value, commit } = options;
  const doc = panel.ownerDocument;
  const win = doc.defaultView;
  let popup: HTMLElement | undefined;
  let year = 0;
  let month = 0;
  let selectedStart: string | null = null;
  let oldRange = value();
  let mode: "days" | "months" | "years" = "days";
  let selectorYear = 0;
  let selectorMonth = 0;
  let selectorSide = 0;
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const close = () => {
    popup?.remove();
    popup = undefined;
    start.value = value().start;
    end.value = value().end;
  };
  const draw = () => {
    if (!popup) return;
    const focused = popup.contains(doc.activeElement) ? doc.activeElement : null;
    const focusedLabel = focused?.getAttribute("aria-label");
    const restoreFocus = () => {
      if (!focused || !popup) return;
      const replacement = Array.from(popup.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.getAttribute("aria-label") === focusedLabel && !button.disabled,
      );
      if (replacement) replacement.focus();
      else start.focus();
    };
    popup.replaceChildren();
    const style = doc.createElement("style");
    style.textContent = `
      .semlo-editor-calendar-range {position:fixed;z-index:1201;box-sizing:border-box;width:min(560px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;padding:8px 12px 12px;background:#fff;border:1px solid #eee;border-radius:6px;box-shadow:0 3px 12px #0002;font:14px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
      .semlo-editor-calendar-range-months {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}
      .semlo-editor-calendar-range-head {display:flex;align-items:center;justify-content:space-between;height:30px}
      .semlo-editor-calendar-range-head button,.semlo-editor-calendar-range-grid button {border:0;background:transparent;color:#333;cursor:pointer;font:inherit}
      .semlo-editor-calendar-range-head button {padding:3px 6px;color:#999}
      .semlo-editor-calendar-range-grid {display:grid;grid-template-columns:repeat(7,minmax(0,1fr));text-align:center;gap:2px 0}
      .semlo-editor-calendar-range-grid span,.semlo-editor-calendar-range-grid button {height:28px;line-height:28px;padding:0}
      .semlo-editor-calendar-range-grid button:hover:not(:disabled) {background:#e0f4e9}
      .semlo-editor-calendar-range-grid button.is-outside {color:#bbb}
      .semlo-editor-calendar-range-grid button.is-range {background:#e0f4e9}
      .semlo-editor-calendar-range-grid button.is-endpoint {color:white;background:#59b779;border-radius:4px}
      .semlo-editor-calendar-range-grid button:disabled {color:#ddd;cursor:not-allowed}
      .semlo-editor-calendar-range-period {display:grid;grid-template-columns:repeat(3,1fr);gap:12px;text-align:center;padding:12px 0}
      .semlo-editor-calendar-range-period button {border:0;border-radius:4px;background:transparent;cursor:pointer;font:inherit;padding:8px 0}
      .semlo-editor-calendar-range-period button:hover {background:#e0f4e9}
      .semlo-editor-calendar-range-period button.is-selected {background:#59b779;color:white}
      @media(max-width:480px) {.semlo-editor-calendar-range-months {gap:4px}.semlo-editor-calendar-range {font-size:12px}}
      @media(max-width:320px) {.semlo-editor-calendar-range-months {grid-template-columns:1fr}}
    `;
    popup.append(style);
    if (mode !== "days") {
      const header = doc.createElement("div");
      header.className = "semlo-editor-calendar-range-head";
      const delta = mode === "months" ? 1 : 10;
      for (const direction of [-1, 0, 1]) {
        const button = doc.createElement("button");
        button.type = "button";
        button.textContent =
          direction < 0
            ? "«"
            : direction > 0
              ? "»"
              : mode === "months"
                ? `${selectorYear}年`
                : `${Math.floor(selectorYear / 10) * 10}-${Math.floor(selectorYear / 10) * 10 + 9}`;
        button.setAttribute(
          "aria-label",
          direction < 0 ? "上一范围" : direction > 0 ? "下一范围" : mode === "months" ? "选择年份" : "当前十年",
        );
        button.addEventListener("click", () => {
          if (direction === 0) {
            if (mode === "months") mode = "years";
          } else selectorYear = Math.max(0, Math.min(9999, selectorYear + direction * delta));
          draw();
        });
        header.append(button);
      }
      const grid = doc.createElement("div");
      grid.className = "semlo-editor-calendar-range-period";
      for (let index = 0; index < 12; index++) {
        const button = doc.createElement("button");
        button.type = "button";
        const target = mode === "months" ? index : Math.floor(selectorYear / 10) * 10 + index - 1;
        button.textContent = mode === "months" ? names[index] : String(target);
        button.setAttribute("aria-label", mode === "months" ? `选择${index + 1}月` : `选择${target}年`);
        button.disabled = target < 0 || target > 9999;
        button.classList.toggle("is-selected", mode === "months" ? target === selectorMonth : target === selectorYear);
        button.addEventListener("click", () => {
          if (mode === "years") {
            selectorYear = target;
            mode = "months";
          } else {
            const absolute = selectorYear * 12 + target - selectorSide;
            if (absolute < 0 || absolute > 9999 * 12 + 10) return;
            year = Math.floor(absolute / 12);
            month = absolute % 12;
            mode = "days";
          }
          draw();
        });
        grid.append(button);
      }
      popup.append(header, grid);
      popup.style.width = "min(280px,calc(100vw - 16px))";
      position();
      restoreFocus();
      return;
    }
    popup.style.width = "";
    const months = doc.createElement("div");
    months.className = "semlo-editor-calendar-range-months";
    for (let offset = 0; offset < 2; offset++) {
      const date = new Date(0);
      date.setFullYear(year, month + offset, 1);
      const y = date.getFullYear(),
        m = date.getMonth();
      const section = doc.createElement("div");
      const header = doc.createElement("div");
      header.className = "semlo-editor-calendar-range-head";
      const nav = (label: string, delta: number) => {
        const button = doc.createElement("button");
        button.type = "button";
        button.textContent = delta === -12 ? "«" : delta === 12 ? "»" : delta < 0 ? "‹" : "›";
        button.setAttribute("aria-label", label);
        button.addEventListener("click", () => {
          const next = year * 12 + month + delta;
          if (next < 0 || next > 9999 * 12 + 10) return;
          year = Math.floor(next / 12);
          month = next % 12;
          draw();
        });
        return button;
      };
      const title = doc.createElement("span");
      for (const [kind, text] of [
        ["years", `${y}年`],
        ["months", names[m]],
      ] as const) {
        if (kind === "months") title.append(doc.createTextNode(" "));
        const button = doc.createElement("button");
        button.type = "button";
        button.textContent = text;
        button.setAttribute("aria-label", kind === "years" ? `选择${y}年` : `选择${m + 1}月`);
        button.addEventListener("click", () => {
          selectorYear = y;
          selectorMonth = m;
          selectorSide = offset;
          mode = kind;
          draw();
        });
        title.append(button);
      }
      const navigation = doc.createElement("span");
      if (offset === 0) {
        navigation.append(nav("上一年", -12), nav("上个月", -1));
        header.append(navigation, title, doc.createElement("span"));
      } else {
        navigation.append(nav("下个月", 1), nav("下一年", 12));
        header.append(doc.createElement("span"), title, navigation);
      }
      const grid = doc.createElement("div");
      grid.className = "semlo-editor-calendar-range-grid";
      for (const day of ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]) {
        const label = doc.createElement("span");
        label.textContent = day;
        grid.append(label);
      }
      for (const cell of monthGrid(y, m, true)) {
        const button = doc.createElement("button");
        button.type = "button";
        button.textContent = String(cell.day);
        button.setAttribute("aria-label", cell.date);
        button.disabled = !dateFromISO(cell.date) || (!!selectedStart && cell.date < selectedStart);
        button.classList.toggle("is-outside", !cell.current);
        button.classList.toggle(
          "is-endpoint",
          selectedStart ? cell.date === selectedStart : cell.date === oldRange.start || cell.date === oldRange.end,
        );
        button.classList.toggle("is-range", !selectedStart && cell.date > oldRange.start && cell.date < oldRange.end);
        if (cell.date === todayISO()) button.setAttribute("aria-current", "date");
        button.addEventListener("click", () => {
          if (!selectedStart) {
            selectedStart = cell.date;
            start.value = cell.date;
            end.value = "";
            draw();
          } else {
            commit(selectedStart, cell.date);
            close();
          }
        });
        grid.append(button);
      }
      section.append(header, grid);
      months.append(section);
    }
    popup.append(months);
    position();
    restoreFocus();
  };
  const position = () => {
    if (!popup) return;
    const anchor = start.getBoundingClientRect();
    const width = popup.offsetWidth,
      height = popup.offsetHeight;
    const viewportWidth = win?.innerWidth ?? 1000,
      viewportHeight = win?.innerHeight ?? 800;
    const above = anchor.top - height - 8;
    popup.style.left = `${Math.max(8, Math.min(anchor.left, viewportWidth - width - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(above >= 8 ? above : anchor.bottom + 8, viewportHeight - height - 8))}px`;
  };
  const open = (endpoint: "start" | "end") => {
    if (popup) {
      selectedStart = endpoint === "end" ? (dateFromISO(start.value) ? start.value : oldRange.start) : null;
      draw();
      return;
    }
    oldRange = value();
    const date = dateFromISO(oldRange.start) ?? new Date();
    year = date.getFullYear();
    month = date.getMonth();
    selectedStart = endpoint === "end" ? oldRange.start : null;
    mode = "days";
    popup = doc.createElement("div");
    popup.className = "semlo-editor-calendar-range";
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", "选择日程日期范围");
    popup.addEventListener("click", (event) => {
      if (!popup || panel.contains(doc.activeElement)) return;
      const label = (event.target as Element | null)?.closest?.("button")?.getAttribute("aria-label");
      if (!label) return;
      const replacement = Array.from(popup.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.getAttribute("aria-label") === label && !button.disabled,
      );
      if (replacement) replacement.focus();
      else start.focus();
    });
    panel.append(popup);
    draw();
  };
  start.addEventListener("click", () => open("start"));
  end.addEventListener("click", () => open("end"));
  for (const input of [start, end]) {
    input.addEventListener("keydown", (event) => {
      if (input.disabled || event.key !== "Enter" || event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      event.stopPropagation();
      if (!popup) open(input === start ? "start" : "end");
      const date = input.value;
      if (!dateFromISO(date)) return;
      if (input === start) {
        selectedStart = date;
        end.value = "";
        const parsed = dateFromISO(date)!;
        year = parsed.getFullYear();
        month = parsed.getMonth();
        draw();
        end.focus();
      } else {
        const first = selectedStart ?? value().start;
        if (!dateFromISO(first) || date < first) return;
        commit(first, date);
        close();
      }
    });
  }
  return { close, isOpen: () => !!popup, position };
}
