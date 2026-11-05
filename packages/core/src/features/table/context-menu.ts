import { Plugin, TextSelection, type Transaction } from "@tiptap/pm/state";
import {
  CellSelection,
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  deleteTable,
  mergeCells,
  selectedRect,
  splitCell,
} from "@tiptap/pm/tables";
import { type EditorView } from "@tiptap/pm/view";

import { rethrowTableViewSetup, runTableViewCleanup, type TableViewDisposerRegistration } from "./edges";
import { selectionContainsCell, selectedTableText } from "./selection";
import {
  hasSequenceColumn,
  normalizeSequenceColumns,
  insertSequenceColumn,
  numberSequenceColumn,
  mergeSequenceCells,
} from "./sequence";
import { dispatchTableChange, type TableCommand } from "./transactions";
import { clearTableCells } from "./transactions";

const maxInsertCount = 100;

/** Apply repeated ProseMirror commands to a single transaction and history event. */
function repeatTableCommand(view: EditorView, command: TableCommand, count: number): boolean {
  let working = view.state;
  const combined = working.tr;
  for (let index = 0; index < count; index++) {
    let part: Transaction | undefined;
    if (!command(working, (transaction) => (part = transaction)) || !part?.docChanged) return false;
    for (const step of part.steps) combined.step(step);
    working = working.apply(part);
  }
  combined.setSelection(working.selection.getBookmark().resolve(combined.doc));
  dispatchTableChange(view, combined);
  return true;
}

export function tableContextMenu(registerViewDisposer?: TableViewDisposerRegistration) {
  return new Plugin({
    appendTransaction: (transactions, oldState, newState) => normalizeSequenceColumns(transactions, oldState, newState),
    view(view) {
      const doc = view.dom.ownerDocument;
      const win = doc.defaultView;
      let menu: HTMLDivElement | null = null;
      let openedDoc = view.state.doc;
      let openedSelection = view.state.selection;
      let openedCell = -1;
      let allowCellCursor = false;
      let writing = false;
      let destroyed = false;

      const close = (focus = false) => {
        menu?.remove();
        menu = null;
        writing = false;
        if (focus && !view.isDestroyed && view.editable) view.focus();
      };
      const valid = () =>
        !destroyed &&
        !view.isDestroyed &&
        view.editable &&
        menu !== null &&
        view.state.doc === openedDoc &&
        view.state.selection.eq(openedSelection);

      const pointerDown = (event: Event) => {
        if (menu && !menu.contains(event.target as globalThis.Node)) close();
      };
      const keyDown = (event: KeyboardEvent) => {
        if (menu && event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close(true);
        }
      };
      const editableChanged = () => {
        if (!view.editable) close();
      };
      const onContextMenu = (event: MouseEvent) => {
        if (!view.editable || !win) return;
        const target = event.target;
        if (!(target instanceof win.Element)) return;
        const cell = target.closest("td,th");
        if (!cell || !view.dom.contains(cell)) return;
        let position: number;
        try {
          position = view.posAtDOM(cell, 0) - 1;
        } catch {
          return;
        }
        const node = view.state.doc.nodeAt(position);
        if (!node || !["cell", "header_cell"].includes(node.type.spec.tableRole ?? "")) return;
        event.preventDefault();
        event.stopPropagation();
        close();
        const selection = view.state.selection;
        if (!(selection instanceof CellSelection && selectionContainsCell(selection, position))) {
          const cursor = TextSelection.near(view.state.doc.resolve(position + 1), 1);
          view.dispatch(view.state.tr.setSelection(cursor).setMeta("addToHistory", false));
        }
        openedDoc = view.state.doc;
        openedSelection = view.state.selection;
        openedCell = position;
        allowCellCursor = !(openedSelection instanceof CellSelection);
        const rect = selectedRect(view.state);
        const panel = doc.createElement("div");
        panel.className = "semlo-editor-table-context-menu";
        panel.setAttribute("role", "menu");
        panel.setAttribute("aria-label", "表格操作");
        menu = panel;

        const separator = () => {
          const line = doc.createElement("div");
          line.className = "semlo-editor-table-context-separator";
          panel.append(line);
        };
        const status = doc.createElement("div");
        status.className = "semlo-editor-table-context-status";
        status.setAttribute("role", "status");

        const action = (label: string, icon: string, run: () => void, shortcut?: string) => {
          const button = doc.createElement("button");
          button.type = "button";
          button.className = "semlo-editor-table-context-action";
          button.setAttribute("role", "menuitem");
          button.setAttribute("aria-label", label);
          const iconElement = doc.createElement("span");
          iconElement.className = "semlo-editor-table-context-icon";
          iconElement.setAttribute("aria-hidden", "true");
          iconElement.textContent = icon;
          const text = doc.createElement("span");
          text.textContent = label;
          button.append(iconElement, text);
          if (shortcut) {
            const hint = doc.createElement("span");
            hint.className = "semlo-editor-table-context-shortcut";
            hint.textContent = shortcut;
            button.append(hint);
          }
          button.addEventListener("mousedown", (down) => down.preventDefault());
          button.addEventListener("click", () => {
            if (valid() && !writing) run();
          });
          panel.append(button);
        };

        const copy = async (cut: boolean) => {
          const selection = view.state.selection;
          if (!(selection instanceof CellSelection) || !valid()) return;
          const current = menu;
          const clipboard = win.navigator.clipboard;
          if (!clipboard) {
            status.textContent = "复制失败，请检查剪贴板权限";
            return;
          }
          writing = true;
          const { dom } = view.serializeForClipboard(selection.content());
          const text = selectedTableText(selection);
          let result: "rich" | "plain" | "failed" = "failed";
          try {
            if (clipboard.write && win.ClipboardItem) {
              await clipboard.write([
                new win.ClipboardItem({
                  "text/html": new win.Blob([dom.innerHTML], { type: "text/html" }),
                  "text/plain": new win.Blob([text], { type: "text/plain" }),
                }),
              ]);
              result = "rich";
            }
          } catch {
            /* Fall back to plain text if rich clipboard access is unavailable. */
          }
          if (result === "failed") {
            try {
              if (clipboard.writeText) {
                await clipboard.writeText(text);
                result = "plain";
              }
            } catch {
              /* Permission denied. */
            }
          }
          if (!valid() || menu !== current) return;
          writing = false;
          if (result === "failed") {
            status.textContent = "复制失败，请检查剪贴板权限";
            return;
          }
          if (result === "plain") {
            status.textContent = cut ? "浏览器仅允许复制纯文本，未剪切以保留格式" : "已复制纯文本，未包含格式";
            return;
          }
          if (cut) clearTableCells(view);
          close(true);
        };

        const selected = view.state.selection;
        if (selected instanceof CellSelection && selected.$anchorCell.pos !== selected.$headCell.pos) {
          action("剪切", "✂", () => void copy(true), "⌘X");
          action("复制", "▢", () => void copy(false), "⌘C");
          separator();
        }
        const insert = (label: string, icon: string, unit: string, initial: number, command: TableCommand) => {
          const row = doc.createElement("div");
          row.className = "semlo-editor-table-context-insert";
          const button = doc.createElement("button");
          button.type = "button";
          button.setAttribute("role", "menuitem");
          button.setAttribute("aria-label", label);
          const glyph = doc.createElement("span");
          glyph.className = "semlo-editor-table-context-icon";
          glyph.setAttribute("aria-hidden", "true");
          glyph.textContent = icon;
          const text = doc.createElement("span");
          text.textContent = label;
          button.append(glyph, text);
          const input = doc.createElement("input");
          input.type = "number";
          input.min = "1";
          input.max = String(maxInsertCount);
          input.step = "1";
          input.value = String(Math.min(maxInsertCount, initial));
          input.setAttribute("aria-label", `${label}${unit}数`);
          const suffix = doc.createElement("span");
          suffix.className = "semlo-editor-table-context-unit";
          suffix.textContent = unit;
          const run = () => {
            if (!valid() || writing) return;
            const count = Number(input.value);
            if (!Number.isSafeInteger(count) || count < 1 || count > maxInsertCount) {
              input.setAttribute("aria-invalid", "true");
              return;
            }
            input.removeAttribute("aria-invalid");
            if (repeatTableCommand(view, command, count)) close(true);
          };
          button.addEventListener("mousedown", (down) => down.preventDefault());
          button.addEventListener("click", run);
          input.addEventListener("input", () => input.removeAttribute("aria-invalid"));
          input.addEventListener("keydown", (key) => {
            if (key.key === "Enter") {
              key.preventDefault();
              run();
            }
          });
          row.append(button, input, suffix);
          panel.append(row);
        };
        insert("向上插入", "↑", "行", rect.bottom - rect.top, addRowBefore);
        insert("向下插入", "↓", "行", rect.bottom - rect.top, addRowAfter);
        insert("向左插入", "←", "列", rect.right - rect.left, addColumnBefore);
        insert("向右插入", "→", "列", rect.right - rect.left, addColumnAfter);
        if (rect.left === 0 && rect.right === 1) {
          const row = doc.createElement("div");
          row.className = "semlo-editor-table-context-numbering";
          const button = doc.createElement("button");
          button.type = "button";
          button.setAttribute("role", "menuitem");
          button.setAttribute("aria-label", "自动编号");
          button.textContent = "¹²　从第";
          const input = doc.createElement("input");
          input.type = "number";
          input.min = "1";
          input.max = String(rect.map.height);
          input.step = "1";
          input.value = String(rect.top + 1);
          input.setAttribute("aria-label", "自动编号起始行");
          const suffix = doc.createElement("span");
          suffix.textContent = "行起自动编号";
          suffix.setAttribute("aria-hidden", "true");
          const run = () => {
            if (!valid() || writing) return;
            const start = Number(input.value);
            if (!Number.isSafeInteger(start) || start < 1 || start > rect.map.height) {
              input.setAttribute("aria-invalid", "true");
              return;
            }
            input.removeAttribute("aria-invalid");
            if (numberSequenceColumn(view, start)) close(true);
            else {
              input.setAttribute("aria-invalid", "true");
              status.textContent = "无法编号，请检查起始行和首列合并单元格";
            }
          };
          for (const trigger of [button, suffix]) {
            trigger.addEventListener("mousedown", (down) => down.preventDefault());
            trigger.addEventListener("click", run);
          }
          input.addEventListener("input", () => input.removeAttribute("aria-invalid"));
          input.addEventListener("keydown", (key) => {
            if (key.key === "Enter") {
              key.preventDefault();
              run();
            }
          });
          row.append(button, input, suffix);
          panel.append(row);
        }
        if (!hasSequenceColumn(view.state) || rect.left === 0)
          action("插入序号列到最左侧", "¹²", () => {
            if (insertSequenceColumn(view)) close(true);
          });
        separator();
        const commandAction = (label: string, command: TableCommand) =>
          action(label, "", () => {
            let changed = false;
            const executed = command(view.state, (transaction) => {
              changed = transaction.docChanged;
              dispatchTableChange(view, transaction);
            });
            if (executed && changed) close(true);
          });
        commandAction("删除所选行", deleteRow);
        commandAction("删除所选列", deleteColumn);
        commandAction("删除表格", deleteTable);
        if (mergeCells(view.state)) commandAction("合并单元格", mergeSequenceCells);
        else if (splitCell(view.state)) commandAction("拆分单元格", splitCell);
        separator();
        action("清除内容", "", () => {
          clearTableCells(view);
          close(true);
        });
        panel.append(status);
        doc.body.append(panel);
        const margin = 8;
        panel.style.left = `${Math.max(margin, Math.min(event.clientX, win.innerWidth - panel.offsetWidth - margin))}px`;
        panel.style.top = `${Math.max(margin, Math.min(event.clientY, win.innerHeight - panel.offsetHeight - margin))}px`;
      };
      let unregister: (() => void) | undefined;
      const destroy = () => {
        if (destroyed) return;
        destroyed = true;
        const detach = unregister;
        unregister = undefined;
        runTableViewCleanup([
          () => detach?.(),
          () => close(),
          () => view.dom.removeEventListener("contextmenu", onContextMenu, true),
          () => view.dom.removeEventListener("semlo-editor:editable", editableChanged),
          () => doc.removeEventListener("pointerdown", pointerDown, true),
          () => doc.removeEventListener("keydown", keyDown, true),
        ]);
      };
      unregister = registerViewDisposer?.(destroy);
      if (destroyed) {
        unregister?.();
        return { destroy };
      }
      try {
        view.dom.addEventListener("contextmenu", onContextMenu, true);
        view.dom.addEventListener("semlo-editor:editable", editableChanged);
        doc.addEventListener("pointerdown", pointerDown, true);
        doc.addEventListener("keydown", keyDown, true);
      } catch (error) {
        rethrowTableViewSetup(error, destroy);
      }
      return {
        update(next) {
          if (!menu) return;
          if (!next.editable || next.state.doc !== openedDoc) {
            close();
            return;
          }
          if (!next.state.selection.eq(openedSelection)) {
            const current = next.state.selection;
            const cell = next.state.doc.nodeAt(openedCell);
            if (
              allowCellCursor &&
              cell &&
              !(current instanceof CellSelection) &&
              current.from > openedCell &&
              current.to < openedCell + cell.nodeSize
            )
              openedSelection = current;
            else close();
          }
        },
        destroy,
      };
    },
  });
}
