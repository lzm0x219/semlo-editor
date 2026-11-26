import type { Editor } from "@tiptap/core";

import {
  createDatabaseId,
  databaseFilterSets,
  databaseLimits,
  visibleDatabaseRecords,
  type DatabaseData,
  type DatabaseFilterOperator,
  type DatabaseFilterSet,
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
  const createFilter = (data: DatabaseData, fieldId: string) => {
    const type = data.fields.find((field) => field.id === fieldId)?.type;
    const operator: DatabaseFilterOperator =
      type === "checkbox"
        ? "notEmpty"
        : type === "singleSelect" || type === "multiSelect"
          ? "contains"
          : type === "number" || type === "date" || type === "rating" || type === "progress"
            ? "equals"
            : "startsWith";
    return { id: createDatabaseId("filter"), fieldId, operator, value: "" };
  };
  const addFilter = (fieldId: string) =>
    change((data, active) => {
      active.filters.push(createFilter(data, fieldId));
    });

  const filterPanel = (anchor: HTMLElement) => {
    const dialog = panel(anchor, "筛选");
    function renderSet(
      active: DatabaseFilterSet,
      container: HTMLElement,
      data: DatabaseData,
      remaining: number,
      groupId?: string,
    ) {
      const findSet = (current: DatabaseView) =>
        groupId === undefined
          ? current
          : databaseFilterSets(current)
              .slice(1)
              .find((group) => group.id === groupId);
      const mutateSet = (
        mutate: (next: DatabaseData, set: DatabaseFilterSet) => void,
        repaint?: boolean,
        origin?: HTMLElement,
      ) =>
        change(
          (next, current) => {
            const set = findSet(current);
            if (set) mutate(next, set);
          },
          repaint,
          origin,
        );
      const applyControl = (
        control: HTMLInputElement | HTMLSelectElement,
        mutate: (next: DatabaseData, set: DatabaseFilterSet) => void,
        savedValue: (set: DatabaseFilterSet | undefined, data: DatabaseData) => string,
      ) => {
        if (!dom.contains(control)) return;
        let committed = false;
        try {
          committed = mutateSet(mutate, true, control);
        } finally {
          if (!committed && dom.contains(control)) {
            const saved = getData();
            control.value = savedValue(findSet(getView(saved)), saved);
          }
        }
      };
      if (active.filters.length + (active.filterGroups?.length ?? 0) > 1) {
        const mode = doc.createElement("select");
        mode.setAttribute("aria-label", groupId === undefined ? "筛选关系" : "分组内筛选关系");
        mode.append(option("and", "满足全部条件"), option("or", "满足任一条件"));
        mode.value = active.filterMode;
        mode.addEventListener("change", () =>
          applyControl(
            mode,
            (_data, view) => {
              view.filterMode = mode.value === "or" ? "or" : "and";
            },
            (set) => set?.filterMode ?? active.filterMode,
          ),
        );
        container.append(mode);
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
            mutateSet((_data, view) => {
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
            mutateSet((_data, view) => {
              const target = view.filters.find((item) => item.id === filter.id);
              if (target) target.operator = operator.value as DatabaseFilterOperator;
            });
          } finally {
            if (getPopup() === dialog) render();
          }
        });
        const remove = button("删除筛选规则", "×", () => {
          mutateSet((_data, view) => {
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
          select.addEventListener("change", () =>
            applyControl(
              select,
              (next, view) => {
                const target = view.filters.find((item) => item.id === filter.id);
                if (!target) return;
                const selected = next.fields
                  .find((item) => item.id === target.fieldId)
                  ?.options.find((item) => item.id === select.value);
                if (selected) {
                  target.optionId = selected.id;
                  target.value = selected.label;
                } else {
                  delete target.optionId;
                  target.value = "";
                }
              },
              (set, saved) => {
                const target = set?.filters.find((item) => item.id === filter.id);
                const options = saved.fields.find((item) => item.id === target?.fieldId)?.options;
                return options?.find((item) => item.id === target?.optionId)?.id ?? "";
              },
            ),
          );
          row.append(prefix, field, operator, select, remove);
          container.append(row);
          continue;
        }
        const input = doc.createElement("input");
        input.placeholder = "请输入";
        input.value = filter.value;
        input.setAttribute("aria-label", "筛选值");
        input.dataset.semloEditorHistory = "filter";
        input.dataset.filterId = filter.id;
        if (groupId !== undefined) input.dataset.filterGroupId = groupId;
        input.hidden = filter.operator === "empty" || filter.operator === "notEmpty";
        input.addEventListener("focus", () => {
          endContinuousEditing();
        });
        input.addEventListener("input", () =>
          applyControl(
            input,
            (_data, view) => {
              const target = view.filters.find((item) => item.id === filter.id);
              if (target) target.value = input.value;
            },
            (set) => set?.filters.find((item) => item.id === filter.id)?.value ?? "",
          ),
        );
        row.append(prefix, field, operator, input, remove);
        container.append(row);
      }
      for (const group of active.filterGroups ?? []) {
        const section = doc.createElement("div");
        section.className = "semlo-editor-database-filter-group";
        section.setAttribute("role", "group");
        section.setAttribute("aria-label", "筛选分组");
        const remove = button(
          "删除筛选分组",
          "×",
          () => {
            mutateSet((_next, set) => {
              const groups = set.filterGroups?.filter((entry) => entry.id !== group.id);
              if (groups?.length) set.filterGroups = groups;
              else delete set.filterGroups;
            });
            render();
          },
          "semlo-editor-database-filter-remove-group",
        );
        section.append(remove);
        renderSet(group, section, data, remaining, group.id);
        container.append(section);
      }
      const actions = doc.createElement("div");
      actions.className = "semlo-editor-database-filter-actions";
      const addRule = button(
        "添加筛选规则",
        "+ 添加筛选规则",
        () => {
          mutateSet((next, set) => {
            if (next.fields[0]) set.filters.push(createFilter(next, next.fields[0].id));
          });
          render();
        },
        "semlo-editor-database-add-rule",
      );
      const addGroup = button(
        "添加筛选分组",
        "+ 添加筛选分组",
        () => {
          mutateSet((next, set) => {
            if (!next.fields[0]) return;
            (set.filterGroups ??= []).push({
              id: createDatabaseId("filter-group"),
              filterMode: "or",
              filters: [createFilter(next, next.fields[0].id)],
            });
          });
          render();
        },
        "semlo-editor-database-add-rule",
      );
      addRule.disabled = addRule.disabled || remaining < 1 || !data.fields.length;
      addGroup.disabled = addGroup.disabled || remaining < 2 || !data.fields.length;
      actions.append(addRule, addGroup);
      container.append(actions);
    }

    const render = () => {
      const data = getData();
      const view = getView(data);
      const sets = databaseFilterSets(view);
      const remaining =
        databaseLimits.filters + 1 - sets.length - sets.reduce((count, set) => count + set.filters.length, 0);
      dialog.replaceChildren();
      panelHeading(dialog, "筛选");

      renderSet(view, dialog, data, remaining);
    };
    const data = getData();
    const view = getView(data);
    if (!view.filters.length && !view.filterGroups?.length && data.fields[0]) addFilter(data.fields[0].id);
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
    const syncControls = (currentData: DatabaseData) => {
      const view = getView(currentData);
      field.value = view.groupFieldId;
      direction.value = view.groupDirection;
      const selected = currentData.fields.find((item) => item.id === view.groupFieldId);
      const optionBased = selected?.type === "singleSelect" || selected?.type === "multiSelect";
      direction.options[0].textContent = optionBased ? "选项顺序" : "升序";
      direction.options[1].textContent = optionBased ? "选项倒序" : "降序";
    };
    const updateGroup = (update: (view: DatabaseView) => void, control: HTMLSelectElement) => {
      try {
        change((_data, view) => update(view), true, control);
      } finally {
        if (getPopup() === dialog) syncControls(getData());
      }
    };
    syncControls(data);
    field.addEventListener("change", () =>
      updateGroup((view) => {
        view.groupFieldId = field.value;
      }, field),
    );
    direction.addEventListener("change", () =>
      updateGroup((view) => {
        view.groupDirection = direction.value === "desc" ? "desc" : "asc";
      }, direction),
    );
    dialog.append(
      field,
      direction,
      button("移除分组", "移除分组", () => {
        if (getPopup() !== dialog) return;
        const removed =
          !getView(getData()).groupFieldId ||
          change(
            (_data, view) => {
              view.groupFieldId = "";
            },
            true,
            dialog,
          );
        if (removed && getPopup() === dialog) closePopup();
      }),
    );
  };

  const sortPanel = (anchor: HTMLElement) => {
    const dialog = panel(anchor, "排序");
    const initialView = getView(getData());
    if (initialView.kind === "table") {
      let draft = structuredClone(initialView.sorts);
      let keepSorting = draft.length > 0;
      const apply = () => {
        // 一次性排序的结果可能已经保存，此时仍可关闭面板。
        let unchanged = false;
        const committed = change(
          (data, view) => {
            if (view.id !== initialView.id) return;
            if (keepSorting) view.sorts = structuredClone(draft);
            else {
              const order = visibleDatabaseRecords(data, {
                ...view,
                filters: [],
                filterGroups: [],
                sorts: draft,
              }).map((record) => record.id);
              unchanged =
                !view.sorts.length &&
                order.length === view.recordOrder.length &&
                order.every((id, index) => id === view.recordOrder[index]);
              view.recordOrder = order;
              view.sorts = [];
            }
          },
          true,
          dialog,
        );
        return committed || unchanged;
      };
      const updateDraft = (mutate: () => void): boolean => {
        const previous = structuredClone(draft);
        mutate();
        let applied = false;
        try {
          applied = !keepSorting || apply();
          return applied;
        } finally {
          if (!applied) {
            draft = previous;
            if (getPopup() === dialog) renderTableSort();
          }
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
            let applied = false;
            try {
              applied = apply();
            } finally {
              if (!applied) keepSorting = previous;
              if (getPopup() === dialog) renderTableSort();
            }
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
            if (!updateDraft(() => draft.splice(index, 1))) return;
            if (!draft.length) keepSorting = false;
            if (getPopup() === dialog) renderTableSort();
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
              if (!field || !updateDraft(() => draft.push({ fieldId: field.id, direction: "asc" }))) return;
              if (getPopup() === dialog) renderTableSort();
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
              if (apply() && getPopup() === dialog) closePopup();
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
          let committed = false;
          try {
            committed = change(
              (_data, view) => {
                const target = view.sorts.find((item) => item.fieldId === field.value);
                if (target) target.direction = direction.value === "desc" ? "desc" : "asc";
              },
              true,
              direction,
            );
          } finally {
            if (!committed && getPopup() === dialog) {
              const saved = getView(getData()).sorts.find((item) => item.fieldId === field.value);
              if (saved) direction.value = saved.direction;
            }
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
