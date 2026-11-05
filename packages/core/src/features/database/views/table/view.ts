import type { Editor } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

import type { createColumnDrag } from "../../column-drag";
import {
  createDatabaseRecord,
  databaseGroupKey,
  databaseValueText,
  orderedDatabaseFields,
  type DatabaseData,
  type DatabaseField,
  type DatabaseFieldType,
  type DatabaseRecord,
  type DatabaseView,
} from "../../model";
import { readDatabaseActor, type DatabaseOptions } from "../../options";
import type { createRowDrag } from "../../row-drag";
import { setDatabaseViewProjection } from "../../view-projection";
import { statisticText } from "./statistics";

interface TableViewContext {
  doc: Document;
  dom: HTMLElement;
  editor: Editor;
  columnDrag: ReturnType<typeof createColumnDrag>;
  rowDrag: ReturnType<typeof createRowDrag>;
  fieldIcons: Record<DatabaseFieldType, string>;
  optionColors: string[];
  collapsedGroupsByView: Map<string, Map<string, Set<string>>>;
  pendingGroups: Map<string, { viewId: string; fieldId: string; value: boolean | [] | "" }>;
  getCurrent(): ProseMirrorNode;
  getSelected(): Set<string>;
  isDestroyed(): boolean;
  getOptions(): DatabaseOptions;
  paint(): void;
  button(
    label: string,
    text: string,
    action: () => void,
    className?: string,
    allowReadonly?: boolean,
  ): HTMLButtonElement;
  fieldMenu(anchor: HTMLElement, field: DatabaseField): void;
  editField(anchor: HTMLElement): void;
  makeCell(field: DatabaseField, record: DatabaseRecord, index: number): HTMLElement;
  statisticPanel(anchor: HTMLElement, field: DatabaseField): void;
  change(mutate: (data: DatabaseData, view: DatabaseView) => void, repaint?: boolean, origin?: HTMLElement): boolean;
}

export function createTableView({
  doc,
  dom,
  editor,
  columnDrag,
  rowDrag,
  fieldIcons,
  optionColors,
  collapsedGroupsByView,
  pendingGroups,
  getCurrent,
  getSelected,
  isDestroyed,
  getOptions,
  paint,
  button,
  fieldMenu,
  editField,
  makeCell,
  statisticPanel,
  change,
}: TableViewContext) {
  return (container: HTMLElement, data: DatabaseData, active: DatabaseView, records: DatabaseRecord[]) => {
    const fields = orderedDatabaseFields(data, active).filter((field) => !active.hiddenFields.includes(field.id));
    const grid = doc.createElement("div");
    grid.className = `semlo-editor-database-grid is-${active.rowHeight}`;
    grid.setAttribute("role", "table");
    grid.setAttribute("aria-label", active.name);
    grid.style.gridTemplateColumns = ["64px", ...fields.map(() => "minmax(150px, 1fr)"), "44px"].join(" ");
    const head = doc.createElement("div");
    head.className = "semlo-editor-database-row semlo-editor-database-header";
    head.setAttribute("role", "row");
    const all = doc.createElement("div");
    all.className = "semlo-editor-database-row-head";
    const checkAll = doc.createElement("input");
    checkAll.type = "checkbox";
    checkAll.setAttribute("aria-label", "选择所有记录");
    checkAll.disabled = !editor.isEditable || records.length === 0;
    checkAll.checked = records.length > 0 && records.every((record) => getSelected().has(record.id));
    checkAll.indeterminate = records.some((record) => getSelected().has(record.id)) && !checkAll.checked;
    checkAll.addEventListener("change", () => {
      if (!dom.contains(checkAll)) return;
      for (const record of records) {
        if (checkAll.checked) getSelected().add(record.id);
        else getSelected().delete(record.id);
      }
      paint();
    });
    all.append(checkAll);
    head.append(all);
    for (const field of fields) {
      const cell = doc.createElement("div");
      cell.className = "semlo-editor-database-column-head";
      cell.setAttribute("role", "columnheader");
      columnDrag.bind(cell, field.id);
      const name = doc.createElement("span");
      name.textContent = `${fieldIcons[field.type]}  ${field.name}`;
      const menu = button(
        `${field.name}列菜单`,
        "⌄",
        () => fieldMenu(menu, field),
        "semlo-editor-database-column-menu",
      );
      cell.append(name, menu);
      head.append(cell);
    }
    const addColumnCell = doc.createElement("div");
    addColumnCell.className = "semlo-editor-database-column-head semlo-editor-database-add-column";
    const addColumn = button("添加列", "+", () => editField(addColumn));
    addColumnCell.append(addColumn);
    head.append(addColumnCell);
    grid.append(head);

    const recordIndexes = new Map(records.map((record, index) => [record.id, index]));
    const paintRow = (record: DatabaseRecord) => {
      const index = recordIndexes.get(record.id) ?? 0;
      const row = doc.createElement("div");
      row.className = "semlo-editor-database-row";
      row.setAttribute("role", "row");
      const number = doc.createElement("div");
      number.className = "semlo-editor-database-row-head semlo-editor-database-record-index";
      const checkbox = doc.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = getSelected().has(record.id);
      checkbox.disabled = !editor.isEditable;
      checkbox.setAttribute("aria-label", `选择第 ${index + 1} 条记录`);
      checkbox.addEventListener("change", () => {
        if (!dom.contains(checkbox)) return;
        if (checkbox.checked) getSelected().add(record.id);
        else getSelected().delete(record.id);
        paint();
      });
      const ordinal = doc.createElement("span");
      ordinal.textContent = String(index + 1);
      const handle = button(`移动第 ${index + 1} 条记录`, "⋮⋮", () => {}, "semlo-editor-database-record-drag");
      rowDrag.bind(row, handle, record.id);
      number.append(handle, checkbox, ordinal);
      row.append(number);
      for (const field of fields) row.append(makeCell(field, record, index));
      const actions = doc.createElement("div");
      actions.className = "semlo-editor-database-row-actions";
      actions.append(
        button(`删除第 ${index + 1} 条记录`, "×", () => {
          change((next) => {
            next.records = next.records.filter((item) => item.id !== record.id);
          });
          getSelected().delete(record.id);
        }),
      );
      row.append(actions);
      grid.append(row);
    };
    const groupField = data.fields.find((field) => field.id === active.groupFieldId);
    if (!groupField) {
      setDatabaseViewProjection(dom, undefined);
      records.forEach(paintRow);
    } else {
      const viewGroups = collapsedGroupsByView.get(active.id) ?? new Map<string, Set<string>>();
      collapsedGroupsByView.set(active.id, viewGroups);
      const collapsedGroups = viewGroups.get(groupField.id) ?? new Set<string>();
      viewGroups.set(groupField.id, collapsedGroups);
      const groups = new Map<string, { name: string; records: DatabaseRecord[] }>();
      for (const record of records) {
        const pin = pendingGroups.get(record.id);
        const groupValue =
          pin && pin.viewId === active.id && pin.fieldId === groupField.id ? pin.value : record.values[groupField.id];
        const value = databaseValueText(groupField, groupValue);
        const key = databaseGroupKey(groupField, groupValue);
        const name = groupField.type === "checkbox" ? (value ? "已勾选" : "未勾选") : value || "（空）";
        const group = groups.get(key) ?? { name, records: [] };
        group.records.push(record);
        groups.set(key, group);
      }
      const optionRanks = new Map(groupField.options.map((item, index) => [item.id, index]));
      const optionOrder = (key: string, group: { records: DatabaseRecord[] }) => {
        const value = key === databaseGroupKey(groupField, []) ? [] : group.records[0]?.values[groupField.id];
        const ids = Array.isArray(value)
          ? value.filter((item): item is string => typeof item === "string")
          : typeof value === "string" && value
            ? [value]
            : [];
        return ids.map((id) => optionRanks.get(id)).filter((rank): rank is number => rank !== undefined);
      };
      const optionBased = groupField.type === "singleSelect" || groupField.type === "multiSelect";
      const orders = optionBased
        ? new Map([...groups.entries()].map(([key, group]) => [key, optionOrder(key, group)]))
        : null;
      const groupEntries = [...groups.entries()].sort(([leftKey, a], [rightKey, b]) => {
        let comparison = 0;
        if (orders) {
          const left = orders.get(leftKey)!,
            right = orders.get(rightKey)!;
          if (!left.length || !right.length) {
            // 单选和多选的空分组在两种排序方向下都排在最后。
            return left.length ? -1 : right.length ? 1 : 0;
          } else {
            for (let index = 0; index < Math.min(left.length, right.length); index++) {
              comparison = left[index] - right[index];
              if (comparison) break;
            }
            if (!comparison) comparison = left.length - right.length;
          }
        } else comparison = a.name.localeCompare(b.name, "zh-CN");
        return active.groupDirection === "desc" ? -comparison : comparison;
      });
      setDatabaseViewProjection(dom, {
        node: getCurrent(),
        viewId: active.id,
        groupFieldId: groupField.id,
        groups: groupEntries.map(([key, group]) => ({
          key,
          recordIds: group.records.map((record) => record.id),
          collapsed: collapsedGroups.has(key),
        })),
      });
      // 行号按展示后的分组顺序计算。
      recordIndexes.clear();
      let groupedIndex = 0;
      for (const [, group] of groupEntries)
        for (const record of group.records) recordIndexes.set(record.id, groupedIndex++);
      for (const [key, { name, records: entries }] of groupEntries) {
        const header = button(
          `折叠分组 ${name}`,
          `${collapsedGroups.has(key) ? "▸" : "▾"}  ${name}`,
          () => {
            if (collapsedGroups.has(key)) collapsedGroups.delete(key);
            else collapsedGroups.add(key);
            paint();
          },
          "semlo-editor-database-group-heading",
          true,
        );
        header.setAttribute("aria-expanded", String(!collapsedGroups.has(key)));
        if (groupField.type === "checkbox") {
          header.replaceChildren();
          const arrow = doc.createElement("span");
          arrow.textContent = collapsedGroups.has(key) ? "▸" : "▾";
          const mark = doc.createElement("span");
          mark.className = "semlo-editor-database-group-checkbox";
          mark.setAttribute("aria-hidden", "true");
          if (key === databaseGroupKey(groupField, true)) {
            mark.classList.add("is-checked");
            mark.textContent = "✓";
          }
          header.append(arrow, mark);
        } else if (optionBased) {
          const value = key === databaseGroupKey(groupField, []) ? [] : entries[0]?.values[groupField.id];
          const ids = Array.isArray(value)
            ? value.filter((item): item is string => typeof item === "string")
            : typeof value === "string" && value
              ? [value]
              : [];
          const selectedOptions = ids.flatMap((id) => {
            const selected = groupField.options.find((item) => item.id === id);
            return selected ? [selected] : [];
          });
          if (selectedOptions.length) {
            header.replaceChildren();
            const arrow = doc.createElement("span");
            arrow.textContent = collapsedGroups.has(key) ? "▸" : "▾";
            header.append(arrow);
            for (const selected of selectedOptions) {
              const chip = doc.createElement("span");
              chip.className = "semlo-editor-database-chip";
              chip.style.backgroundColor = optionColors[selected.color] ?? optionColors[0];
              chip.textContent = selected.label;
              header.append(chip);
            }
          }
        }
        const groupRow = doc.createElement("div");
        groupRow.className = "semlo-editor-database-group-row";
        groupRow.setAttribute("role", "row");
        groupRow.style.gridTemplateColumns = grid.style.gridTemplateColumns;
        groupRow.append(header);
        fields.forEach((field, index) => {
          const cell = doc.createElement("div");
          cell.className = "semlo-editor-database-statistic semlo-editor-database-group-statistic";
          cell.style.gridColumn = String(index + 2);
          const statistic = active.statistics[field.id] ?? "none";
          if (statistic !== "none") cell.classList.add("has-statistic");
          const control = button(`${name}分组的${field.name}统计`, statisticText(field, entries, statistic), () =>
            statisticPanel(control, field),
          );
          cell.append(control);
          groupRow.append(cell);
        });
        grid.append(groupRow);
        if (!collapsedGroups.has(key)) {
          entries.forEach(paintRow);
          const groupValue = key === databaseGroupKey(groupField, []) ? [] : entries[0]?.values[groupField.id];
          if (
            groupField.type === "multiSelect" ||
            groupField.type === "singleSelect" ||
            groupField.type === "checkbox"
          ) {
            const addGroupRow = doc.createElement("div");
            addGroupRow.className = "semlo-editor-database-add-row semlo-editor-database-group-add-row";
            const addGroup = button(`在${name}分组添加记录`, "＋", () => {
              let recordId = "";
              const applied = change((next, view) => {
                const field = next.fields.find((entry) => entry.id === groupField.id && entry.type === groupField.type);
                if (!field || view.id !== active.id || view.groupFieldId !== field.id) return;
                const record = createDatabaseRecord(next.fields, readDatabaseActor(getOptions()));
                if (field.type === "checkbox" && key === databaseGroupKey(field, true)) record.values[field.id] = true;
                if ((Array.isArray(groupValue) && groupValue.length) || (typeof groupValue === "string" && groupValue))
                  record.values[field.id] = structuredClone(groupValue);
                recordId = record.id;
                if (
                  (field.type === "multiSelect" || field.type === "singleSelect") &&
                  key === databaseGroupKey(field, []) &&
                  databaseGroupKey(field, record.values[field.id]) !== key
                )
                  pendingGroups.set(recordId, {
                    viewId: view.id,
                    fieldId: field.id,
                    value: field.type === "singleSelect" ? "" : [],
                  });
                if (field.type === "checkbox" && key !== databaseGroupKey(field, record.values[field.id]))
                  pendingGroups.set(recordId, {
                    viewId: view.id,
                    fieldId: field.id,
                    value: key === databaseGroupKey(field, true),
                  });
                next.records.push(record);
              });
              if (!applied || !recordId || isDestroyed()) {
                pendingGroups.delete(recordId);
                return;
              }
              const cells = Array.from(
                dom.querySelectorAll<HTMLElement>(".semlo-editor-database-cell[data-record-id]"),
              ).filter((cell) => cell.dataset.recordId === recordId);
              for (const cell of cells) {
                const input = cell.querySelector<HTMLInputElement>("input:not(:disabled):not([readonly])");
                if (input) {
                  input.focus();
                  break;
                }
                const control = cell.querySelector<HTMLButtonElement>("button:not(:disabled)");
                if (control) {
                  control.click();
                  break;
                }
              }
            });
            addGroupRow.append(addGroup);
            grid.append(addGroupRow);
          }
        }
      }
    }
    if (!groupField) {
      const addRow = doc.createElement("div");
      addRow.className = "semlo-editor-database-add-row";
      addRow.append(
        button("在末尾添加记录", "＋", () =>
          change((next) => {
            next.records.push(createDatabaseRecord(next.fields, readDatabaseActor(getOptions())));
          }),
        ),
      );
      grid.append(addRow);
    }
    const foot = doc.createElement("div");
    foot.className = "semlo-editor-database-row semlo-editor-database-footer";
    const count = doc.createElement("div");
    count.className = "semlo-editor-database-row-head";
    count.textContent = `${records.length} 条记录`;
    foot.append(count);
    for (const field of fields) {
      const cell = doc.createElement("div");
      cell.className = "semlo-editor-database-statistic";
      const control = button(
        `${field.name}统计`,
        statisticText(field, records, active.statistics[field.id] ?? "none"),
        () => statisticPanel(control, field),
      );
      cell.append(control);
      foot.append(cell);
    }
    foot.append(doc.createElement("div"));
    grid.append(foot);
    container.append(grid);
  };
}
