import type { Editor } from "@tiptap/core";

import {
  createDatabaseId,
  visibleDatabaseRecords,
  type DatabaseData,
  type DatabaseFilterOperator,
  type DatabaseView,
} from "../model";

interface DatabaseQueryPanelsContext {
  doc: Document;
  dom: HTMLElement;
  editor: Editor;
  getData(): DatabaseData;
  getView(data: DatabaseData): DatabaseView;
  getPopup(): HTMLElement | null;
  endContinuousEditing(): void;
  panel(anchor: HTMLElement, title: string): HTMLElement;
  panelHeading(element: HTMLElement, text: string): void;
  closePopup(): void;
  option(value: string, label: string): HTMLOptionElement;
  button(
    label: string,
    text: string,
    action: () => void,
    className?: string,
    allowReadonly?: boolean,
  ): HTMLButtonElement;
  change(mutate: (data: DatabaseData, view: DatabaseView) => void, repaint?: boolean, origin?: HTMLElement): boolean;
}

const textOperators: [DatabaseFilterOperator, string][] = [
  ["startsWith", "开头是"],
  ["notStartsWith", "开头不是"],
  ["endsWith", "结尾是"],
  ["notEndsWith", "结尾不是"],
  ["contains", "包含"],
  ["notContains", "不包含"],
  ["equals", "等于"],
  ["notEquals", "不等于"],
  ["empty", "为空"],
  ["notEmpty", "非空"],
];
const singleOptionOperators: [DatabaseFilterOperator, string][] = [
  ["contains", "是"],
  ["notContains", "不是"],
  ["empty", "为空"],
  ["notEmpty", "非空"],
];
const comparisonOperators: [DatabaseFilterOperator, string][] = [
  ["equals", "等于"],
  ["notEquals", "不等于"],
  ["greater", "大于"],
  ["less", "小于"],
  ["empty", "为空"],
  ["notEmpty", "非空"],
];
const optionOperators: [DatabaseFilterOperator, string][] = [
  ["contains", "包含"],
  ["notContains", "不包含"],
  ["empty", "为空"],
  ["notEmpty", "非空"],
];
const checkboxOperators: [DatabaseFilterOperator, string][] = [
  ["notEmpty", "已勾选"],
  ["empty", "未勾选"],
];

/** 筛选、分组和排序面板共享当前视图与事务入口。 */
export function createDatabaseQueryPanels({
  doc,
  dom,
  editor,
  getData,
  getView,
  getPopup,
  endContinuousEditing,
  panel,
  panelHeading,
  closePopup,
  option,
  button,
  change,
}: DatabaseQueryPanelsContext) {
  const fieldSelect = (data: DatabaseData, selectedId: string, emptyLabel?: string) => {
    const select = doc.createElement("select");
    if (emptyLabel) select.append(option("", emptyLabel));
    for (const field of data.fields) select.append(option(field.id, field.name));
    select.value = selectedId;
    return select;
  };
  const addFilter = (fieldId: string) =>
    change((data, active) => {
      const type = data.fields.find((field) => field.id === fieldId)?.type;
      const operator =
        type === "checkbox"
          ? "notEmpty"
          : type === "singleSelect" || type === "multiSelect"
            ? "contains"
            : type === "number" || type === "date" || type === "rating" || type === "progress"
              ? "equals"
              : "startsWith";
      active.filters.push({ id: createDatabaseId("filter"), fieldId, operator, value: "" });
    });

  const filterPanel = (anchor: HTMLElement) => {
    const dialog = panel(anchor, "筛选");
    const render = () => {
      const data = getData();
      const active = getView(data);
      dialog.replaceChildren();
      panelHeading(dialog, "筛选");
      if (active.filters.length > 1) {
        const mode = doc.createElement("select");
        mode.setAttribute("aria-label", "筛选关系");
        mode.append(option("and", "满足全部条件"), option("or", "满足任一条件"));
        mode.value = active.filterMode;
        mode.addEventListener("change", () => {
          try {
            change(
              (_data, view) => {
                view.filterMode = mode.value === "or" ? "or" : "and";
              },
              true,
              mode,
            );
          } catch (error) {
            if (dom.contains(mode)) mode.value = getView(getData()).filterMode;
            throw error;
          }
        });
        dialog.append(mode);
      }
      for (const filter of active.filters) {
        const row = doc.createElement("div");
        row.className = "semlo-editor-database-rule";
        const prefix = doc.createElement("span");
        prefix.textContent = "当";
        const field = fieldSelect(data, filter.fieldId);
        field.setAttribute("aria-label", "筛选列");
        const selectedField = data.fields.find((item) => item.id === filter.fieldId);
        const operators =
          selectedField?.type === "checkbox"
            ? checkboxOperators.some(([value]) => value === filter.operator)
              ? checkboxOperators
              : [...checkboxOperators, ...textOperators.filter(([value]) => value !== "empty" && value !== "notEmpty")]
            : selectedField?.type === "singleSelect"
              ? singleOptionOperators
              : selectedField?.type === "multiSelect"
                ? optionOperators
                : selectedField?.type === "number" ||
                    selectedField?.type === "date" ||
                    selectedField?.type === "rating" ||
                    selectedField?.type === "progress"
                  ? comparisonOperators
                  : textOperators;
        const operator = doc.createElement("select");
        operator.setAttribute("aria-label", "筛选条件");
        for (const [value, text] of operators) operator.append(option(value, text));
        operator.value = operators.some(([value]) => value === filter.operator) ? filter.operator : operators[0][0];
        field.addEventListener("change", () => {
          if (!dom.contains(field)) return;
          try {
            change((_data, view) => {
              const target = view.filters.find((item) => item.id === filter.id);
              const nextField = _data.fields.find((item) => item.id === field.value);
              if (!target || !nextField) return;
              target.fieldId = field.value;
              target.operator =
                nextField.type === "checkbox"
                  ? "notEmpty"
                  : nextField.type === "singleSelect" || nextField.type === "multiSelect"
                    ? "contains"
                    : nextField.type === "number" ||
                        nextField.type === "date" ||
                        nextField.type === "rating" ||
                        nextField.type === "progress"
                      ? "equals"
                      : "startsWith";
              target.value = "";
              delete target.optionId;
            });
          } finally {
            if (getPopup() === dialog) render();
          }
        });
        operator.addEventListener("change", () => {
          if (!dom.contains(operator)) return;
          try {
            change((_data, view) => {
              const target = view.filters.find((item) => item.id === filter.id);
              if (target) target.operator = operator.value as DatabaseFilterOperator;
            });
          } finally {
            if (getPopup() === dialog) render();
          }
        });
        const remove = button("删除筛选规则", "×", () => {
          change((_data, view) => {
            view.filters = view.filters.filter((item) => item.id !== filter.id);
          });
          render();
        });
        if (selectedField?.type === "singleSelect" || selectedField?.type === "multiSelect") {
          const select = doc.createElement("select");
          select.setAttribute("aria-label", "筛选值");
          select.hidden = filter.operator === "empty" || filter.operator === "notEmpty";
          const legacyLabel = filter.optionId ? "已删除的选项" : filter.value || "请选择选项";
          select.append(option("", legacyLabel));
          for (const item of selectedField.options) select.append(option(item.id, item.label));
          select.value = selectedField.options.some((item) => item.id === filter.optionId) ? filter.optionId! : "";
          select.addEventListener("change", () => {
            if (!dom.contains(select)) return;
            try {
              change(
                (_data, view) => {
                  const target = view.filters.find((item) => item.id === filter.id);
                  const option = _data.fields
                    .find((item) => item.id === filter.fieldId)
                    ?.options.find((item) => item.id === select.value);
                  if (!target) return;
                  if (option) {
                    target.optionId = option.id;
                    target.value = option.label;
                  } else {
                    delete target.optionId;
                    target.value = "";
                  }
                },
                true,
                select,
              );
            } catch (error) {
              if (dom.contains(select)) {
                const data = getData();
                const target = getView(data).filters.find((item) => item.id === filter.id);
                const options = data.fields.find((item) => item.id === target?.fieldId)?.options ?? [];
                select.value = options.some((item) => item.id === target?.optionId) ? target!.optionId! : "";
              }
              throw error;
            }
          });
          row.append(prefix, field, operator, select, remove);
          dialog.append(row);
          continue;
        }
        const input = doc.createElement("input");
        input.placeholder = "请输入";
        input.value = filter.value;
        input.setAttribute("aria-label", "筛选值");
        input.dataset.semloEditorHistory = "filter";
        input.dataset.filterId = filter.id;
        input.hidden = filter.operator === "empty" || filter.operator === "notEmpty";
        input.addEventListener("focus", () => {
          endContinuousEditing();
        });
        input.addEventListener("input", () => {
          try {
            change(
              (_data, view) => {
                const target = view.filters.find((item) => item.id === filter.id);
                if (target) target.value = input.value;
              },
              true,
              input,
            );
          } catch (error) {
            if (dom.contains(input)) {
              const data = getData();
              input.value = getView(data).filters.find((item) => item.id === filter.id)?.value ?? "";
            }
            throw error;
          }
        });
        row.append(prefix, field, operator, input, remove);
        dialog.append(row);
      }
      dialog.append(
        button(
          "添加筛选规则",
          "+ 添加筛选规则",
          () => {
            const field = getData().fields[0];
            if (field) addFilter(field.id);
            render();
          },
          "semlo-editor-database-add-rule",
        ),
      );
    };
    const data = getData();
    if (!getView(data).filters.length && data.fields[0]) addFilter(data.fields[0].id);
    render();
  };

  const groupPanel = (anchor: HTMLElement) => {
    const dialog = panel(anchor, "分组");
    const data = getData();
    const active = getView(data);
    panelHeading(dialog, "分组");
    const field = fieldSelect(data, active.groupFieldId, "不分组");
    field.setAttribute("aria-label", "分组列");
    const direction = doc.createElement("select");
    direction.setAttribute("aria-label", "分组顺序");
    direction.append(option("asc", "升序"), option("desc", "降序"));
    direction.value = active.groupDirection;
    const updateDirectionLabels = () => {
      const selected = data.fields.find((item) => item.id === field.value);
      const optionBased = selected?.type === "singleSelect" || selected?.type === "multiSelect";
      direction.options[0].textContent = optionBased ? "选项顺序" : "升序";
      direction.options[1].textContent = optionBased ? "选项倒序" : "降序";
    };
    updateDirectionLabels();
    field.addEventListener("change", () => {
      change(
        (_data, view) => {
          view.groupFieldId = field.value;
        },
        true,
        field,
      );
      updateDirectionLabels();
    });
    direction.addEventListener("change", () =>
      change(
        (_data, view) => {
          view.groupDirection = direction.value === "desc" ? "desc" : "asc";
        },
        true,
        direction,
      ),
    );
    dialog.append(
      field,
      direction,
      button("移除分组", "移除分组", () => {
        change((_data, view) => {
          view.groupFieldId = "";
        });
        closePopup();
      }),
    );
  };

  const sortPanel = (anchor: HTMLElement) => {
    const dialog = panel(anchor, "排序");
    const initialView = getView(getData());
    if (initialView.kind === "table") {
      let draft = structuredClone(initialView.sorts);
      let keepSorting = draft.length > 0;
      const apply = () =>
        change(
          (data, view) => {
            if (view.id !== initialView.id) return;
            if (keepSorting) view.sorts = structuredClone(draft);
            else {
              view.recordOrder = visibleDatabaseRecords(data, { ...view, filters: [], sorts: draft }).map(
                (record) => record.id,
              );
              view.sorts = [];
            }
          },
          true,
          dialog,
        );
      const updateDraft = (mutate: () => void): void => {
        const previous = structuredClone(draft);
        mutate();
        try {
          if (keepSorting) apply();
        } catch (error) {
          draft = previous;
          if (getPopup() === dialog) renderTableSort();
          throw error;
        }
      };
      const renderTableSort = () => {
        const data = getData();
        dialog.replaceChildren();
        panelHeading(dialog, "排序");
        if (draft.length) {
          const label = doc.createElement("label");
          label.className = "semlo-editor-database-rule";
          const keep = doc.createElement("input");
          keep.type = "checkbox";
          keep.checked = keepSorting;
          keep.disabled = !editor.isEditable;
          keep.setAttribute("aria-label", "保持排序");
          keep.addEventListener("change", () => {
            const previous = keepSorting;
            keepSorting = keep.checked;
            try {
              apply();
            } catch (error) {
              keepSorting = previous;
              if (getPopup() === dialog) renderTableSort();
              throw error;
            }
            if (getPopup() === dialog) renderTableSort();
          });
          label.append(keep, doc.createTextNode("保持排序"));
          dialog.append(label);
        }
        draft.forEach((sort, index) => {
          const row = doc.createElement("div");
          row.className = "semlo-editor-database-rule";
          const field = fieldSelect(data, sort.fieldId);
          field.setAttribute("aria-label", "排序列");
          field.addEventListener("change", () => {
            updateDraft(() => (draft[index].fieldId = field.value));
          });
          const direction = doc.createElement("select");
          direction.setAttribute("aria-label", "排序顺序");
          direction.append(option("asc", "升序"), option("desc", "降序"));
          direction.value = sort.direction;
          direction.addEventListener("change", () => {
            updateDraft(() => (draft[index].direction = direction.value === "desc" ? "desc" : "asc"));
          });
          const remove = button("删除排序", "×", () => {
            updateDraft(() => draft.splice(index, 1));
            if (!draft.length) keepSorting = false;
            renderTableSort();
          });
          row.append(field, direction, remove);
          dialog.append(row);
        });
        dialog.append(
          button(
            "添加排序",
            "+ 添加排序",
            () => {
              const field = data.fields.find((entry) => !draft.some((sort) => sort.fieldId === entry.id));
              if (field) updateDraft(() => draft.push({ fieldId: field.id, direction: "asc" }));
              renderTableSort();
            },
            "semlo-editor-database-add-rule",
          ),
        );
        if (draft.length && !keepSorting) {
          dialog.append(
            button("取消排序", "取消", () => {
              if (getPopup() === dialog) closePopup();
            }),
            button("确定排序", "确定", () => {
              apply();
              if (getPopup() === dialog) closePopup();
            }),
          );
        }
      };
      renderTableSort();
      return;
    }
    const render = () => {
      const data = getData();
      const active = getView(data);
      dialog.replaceChildren();
      panelHeading(dialog, "排序");
      for (const sort of active.sorts) {
        const row = doc.createElement("div");
        row.className = "semlo-editor-database-rule";
        const field = fieldSelect(data, sort.fieldId);
        field.setAttribute("aria-label", "排序列");
        field.addEventListener("change", () => {
          try {
            change(
              (_data, view) => {
                const target = view.sorts.find((item) => item.fieldId === sort.fieldId);
                if (target) target.fieldId = field.value;
              },
              true,
              field,
            );
          } finally {
            if (getPopup() === dialog) render();
          }
        });
        const direction = doc.createElement("select");
        direction.setAttribute("aria-label", "排序顺序");
        direction.append(option("asc", "升序"), option("desc", "降序"));
        direction.value = sort.direction;
        direction.addEventListener("change", () => {
          try {
            change(
              (_data, view) => {
                const target = view.sorts.find((item) => item.fieldId === field.value);
                if (target) target.direction = direction.value === "desc" ? "desc" : "asc";
              },
              true,
              direction,
            );
          } catch (error) {
            if (getPopup() === dialog) render();
            throw error;
          }
        });
        const remove = button("删除排序", "×", () => {
          change((_data, view) => {
            view.sorts = view.sorts.filter((item) => item.fieldId !== field.value);
          });
          render();
        });
        row.append(field, direction, remove);
        dialog.append(row);
      }
      dialog.append(
        button(
          "添加排序",
          "+ 添加排序",
          () => {
            change((data, view) => {
              const field = data.fields.find((entry) => !view.sorts.some((sort) => sort.fieldId === entry.id));
              if (field) view.sorts.push({ fieldId: field.id, direction: "asc" });
            });
            render();
          },
          "semlo-editor-database-add-rule",
        ),
      );
    };
    render();
  };

  return { addFilter, filterPanel, groupPanel, sortPanel };
}
