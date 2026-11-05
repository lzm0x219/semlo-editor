import type { Editor } from "@tiptap/core";

import type { createDatabaseEditSession } from "../edit-session";
import {
  createDatabaseId,
  databaseFiles,
  databaseLimits,
  databaseValueText,
  type DatabaseData,
  type DatabaseField,
  type DatabaseFile,
  type DatabaseRecord,
  type DatabaseValue,
  type DatabaseView,
} from "../model";

interface DatabaseCellInteractionsContext {
  doc: Document;
  dom: HTMLElement;
  editor: Editor;
  optionColors: readonly string[];
  cellSessions: ReturnType<typeof createDatabaseEditSession>;
  getData(): DatabaseData;
  change(mutate: (data: DatabaseData, view: DatabaseView) => void, repaint?: boolean, origin?: HTMLElement): boolean;
  panel(anchor: HTMLElement, title: string): HTMLElement;
  panelHeading(element: HTMLElement, text: string): void;
  closePopup(): void;
  button(
    label: string,
    text: string,
    action: () => void,
    className?: string,
    allowReadonly?: boolean,
  ): HTMLButtonElement;
  personSearch(container: HTMLElement, onPick: (item: { id: string; label: string }) => void): void;
  filePicker(
    container: HTMLElement,
    type: "image" | "attachment",
    onUploaded: (files: DatabaseFile[]) => void,
    remaining: () => number,
  ): void;
}

/** 单元格控件及选项、人员、文件的交互。 */
export function createDatabaseCellInteractions({
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
}: DatabaseCellInteractionsContext) {
  const applyCell = (recordId: string, fieldId: string, value: DatabaseValue, repaint = true, origin?: HTMLElement) =>
    change(
      (data) => {
        const record = data.records.find((item) => item.id === recordId);
        if (record && data.fields.some((field) => field.id === fieldId)) record.values[fieldId] = value;
      },
      repaint,
      origin,
    );

  const selectOptions = (anchor: HTMLElement, field: DatabaseField, record: DatabaseRecord) => {
    const dialog = panel(anchor, `${field.name} 选项`);
    dialog.classList.add("semlo-editor-database-options");
    const rawSelectedValue = record.values[field.id];
    const selectedValue = Array.isArray(rawSelectedValue)
      ? rawSelectedValue.filter((item): item is string => typeof item === "string")
      : rawSelectedValue;
    for (const entry of field.options) {
      const selected =
        field.type === "multiSelect"
          ? Array.isArray(selectedValue) && selectedValue.includes(entry.id)
          : selectedValue === entry.id;
      const control = button(entry.label, entry.label, () => {
        const next =
          field.type === "multiSelect"
            ? selected
              ? Array.isArray(selectedValue)
                ? selectedValue.filter((id) => id !== entry.id)
                : []
              : [...(Array.isArray(selectedValue) ? selectedValue : []), entry.id]
            : selected
              ? ""
              : entry.id;
        applyCell(record.id, field.id, next);
        closePopup();
      });
      control.style.backgroundColor = optionColors[entry.color] ?? optionColors[0];
      control.setAttribute("aria-pressed", String(selected));
      dialog.append(control);
    }
    const add = doc.createElement("input");
    add.type = "text";
    add.placeholder = "添加选项";
    add.setAttribute("aria-label", "添加选项");
    add.addEventListener("keydown", (event) => {
      if (
        event.isComposing ||
        event.keyCode === 229 ||
        !dom.contains(add) ||
        event.key !== "Enter" ||
        !add.value.trim()
      )
        return;
      event.preventDefault();
      const label = add.value.trim();
      const entry = { id: createDatabaseId("option"), label, color: field.options.length % optionColors.length };
      const changed = change((next) => {
        const target = next.fields.find((item) => item.id === field.id);
        const row = next.records.find((item) => item.id === record.id);
        if (!target || !row) return;
        target.options.push(entry);
        row.values[field.id] =
          field.type === "multiSelect" ? [...(Array.isArray(selectedValue) ? selectedValue : []), entry.id] : entry.id;
      });
      if (changed) closePopup();
    });
    dialog.append(add);
  };

  const selectPeople = (anchor: HTMLElement, field: DatabaseField, record: DatabaseRecord) => {
    const dialog = panel(anchor, `${field.name} 人员`);
    panelHeading(dialog, "选择人员");
    const selected = Array.isArray(record.values[field.id]) ? (record.values[field.id] as string[]) : [];
    for (const id of selected) {
      const person = field.options.find((item) => item.id === id);
      if (!person) continue;
      dialog.append(
        button(`移除 ${person.label}`, `${person.label} ×`, () => {
          applyCell(
            record.id,
            field.id,
            selected.filter((entry) => entry !== id),
          );
          closePopup();
        }),
      );
    }
    const picker = doc.createElement("div");
    picker.className = "semlo-editor-database-person-picker";
    dialog.append(picker);
    personSearch(picker, (person) => {
      change((data) => {
        const target = data.fields.find((entry) => entry.id === field.id && entry.type === "person");
        const row = data.records.find((entry) => entry.id === record.id);
        if (!target || !row) return;
        let entry = target.options.find((item) => item.externalId === person.id);
        if (!entry) {
          entry = { id: createDatabaseId("person"), externalId: person.id, label: person.label, color: 0 };
          target.options.push(entry);
        } else entry.label = person.label;
        const current = Array.isArray(row.values[field.id]) ? (row.values[field.id] as string[]) : [];
        if (!current.includes(entry.id)) row.values[field.id] = [...current, entry.id];
      });
      closePopup();
    });
  };
  const editFiles = (anchor: HTMLElement, field: DatabaseField, record: DatabaseRecord) => {
    if (field.type !== "image" && field.type !== "attachment") return;
    const dialog = panel(anchor, `${field.name} 文件`);
    panelHeading(dialog, field.name);
    const files = databaseFiles(record.values[field.id]);
    for (const file of files) {
      const row = doc.createElement("div");
      row.className = "semlo-editor-database-file-item";
      const link = doc.createElement("a");
      link.href = file.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = file.name;
      row.append(link);
      if (editor.isEditable)
        row.append(
          button(`删除文件 ${file.name}`, "×", () => {
            applyCell(
              record.id,
              field.id,
              files.filter((entry) => entry.id !== file.id),
            );
            closePopup();
          }),
        );
      dialog.append(row);
    }
    if (editor.isEditable) {
      const picker = doc.createElement("div");
      picker.className = "semlo-editor-database-file-picker";
      dialog.append(picker);
      filePicker(
        picker,
        field.type,
        (uploaded) => {
          const changed = change((data) => {
            const target = data.fields.find((entry) => entry.id === field.id && entry.type === field.type);
            const row = data.records.find((entry) => entry.id === record.id);
            if (target && row) row.values[field.id] = [...databaseFiles(row.values[field.id]), ...uploaded];
          });
          if (changed) closePopup();
        },
        () => {
          const data = getData();
          const row = data.records.find((entry) => entry.id === record.id);
          return row ? databaseLimits.files - databaseFiles(row.values[field.id]).length : 0;
        },
      );
    }
  };

  const makeCell = (field: DatabaseField, record: DatabaseRecord, index: number): HTMLElement => {
    const cell = doc.createElement("div");
    cell.className = "semlo-editor-database-cell";
    cell.setAttribute("role", "cell");
    cell.dataset.recordId = record.id;
    cell.dataset.fieldId = field.id;
    const value = record.values[field.id];
    const accessible = `第 ${index + 1} 行 ${field.name}`;
    if (field.type === "image" || field.type === "attachment") {
      const files = databaseFiles(value);
      const control = button(
        accessible,
        "",
        () => editFiles(control, field, record),
        "semlo-editor-database-files",
        true,
      );
      if (!files.length) control.textContent = editor.isEditable ? "+" : "";
      for (const file of files) {
        if (field.type === "image") {
          const image = doc.createElement("img");
          image.src = file.url;
          image.alt = file.name;
          control.append(image);
        } else {
          const name = doc.createElement("span");
          name.textContent = file.name;
          control.append(name);
        }
      }
      cell.append(control);
    } else if (
      field.type === "createdTime" ||
      field.type === "modifiedTime" ||
      field.type === "createdBy" ||
      field.type === "modifiedBy"
    ) {
      const text = doc.createElement("span");
      text.setAttribute("aria-label", accessible);
      text.textContent = databaseValueText(field, value);
      cell.append(text);
    } else if (field.type === "singleSelect" || field.type === "multiSelect" || field.type === "person") {
      const control = button(
        accessible,
        "",
        () => (field.type === "person" ? selectPeople(control, field, record) : selectOptions(control, field, record)),
        "semlo-editor-database-choice",
      );
      const ids =
        field.type === "multiSelect" || field.type === "person"
          ? Array.isArray(value)
            ? value
            : []
          : typeof value === "string" && value
            ? [value]
            : [];
      for (const id of ids) {
        const entry = field.options.find((item) => item.id === id);
        if (!entry) continue;
        const chip = doc.createElement("span");
        chip.className = "semlo-editor-database-chip";
        chip.style.backgroundColor = optionColors[entry.color] ?? optionColors[0];
        chip.textContent = entry.label;
        control.append(chip);
      }
      cell.append(control);
    } else if (field.type === "checkbox") {
      const input = doc.createElement("input");
      input.type = "checkbox";
      input.checked = value === true;
      input.disabled = !editor.isEditable;
      input.setAttribute("aria-label", accessible);
      input.addEventListener("change", () => {
        try {
          applyCell(record.id, field.id, input.checked, true, input);
        } catch (error) {
          if (dom.contains(input))
            input.checked = getData().records.find((item) => item.id === record.id)?.values[field.id] === true;
          throw error;
        }
      });
      cell.append(input);
    } else {
      const input = doc.createElement("input");
      const raw = typeof value === "string" ? value : "";
      const validDate =
        !raw ||
        (/^\d{4}-\d{2}-\d{2}$/.test(raw) &&
          raw.slice(0, 4) !== "0000" &&
          !Number.isNaN(new Date(`${raw}T00:00:00Z`).getTime()) &&
          new Date(`${raw}T00:00:00Z`).toISOString().slice(0, 10) === raw);
      input.type =
        field.type === "date" && validDate
          ? "date"
          : field.type === "email"
            ? "email"
            : field.type === "phone"
              ? "tel"
              : "text";
      if (field.type === "number" || field.type === "rating" || field.type === "progress") input.inputMode = "decimal";
      input.value = raw;
      const dateDisplay = input.type === "date" ? doc.createElement("span") : null;
      if (dateDisplay) {
        cell.classList.add("semlo-editor-database-date-cell");
        dateDisplay.className = "semlo-editor-database-date-display";
        dateDisplay.setAttribute("aria-hidden", "true");
        dateDisplay.textContent = input.value;
      }
      input.readOnly = !editor.isEditable;
      input.setAttribute("aria-label", accessible);
      cellSessions.bindInput(input, {
        recordId: record.id,
        fieldId: field.id,
        trim: field.type === "text",
        onValueChange: dateDisplay ? (value) => (dateDisplay.textContent = value) : undefined,
      });
      cell.append(input);
      if (dateDisplay) cell.append(dateDisplay);
    }
    return cell;
  };

  return { makeCell };
}
