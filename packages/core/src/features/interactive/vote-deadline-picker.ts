import { linkPopup } from "../../platform/dom/popup-owner";
import { formatInteractiveDeadline, interactiveDeadline } from "./interactive-card-deadline";

const pad = (value: number, width = 2) => String(value).padStart(width, "0");
const dateText = (year: number, month: number, day: number) => `${pad(year, 4)}-${pad(month + 1)}-${pad(day)}`;
const localNow = () => {
  const now = new Date();
  return {
    date: dateText(now.getFullYear(), now.getMonth(), now.getDate()),
    time: `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`,
  };
};
const calendarDate = (year: number, month: number, day: number) => {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(0, 0, 0, 0);
  return date;
};
const parsed = (value: string) => interactiveDeadline(value.trim().replace(" ", "T"));

/** Local date-time editor. Merely opening or cancelling it never changes the document. */
export function createVoteDeadlinePicker(
  doc: Document,
  getValue: () => string | null,
  onCommit: (deadline: string | null) => void,
) {
  const root = doc.createElement("div");
  root.className = "semlo-editor-vote-deadline-picker";
  const label = doc.createElement("label");
  label.className = "semlo-editor-vote-deadline-label";
  const caption = doc.createElement("span");
  caption.textContent = "截止日期";
  const input = doc.createElement("input");
  input.type = "text";
  input.setAttribute("aria-label", "截止日期");
  input.setAttribute("aria-haspopup", "dialog");
  input.setAttribute("aria-expanded", "false");
  input.placeholder = "请选择日期和时间";
  label.append(caption, input);
  root.append(label);
  let panel: HTMLElement | undefined;
  let unlinkPanel: (() => void) | undefined;
  let disposed = false;
  let year = 0;
  let month = 0;
  let selectedDate = "";
  let parts: Array<string | null> = [null, null, null];
  let textDirty = false;
  let timePrecision: 2 | 3 = 3;
  let inputComposing = false;
  let calendarMode: "date" | "year" | "month" = "date";
  let decade = 0;
  let suppressFocusOpen = false;
  const syncInput = () => {
    input.value = formatInteractiveDeadline(getValue() ?? "");
  };
  const focusInput = () => {
    if (disposed || !input.isConnected) return;
    suppressFocusOpen = true;
    input.focus({ preventScroll: true });
    suppressFocusOpen = false;
  };
  const close = (restoreFocus = false) => {
    if (!panel) return;
    doc.removeEventListener("pointerdown", outside, true);
    unlinkPanel?.();
    unlinkPanel = undefined;
    panel.remove();
    panel = undefined;
    input.setAttribute("aria-expanded", "false");
    inputComposing = false;
    input.setCustomValidity("");
    syncInput();
    if (restoreFocus) focusInput();
  };
  const outside = (event: Event) => {
    if (!root.contains(event.target as globalThis.Node)) close();
  };
  const updateDraft = () => {
    textDirty = false;
    const time = parts.every((part) => part !== null) ? ` ${parts.slice(0, timePrecision).join(":")}` : "";
    input.value = selectedDate ? selectedDate + time : "";
    input.setCustomValidity("");
  };
  const commit = () => {
    if (!panel || disposed) return;
    const value = input.value.trim();
    const deadline = value ? parsed(value) : null;
    if (value && !deadline) {
      input.setCustomValidity("请输入有效日期和时间");
      input.reportValidity();
      return;
    }
    if (!textDirty && !selectedDate && parts.some((part) => part !== null)) {
      input.setCustomValidity("请先选择日期");
      input.reportValidity();
      return;
    }
    if (!textDirty && parts.some((part) => part !== null) && !parts.every((part) => part !== null)) {
      input.setCustomValidity("请选择完整的时、分、秒");
      input.reportValidity();
      return;
    }
    close();
    onCommit(deadline);
    syncInput();
    focusInput();
  };
  const render = () => {
    if (!panel) return;
    panel.replaceChildren();
    const main = doc.createElement("div");
    main.className = "semlo-editor-vote-date-main";
    main.classList.toggle("is-choosing-period", calendarMode !== "date");
    const calendar = doc.createElement("div");
    calendar.className = "semlo-editor-vote-calendar";
    const header = doc.createElement("div");
    header.className = "semlo-editor-vote-calendar-header";
    const nav = (name: string, symbol: string, amount: number) => {
      const button = doc.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", name);
      button.textContent = symbol;
      const next = year * 12 + month + amount;
      button.disabled = next < 0 || next > 9999 * 12 + 11;
      button.addEventListener("click", () => {
        const index = year * 12 + month + amount;
        year = Math.floor(index / 12);
        month = index % 12;
        render();
        panel?.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)?.focus({ preventScroll: true });
      });
      return button;
    };
    if (calendarMode === "date") {
      const yearButton = doc.createElement("button");
      yearButton.type = "button";
      yearButton.textContent = `${pad(year, 4)}年`;
      yearButton.dataset.voteYear = "";
      yearButton.addEventListener("click", () => {
        decade = Math.floor(year / 10) * 10;
        calendarMode = "year";
        render();
        panel
          ?.querySelector<HTMLButtonElement>(".semlo-editor-vote-period-grid .is-selected")
          ?.focus({ preventScroll: true });
      });
      const monthButton = doc.createElement("button");
      monthButton.type = "button";
      monthButton.dataset.voteMonth = "";
      monthButton.textContent = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][
        month
      ];
      monthButton.addEventListener("click", () => {
        calendarMode = "month";
        render();
        panel
          ?.querySelector<HTMLButtonElement>(".semlo-editor-vote-period-grid .is-selected")
          ?.focus({ preventScroll: true });
      });
      header.append(
        nav("上一年", "«", -12),
        nav("上个月", "‹", -1),
        yearButton,
        monthButton,
        nav("下个月", "›", 1),
        nav("下一年", "»", 12),
      );
    } else if (calendarMode === "year") {
      const periodNav = (label: string, offset: number) => {
        const button = doc.createElement("button");
        button.type = "button";
        button.setAttribute("aria-label", label);
        button.textContent = offset < 0 ? "«" : "»";
        button.disabled = decade + offset < 0 || decade + offset > 9990;
        button.addEventListener("click", () => {
          decade += offset;
          render();
        });
        return button;
      };
      const title = doc.createElement("strong");
      title.textContent = `${pad(decade, 4)}-${pad(decade + 9, 4)}`;
      header.append(periodNav("上十年", -10), title, periodNav("下十年", 10));
    } else {
      const title = doc.createElement("button");
      title.type = "button";
      title.textContent = `${pad(year, 4)}年`;
      title.addEventListener("click", () => {
        decade = Math.floor(year / 10) * 10;
        calendarMode = "year";
        render();
      });
      header.append(nav("上一年", "«", -12), title, nav("下一年", "»", 12));
    }
    calendar.append(header);
    if (calendarMode === "date") {
      const grid = doc.createElement("div");
      grid.className = "semlo-editor-vote-calendar-grid";
      grid.setAttribute("role", "group");
      grid.setAttribute("aria-label", `${pad(year, 4)}年${month + 1}月`);
      for (const weekday of ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]) {
        const cell = doc.createElement("span");
        cell.className = "semlo-editor-vote-calendar-weekday";
        cell.textContent = weekday;
        grid.append(cell);
      }
      const first = calendarDate(year, month, 1);
      const start = 1 - first.getUTCDay();
      for (let i = 0; i < 42; i++) {
        const date = calendarDate(year, month, start + i);
        const y = date.getUTCFullYear(),
          m = date.getUTCMonth(),
          day = date.getUTCDate();
        const button = doc.createElement("button");
        button.type = "button";
        const value = dateText(y, m, day);
        button.textContent = String(day);
        button.setAttribute("aria-label", value);
        button.dataset.date = value;
        button.disabled = y < 0 || y > 9999;
        button.tabIndex = value === selectedDate || (!selectedDate && m === month && y === year && day === 1) ? 0 : -1;
        button.classList.toggle("is-outside", m !== month);
        button.classList.toggle("is-selected", value === selectedDate);
        button.classList.toggle("is-today", value === localNow().date);
        button.setAttribute("aria-pressed", String(value === selectedDate));
        button.addEventListener("click", () => {
          selectedDate = value;
          year = y;
          month = m;
          updateDraft();
          render();
          panel?.querySelector<HTMLButtonElement>(`[data-date="${value}"]`)?.focus({ preventScroll: true });
        });
        button.addEventListener("keydown", (event) => {
          const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
          if (!(event.key in offsets)) return;
          event.preventDefault();
          const next = calendarDate(y, m, day + offsets[event.key]);
          const nextYear = next.getUTCFullYear();
          if (nextYear < 0 || nextYear > 9999) return;
          year = nextYear;
          month = next.getUTCMonth();
          const nextValue = dateText(year, month, next.getUTCDate());
          render();
          const nextButton = panel?.querySelector<HTMLButtonElement>(`[data-date="${nextValue}"]`);
          if (nextButton) {
            for (const dayButton of panel!.querySelectorAll<HTMLButtonElement>("[data-date]")) dayButton.tabIndex = -1;
            nextButton.tabIndex = 0;
            nextButton.focus({ preventScroll: true });
          }
        });
        grid.append(button);
      }
      calendar.append(grid);
    } else {
      const grid = doc.createElement("div");
      grid.className = "semlo-editor-vote-period-grid";
      const mode = calendarMode;
      grid.setAttribute("role", "group");
      grid.setAttribute("aria-label", mode === "year" ? "选择年份" : "选择月份");
      const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      for (let index = 0; index < 12; index++) {
        const value = mode === "year" ? decade - 1 + index : index;
        const button = doc.createElement("button");
        button.type = "button";
        button.disabled = mode === "year" && (value < 0 || value > 9999);
        button.textContent = mode === "year" ? pad(value, 4) : names[value];
        button.setAttribute("aria-label", mode === "year" ? `${pad(value, 4)}年` : `${value + 1}月`);
        button.classList.toggle("is-outside", mode === "year" && (index === 0 || index === 11));
        button.classList.toggle("is-selected", mode === "year" ? value === year : value === month);
        button.addEventListener("click", () => {
          if (mode === "year") year = value;
          else month = value;
          calendarMode = "date";
          render();
          panel
            ?.querySelector<HTMLButtonElement>(mode === "year" ? "[data-vote-year]" : "[data-vote-month]")
            ?.focus({ preventScroll: true });
        });
        grid.append(button);
      }
      calendar.append(grid);
    }
    const time = doc.createElement("div");
    time.className = "semlo-editor-vote-time";
    time.hidden = calendarMode !== "date";
    const timeHeading = doc.createElement("div");
    timeHeading.className = "semlo-editor-vote-time-heading";
    timeHeading.textContent = parts.map((part) => part ?? "--").join(":");
    time.append(timeHeading);
    const columns = doc.createElement("div");
    columns.className = "semlo-editor-vote-time-columns";
    (["小时", "分钟", "秒"] as const).forEach((label, index) => {
      const list = doc.createElement("div");
      list.className = "semlo-editor-vote-time-list";
      list.setAttribute("role", "listbox");
      list.setAttribute("aria-label", label);
      const max = index === 0 ? 24 : 60;
      for (let value = 0; value < max; value++) {
        const button = doc.createElement("button");
        button.type = "button";
        button.setAttribute("role", "option");
        button.tabIndex = pad(value) === (parts[index] ?? "00") ? 0 : -1;
        button.setAttribute("aria-label", `${label} ${pad(value)}`);
        button.textContent = pad(value);
        button.classList.toggle("is-selected", parts[index] === pad(value));
        button.setAttribute("aria-selected", String(parts[index] === pad(value)));
        button.addEventListener("click", () => {
          parts[index] = pad(value);
          if (index === 2) timePrecision = 3;
          updateDraft();
          render();
          panel
            ?.querySelector<HTMLButtonElement>(`[aria-label="${label} ${pad(value)}"]`)
            ?.focus({ preventScroll: true });
        });
        button.addEventListener("keydown", (event) => {
          if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
          event.preventDefault();
          const next = (value + (event.key === "ArrowDown" ? 1 : -1) + max) % max;
          const nextButton = panel?.querySelector<HTMLButtonElement>(`[aria-label="${label} ${pad(next)}"]`);
          if (nextButton) {
            for (const item of list.querySelectorAll<HTMLButtonElement>("button")) item.tabIndex = -1;
            nextButton.tabIndex = 0;
            nextButton.focus({ preventScroll: true });
            nextButton.scrollIntoView({ block: "nearest" });
          }
        });
        list.append(button);
      }
      columns.append(list);
    });
    time.append(columns);
    main.append(calendar, time);
    const footer = doc.createElement("div");
    footer.className = "semlo-editor-vote-date-footer";
    const now = doc.createElement("button");
    now.type = "button";
    now.textContent = "此刻";
    now.dataset.voteNow = "";
    now.addEventListener("click", () => {
      const current = localNow();
      calendarMode = "date";
      selectedDate = current.date;
      parts = current.time.split(":");
      timePrecision = 3;
      year = Number(selectedDate.slice(0, 4));
      month = Number(selectedDate.slice(5, 7)) - 1;
      updateDraft();
      render();
      onCommit(`${current.date}T${current.time}`);
      panel?.querySelector<HTMLButtonElement>("[data-vote-now]")?.focus({ preventScroll: true });
    });
    const confirm = doc.createElement("button");
    confirm.type = "button";
    confirm.textContent = "确定";
    confirm.addEventListener("click", commit);
    footer.append(now, confirm);
    panel.append(main, footer);
    columns.querySelectorAll<HTMLElement>(".semlo-editor-vote-time-list").forEach((list, index) => {
      if (parts[index] !== null) list.scrollTop = Number(parts[index]) * 28;
    });
  };
  const open = () => {
    if (disposed || panel) return;
    calendarMode = "date";
    const [date = "", time = ""] = (getValue() ?? "").split("T");
    selectedDate = date;
    parts = time ? [...time.split(":"), "00"].slice(0, 3) : [null, null, null];
    timePrecision = time && time.split(":").length === 2 ? 2 : 3;
    const displayDate = date || localNow().date;
    year = Number(displayDate.slice(0, 4));
    month = Number(displayDate.slice(5, 7)) - 1;
    textDirty = false;
    panel = doc.createElement("div");
    panel.className = "semlo-editor-vote-date-panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "选择截止日期和时间");
    panel.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      }
    });
    root.append(panel);
    unlinkPanel = linkPopup(input, panel);
    input.setAttribute("aria-expanded", "true");
    render();
    const anchor = root.getBoundingClientRect();
    const width = Math.min(450, (doc.defaultView?.innerWidth ?? 1000) - 24);
    const overflow = Math.max(0, anchor.left + width + 12 - (doc.defaultView?.innerWidth ?? 1000));
    if (overflow) panel.style.left = `${-overflow}px`;
    if (anchor.top < 330) {
      panel.style.bottom = "auto";
      panel.style.top = "calc(100% + 6px)";
    }
    doc.addEventListener("pointerdown", outside, true);
  };
  input.addEventListener("focus", () => {
    if (!suppressFocusOpen) open();
  });
  input.addEventListener("click", open);
  const updateTypedDraft = () => {
    if (!panel) return;
    const deadline = parsed(input.value);
    if (!deadline) return;
    const [date, time = ""] = deadline.split("T");
    selectedDate = date;
    parts = time ? [...time.split(":"), "00"].slice(0, 3) : [null, null, null];
    timePrecision = time && time.split(":").length === 2 ? 2 : 3;
    year = Number(date.slice(0, 4));
    month = Number(date.slice(5, 7)) - 1;
    render();
  };
  input.addEventListener("compositionstart", () => {
    inputComposing = true;
  });
  input.addEventListener("input", (event) => {
    textDirty = true;
    input.setCustomValidity("");
    if (!inputComposing && !(event as InputEvent).isComposing) updateTypedDraft();
  });
  input.addEventListener("compositionend", () => {
    inputComposing = false;
    updateTypedDraft();
  });
  input.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "Escape" && panel) {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    }
    if (event.key === "Enter" && panel) {
      event.preventDefault();
      event.stopPropagation();
      commit();
    }
  });
  syncInput();
  return {
    element: root,
    destroy: () => {
      disposed = true;
      close();
    },
  };
}
