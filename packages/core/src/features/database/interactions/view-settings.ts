import type { Editor } from "@tiptap/core";

import {
  createDatabaseView,
  orderedDatabaseFields,
  type DatabaseData,
  type DatabaseFieldType,
  type DatabaseView,
} from "../model";

interface DatabaseViewSettingsContext {
  doc: Document;
  dom: HTMLElement;
  editor: Editor;
  fieldIcons: Record<DatabaseFieldType, string>;
  getData(): DatabaseData;
  getView(data: DatabaseData): DatabaseView;
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
  option(value: string, label: string): HTMLOptionElement;
  label(text: string, control: HTMLElement): HTMLLabelElement;
  repaintBody(): void;
  switchReadonlyView(viewId: string): void;
}

const calendarColors = [
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

/** 视图、字段显示及日历设置面板。 */
export function createDatabaseViewSettings({
  doc,
  dom,
  editor,
  fieldIcons,
  getData,
  getView,
  change,
  panel,
  panelHeading,
  closePopup,
  button,
  option,
  label,
  repaintBody,
  switchReadonlyView,
}: DatabaseViewSettingsContext) {
  const fieldsPanel = (anchor: HTMLElement) => {
    const dialog = panel(anchor, "字段配置");
    panelHeading(dialog, "显示字段");
    const data = getData();
    const active = getView(data);
    if (active.kind === "gallery" || active.kind === "kanban") {
      const row = doc.createElement("label");
      row.className = "semlo-editor-database-field-toggle semlo-editor-database-field-name-toggle";
      const input = doc.createElement("input");
      input.type = "checkbox";
      input.checked = active.showFieldNames;
      input.setAttribute("aria-label", "显示字段名");
      input.addEventListener("change", () =>
        change(
          (_data, view) => {
            view.showFieldNames = input.checked;
          },
          true,
          input,
        ),
      );
      const name = doc.createElement("span");
      name.textContent = "显示字段名";
      row.append(input, name);
      dialog.append(row);
    }
    for (const field of orderedDatabaseFields(data, active)) {
      const row = doc.createElement("label");
      row.className = "semlo-editor-database-field-toggle";
      const input = doc.createElement("input");
      input.type = "checkbox";
      input.checked = !active.hiddenFields.includes(field.id);
      input.setAttribute("aria-label", `显示${field.name}`);
      input.addEventListener("change", () =>
        change(
          (_data, view) => {
            view.hiddenFields = input.checked
              ? view.hiddenFields.filter((id) => id !== field.id)
              : [...view.hiddenFields, field.id];
          },
          true,
          input,
        ),
      );
      const name = doc.createElement("span");
      name.textContent = `${fieldIcons[field.type]}  ${field.name}`;
      row.append(input, name);
      dialog.append(row);
    }
  };

  const calendarSettingsPanel = (anchor: HTMLElement) => {
    const dialog = panel(anchor, "日历设置");
    dialog.classList.add("semlo-editor-database-calendar-settings");
    panelHeading(dialog, "日历设置");
    const data = getData();
    const settings = getView(data).calendar;
    const addSelect = (
      caption: string,
      key: "titleFieldId" | "startFieldId" | "endFieldId",
      types: DatabaseFieldType[],
      emptyLabel?: string,
    ) => {
      const select = doc.createElement("select");
      select.setAttribute("aria-label", caption);
      if (emptyLabel) select.append(option("", emptyLabel));
      for (const field of data.fields.filter((field) => types.includes(field.type)))
        select.append(option(field.id, field.name));
      if (!select.options.length) select.append(option("", "无可用字段"));
      select.value = settings[key];
      select.disabled = !editor.isEditable || (!emptyLabel && !settings[key]);
      select.addEventListener("change", () => {
        if (!dom.contains(select)) return;
        const changed = change(
          (_next, active) => {
            active.calendar[key] = select.value;
          },
          false,
          select,
        );
        if (changed) repaintBody();
      });
      dialog.append(label(caption, select));
    };
    addSelect("标题展示", "titleFieldId", ["text"]);
    const colorMode = doc.createElement("select");
    colorMode.setAttribute("aria-label", "颜色显示");
    colorMode.append(option("custom", "自定义颜色"), option("field", "跟随字段颜色"));
    const colorFields = data.fields.filter((field) => field.type === "singleSelect");
    colorMode.options[1].disabled = !colorFields.length;
    colorMode.value = settings.colorFieldId ? "field" : "custom";
    colorMode.disabled = !editor.isEditable;
    dialog.append(label("颜色显示", colorMode));
    const colorField = doc.createElement("select");
    colorField.setAttribute("aria-label", "颜色字段");
    for (const field of colorFields) colorField.append(option(field.id, field.name));
    colorField.value = settings.colorFieldId || colorFields[0]?.id || "";
    colorField.disabled = !editor.isEditable;
    const colorFieldLabel = label("颜色字段", colorField);
    colorFieldLabel.hidden = !settings.colorFieldId;
    dialog.append(colorFieldLabel);
    const palette = doc.createElement("div");
    palette.className = "semlo-editor-database-calendar-palette";
    palette.hidden = !!settings.colorFieldId;
    for (const [index, color] of calendarColors.entries()) {
      const choice = button(`日程颜色 ${index + 1}`, "", () => {
        if (
          change(
            (_next, active) => {
              active.calendar.color = index;
            },
            false,
            choice,
          )
        ) {
          for (const sibling of palette.querySelectorAll("button"))
            sibling.setAttribute("aria-pressed", String(sibling === choice));
          repaintBody();
        }
      });
      choice.style.backgroundColor = color;
      choice.setAttribute("aria-pressed", String(settings.color === index));
      palette.append(choice);
    }
    dialog.append(palette);
    colorMode.addEventListener("change", () => {
      const fieldId = colorMode.value === "field" ? colorField.value : "";
      const changed = change(
        (_next, active) => {
          active.calendar.colorFieldId = fieldId;
        },
        false,
        colorMode,
      );
      colorFieldLabel.hidden = !fieldId;
      palette.hidden = !!fieldId;
      if (changed) repaintBody();
    });
    colorField.addEventListener("change", () => {
      if (
        change(
          (_next, active) => {
            active.calendar.colorFieldId = colorField.value;
          },
          false,
          colorField,
        )
      )
        repaintBody();
    });
    addSelect("开始日期", "startFieldId", ["date", "createdTime", "modifiedTime"]);
    addSelect("结束日期", "endFieldId", ["date", "createdTime", "modifiedTime"]);
    for (const [caption, key] of [
      ["农历及节假日", "showLunar"],
      ["星期日在首位", "sundayFirst"],
    ] as const) {
      const input = doc.createElement("input");
      input.type = "checkbox";
      input.checked = settings[key];
      input.disabled = !editor.isEditable;
      input.setAttribute("aria-label", caption);
      input.addEventListener("change", () => {
        if (
          change(
            (_next, active) => {
              active.calendar[key] = input.checked;
            },
            false,
            input,
          )
        )
          repaintBody();
      });
      dialog.append(label(caption, input));
    }
  };

  const createViewPanel = (anchor: HTMLElement) => {
    const dialog = panel(anchor, "新建视图");
    dialog.classList.add("semlo-editor-database-menu");
    const entries: Array<[string, DatabaseView["kind"] | null]> = [
      ["表格", "table"],
      ["画册", "gallery"],
      ["日历", "calendar"],
      ["看板", "kanban"],
      ["图表", "chart"],
    ];
    for (const [name, kind] of entries) {
      const control = button(name, name, () => {
        if (!kind) return;
        change((data) => {
          const newView = createDatabaseView(`${name}视图`, kind);
          if (kind === "gallery" || kind === "kanban")
            newView.hiddenFields = data.fields.slice(3).map((field) => field.id);
          if (kind === "kanban")
            newView.groupFieldId = data.fields.find((field) => field.type === "singleSelect")?.id ?? "";
          if (kind === "calendar") {
            newView.calendar.titleFieldId = data.fields.find((field) => field.type === "text")?.id ?? "";
            newView.calendar.startFieldId = data.fields.find((field) => field.type === "date")?.id ?? "";
            newView.calendar.endFieldId = newView.calendar.startFieldId;
          }
          data.views.push(newView);
          data.activeViewId = newView.id;
        });
        closePopup();
      });
      if (!kind) {
        control.disabled = true;
        control.title = "暂未支持";
      }
      dialog.append(control);
    }
  };

  const viewPanel = (anchor: HTMLElement) => {
    const dialog = panel(anchor, "切换视图");
    dialog.classList.add("semlo-editor-database-menu");
    const data = getData();
    for (const entry of data.views) {
      const control = button(
        `切换到${entry.name}`,
        entry.name,
        () => {
          if (editor.isEditable)
            change((next) => {
              next.activeViewId = entry.id;
            });
          else switchReadonlyView(entry.id);
          closePopup();
        },
        "",
        true,
      );
      control.setAttribute("aria-pressed", String(entry.id === getView(data).id));
      dialog.append(control);
    }
    if (data.views.length > 1) {
      dialog.append(
        button("删除当前视图", "删除当前视图", () => {
          change((next) => {
            next.views = next.views.filter((entry) => entry.id !== next.activeViewId);
            next.activeViewId = next.views[0].id;
          });
          closePopup();
        }),
      );
    }
  };

  const heightPanel = (anchor: HTMLElement) => {
    const dialog = panel(anchor, "行高");
    dialog.classList.add("semlo-editor-database-menu");
    for (const [value, name] of [
      ["small", "紧凑"],
      ["medium", "中等"],
      ["large", "宽松"],
    ] as const) {
      dialog.append(
        button(name, name, () => {
          change((_data, active) => {
            active.rowHeight = value;
          });
          closePopup();
        }),
      );
    }
  };

  return { fieldsPanel, calendarSettingsPanel, createViewPanel, viewPanel, heightPanel };
}
