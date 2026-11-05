import { Node } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

import { appendedReplacesSameNode, replacesSameNode } from "../../runtime/same-node-replacement";
import { addDays, dateFromISO, dateLabel, monthGrid, todayISO } from "../../shared/date/date-utils";

function validTime(value: unknown): string | null {
  return typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
}
function nextQuarterHour(): string {
  const now = new Date();
  const minutes = now.getHours() * 60 + now.getMinutes() + (now.getSeconds() || now.getMilliseconds() ? 1 : 0);
  const rounded = (Math.ceil(minutes / 15) * 15) % (24 * 60);
  return String(Math.floor(rounded / 60)).padStart(2, "0") + ":" + String(rounded % 60).padStart(2, "0");
}
function label(date: string, time: unknown): string {
  const value = validTime(time);
  return `${dateLabel(date)}${value ? ` ${value}` : ""}`;
}

export const DateCard = Node.create({
  name: "semloEditorDate",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      date: {
        default: null,
        rendered: false,
        parseHTML: (element) =>
          element.getAttribute("data-semlo-editor-date") || element.getAttribute("datetime")?.split("T")[0],
      },
      time: {
        default: null,
        rendered: false,
        parseHTML: (element) =>
          validTime(element.getAttribute("data-time") || element.getAttribute("datetime")?.split("T")[1]),
      },
      id: { default: null, rendered: false, parseHTML: (element) => element.getAttribute("data-date-id") },
    };
  },
  parseHTML() {
    return [{ tag: "time[data-semlo-editor-date]" }];
  },
  renderText({ node }) {
    return label(node.attrs.date, node.attrs.time);
  },
  renderHTML({ node }) {
    const date = dateFromISO(node.attrs.date) ? node.attrs.date : todayISO();
    const time = validTime(node.attrs.time);
    return [
      "time",
      {
        "data-semlo-editor-date": date,
        datetime: time ? `${date}T${time}` : date,
        class: "semlo-editor-date",
        ...(time ? { "data-time": time } : {}),
        ...(node.attrs.id ? { "data-date-id": node.attrs.id } : {}),
      },
      label(date, time),
    ];
  },
  addNodeView() {
    return ({ editor, view, node: initial, getPos }) => {
      const doc = view.dom.ownerDocument;
      const dom = doc.createElement("span");
      dom.className = "semlo-editor-date-node";
      dom.contentEditable = "false";
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "semlo-editor-date";
      dom.append(button);
      let current = initial;
      let closePopup: (() => void) | undefined;
      let refreshPopup: ((dateChanged: boolean) => void) | undefined;
      let updatingFromPopup = false;
      let popupTransaction: Transaction | undefined;
      const currentDate = () => (dateFromISO(current.attrs.date) ? (current.attrs.date as string) : todayISO());
      const paint = () => {
        if (current.attrs.id) dom.dataset.dateId = current.attrs.id;
        else delete dom.dataset.dateId;
        button.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="16" height="14" rx="2"/><path d="M8 3v6m8-6v6M4 11h16"/></svg>';
        button.append(doc.createTextNode(label(currentDate(), current.attrs.time)));
        button.setAttribute(
          "aria-label",
          `日期：${currentDate()}${validTime(current.attrs.time) ? ` ${current.attrs.time}` : ""}`,
        );
        button.disabled = !editor.isEditable;
      };
      const update = (attrs: { date?: string; time?: string | null }) => {
        if (!editor.isEditable || (attrs.date !== undefined && !dateFromISO(attrs.date))) return;
        const pos = getPos();
        const node = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
        if (node && node.type === current.type && typeof pos === "number") {
          if (Object.entries(attrs).every(([key, value]) => node.attrs[key] === value)) return;
          updatingFromPopup = true;
          const transaction = view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
          popupTransaction = transaction;
          const priorDate = current.attrs.date;
          try {
            view.dispatch(transaction);
          } catch (error) {
            try {
              refreshPopup?.(current.attrs.date !== priorDate);
            } catch (refreshError) {
              const report = doc.defaultView?.reportError;
              if (typeof report === "function") {
                try {
                  report.call(doc.defaultView, refreshError);
                } catch (reportError) {
                  queueMicrotask(() => {
                    throw new AggregateError([refreshError, reportError], "日期面板同步异常报告失败", {
                      cause: refreshError,
                    });
                  });
                }
              } else
                queueMicrotask(() => {
                  throw refreshError;
                });
            }
            throw error;
          } finally {
            popupTransaction = undefined;
            updatingFromPopup = false;
          }
        }
      };
      const open = () => {
        if (!editor.isEditable) return;
        if (closePopup) {
          closePopup();
          return;
        }

        const panel = doc.createElement("div");
        panel.className = "semlo-editor-date-picker";
        panel.setAttribute("role", "dialog");
        panel.setAttribute("aria-label", "选择日期");
        doc.body.append(panel);

        const win = doc.defaultView;
        const chosen = dateFromISO(currentDate()) ?? new Date();
        let rememberedTime = validTime(current.attrs.time) ?? nextQuarterHour();
        let year = chosen.getFullYear();
        let month = chosen.getMonth();
        let mode: "days" | "months" | "years" | "decades" = "days";
        let frame: number | undefined;

        const close = () => {
          if (!closePopup) return;
          closePopup = undefined;
          refreshPopup = undefined;
          panel.remove();
          doc.removeEventListener("pointerdown", outside, true);
          doc.removeEventListener("scroll", schedulePosition, true);
          win?.removeEventListener("resize", schedulePosition);
          if (frame !== undefined) win?.cancelAnimationFrame(frame);
        };
        const position = () => {
          if (!win || !panel.isConnected) return;
          const anchor = button.getBoundingClientRect();
          if (
            !button.isConnected ||
            !anchor.width ||
            !anchor.height ||
            anchor.bottom < 0 ||
            anchor.top > win.innerHeight ||
            anchor.right < 0 ||
            anchor.left > win.innerWidth
          ) {
            close();
            return;
          }
          const width = panel.offsetWidth;
          const height = panel.offsetHeight;
          const below = anchor.bottom + 8;
          const above = anchor.top - height - 8;
          const preferred = below + height <= win.innerHeight - 8 ? below : above >= 8 ? above : below;
          panel.style.left = Math.max(0, Math.min(Math.max(8, anchor.left), win.innerWidth - width - 8)) + "px";
          panel.style.top = Math.max(0, Math.min(Math.max(8, preferred), win.innerHeight - height - 8)) + "px";
        };
        const schedulePosition = () => {
          if (!win) return;
          if (frame !== undefined) win.cancelAnimationFrame(frame);
          frame = win.requestAnimationFrame(() => {
            frame = undefined;
            position();
          });
        };
        const moveMonth = (amount: number) => {
          const value = year * 12 + month + amount;
          if (value < 0 || value > 9999 * 12 + 11) return;
          year = Math.floor(value / 12);
          month = value % 12;
          draw();
        };
        const moveYear = (amount: number) => {
          const value = year + amount;
          if (value < 0 || value > 9999) return;
          year = value;
          draw();
        };
        const choose = (value: string) => {
          update({ date: value });
          close();
          if (!editor.isDestroyed) editor.commands.focus();
        };
        const navButton = (text: string, name: string, action: () => void) => {
          const nav = doc.createElement("button");
          nav.type = "button";
          nav.className = "semlo-editor-date-nav";
          nav.setAttribute("aria-label", name);
          nav.textContent = text;
          nav.addEventListener("click", action);
          return nav;
        };
        const titleButton = (text: string, name: string, action: () => void) => {
          const title = doc.createElement("button");
          title.type = "button";
          title.className = "semlo-editor-date-title-button";
          title.setAttribute("aria-label", name);
          title.textContent = text;
          title.addEventListener("click", action);
          return title;
        };
        const changeMode = (value: typeof mode) => {
          mode = value;
          draw();
        };
        const draw = () => {
          panel.replaceChildren();
          panel.dataset.view = mode;
          const header = doc.createElement("div");
          header.className = "semlo-editor-date-header";
          const title = doc.createElement("div");
          title.className = "semlo-editor-date-header-title";

          if (mode === "days") {
            header.append(
              navButton("«", "上一年", () => moveMonth(-12)),
              navButton("‹", "上个月", () => moveMonth(-1)),
            );
            title.append(
              titleButton(year + "年", "选择年份", () => changeMode("years")),
              titleButton(month + 1 + "月", "选择月份", () => changeMode("months")),
            );
            header.append(
              title,
              navButton("›", "下个月", () => moveMonth(1)),
              navButton("»", "下一年", () => moveMonth(12)),
            );
          } else {
            const amount = mode === "months" ? 1 : mode === "years" ? 10 : 100;
            const unit = mode === "months" ? "年" : mode === "years" ? "十年" : "百年";
            header.append(navButton("«", "上一" + unit, () => moveYear(-amount)));
            if (mode === "months") {
              title.append(titleButton(year + "年", "选择年份", () => changeMode("years")));
            } else if (mode === "years") {
              const start = Math.floor(year / 10) * 10;
              title.append(titleButton(start + "-" + (start + 9), "选择十年范围", () => changeMode("decades")));
            } else {
              const start = Math.floor(year / 100) * 100;
              const range = doc.createElement("span");
              range.textContent = start + "-" + (start + 99);
              title.append(range);
            }
            header.append(
              title,
              navButton("»", "下一" + unit, () => moveYear(amount)),
            );
          }
          panel.append(header);

          if (mode === "days") {
            const grid = doc.createElement("div");
            grid.className = "semlo-editor-date-grid";
            grid.setAttribute("role", "grid");
            for (const label of ["日", "一", "二", "三", "四", "五", "六"]) {
              const day = doc.createElement("span");
              day.className = "semlo-editor-date-weekday";
              day.textContent = label;
              grid.append(day);
            }
            for (const cell of monthGrid(year, month, true)) {
              const day = doc.createElement("button");
              day.type = "button";
              day.textContent = String(cell.day);
              day.setAttribute("aria-label", cell.date);
              day.disabled = !dateFromISO(cell.date);
              day.classList.toggle("is-outside", !cell.current);
              day.classList.toggle("is-selected", cell.date === currentDate());
              day.addEventListener("click", () => choose(cell.date));
              grid.append(day);
            }
            panel.append(grid);
          } else {
            const grid = doc.createElement("div");
            grid.className = "semlo-editor-date-period-grid";
            grid.setAttribute("role", "grid");
            const selected = dateFromISO(currentDate());
            const start = mode === "years" ? Math.floor(year / 10) * 10 : Math.floor(year / 100) * 100;
            for (let index = 0; index < 12; index++) {
              const item = doc.createElement("button");
              item.type = "button";
              if (mode === "months") {
                item.textContent = index + 1 + " 月";
                item.setAttribute("aria-label", "选择" + (index + 1) + "月");
                item.classList.toggle("is-selected", selected?.getFullYear() === year && selected.getMonth() === index);
                item.addEventListener("click", () => {
                  month = index;
                  changeMode("days");
                });
              } else if (mode === "years") {
                const value = start + index - 1;
                item.textContent = String(value);
                item.setAttribute("aria-label", "选择" + value + "年");
                item.disabled = value < 0 || value > 9999;
                item.classList.toggle("is-outside", index === 0 || index === 11);
                item.classList.toggle("is-selected", selected?.getFullYear() === value);
                item.addEventListener("click", () => {
                  year = value;
                  changeMode("days");
                });
              } else {
                const value = start + (index - 1) * 10;
                item.textContent = value + "-" + (value + 9);
                item.setAttribute("aria-label", "选择" + value + "-" + (value + 9) + "年");
                item.disabled = value < 0 || value > 9999;
                item.classList.toggle("is-outside", index === 0 || index === 11);
                item.classList.toggle("is-selected", Math.floor((selected?.getFullYear() ?? -1) / 10) * 10 === value);
                item.addEventListener("click", () => {
                  year = value + (year % 10);
                  changeMode("years");
                });
              }
              if (item.classList.contains("is-selected")) item.setAttribute("aria-current", "date");
              grid.append(item);
            }
            panel.append(grid);
          }

          const footer = doc.createElement("div");
          footer.className = "semlo-editor-date-footer";
          for (const [label, offset] of [
            ["今天", 0],
            ["明天", 1],
            ["+7天", 7],
          ] as const) {
            const quick = doc.createElement("button");
            quick.type = "button";
            quick.textContent = label;
            quick.addEventListener("click", () => choose(addDays(todayISO(), offset)));
            footer.append(quick);
          }
          panel.append(footer);

          const timeRow = doc.createElement("div");
          timeRow.className = "semlo-editor-date-time";
          const toggleLabel = doc.createElement("label");
          const toggle = doc.createElement("input");
          toggle.type = "checkbox";
          toggle.checked = !!validTime(current.attrs.time);
          toggle.setAttribute("aria-label", "时刻");
          toggleLabel.append(toggle, doc.createTextNode("时刻"));
          timeRow.append(toggleLabel);
          toggle.addEventListener("change", () => {
            const restoreFocus = toggle.checked && doc.activeElement === toggle;
            const priorDate = current.attrs.date;
            update({ time: toggle.checked ? rememberedTime : null });
            if (editor.isDestroyed || !closePopup) return;
            if (current.attrs.date !== priorDate) refreshPopup?.(true);
            else draw();
            if (restoreFocus) panel.querySelector<HTMLInputElement>('input[aria-label="时刻"]')?.focus();
          });
          toggle.addEventListener("keydown", (event) => {
            if (event.isComposing || event.keyCode === 229) return;
            if (event.key === "Tab" && !event.shiftKey && toggle.checked) {
              event.preventDefault();
              close();
              view.focus();
            }
          });
          const time = validTime(current.attrs.time);
          if (time) {
            const wrap = doc.createElement("div");
            wrap.className = "semlo-editor-date-time-wrap";
            const trigger = doc.createElement("button");
            trigger.type = "button";
            trigger.className = "semlo-editor-date-time-trigger";
            trigger.setAttribute("aria-label", "选择时刻");
            trigger.setAttribute("aria-haspopup", "listbox");
            trigger.setAttribute("aria-expanded", "false");
            trigger.textContent = time;
            const list = doc.createElement("div");
            list.className = "semlo-editor-date-time-list";
            list.setAttribute("role", "listbox");
            list.setAttribute("aria-label", "选择时刻");
            list.hidden = true;
            const values = Array.from(
              { length: 96 },
              (_, index) =>
                String(Math.floor(index / 4)).padStart(2, "0") + ":" + String((index % 4) * 15).padStart(2, "0"),
            );
            const hide = () => {
              list.hidden = true;
              trigger.setAttribute("aria-expanded", "false");
            };
            const buttons = values.map((value) => {
              const option = doc.createElement("button");
              option.type = "button";
              option.setAttribute("role", "option");
              option.textContent = value;
              option.setAttribute("aria-selected", String(value === time));
              option.addEventListener("click", () => {
                rememberedTime = value;
                const priorDate = current.attrs.date;
                update({ time: value });
                if (editor.isDestroyed || !closePopup) return;
                const actualTime = validTime(current.attrs.time);
                if (actualTime !== value || current.attrs.date !== priorDate) {
                  refreshPopup?.(current.attrs.date !== priorDate);
                  panel
                    .querySelector<HTMLButtonElement | HTMLInputElement>(
                      actualTime ? 'button[aria-label="选择时刻"]' : 'input[aria-label="时刻"]',
                    )
                    ?.focus();
                  return;
                }
                trigger.textContent = value;
                buttons.forEach((item, index) => item.setAttribute("aria-selected", String(values[index] === value)));
                hide();
                trigger.focus();
              });
              list.append(option);
              return option;
            });
            const show = () => {
              list.hidden = false;
              trigger.setAttribute("aria-expanded", "true");
              const index = Math.max(0, values.indexOf(validTime(current.attrs.time) ?? time));
              list.scrollTop = Math.max(0, index * 32 - 96);
            };
            trigger.addEventListener("mousedown", (event) => event.preventDefault());
            trigger.addEventListener("click", () => {
              if (list.hidden) show();
              else hide();
            });
            trigger.addEventListener("keydown", (event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                show();
                buttons[Math.max(0, values.indexOf(validTime(current.attrs.time) ?? time))].focus();
              }
            });
            list.addEventListener("keydown", (event) => {
              const index = buttons.indexOf(doc.activeElement as HTMLButtonElement);
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                buttons[
                  Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))
                ].focus();
              }
            });
            wrap.append(trigger, list);
            timeRow.append(wrap);
          }
          panel.append(timeRow);
          position();
        };
        const outside = (event: Event) => {
          if (!panel.contains(event.target as globalThis.Node) && !dom.contains(event.target as globalThis.Node))
            close();
        };
        closePopup = close;
        refreshPopup = (dateChanged) => {
          rememberedTime = validTime(current.attrs.time) ?? rememberedTime;
          if (dateChanged) {
            const date = dateFromISO(currentDate());
            if (date) {
              year = date.getFullYear();
              month = date.getMonth();
            }
          }
          draw();
        };
        draw();
        if (!closePopup) return;
        doc.addEventListener("pointerdown", outside, true);
        doc.addEventListener("scroll", schedulePosition, true);
        win?.addEventListener("resize", schedulePosition);
      };
      button.addEventListener("mousedown", (event) => event.preventDefault());
      button.addEventListener("click", open);
      dom.addEventListener("semlo-editor:open-date", open);
      const editableChanged = () => {
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
        )
          closePopup?.();
        if (updatingFromPopup) return;
        const pos = getPos();
        const node = typeof pos === "number" ? view.state.doc.nodeAt(pos) : null;
        if (node && node.type === current.type && node !== current) {
          // Equal replacement can reuse this view without calling update().
          // Do not let the old picker edit the replacement node.
          closePopup?.();
          current = node;
          paint();
        }
      };
      const beforeTransaction = ({ transaction }: { transaction: Transaction }) => {
        const pos = getPos();
        if (typeof pos !== "number") return;
        const before = view.state.doc.nodeAt(pos);
        if (transaction !== popupTransaction && before === current && replacesSameNode(transaction, pos, current))
          replacedSameNodes.add(transaction);
        if (!updatingFromPopup || transaction === popupTransaction) return;
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
          const dateChanged = node.attrs.date !== current.attrs.date;
          const timeChanged = node.attrs.time !== current.attrs.time;
          const identityChanged =
            typeof current.attrs.id === "string" &&
            current.attrs.id.length > 0 &&
            typeof node.attrs.id === "string" &&
            node.attrs.id.length > 0 &&
            node.attrs.id !== current.attrs.id;
          if (identityChanged) closePopup?.();
          current = node;
          paint();
          if (!updatingFromPopup && (dateChanged || timeChanged)) refreshPopup?.(dateChanged);
          return true;
        },
        stopEvent: () => true,
        ignoreMutation: () => true,
        destroy() {
          closePopup?.();
          editor.off("beforeTransaction", beforeTransaction);
          editor.off("transaction", transaction);
          view.dom.removeEventListener("semlo-editor:editable", editableChanged);
        },
      };
    };
  },
});
