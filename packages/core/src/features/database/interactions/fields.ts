import {
  createDatabaseField,
  createDatabaseId,
  convertDatabaseValue,
  DatabaseContentError,
  databaseFieldTypes,
  databaseFiles,
  databaseLimits,
  databaseTimeFormats,
  databaseValueText,
  orderedDatabaseFields,
  visibleDatabaseRecords,
  type DatabaseData,
  type DatabaseField,
  type DatabaseFieldType,
  type DatabaseFile,
  type DatabaseTimeFormat,
  type DatabaseValue,
  type DatabaseView,
} from "../model";

interface DatabaseFieldInteractionsContext {
  doc: Document;
  optionColors: readonly string[];
  getData(): DatabaseData;
  change(
    mutate: (data: DatabaseData, view: DatabaseView) => void,
    repaint?: boolean,
    origin?: HTMLElement,
    onContentError?: (error: DatabaseContentError) => void,
  ): boolean;
  panel(anchor: HTMLElement, title: string): HTMLElement;
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
  addFilter(fieldId: string): void;
  startAiFill(fieldId: string): void;
  cancelPersonSearch(): void;
  personSearch(container: HTMLElement, onPick: (item: { id: string; label: string }) => void): void;
  filePicker(
    container: HTMLElement,
    type: "image" | "attachment",
    onUploaded: (files: DatabaseFile[]) => void,
    remaining: () => number,
  ): void;
}

const fieldLabels: Record<DatabaseFieldType, string> = {
  text: "文本",
  number: "数字",
  singleSelect: "单选",
  multiSelect: "多选",
  person: "人员",
  image: "图片",
  attachment: "附件",
  date: "日期",
  createdTime: "创建时间",
  modifiedTime: "修改时间",
  createdBy: "创建人",
  modifiedBy: "修改人",
  checkbox: "复选框",
  link: "链接",
  email: "邮箱",
  phone: "手机号码",
  rating: "评分",
  progress: "进度",
};
/** 字段定义、默认值及列菜单的交互入口。 */
export function createDatabaseFieldInteractions({
  doc,
  optionColors,
  getData,
  change,
  panel,
  closePopup,
  button,
  option,
  label,
  addFilter,
  startAiFill,
  cancelPersonSearch,
  personSearch,
  filePicker,
}: DatabaseFieldInteractionsContext) {
  const editField = (
    anchor: HTMLElement,
    fieldId?: string,
    insertIndex?: number,
    insertBeside?: { id: string; after: boolean },
  ) => {
    const data = getData();
    const old = data.fields.find((field) => field.id === fieldId);
    const draft = old
      ? structuredClone(old)
      : createDatabaseField(`文本 ${data.fields.filter((field) => field.type === "text").length}`);
    const dialog = panel(anchor, old ? "编辑列" : "新增列");
    dialog.classList.add("semlo-editor-database-field-dialog");
    const name = doc.createElement("input");
    name.type = "text";
    name.value = draft.name;
    name.setAttribute("aria-label", "数据表列名");
    const type = doc.createElement("select");
    type.setAttribute("aria-label", "列类型");
    for (const key of databaseFieldTypes) type.append(option(key, fieldLabels[key]));
    type.value = draft.type;
    const defaultInput = doc.createElement("input");
    defaultInput.type = "text";
    defaultInput.value =
      typeof draft.defaultValue === "string"
        ? draft.type === "singleSelect"
          ? (draft.options.find((option) => option.id === draft.defaultValue)?.label ?? draft.defaultValue)
          : draft.defaultValue
        : "";
    defaultInput.placeholder = "请输入";
    defaultInput.setAttribute("aria-label", "默认值");
    let optionDraft = structuredClone(draft.options);
    const defaultIds = new Set(
      Array.isArray(draft.defaultValue)
        ? draft.defaultValue.filter((item): item is string => typeof item === "string")
        : [],
    );
    const defaultCheckbox = doc.createElement("input");
    defaultCheckbox.type = "checkbox";
    defaultCheckbox.checked = draft.defaultValue === true;
    defaultCheckbox.setAttribute("aria-label", "默认勾选");
    const defaultChoices = doc.createElement("div");
    defaultChoices.className = "semlo-editor-database-default-choices";
    const defaultTextLabel = doc.createElement("div");
    defaultTextLabel.className = "semlo-editor-database-label";
    const defaultCaption = doc.createElement("span");
    defaultCaption.textContent = "默认值";
    defaultTextLabel.append(defaultCaption, defaultInput);
    const singleDefault = doc.createElement("div");
    singleDefault.className = "semlo-editor-database-single-default";
    const singleTrigger = doc.createElement("button");
    singleTrigger.type = "button";
    singleTrigger.setAttribute("aria-label", "默认值");
    singleTrigger.setAttribute("aria-haspopup", "listbox");
    singleTrigger.setAttribute("aria-expanded", "false");
    const singleClear = doc.createElement("button");
    singleClear.type = "button";
    singleClear.className = "semlo-editor-database-single-clear";
    singleClear.setAttribute("aria-label", "清除默认值");
    singleClear.textContent = "×";
    const singlePopup = doc.createElement("div");
    singlePopup.className = "semlo-editor-database-single-popup";
    singlePopup.hidden = true;
    const singleSearch = doc.createElement("input");
    singleSearch.type = "search";
    singleSearch.placeholder = "搜索选项";
    singleSearch.setAttribute("aria-label", "搜索默认选项");
    const singleList = doc.createElement("div");
    singleList.setAttribute("role", "listbox");
    singleList.setAttribute("aria-label", "默认选项");
    singlePopup.append(singleSearch, singleList);
    singleDefault.append(singleTrigger, singleClear, singlePopup);
    let singleDefaultId =
      draft.type === "singleSelect" && typeof draft.defaultValue === "string"
        ? (draft.options.find((entry) => entry.id === draft.defaultValue)?.id ??
          draft.options.find((entry) => entry.label === draft.defaultValue)?.id ??
          "")
        : "";
    const closeSingleDefault = () => {
      singlePopup.hidden = true;
      singleTrigger.setAttribute("aria-expanded", "false");
    };
    const renderSingleDefault = () => {
      const selected = optionDraft.find((entry) => entry.id === singleDefaultId);
      if (!selected) singleDefaultId = "";
      singleTrigger.replaceChildren();
      if (selected) {
        const chip = doc.createElement("span");
        chip.className = "semlo-editor-database-single-chip";
        chip.style.backgroundColor = optionColors[selected.color] ?? optionColors[0];
        chip.textContent = selected.label || "未命名";
        singleTrigger.append(chip);
      } else singleTrigger.textContent = "请选择";
      singleClear.hidden = !selected;
      singleList.replaceChildren();
      const query = singleSearch.value.trim().toLocaleLowerCase();
      for (const entry of optionDraft) {
        if (!entry.label.toLocaleLowerCase().includes(query)) continue;
        const choice = doc.createElement("button");
        choice.type = "button";
        choice.setAttribute("role", "option");
        choice.setAttribute("aria-selected", String(entry.id === singleDefaultId));
        const chip = doc.createElement("span");
        chip.className = "semlo-editor-database-single-chip";
        chip.style.backgroundColor = optionColors[entry.color] ?? optionColors[0];
        chip.textContent = entry.label || "未命名";
        choice.append(chip);
        choice.addEventListener("click", () => {
          singleDefaultId = entry.id;
          renderSingleDefault();
          closeSingleDefault();
          singleTrigger.focus();
        });
        singleList.append(choice);
      }
    };
    singleTrigger.addEventListener("click", () => {
      if (!singlePopup.hidden) return closeSingleDefault();
      singleSearch.value = "";
      renderSingleDefault();
      singlePopup.hidden = false;
      singleTrigger.setAttribute("aria-expanded", "true");
      singleSearch.focus();
    });
    singleClear.addEventListener("click", () => {
      singleDefaultId = "";
      renderSingleDefault();
      closeSingleDefault();
      singleTrigger.focus();
    });
    singleSearch.addEventListener("input", renderSingleDefault);
    singlePopup.addEventListener("keydown", (event) => {
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeSingleDefault();
        singleTrigger.focus();
      } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        const choices = [...singleList.querySelectorAll<HTMLButtonElement>('[role="option"]')];
        if (!choices.length) return;
        event.preventDefault();
        const index = choices.indexOf(doc.activeElement as HTMLButtonElement);
        const next =
          event.key === "ArrowDown" ? (index + 1) % choices.length : index <= 0 ? choices.length - 1 : index - 1;
        choices[next].focus();
      }
    });
    singleDefault.addEventListener("focusout", (event) => {
      if (!singleDefault.contains(event.relatedTarget as globalThis.Node | null)) closeSingleDefault();
    });
    dialog.addEventListener("pointerdown", (event) => {
      if (!singleDefault.contains(event.target as globalThis.Node)) closeSingleDefault();
    });
    const defaultCheckboxLabel = label("默认勾选", defaultCheckbox);
    const defaultChoicesLabel = doc.createElement("div");
    defaultChoicesLabel.className = "semlo-editor-database-label";
    const defaultChoicesCaption = doc.createElement("span");
    defaultChoicesCaption.textContent = "默认选项";
    defaultChoicesLabel.append(defaultChoicesCaption, defaultChoices);
    const defaultPersonSearch = doc.createElement("div");
    defaultPersonSearch.className = "semlo-editor-database-person-picker";
    let personPickerReady = false;
    let defaultFiles = databaseFiles(draft.defaultValue);
    const defaultFilePicker = doc.createElement("div");
    defaultFilePicker.className = "semlo-editor-database-file-picker";
    const defaultFileList = doc.createElement("div");
    const renderDefaultFiles = () => {
      defaultFileList.replaceChildren();
      for (const file of defaultFiles)
        defaultFileList.append(
          button(`移除默认文件 ${file.name}`, `${file.name} ×`, () => {
            defaultFiles = defaultFiles.filter((entry) => entry.id !== file.id);
            renderDefaultFiles();
          }),
        );
    };
    let pickerType: "image" | "attachment" | null = null;
    const timeFormat = doc.createElement("select");
    timeFormat.setAttribute("aria-label", "日期格式");
    const example = new Date().toISOString();
    for (const format of databaseTimeFormats)
      timeFormat.append(
        option(format, databaseValueText({ ...draft, type: "createdTime", timeFormat: format }, example)),
      );
    timeFormat.value = draft.timeFormat ?? "datetimeSeconds";
    const timeFormatLabel = label("日期格式", timeFormat);
    const renderDefaultChoices = () => {
      renderSingleDefault();
      defaultChoices.replaceChildren();
      for (const entry of optionDraft) {
        const choice = doc.createElement("input");
        choice.type = "checkbox";
        choice.checked = defaultIds.has(entry.id);
        choice.setAttribute("aria-label", `默认选项 ${entry.label || "未命名"}`);
        choice.addEventListener("change", () => {
          if (choice.checked) defaultIds.add(entry.id);
          else defaultIds.delete(entry.id);
        });
        const choiceLabel = label(entry.label || "未命名", choice);
        choiceLabel.classList.add("semlo-editor-database-default-choice");
        defaultChoices.append(choiceLabel);
      }
    };
    let pendingLoss = "";
    const optionsInput = doc.createElement("div");
    optionsInput.className = "semlo-editor-database-option-editor";
    const optionsLabel = label("选项", optionsInput);
    const renderOptions = () => {
      optionsInput.replaceChildren();
      optionDraft.forEach((entry, index) => {
        const row = doc.createElement("div");
        row.className = "semlo-editor-database-option-row";
        const input = doc.createElement("input");
        input.value = entry.label;
        input.placeholder = "选项名称";
        input.setAttribute("aria-label", `选项名称 ${index + 1}`);
        input.addEventListener("input", () => {
          entry.label = input.value;
          pendingLoss = "";
          renderDefaultChoices();
        });
        const up = button(`上移选项 ${index + 1}`, "↑", () => {
          if (index === 0) return;
          [optionDraft[index - 1], optionDraft[index]] = [optionDraft[index], optionDraft[index - 1]];
          pendingLoss = "";
          renderOptions();
        });
        up.disabled = index === 0;
        const down = button(`下移选项 ${index + 1}`, "↓", () => {
          if (index >= optionDraft.length - 1) return;
          [optionDraft[index], optionDraft[index + 1]] = [optionDraft[index + 1], optionDraft[index]];
          pendingLoss = "";
          renderOptions();
        });
        down.disabled = index >= optionDraft.length - 1;
        const remove = button(`删除选项 ${index + 1}`, "×", () => {
          optionDraft.splice(index, 1);
          pendingLoss = "";
          renderOptions();
        });
        row.append(input, up, down, remove);
        optionsInput.append(row);
      });
      renderDefaultChoices();
      optionsInput.append(
        button(
          "新增选项",
          "+ 新增选项",
          () => {
            optionDraft.push({
              id: createDatabaseId("option"),
              label: "",
              color: optionDraft.length % optionColors.length,
            });
            pendingLoss = "";
            renderOptions();
            optionsInput.querySelector<HTMLInputElement>(`[aria-label="选项名称 ${optionDraft.length}"]`)?.focus();
          },
          "semlo-editor-database-add-rule",
        ),
      );
    };
    renderOptions();
    const aiSettings = doc.createElement("div");
    aiSettings.className = "semlo-editor-database-ai-settings";
    const aiEnabled = doc.createElement("input");
    aiEnabled.type = "checkbox";
    aiEnabled.checked = !!draft.ai;
    aiEnabled.setAttribute("aria-label", "AI 智能填写");
    const aiToggle = label("AI 智能填写", aiEnabled);
    aiToggle.classList.add("semlo-editor-database-ai-toggle");
    const aiMode = doc.createElement("select");
    aiMode.setAttribute("aria-label", "内容规则");
    aiMode.append(option("summary", "内容总结"), option("custom", "自定义"));
    aiMode.value = draft.ai?.mode ?? "summary";
    const aiModeLabel = label("内容规则", aiMode);
    const aiPrompt = doc.createElement("textarea");
    aiPrompt.setAttribute("aria-label", "填写规则");
    aiPrompt.maxLength = 2000;
    aiPrompt.value = draft.ai?.prompt ?? "";
    const aiPromptLabel = label("填写规则", aiPrompt);
    const aiNotice = doc.createElement("p");
    aiNotice.textContent = "将整表内容发送给服务并覆盖本列。";
    aiSettings.append(aiToggle, aiModeLabel, aiPromptLabel, aiNotice);
    let startButton: HTMLButtonElement | undefined;
    const updateAiVisibility = () => {
      aiSettings.hidden = type.value !== "text";
      aiModeLabel.hidden = !aiEnabled.checked;
      aiPromptLabel.hidden = !aiEnabled.checked || aiMode.value !== "custom";
      aiNotice.hidden = !aiEnabled.checked;
      if (startButton) startButton.hidden = type.value !== "text" || !aiEnabled.checked;
    };
    aiEnabled.addEventListener("change", updateAiVisibility);
    aiMode.addEventListener("change", updateAiVisibility);
    const updateOptionVisibility = () => {
      updateAiVisibility();
      optionsLabel.hidden = type.value !== "singleSelect" && type.value !== "multiSelect";
      defaultTextLabel.hidden =
        type.value === "checkbox" ||
        type.value === "multiSelect" ||
        type.value === "person" ||
        type.value === "image" ||
        type.value === "attachment" ||
        type.value === "createdTime" ||
        type.value === "modifiedTime" ||
        type.value === "createdBy" ||
        type.value === "modifiedBy";
      if (type.value === "singleSelect" && defaultInput.parentElement === defaultTextLabel)
        defaultInput.replaceWith(singleDefault);
      else if (type.value !== "singleSelect" && singleDefault.parentElement === defaultTextLabel) {
        closeSingleDefault();
        singleDefault.replaceWith(defaultInput);
      }
      defaultCheckboxLabel.hidden = type.value !== "checkbox";
      defaultChoicesLabel.hidden = type.value !== "multiSelect" && type.value !== "person";
      defaultPersonSearch.hidden = type.value !== "person";
      const nextPickerType = type.value === "image" || type.value === "attachment" ? type.value : null;
      defaultFilePicker.hidden = !nextPickerType;
      if (nextPickerType !== pickerType) {
        pickerType = nextPickerType;
        defaultFilePicker.replaceChildren();
        defaultFileList.replaceChildren();
        if (nextPickerType) {
          if (draft.type !== nextPickerType) defaultFiles = [];
          renderDefaultFiles();
          defaultFilePicker.append(defaultFileList);
          filePicker(
            defaultFilePicker,
            nextPickerType,
            (files) => {
              if (type.value !== nextPickerType) return;
              if (defaultFiles.length + files.length > databaseLimits.files)
                throw new DatabaseContentError(`文件不能超过 ${databaseLimits.files} 项`);
              defaultFiles = [...defaultFiles, ...files];
              renderDefaultFiles();
            },
            () => databaseLimits.files - defaultFiles.length,
          );
        }
      }
      if (type.value !== "person" && personPickerReady) {
        cancelPersonSearch();
        personPickerReady = false;
        defaultPersonSearch.replaceChildren();
      }
      if (type.value === "person" && !personPickerReady) {
        personPickerReady = true;
        personSearch(defaultPersonSearch, (person) => {
          let entry = optionDraft.find((item) => item.externalId === person.id);
          if (!entry) {
            entry = { id: createDatabaseId("person"), label: person.label, color: 0, externalId: person.id };
            optionDraft.push(entry);
          }
          defaultIds.add(entry.id);
          renderDefaultChoices();
        });
      }
      timeFormatLabel.hidden = type.value !== "createdTime" && type.value !== "modifiedTime";
    };
    type.addEventListener("change", updateOptionVisibility);
    dialog.append(
      label("数据表列名", name),
      label("列类型", type),
      optionsLabel,
      defaultTextLabel,
      defaultCheckboxLabel,
      defaultChoicesLabel,
      defaultPersonSearch,
      defaultFilePicker,
      timeFormatLabel,
      aiSettings,
    );
    updateOptionVisibility();
    const actions = doc.createElement("div");
    actions.className = "semlo-editor-database-actions";
    const cancel = button("取消", "取消", closePopup);
    const warning = doc.createElement("p");
    warning.className = "semlo-editor-database-warning";
    warning.setAttribute("role", "status");
    warning.hidden = true;
    const commit = (startFill: boolean) => {
      const nextType = type.value as DatabaseFieldType;
      if (!databaseFieldTypes.includes(nextType)) return;
      if (nextType !== "text" && aiEnabled.checked) {
        warning.textContent = "请先关闭 AI 智能填写再更改列类型。";
        warning.hidden = false;
        return;
      }
      if (aiEnabled.checked && aiMode.value === "custom" && !aiPrompt.value.trim()) {
        warning.textContent = "请输入填写规则。";
        warning.hidden = false;
        return;
      }
      const nextOptions = optionDraft
        .map((item) => ({ ...item, label: item.label.trim() }))
        .filter((item) => item.label);
      if (nextType !== "person" && new Set(nextOptions.map((item) => item.label)).size !== nextOptions.length) {
        warning.textContent = "选项名称不能重复。";
        warning.hidden = false;
        return;
      }
      const defaultValue: DatabaseValue =
        nextType === "checkbox"
          ? defaultCheckbox.checked
          : nextType === "image" || nextType === "attachment"
            ? defaultFiles
            : nextType === "multiSelect" || nextType === "person"
              ? nextOptions.filter((item) => defaultIds.has(item.id)).map((item) => item.id)
              : nextType === "singleSelect"
                ? (nextOptions.find((item) => item.id === singleDefaultId)?.id ?? "")
                : defaultInput.value;
      const field: DatabaseField = {
        ...draft,
        name: name.value.trim() || "未命名列",
        type: nextType,
        options: nextOptions,
        defaultValue,
        ai:
          aiEnabled.checked && nextType === "text"
            ? {
                version: 1,
                mode: aiMode.value === "custom" ? "custom" : "summary",
                prompt: aiMode.value === "custom" ? aiPrompt.value : "",
              }
            : undefined,
        ...(nextType === "createdTime" || nextType === "modifiedTime"
          ? { timeFormat: timeFormat.value as DatabaseTimeFormat }
          : { timeFormat: undefined }),
      };
      const currentData = getData();
      const existing = currentData.fields.find((item) => item.id === draft.id);
      const converted = existing
        ? currentData.records.map((record) => ({
            id: record.id,
            ...(field.type === "createdBy" || field.type === "modifiedBy"
              ? {
                  value:
                    (field.type === "createdBy" ? record.createdBy : record.modifiedBy) ??
                    (existing.type === field.type ? record.values[field.id] : "") ??
                    "",
                  lost: false,
                }
              : field.type === "createdTime" || field.type === "modifiedTime"
                ? {
                    value:
                      (field.type === "createdTime" ? record.createdAt : record.modifiedAt) ??
                      (existing.type === field.type ? record.values[field.id] : "") ??
                      "",
                    lost: false,
                  }
                : convertDatabaseValue(existing, field, record.values[field.id])),
          }))
        : [];
      const lossCount = converted.filter((item) => item.lost).length;
      const fingerprint = JSON.stringify({ field, converted });
      if (lossCount && pendingLoss !== fingerprint) {
        pendingLoss = fingerprint;
        warning.textContent = `${lossCount} 条记录中无法转换的值将被清除，请再次点击确定。操作可以撤销。`;
        warning.hidden = false;
        return;
      }
      let rejectedContent = false;
      change(
        (next) => {
          const existing = next.fields.find((item) => item.id === draft.id);
          if (existing) {
            const index = next.fields.indexOf(existing);
            next.fields[index] = field;
            for (const view of next.views) {
              for (const filter of [...view.filters, ...view.charts.flatMap((chart) => chart.filters)]) {
                if (filter.fieldId !== field.id || !filter.optionId) continue;
                const options = existing.type === field.type ? field.options : existing.options;
                const selected = options.find((item) => item.id === filter.optionId);
                if (selected) filter.value = selected.label;
                if (existing.type !== field.type) delete filter.optionId;
              }
            }
            for (const result of converted) {
              const record = next.records.find((item) => item.id === result.id);
              if (record) record.values[field.id] = result.value;
            }
          } else {
            const position = insertIndex ?? next.fields.length;
            const nextFieldId = next.fields[position]?.id;
            for (const view of next.views) {
              if (!view.fieldOrder.length) continue;
              const order = orderedDatabaseFields(next, view).map((entry) => entry.id);
              const target = insertBeside
                ? order.indexOf(insertBeside.id)
                : nextFieldId
                  ? order.indexOf(nextFieldId)
                  : -1;
              order.splice(target < 0 ? order.length : target + (insertBeside?.after ? 1 : 0), 0, field.id);
              view.fieldOrder = order;
            }
            next.fields.splice(position, 0, field);
            for (const record of next.records)
              record.values[field.id] =
                field.type === "createdBy"
                  ? (record.createdBy ?? "")
                  : field.type === "modifiedBy"
                    ? (record.modifiedBy ?? "")
                    : field.type === "createdTime"
                      ? (record.createdAt ?? "")
                      : field.type === "modifiedTime"
                        ? (record.modifiedAt ?? "")
                        : field.type === "checkbox"
                          ? false
                          : field.type === "multiSelect" ||
                              field.type === "person" ||
                              field.type === "image" ||
                              field.type === "attachment"
                            ? []
                            : structuredClone(field.defaultValue);
          }
        },
        true,
        undefined,
        (error) => {
          rejectedContent = true;
          warning.textContent = error.message;
          warning.hidden = false;
        },
      );
      if (rejectedContent) return;
      const stored = getData().fields.find((entry) => entry.id === field.id);
      if (
        !stored ||
        stored.name !== field.name ||
        stored.type !== field.type ||
        JSON.stringify(stored.ai) !== JSON.stringify(field.ai) ||
        JSON.stringify(stored.options) !== JSON.stringify(field.options) ||
        JSON.stringify(stored.defaultValue) !== JSON.stringify(field.defaultValue) ||
        stored.timeFormat !== field.timeFormat
      ) {
        warning.textContent = "列设置未保存，请重试。";
        warning.hidden = false;
        return;
      }
      closePopup();
      if (startFill) startAiFill(field.id);
    };
    const confirm = button("确定", "确定", () => commit(false), "semlo-editor-database-primary");
    startButton = button("开始自动填写", "开始自动填写", () => commit(true), "semlo-editor-database-primary");
    updateAiVisibility();
    dialog.addEventListener("input", () => {
      pendingLoss = "";
      warning.hidden = true;
    });
    dialog.addEventListener("change", () => {
      pendingLoss = "";
      warning.hidden = true;
    });
    actions.append(cancel, confirm, startButton);
    dialog.append(warning, actions);
    name.focus();
    name.select();
  };

  const fieldMenu = (anchor: HTMLElement, field: DatabaseField) => {
    const dialog = panel(anchor, `${field.name} 列菜单`);
    dialog.classList.add("semlo-editor-database-menu");
    const item = (name: string, action: () => void) => {
      const control = button(name, name, action);
      control.setAttribute("role", "menuitem");
      dialog.append(control);
    };
    dialog.setAttribute("role", "menu");
    item("编辑列", () => editField(anchor, field.id));
    if (field.ai)
      item("重新填写本列内容", () => {
        closePopup();
        startAiFill(field.id);
      });
    item("复制列", () => {
      change((data) => {
        const source = data.fields.find((entry) => entry.id === field.id);
        if (!source) return;
        const copy = structuredClone(source);
        copy.id = createDatabaseId("field");
        copy.name = `${source.name} 副本`;
        for (const view of data.views) {
          if (!view.fieldOrder.length) continue;
          const order = orderedDatabaseFields(data, view).map((entry) => entry.id);
          const index = order.indexOf(source.id);
          order.splice(index < 0 ? order.length : index + 1, 0, copy.id);
          view.fieldOrder = order;
        }
        data.fields.splice(data.fields.indexOf(source) + 1, 0, copy);
        for (const record of data.records)
          record.values[copy.id] = structuredClone(record.values[source.id] ?? copy.defaultValue);
      });
      closePopup();
    });
    item("向左插入列", () =>
      editField(
        anchor,
        undefined,
        getData().fields.findIndex((item) => item.id === field.id),
        { id: field.id, after: false },
      ),
    );
    item("向右插入列", () =>
      editField(anchor, undefined, getData().fields.findIndex((item) => item.id === field.id) + 1, {
        id: field.id,
        after: true,
      }),
    );
    item("按本列分组", () => {
      change((_data, active) => {
        active.groupFieldId = field.id;
      });
      closePopup();
    });
    item("按本列筛选", () => {
      addFilter(field.id);
      closePopup();
    });
    for (const [name, direction] of [
      ["升序", "asc"],
      ["降序", "desc"],
    ] as const) {
      item(name, () => {
        change((data, active) => {
          if (active.kind === "table") {
            const sortedView = { ...active, filters: [], sorts: [{ fieldId: field.id, direction }] };
            active.recordOrder = visibleDatabaseRecords(data, sortedView).map((record) => record.id);
            active.sorts = [];
          } else {
            active.sorts = [{ fieldId: field.id, direction }];
          }
        });
        closePopup();
      });
    }
    item("删除列", () => {
      change((data) => {
        data.fields = data.fields.filter((item) => item.id !== field.id);
        for (const record of data.records) delete record.values[field.id];
        for (const entry of data.views) {
          entry.filters = entry.filters.filter((item) => item.fieldId !== field.id);
          entry.sorts = entry.sorts.filter((item) => item.fieldId !== field.id);
          entry.hiddenFields = entry.hiddenFields.filter((id) => id !== field.id);
          entry.fieldOrder = entry.fieldOrder.filter((id) => id !== field.id);
          if (entry.groupFieldId === field.id) entry.groupFieldId = "";
          delete entry.statistics[field.id];
        }
      });
      closePopup();
    });
  };

  return { editField, fieldMenu };
}
