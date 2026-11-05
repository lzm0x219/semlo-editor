import type { Editor } from "@tiptap/core";

import { getCardVisibleFields } from "../card-fields";
import {
  createDatabaseRecord,
  databaseFiles,
  databaseValueText,
  type DatabaseData,
  type DatabaseField,
  type DatabaseRecord,
  type DatabaseView,
} from "../model";
import { readDatabaseActor, type DatabaseOptions } from "../options";
import type { createBoardDrag } from "./board/drag";

interface CardViewsContext {
  doc: Document;
  dom: HTMLElement;
  editor: Editor;
  boardDrag: ReturnType<typeof createBoardDrag>;
  optionColors: string[];
  getOptions(): DatabaseOptions;
  recordPanel(anchor: HTMLElement, record: DatabaseRecord, index: number): void;
  button(
    label: string,
    text: string,
    action: () => void,
    className?: string,
    allowReadonly?: boolean,
  ): HTMLButtonElement;
  change(mutate: (data: DatabaseData, view: DatabaseView) => void, repaint?: boolean, origin?: HTMLElement): boolean;
}

export function createCardViews({
  doc,
  dom,
  editor,
  boardDrag,
  optionColors,
  getOptions,
  recordPanel,
  button,
  change,
}: CardViewsContext) {
  const paintCard = (record: DatabaseRecord, data: DatabaseData, active: DatabaseView, records: DatabaseRecord[]) => {
    const card = doc.createElement("button");
    card.type = "button";
    card.className = "semlo-editor-database-card";
    card.dataset.recordId = record.id;
    const index = records.indexOf(record);
    const [titleField, ...otherFields] = getCardVisibleFields(data, active);
    const caption = (field: DatabaseField) => {
      const name = doc.createElement("span");
      name.className = "semlo-editor-database-card-field-name";
      name.textContent = field.name;
      return name;
    };
    const titleContainer = doc.createElement("span");
    titleContainer.className = "semlo-editor-database-card-title";
    if (titleField) titleContainer.dataset.fieldId = titleField.id;
    if (titleField && active.showFieldNames) titleContainer.append(caption(titleField));
    const title = doc.createElement("strong");
    const titleText = titleField ? databaseValueText(titleField, record.values[titleField.id]) : "";
    title.textContent = titleText || "未命名记录";
    title.classList.toggle("is-empty", !titleText);
    titleContainer.append(title);
    card.append(titleContainer);
    for (const field of otherFields) {
      const values = record.values[field.id];
      const text = databaseValueText(field, values);
      const hasValue = field.type === "checkbox" ? values === true : !!text;
      if (!hasValue && !active.showFieldNames) continue;
      const wrapper = doc.createElement("span");
      wrapper.className = "semlo-editor-database-card-field";
      wrapper.dataset.fieldId = field.id;
      if (active.showFieldNames) wrapper.append(caption(field));
      if (field.type === "image") {
        for (const file of databaseFiles(values)) {
          const image = doc.createElement("img");
          image.className = "semlo-editor-database-card-image";
          image.src = file.url;
          image.alt = file.name;
          wrapper.append(image);
        }
      } else if (field.type === "singleSelect" || field.type === "multiSelect" || field.type === "person") {
        const ids = Array.isArray(values) ? values : typeof values === "string" && values ? [values] : [];
        for (const id of ids) {
          const entry = field.options.find((item) => item.id === id);
          if (!entry) continue;
          const chip = doc.createElement("span");
          chip.className = "semlo-editor-database-chip";
          chip.style.backgroundColor = optionColors[entry.color] ?? optionColors[0];
          chip.textContent = entry.label;
          wrapper.append(chip);
        }
      } else if (field.type === "checkbox" && values === true) {
        const checked = doc.createElement("span");
        checked.className = "semlo-editor-database-card-checkbox";
        checked.setAttribute("role", "img");
        checked.setAttribute("aria-label", "已勾选");
        checked.textContent = "☑";
        wrapper.append(checked);
      } else if (text) {
        const value = doc.createElement("span");
        value.className = "semlo-editor-database-card-field-value";
        value.textContent = text;
        wrapper.append(value);
      }
      card.append(wrapper);
    }
    card.setAttribute("aria-label", `记录：${title.textContent}`);
    card.addEventListener("click", () => {
      if (dom.contains(card) && !boardDrag.shouldSuppressClick()) recordPanel(card, record, index);
    });
    return card;
  };

  return (container: HTMLElement, data: DatabaseData, active: DatabaseView, records: DatabaseRecord[]) => {
    if (active.kind === "gallery") {
      const cards = doc.createElement("div");
      cards.className = "semlo-editor-database-gallery";
      for (const record of records) cards.append(paintCard(record, data, active, records));
      container.append(cards);
      return;
    }
    const field =
      data.fields.find((item) => item.id === active.groupFieldId && item.type === "singleSelect") ??
      data.fields.find((item) => item.type === "singleSelect");
    if (!field) {
      const empty = doc.createElement("div");
      empty.className = "semlo-editor-database-empty";
      empty.textContent = "添加单选列后可按选项展示看板。";
      container.append(empty);
      return;
    }
    const board = doc.createElement("div");
    board.className = "semlo-editor-database-board";
    const groups = [{ id: "", label: "未分组", color: -1 }, ...field.options];
    for (const group of groups) {
      const entries = records.filter((record) => (record.values[field.id] || "") === group.id);
      const column = doc.createElement("div");
      column.className = "semlo-editor-database-board-column";
      column.setAttribute("role", "group");
      column.setAttribute("aria-label", `看板分组：${group.label}`);
      boardDrag.bindColumn(column, group.id, field.id);
      const title = doc.createElement("div");
      title.className = "semlo-editor-database-board-title";
      const tag = doc.createElement("span");
      tag.textContent = group.label;
      if (group.color >= 0) tag.style.background = optionColors[group.color] ?? optionColors[0];
      const count = doc.createElement("span");
      count.textContent = String(entries.length);
      title.append(tag, count);
      column.append(title);
      for (const record of entries) {
        const card = paintCard(record, data, active, records);
        boardDrag.bindCard(card, field.id, group.id, record.id);
        column.append(card);
      }
      if (editor.isEditable)
        column.append(
          button(
            `在${group.label}添加记录`,
            "+ 添加记录",
            () => {
              change((next) => {
                const record = createDatabaseRecord(next.fields, readDatabaseActor(getOptions()));
                record.values[field.id] = group.id;
                next.records.push(record);
              });
            },
            "semlo-editor-database-board-add",
          ),
        );
      board.append(column);
    }
    container.append(board);
  };
}
