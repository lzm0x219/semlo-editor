import { linkPopup } from "../../../../platform/dom/popup-owner";
import {
  createDatabaseChart,
  createDatabaseId,
  type DatabaseChart,
  type DatabaseChartKind,
  type DatabaseChartLayout,
  type DatabaseChartLegend,
  type DatabaseChartSort,
  type DatabaseChartStatistic,
  type DatabaseData,
  type DatabaseField,
  type DatabaseFilterOperator,
  type DatabaseRecord,
  type DatabaseView,
} from "../../model";
import { compactChartLayouts, findChartVacancy, resizeChartLayouts, resolveChartLayouts } from "./layout";
import { calculateDatabaseChart, renderDatabaseChart } from "./render";

export interface DatabaseChartsOptions {
  doc: Document;
  container: HTMLElement;
  data: DatabaseData;
  view: DatabaseView;
  /** Records already filtered by the active view. */
  records: DatabaseRecord[];
  editable: boolean;
  onCommit(charts: DatabaseChart[]): void;
}

/** A chart view owns its portals; always dispose it before repainting the host. */
export type DatabaseChartsHandle = (() => void) & { openPicker(anchor?: HTMLElement): void };

const chartKinds: Array<{ kind: DatabaseChartKind; label: string; enabled: boolean }> = [
  { kind: "column", label: "柱状图", enabled: true },
  { kind: "bar", label: "条形图", enabled: true },
  { kind: "area", label: "面积图", enabled: true },
  { kind: "line", label: "折线图", enabled: true },
  { kind: "pie", label: "饼图", enabled: true },
  { kind: "funnel", label: "漏斗图", enabled: true },
  { kind: "scatter", label: "散点图", enabled: true },
  { kind: "heatmap", label: "热力图", enabled: true },
  { kind: "number", label: "统计数字", enabled: true },
  { kind: "wordcloud", label: "词云", enabled: true },
];
const sorts: Array<[DatabaseChartSort, string]> = [
  ["default", "默认"],
  ["text-asc", "文本 A → Z"],
  ["text-desc", "文本 Z → A"],
  ["count-asc", "计数 小 → 大"],
  ["count-desc", "计数 大 → 小"],
];
const statistics: Array<[DatabaseChartStatistic, string]> = [
  ["count", "记录总数"],
  ["filled", "已填写数"],
  ["empty", "未填写数"],
  ["unique", "唯一数"],
  ["filledPercent", "已填写占比"],
  ["emptyPercent", "未填写占比"],
  ["uniquePercent", "唯一数占比"],
];
const numberStatistics: Array<[DatabaseChartStatistic, string]> = [
  ...statistics,
  ["sum", "总和"],
  ["average", "平均值"],
  ["min", "最小值"],
  ["max", "最大值"],
];
const numericMetricStatistics: Array<[DatabaseChartStatistic, string]> = [
  ["sum", "总和"],
  ["average", "平均数"],
  ["min", "最小值"],
  ["max", "最大值"],
  ["median", "中位数"],
  ["distinct", "不重复的值"],
];
const legends: Array<[DatabaseChartLegend, string]> = [
  ["bottom", "下"],
  ["top", "上"],
  ["left", "左"],
  ["right", "右"],
  ["none", "不显示"],
];
const filters: Array<[DatabaseFilterOperator, string]> = [
  ["contains", "包含"],
  ["notContains", "不包含"],
  ["startsWith", "开头是"],
  ["notStartsWith", "开头不是"],
  ["endsWith", "结尾是"],
  ["notEndsWith", "结尾不是"],
  ["equals", "等于"],
  ["notEquals", "不等于"],
  ["greater", "大于"],
  ["less", "小于"],
  ["empty", "为空"],
  ["notEmpty", "非空"],
];
const numberColors = [
  "#262626",
  "#3b82f6",
  "#c13d80",
  "#e77931",
  "#84b633",
  "#6439d7",
  "#d44657",
  "#59b875",
  "#3879b4",
  "#874db3",
  "#df6273",
  "#e39b2f",
];

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function element<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className?: string) {
  const result = doc.createElement(tag);
  if (className) result.className = className;
  return result;
}
function button(doc: Document, label: string, className?: string) {
  const result = element(doc, "button", className);
  result.type = "button";
  result.setAttribute("aria-label", label);
  result.textContent = label;
  return result;
}
function option(doc: Document, value: string, label: string) {
  const result = element(doc, "option");
  result.value = value;
  result.textContent = label;
  return result;
}
function fieldLabel(field: DatabaseField) {
  const icon: Record<DatabaseField["type"], string> = {
    text: "T",
    number: "#",
    singleSelect: "◉",
    multiSelect: "☷",
    person: "♙",
    image: "▧",
    attachment: "⌁",
    date: "▦",
    createdTime: "▦",
    modifiedTime: "▦",
    createdBy: "♙",
    modifiedBy: "♙",
    checkbox: "☑",
    link: "↗",
    email: "✉",
    phone: "☎",
    rating: "☆",
    progress: "▰",
  };
  return `${icon[field.type]} ${field.name}`;
}

function thumbnail(doc: Document, kind: DatabaseChartKind) {
  const sample = element(doc, "div", `semlo-editor-chart-thumb-art semlo-editor-chart-thumb-${kind}`);
  sample.setAttribute("aria-hidden", "true");
  if (kind === "number") {
    sample.textContent = "12,893";
  } else if (kind === "pie") {
    sample.append(element(doc, "span", "semlo-editor-chart-thumb-pie"));
  } else if (kind === "wordcloud") {
    sample.textContent = "Data 文字 数据 Chart";
  } else {
    const graph = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    graph.setAttribute("viewBox", "0 0 140 76");
    graph.setAttribute("focusable", "false");
    const html: Partial<Record<DatabaseChartKind, string>> = {
      column:
        '<path d="M8 66H134 M8 36H134" stroke="#e2e5e8"/><path fill="#7197ee" d="M18 55h12v11H18z M38 44h12v22H38z M58 12h12v54H58z M78 50h12v16H78z M98 56h12v10H98z M118 59h12v7h-12z"/>',
      bar: '<path fill="#7197ee" d="M8 10h55v8H8z M8 25h85v8H8z M8 40h110v8H8z M8 55h40v8H8z"/>',
      line: '<path fill="none" stroke="#7197ee" stroke-width="2" d="M7 45L22 38 34 43 48 29 60 34 75 21 89 28 104 14 119 21 134 9"/>',
      area: '<path fill="#d2e5ec" d="M7 60L22 54 34 56 48 43 60 45 75 31 89 34 104 22 119 20 134 9V66H7z"/><path fill="none" stroke="#7197ee" d="M7 60L22 54 34 56 48 43 60 45 75 31 89 34 104 22 119 20 134 9"/>',
      funnel:
        '<path fill="#7197ee" d="M7 8h126l-15 14H22z"/><path fill="#80cfae" d="M22 24h96l-13 14H35z"/><path fill="#f5c46a" d="M35 40h70L94 54H46z"/><path fill="#de7b85" d="M46 56h48l-9 12H55z"/>',
      scatter:
        '<path fill="#7197ee" d="M15 45h4v4h-4z M28 37h4v4h-4z M41 49h4v4h-4z M54 28h4v4h-4z M67 34h4v4h-4z M80 23h4v4h-4z M94 20h4v4h-4z M108 12h4v4h-4z M122 20h4v4h-4z"/>',
      heatmap:
        '<path fill="#d9efe3" d="M12 12h20v12H12z M36 12h20v12H36z M60 12h20v12H60z M84 12h20v12H84z M108 12h20v12h-20z M12 28h20v12H12z M36 28h20v12H36z M60 28h20v12H60z M84 28h20v12H84z M108 28h20v12h-20z M12 44h20v12H12z M36 44h20v12H36z M60 44h20v12H60z M84 44h20v12H84z M108 44h20v12h-20z"/><path fill="#75c69a" d="M36 28h20v12H36z M84 44h20v12H84z"/>',
    };
    graph.innerHTML = html[kind] ?? "";
    sample.append(graph);
  }
  return sample;
}

export function paintDatabaseCharts(options: DatabaseChartsOptions): DatabaseChartsHandle {
  const { doc, container, data, view, records, editable, onCommit } = options;
  const portals = new Set<() => void>();
  let disposed = false;
  let cancelResize: (() => void) | undefined;
  let grid: HTMLDivElement | undefined;
  let layouts: Map<string, DatabaseChartLayout> | undefined;
  let columnWidth = 0;
  let resizeObserver: ResizeObserver | undefined;
  let measureFrame: number | undefined;
  const cards = new Map<string, HTMLElement>();
  const stop = (event: Event) => event.stopPropagation();
  container.addEventListener("click", stop);
  container.addEventListener("pointerdown", stop);

  function closeAll() {
    for (const close of portals) close();
  }

  // The database body is attached after this view is created, so dimensions
  // are resolved only once the grid has a real, nonzero width.
  function measureColumn() {
    return (grid?.getBoundingClientRect().width ?? canvas.getBoundingClientRect().width) / 12;
  }
  function currentLayouts() {
    const width = measureColumn();
    if (!(width > 0)) return undefined;
    if (!layouts) layouts = resolveChartLayouts(view.charts);
    return layouts;
  }
  function positionedCharts() {
    const resolved = currentLayouts();
    if (!resolved) return undefined;
    return view.charts.map((chart) => ({ ...copy(chart), layout: { ...resolved.get(chart.id)! } }));
  }
  function paintLayouts(next: ReadonlyMap<string, DatabaseChartLayout>) {
    if (!grid) return;
    for (const [id, card] of cards) {
      const layout = next.get(id);
      if (!layout) continue;
      card.style.gridColumn = `${layout.x + 1} / span ${layout.w}`;
      card.style.gridRow = `${layout.y + 1} / span ${layout.h}`;
      card.dataset.gridX = String(layout.x);
      card.dataset.gridY = String(layout.y);
      card.dataset.gridW = String(layout.w);
      card.dataset.gridH = String(layout.h);
    }
  }
  function measureGrid() {
    if (disposed || !grid) return;
    const next = measureColumn();
    if (!(next > 0)) return;
    if (Math.abs(columnWidth - next) < 0.01 && layouts) return;
    cancelResize?.();
    columnWidth = next;
    grid.style.setProperty("--semlo-editor-chart-cell", `${columnWidth}px`);
    grid.style.setProperty("--semlo-editor-chart-inset", `${Math.min(10, columnWidth / 4)}px`);
    if (!layouts) layouts = resolveChartLayouts(view.charts);
    paintLayouts(layouts);
  }
  function portal(node: HTMLElement, anchor?: HTMLElement, outside = true) {
    let closed = false;
    const unlink = anchor ? linkPopup(anchor, node) : () => {};
    const previousFocus = doc.activeElement?.nodeType === 1 ? (doc.activeElement as HTMLElement) : undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) return;
      const target = event.target;
      if (!(target instanceof (doc.defaultView?.Node ?? Node)) || (!node.contains(target) && !anchor?.contains(target)))
        return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(true);
      } else if (event.key === "Tab" && !outside) {
        const focusable = Array.from(
          node.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled):not([hidden]), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((item) => item.getClientRects().length > 0);
        if (!focusable.length) return;
        const current = focusable.indexOf(doc.activeElement as HTMLElement);
        if (event.shiftKey && current <= 0) {
          event.preventDefault();
          focusable[focusable.length - 1].focus();
        } else if (!event.shiftKey && (current < 0 || current === focusable.length - 1)) {
          event.preventDefault();
          focusable[0].focus();
        }
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof (doc.defaultView?.Node ?? Node) && !node.contains(target) && !anchor?.contains(target))
        close();
    };
    function close(restoreFocus = false) {
      if (closed) return;
      closed = true;
      portals.delete(close);
      doc.removeEventListener("keydown", onKey, true);
      if (outside) doc.removeEventListener("pointerdown", onPointer, true);
      unlink();
      node.remove();
      if (restoreFocus && !disposed && previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    }
    portals.add(close);
    doc.body.append(node);
    doc.addEventListener("keydown", onKey, true);
    if (outside) doc.addEventListener("pointerdown", onPointer, true);
    return close;
  }
  function positionPopup(popup: HTMLElement, anchor?: HTMLElement) {
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const win = doc.defaultView;
    if (!win) return;
    const width = popup.offsetWidth;
    const height = popup.offsetHeight;
    popup.style.left = `${Math.max(8, Math.min(rect.right - width, win.innerWidth - width - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(rect.bottom + 6, win.innerHeight - height - 8))}px`;
  }
  function chartChoices(onSelect: (kind: DatabaseChartKind) => void) {
    const grid = element(doc, "div", "semlo-editor-database-chart-choices");
    for (const entry of chartKinds) {
      const choice = button(doc, entry.label, "semlo-editor-database-chart-choice");
      choice.disabled = !entry.enabled || !editable;
      if (!entry.enabled) choice.title = "暂未实现";
      choice.append(thumbnail(doc, entry.kind));
      const name = element(doc, "span", "semlo-editor-database-chart-choice-label");
      name.textContent = entry.label;
      choice.append(name);
      // The accessible label is set above; do not visually duplicate the text node.
      if (choice.firstChild?.nodeType === 3) choice.firstChild.remove();
      choice.addEventListener("click", () => onSelect(entry.kind));
      grid.append(choice);
    }
    return grid;
  }
  function openEditor(initial: DatabaseChart, isNew: boolean, anchor?: HTMLElement) {
    if (!editable || disposed) return;
    closeAll();
    const draft = copy(initial);
    const overlay = element(doc, "div", "semlo-editor-database-chart-overlay");
    const dialog = element(doc, "div", "semlo-editor-database-chart-dialog");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-modal", "true");
    dialog.setAttribute("aria-label", isNew ? "添加图表" : "编辑图表");
    const preview = element(doc, "div", "semlo-editor-database-chart-preview");
    const previewTitle = element(doc, "div", "semlo-editor-database-chart-preview-title");
    const previewBody = element(doc, "div", "semlo-editor-database-chart-preview-body");
    preview.append(previewTitle, previewBody);
    const settings = element(doc, "div", "semlo-editor-database-chart-settings");
    const tabs = element(doc, "div", "semlo-editor-database-chart-tabs");
    tabs.setAttribute("role", "tablist");
    const basic = button(doc, "基础配置");
    const style = button(doc, "样式配置");
    basic.setAttribute("role", "tab");
    style.setAttribute("role", "tab");
    tabs.append(basic, style);
    const form = element(doc, "div", "semlo-editor-database-chart-form");
    const footer = element(doc, "div", "semlo-editor-database-chart-footer");
    const confirm = button(doc, "确定", "semlo-editor-database-chart-confirm");
    const closeButton = button(doc, "关闭图表设置", "semlo-editor-database-chart-close");
    closeButton.textContent = "×";
    footer.append(confirm);
    settings.append(tabs, form, footer);
    dialog.append(preview, settings, closeButton);
    overlay.append(dialog);
    const close = portal(overlay, anchor, false);
    overlay.addEventListener("pointerdown", (event) => {
      if (event.target === overlay) close();
    });
    closeButton.addEventListener("click", () => close(true));
    let tab: "basic" | "style" = "basic";
    let refreshFunnelOrder: (() => void) | undefined;
    let previousFilters = JSON.stringify([draft.filterMode, draft.filters]);
    let previousFunnelKeys: string[] = [];
    function renderPreview() {
      previewTitle.textContent = draft.title;
      previewBody.replaceChildren(renderDatabaseChart(doc, data, draft, records));
      refreshFunnelOrder?.();
    }
    function row(caption: string, control: HTMLElement) {
      const label = element(doc, "label", "semlo-editor-database-chart-setting");
      const text = element(doc, "span");
      text.textContent = caption;
      label.append(text, control);
      form.append(label);
      return label;
    }
    function select(label: string, values: Array<[string, string]>, value: string, change: (value: string) => void) {
      const control = element(doc, "select", "semlo-editor-database-chart-select");
      control.setAttribute("aria-label", label);
      for (const [id, title] of values) control.append(option(doc, id, title));
      control.value = value;
      control.addEventListener("change", () => {
        change(control.value);
        renderPreview();
      });
      return control;
    }
    function fieldSelect(
      label: string,
      value: string,
      change: (value: string) => void,
      empty?: string,
      types?: DatabaseField["type"][],
    ) {
      return select(
        label,
        [
          ...(empty ? [["", empty] as [string, string]] : []),
          ...data.fields
            .filter((field) => !types || types.includes(field.type))
            .map((field): [string, string] => [field.id, fieldLabel(field)]),
        ],
        value,
        change,
      );
    }
    function metricControl(label: string) {
      const controls = element(doc, "div", "semlo-editor-database-chart-metric");
      const fieldControl = fieldSelect(
        label,
        draft.metricFieldId,
        (value) => {
          draft.metricFieldId = value;
          const field = data.fields.find((item) => item.id === value);
          draft.statistic = !field ? "count" : ["number", "rating", "progress"].includes(field.type) ? "sum" : "filled";
          renderForm();
        },
        "总数",
      );
      controls.append(fieldControl);
      if (draft.metricFieldId) {
        const field = data.fields.find((item) => item.id === draft.metricFieldId);
        const numeric = !!field && ["number", "rating", "progress"].includes(field.type);
        if (numeric) {
          if (!numericMetricStatistics.some(([value]) => value === draft.statistic)) draft.statistic = "sum";
          controls.append(
            select(
              draft.kind === "pie"
                ? "切片统计方式"
                : draft.kind === "funnel"
                  ? "每层统计方式"
                  : draft.kind === "bar"
                    ? "X轴统计方式"
                    : "Y轴统计方式",
              numericMetricStatistics,
              draft.statistic,
              (value) => (draft.statistic = value as DatabaseChartStatistic),
            ),
          );
        }
      }
      return controls;
    }
    function input(label: string, value: string, change: (value: string) => void) {
      const control = element(doc, "input", "semlo-editor-database-chart-input");
      control.setAttribute("aria-label", label);
      control.placeholder = "请输入";
      control.value = value;
      control.addEventListener("input", () => {
        change(control.value);
        renderPreview();
      });
      return control;
    }
    function section(title: string) {
      const heading = element(doc, "div", "semlo-editor-database-chart-section");
      heading.textContent = title;
      form.append(heading);
    }
    function renderFilters() {
      const wrap = element(doc, "div", "semlo-editor-database-chart-filters");
      const head = element(doc, "div", "semlo-editor-database-chart-filter-heading");
      const caption = element(doc, "span");
      caption.textContent = "数据筛选";
      const add = button(doc, "添加筛选规则", "semlo-editor-database-chart-add-filter");
      add.textContent = "☰ 添加";
      add.disabled = data.fields.length === 0;
      add.addEventListener("click", () => {
        const first = data.fields[0];
        if (!first) return;
        draft.filters.push({ id: createDatabaseId("filter"), fieldId: first.id, operator: "contains", value: "" });
        renderForm();
        renderPreview();
      });
      head.append(caption, add);
      wrap.append(head);
      if (draft.filters.length > 1) {
        wrap.append(
          select(
            "筛选关系",
            [
              ["and", "满足全部条件"],
              ["or", "满足任一条件"],
            ],
            draft.filterMode,
            (value) => {
              draft.filterMode = value === "or" ? "or" : "and";
            },
          ),
        );
      }
      for (const filter of draft.filters) {
        const filterRow = element(doc, "div", "semlo-editor-database-chart-filter-row");
        const field = fieldSelect("筛选列", filter.fieldId, (value) => {
          filter.fieldId = value;
          filter.value = "";
          delete filter.optionId;
          renderForm();
        });
        const operator = select("筛选条件", filters, filter.operator, (value) => {
          filter.operator = value as DatabaseFilterOperator;
          renderForm();
        });
        const selectedOption = data.fields
          .find((item) => item.id === filter.fieldId)
          ?.options.find((item) => item.id === filter.optionId);
        const value = input("筛选值", selectedOption?.label ?? filter.value, (next) => {
          filter.value = next;
          delete filter.optionId;
        });
        value.hidden = filter.operator === "empty" || filter.operator === "notEmpty";
        const remove = button(doc, "删除筛选规则", "semlo-editor-database-chart-remove-filter");
        remove.textContent = "×";
        remove.addEventListener("click", () => {
          draft.filters = draft.filters.filter((entry) => entry.id !== filter.id);
          renderForm();
          renderPreview();
        });
        filterRow.append(field, operator, value, remove);
        wrap.append(filterRow);
      }
      form.append(wrap);
    }
    function renderForm() {
      refreshFunnelOrder = undefined;
      form.replaceChildren();
      basic.setAttribute("aria-selected", String(tab === "basic"));
      style.setAttribute("aria-selected", String(tab === "style"));
      if (tab === "style") {
        if (["number", "heatmap", "funnel", "wordcloud"].includes(draft.kind)) {
          const empty = element(doc, "div", "semlo-editor-database-chart-style-empty");
          empty.textContent = "暂无配置";
          form.append(empty);
          return;
        }
        row(
          "图例位置",
          select("图例位置", legends, draft.legend, (value) => (draft.legend = value as DatabaseChartLegend)),
        );
        if (draft.kind === "area" || draft.kind === "line" || draft.kind === "scatter") return;
        const control = element(doc, "input", "semlo-editor-database-chart-input");
        control.type = "number";
        control.min = draft.kind === "pie" ? "0" : "1";
        control.max = draft.kind === "pie" ? "10" : "1000";
        control.value = String(draft.kind === "pie" ? draft.precision : draft.barWidth);
        const label = draft.kind === "pie" ? "小数点后位数" : "柱子最大宽度";
        control.setAttribute("aria-label", label);
        control.addEventListener("input", () => {
          const number = Number(control.value);
          if (!Number.isFinite(number)) return;
          if (draft.kind === "pie") draft.precision = Math.max(0, Math.min(10, Math.round(number)));
          else draft.barWidth = Math.max(1, Math.min(1000, Math.round(number)));
          renderPreview();
        });
        row(label, control);
        return;
      }
      row(
        "图表名称",
        input("图表名称", draft.title, (value) => (draft.title = value)),
      );
      renderFilters();
      if (draft.kind === "number") {
        row(
          "内容显示",
          fieldSelect("内容显示", draft.fieldId, (value) => {
            draft.fieldId = value;
            renderForm();
          }),
        );
        const selected = data.fields.find((field) => field.id === draft.fieldId);
        const available =
          selected && ["number", "rating", "progress"].includes(selected.type) ? numberStatistics : statistics;
        if (!available.some(([value]) => value === draft.statistic)) draft.statistic = "count";
        row(
          "统计方式",
          select(
            "统计方式",
            available,
            draft.statistic,
            (value) => (draft.statistic = value as DatabaseChartStatistic),
          ),
        );
        row(
          "数值说明",
          input("数值说明", draft.description, (value) => (draft.description = value)),
        );
        const palette = element(doc, "div", "semlo-editor-database-chart-colors");
        palette.setAttribute("role", "group");
        palette.setAttribute("aria-label", "配色方案");
        for (const color of numberColors) {
          const swatch = button(doc, `颜色 ${color}`);
          swatch.style.background = color;
          swatch.setAttribute("aria-pressed", String(draft.color === color));
          swatch.addEventListener("click", () => {
            draft.color = color;
            for (const item of palette.querySelectorAll("button"))
              item.setAttribute("aria-pressed", String(item === swatch));
            renderPreview();
          });
          palette.append(swatch);
        }
        row("配色方案", palette);
      } else if (draft.kind === "funnel") {
        row(
          "内容显示",
          fieldSelect("内容显示", draft.fieldId, (value) => {
            draft.fieldId = value;
            draft.funnelOrder = [];
            renderForm();
          }),
        );
        row("每层表示", metricControl("每层表示"));
        const cumulative = element(doc, "input", "semlo-editor-database-chart-checkbox");
        cumulative.type = "checkbox";
        cumulative.setAttribute("aria-label", "累计合并下层数据");
        cumulative.checked = draft.funnelCumulative;
        cumulative.addEventListener("change", () => {
          draft.funnelCumulative = cumulative.checked;
          renderPreview();
        });
        row("累计合并下层数据", cumulative);
        const order = element(doc, "div", "semlo-editor-database-chart-order");
        const heading = element(doc, "div", "semlo-editor-database-chart-section");
        heading.textContent = "层顺序";
        form.append(order);
        let signature = "";
        refreshFunnelOrder = () => {
          const buckets = calculateDatabaseChart(data, draft, records).buckets;
          const bucketsByKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
          const currentFilters = JSON.stringify([draft.filterMode, draft.filters]);
          if (currentFilters !== previousFilters) {
            // Once a filter removes a level, Yuque appends it when that level returns.
            draft.funnelOrder = previousFunnelKeys.filter((key) => bucketsByKey.has(key));
            previousFilters = currentFilters;
          }
          const storedKeys = new Set(draft.funnelOrder);
          const keys = [
            ...draft.funnelOrder.filter((key) => bucketsByKey.has(key)),
            ...buckets.map((bucket) => bucket.key).filter((key) => !storedKeys.has(key)),
          ];
          previousFunnelKeys = keys;
          const nextSignature = JSON.stringify(keys.map((key) => [key, bucketsByKey.get(key)?.label]));
          if (nextSignature === signature) return;
          signature = nextSignature;
          order.replaceChildren(heading);
          let dragging: string | undefined;
          const reorder = (from: number, to: number, focus = false) => {
            if (from < 0 || to < 0 || from === to || from >= keys.length || to >= keys.length) return;
            const [moved] = keys.splice(from, 1);
            keys.splice(to, 0, moved);
            const visible = new Set(keys);
            const fullOrder = [...draft.funnelOrder, ...keys.filter((key) => !storedKeys.has(key))];
            let position = 0;
            draft.funnelOrder = fullOrder.map((key) => (visible.has(key) ? keys[position++] : key));
            renderPreview();
            if (focus) {
              const movedItem = Array.from(
                order.querySelectorAll<HTMLElement>(".semlo-editor-database-chart-order-item"),
              ).find((item) => item.dataset.key === moved);
              const preferred = movedItem?.querySelectorAll<HTMLButtonElement>("button")[to < from ? 0 : 1];
              const fallback = movedItem?.querySelector<HTMLButtonElement>("button:not(:disabled)");
              const focusTarget = preferred && !preferred.disabled ? preferred : fallback;
              focusTarget?.focus();
            }
          };
          for (const [index, key] of keys.entries()) {
            const bucket = bucketsByKey.get(key)!;
            const item = element(doc, "div", "semlo-editor-database-chart-order-item");
            item.dataset.key = key;
            item.draggable = true;
            const grip = element(doc, "div", "semlo-editor-database-chart-order-grip");
            grip.textContent = "⠿";
            grip.setAttribute("aria-hidden", "true");
            const label = element(doc, "span");
            label.textContent = bucket.label;
            const up = button(doc, `上移 ${bucket.label}`, "semlo-editor-database-chart-order-move");
            const down = button(doc, `下移 ${bucket.label}`, "semlo-editor-database-chart-order-move");
            up.textContent = "↑";
            down.textContent = "↓";
            up.disabled = index === 0;
            down.disabled = index === keys.length - 1;
            up.addEventListener("click", () => reorder(index, index - 1, true));
            down.addEventListener("click", () => reorder(index, index + 1, true));
            item.addEventListener("dragstart", (event) => {
              dragging = key;
              if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", key);
              }
            });
            item.addEventListener("dragover", (event) => {
              if (dragging === undefined || dragging === key) return;
              event.preventDefault();
              if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
            });
            item.addEventListener("drop", (event) => {
              if (dragging === undefined) return;
              event.preventDefault();
              reorder(keys.indexOf(dragging), index);
              dragging = undefined;
            });
            item.addEventListener("dragend", () => (dragging = undefined));
            item.append(grip, label, up, down);
            order.append(item);
          }
        };
        refreshFunnelOrder();
      } else if (draft.kind === "wordcloud") {
        row(
          "显示内容",
          fieldSelect("显示内容", draft.fieldId, (value) => (draft.fieldId = value)),
        );
        row(
          "形状",
          select(
            "形状",
            [
              ["cloud", "云朵"],
              ["circle", "正圆"],
              ["ellipse", "椭圆"],
            ],
            draft.wordcloudShape,
            (value) => (draft.wordcloudShape = value as DatabaseChart["wordcloudShape"]),
          ),
        );
        const maximum = element(doc, "input", "semlo-editor-database-chart-input");
        maximum.type = "number";
        maximum.min = "1";
        maximum.max = "100";
        maximum.step = "1";
        maximum.value = String(draft.wordcloudMaxWords);
        maximum.setAttribute("aria-label", "最大数量");
        maximum.addEventListener("input", () => {
          if (maximum.value === "") return;
          const value = Number(maximum.value);
          if (!Number.isFinite(value)) return;
          draft.wordcloudMaxWords = Math.max(1, Math.min(100, Math.round(value)));
          renderPreview();
        });
        maximum.addEventListener("change", () => (maximum.value = String(draft.wordcloudMaxWords)));
        row("最大数量", maximum);
        const excluded = input("排除词", draft.wordcloudExclude, (value) => (draft.wordcloudExclude = value));
        excluded.placeholder = "使用空格分隔";
        row("排除词", excluded);
      } else if (draft.kind === "heatmap") {
        row(
          "日期字段",
          fieldSelect("日期字段", draft.fieldId, (value) => (draft.fieldId = value)),
        );
        row("热点计算", metricControl("热点计算"));
        for (const [key, label, min, max] of [
          ["heatmapMax", "热度最大值", 0, undefined],
          ["heatmapWeeks", "显示周数", 4, 52],
        ] as const) {
          const control = element(doc, "input", "semlo-editor-database-chart-input");
          control.type = "number";
          control.min = String(min);
          if (max !== undefined) control.max = String(max);
          control.step = "1";
          control.value = String(draft[key]);
          control.setAttribute("aria-label", label);
          control.addEventListener("input", () => {
            if (control.value === "") return;
            const number = Number(control.value);
            if (!Number.isFinite(number)) return;
            draft[key] =
              key === "heatmapWeeks" ? Math.max(min, Math.min(max!, Math.round(number))) : Math.max(min, number);
            renderPreview();
          });
          control.addEventListener("change", () => {
            control.value = String(draft[key]);
          });
          row(label, control);
        }
      } else if (draft.kind === "area") {
        section("X轴");
        row(
          "显示内容",
          fieldSelect("X轴显示内容", draft.fieldId, (value) => (draft.fieldId = value), undefined, [
            "text",
            "singleSelect",
            "date",
          ]),
        );
        row(
          "分组方式",
          fieldSelect("分组方式", draft.groupFieldId, (value) => (draft.groupFieldId = value), "请选择"),
        );
        section("Y轴");
        row("显示内容", metricControl("Y轴显示内容"));
        for (const [key, caption] of [
          ["stacked", "是否堆叠"],
          ["smooth", "是否平滑"],
        ] as const) {
          const toggle = element(doc, "input", "semlo-editor-database-chart-checkbox");
          toggle.type = "checkbox";
          toggle.setAttribute("aria-label", caption);
          toggle.checked = draft[key];
          toggle.addEventListener("change", () => {
            draft[key] = toggle.checked;
            renderPreview();
          });
          row(caption, toggle);
        }
      } else if (draft.kind === "bar") {
        section("X轴");
        row("显示内容", metricControl("X轴显示内容"));
        row(
          "分组方式",
          fieldSelect("分组方式", draft.groupFieldId, (value) => (draft.groupFieldId = value), "请选择"),
        );
        section("Y轴");
        row(
          "显示内容",
          fieldSelect("Y轴显示内容", draft.fieldId, (value) => (draft.fieldId = value)),
        );
        row(
          "排序方式",
          select("排序方式", sorts, draft.sort, (value) => (draft.sort = value as DatabaseChartSort)),
        );
      } else {
        section(draft.kind === "pie" ? "数据" : "X轴");
        row(
          "显示内容",
          fieldSelect(
            draft.kind === "pie" ? "数据显示内容" : "X轴显示内容",
            draft.fieldId,
            (value) => (draft.fieldId = value),
          ),
        );
        if (draft.kind === "pie") {
          row("每个切片代表", metricControl("每个切片代表"));
        }
        row(
          "排序方式",
          select("排序方式", sorts, draft.sort, (value) => (draft.sort = value as DatabaseChartSort)),
        );
        if (draft.kind !== "pie") {
          section("Y轴");
          row("显示内容", metricControl("Y轴显示内容"));
          row(
            "分组方式",
            fieldSelect("分组方式", draft.groupFieldId, (value) => (draft.groupFieldId = value), "请选择"),
          );
        }
      }
    }
    basic.addEventListener("click", () => {
      tab = "basic";
      renderForm();
    });
    style.addEventListener("click", () => {
      tab = "style";
      renderForm();
    });
    confirm.addEventListener("click", () => {
      if (disposed || !editable) return;
      const charts = positionedCharts();
      const resolved = currentLayouts();
      if (!charts || !resolved) return;
      const index = charts.findIndex((chart) => chart.id === draft.id);
      if (isNew) charts.push({ ...copy(draft), layout: findChartVacancy(resolved.values(), 4, 4) });
      else if (index >= 0) charts[index] = { ...copy(draft), layout: { ...resolved.get(draft.id)! } };
      else return;
      close();
      onCommit(charts);
    });
    renderForm();
    renderPreview();
    closeButton.focus();
  }
  function openPicker(anchor?: HTMLElement) {
    if (disposed || !editable) return;
    closeAll();
    const picker = element(doc, "div", "semlo-editor-database-chart-picker");
    picker.setAttribute("role", "dialog");
    picker.setAttribute("aria-label", "添加图表组件");
    picker.append(
      chartChoices((kind) => {
        close();
        openEditor(createDatabaseChart(kind, data.fields), true, anchor);
      }),
    );
    const close = portal(picker, anchor);
    positionPopup(picker, anchor);
  }
  function openMenu(chart: DatabaseChart, anchor: HTMLElement) {
    if (disposed || !editable) return;
    closeAll();
    const menu = element(doc, "div", "semlo-editor-database-chart-menu");
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", "图表操作");
    const edit = button(doc, "编辑图表");
    const duplicate = button(doc, "复制图表");
    const remove = button(doc, "删除图表");
    for (const item of [edit, duplicate, remove]) item.setAttribute("role", "menuitem");
    edit.addEventListener("click", () => {
      close();
      openEditor(chart, false, anchor);
    });
    duplicate.addEventListener("click", () => {
      if (disposed) return;
      const charts = positionedCharts();
      const resolved = currentLayouts();
      const original = resolved?.get(chart.id);
      if (!charts || !resolved || !original) return;
      const clone = copy(chart);
      clone.id = createDatabaseId("chart");
      clone.layout = findChartVacancy(resolved.values(), original.w, original.h);
      close();
      onCommit([...charts, clone]);
    });
    remove.addEventListener("click", () => {
      if (disposed) return;
      const charts = positionedCharts();
      const resolved = currentLayouts();
      if (!charts || !resolved) return;
      const remaining = new Map(resolved);
      remaining.delete(chart.id);
      const compacted = compactChartLayouts(remaining);
      close();
      onCommit(
        charts
          .filter((entry) => entry.id !== chart.id)
          .map((entry) => ({ ...entry, layout: { ...compacted.get(entry.id)! } })),
      );
    });
    menu.append(edit, duplicate, remove);
    const close = portal(menu, anchor);
    positionPopup(menu, anchor);
  }

  function commitLayout(
    chart: DatabaseChart,
    previous: ReadonlyMap<string, DatabaseChartLayout>,
    next: ReadonlyMap<string, DatabaseChartLayout>,
  ) {
    const before = previous.get(chart.id);
    const after = next.get(chart.id);
    if (disposed || !editable || !before || !after) return;
    if (before.w === after.w && before.h === after.h) {
      paintLayouts(previous);
      return;
    }
    const inset = Math.min(10, columnWidth / 4);
    onCommit(
      view.charts.map((entry) => ({
        ...copy(entry),
        layout: { ...next.get(entry.id)! },
        ...(entry.id === chart.id
          ? {
              width: Math.max(1, Math.round(after.w * columnWidth - inset * 2)),
              height: Math.max(1, Math.round(after.h * columnWidth - inset * 2)),
            }
          : {}),
      })),
    );
  }

  function installResize(chart: DatabaseChart, card: HTMLElement) {
    const handle = button(doc, "调整图表大小", "semlo-editor-database-chart-resize");
    handle.title = "拖动调整大小";
    card.append(handle);
    handle.addEventListener("keydown", (event) => {
      if (disposed || !editable || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      measureGrid();
      const previous = currentLayouts();
      const initial = previous?.get(chart.id);
      if (!previous || !initial || !(columnWidth > 0)) return;
      const delta = event.shiftKey ? 4 : 1;
      const widthDelta = event.key === "ArrowRight" ? delta : event.key === "ArrowLeft" ? -delta : 0;
      const heightDelta = event.key === "ArrowDown" ? delta : event.key === "ArrowUp" ? -delta : 0;
      const next = resizeChartLayouts(previous, chart.id, { w: initial.w + widthDelta, h: initial.h + heightDelta });
      commitLayout(chart, previous, next);
    });
    handle.addEventListener("pointerdown", (event) => {
      const win = doc.defaultView;
      if (disposed || !editable || !win || event.button !== 0) return;
      measureGrid();
      const previous = currentLayouts();
      const initial = previous?.get(chart.id);
      if (!previous || !initial || !(columnWidth > 0)) return;
      event.preventDefault();
      event.stopPropagation();
      cancelResize?.();
      closeAll();
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      const cellSize = columnWidth;
      let next = previous;
      let moved = false;
      card.classList.add("is-resizing");
      function finish(commit: boolean) {
        win!.removeEventListener("pointermove", move);
        win!.removeEventListener("pointerup", up);
        win!.removeEventListener("pointercancel", pointercancel);
        win!.removeEventListener("blur", cancel);
        doc.removeEventListener("keydown", keydown, true);
        cancelResize = undefined;
        card.classList.remove("is-resizing");
        if (commit && moved) commitLayout(chart, previous!, next);
        else paintLayouts(previous!);
      }
      function move(next: PointerEvent) {
        if (next.pointerId !== pointerId) return;
        const dx = next.clientX - startX;
        const dy = next.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        moved = true;
        const updated = resizeChartLayouts(previous!, chart.id, {
          w: initial!.w + Math.round(dx / cellSize),
          h: initial!.h + Math.round(dy / cellSize),
        });
        preview(updated);
      }
      function preview(value: Map<string, DatabaseChartLayout>) {
        next = value;
        paintLayouts(value);
      }
      function up(next: PointerEvent) {
        if (next.pointerId === pointerId) finish(true);
      }
      function cancel() {
        finish(false);
      }
      function pointercancel(next: PointerEvent) {
        if (next.pointerId === pointerId) finish(false);
      }
      function keydown(next: KeyboardEvent) {
        if (next.key !== "Escape") return;
        next.preventDefault();
        next.stopPropagation();
        finish(false);
      }
      cancelResize = cancel;
      win.addEventListener("pointermove", move);
      win.addEventListener("pointerup", up);
      win.addEventListener("pointercancel", pointercancel);
      win.addEventListener("blur", cancel);
      doc.addEventListener("keydown", keydown, true);
    });
  }

  const canvas = element(doc, "div", "semlo-editor-database-chart-canvas");
  canvas.setAttribute("aria-label", "图表看板");
  if (!view.charts.length) {
    const empty = element(doc, "div", "semlo-editor-database-chart-empty");
    const illustration = element(doc, "div", "semlo-editor-database-chart-empty-illustration");
    illustration.setAttribute("aria-hidden", "true");
    illustration.textContent = "▱";
    const title = element(doc, "h2");
    title.textContent = "选择一个组件，开始搭建你的数据可视化";
    const description = element(doc, "p");
    description.textContent = "可以使用柱状图、折线图、饼图等组件，组合多个组件可以更直观展示数据，方便洞察数据";
    empty.append(illustration, title, description);
    canvas.append(
      empty,
      chartChoices((kind) => openEditor(createDatabaseChart(kind, data.fields), true)),
    );
  } else {
    canvas.classList.add("is-populated");
    grid = element(doc, "div", "semlo-editor-database-chart-grid");
    for (const chart of view.charts) {
      const card = element(doc, "section", "semlo-editor-database-chart-card");
      card.setAttribute(
        "aria-label",
        `图表：${chart.title || chartKinds.find((entry) => entry.kind === chart.kind)?.label || "未命名"}`,
      );
      card.dataset.chartId = chart.id;
      cards.set(chart.id, card);
      const header = element(doc, "div", "semlo-editor-database-chart-card-header");
      const title = element(doc, "span");
      title.textContent = chart.title;
      header.append(title);
      if (editable) {
        const more = button(doc, "图表操作", "semlo-editor-database-chart-more");
        more.textContent = "⋮";
        more.addEventListener("click", () => openMenu(chart, more));
        header.append(more);
      }
      const body = element(doc, "div", "semlo-editor-database-chart-card-body");
      body.append(renderDatabaseChart(doc, data, chart, records));
      card.append(header, body);
      grid.append(card);
      if (editable) installResize(chart, card);
    }
    // Temporary geometry prevents overlaps before the observer measures the
    // attached container; it is never written to the document.
    paintLayouts(resolveChartLayouts(view.charts));
    canvas.append(grid);
  }
  container.append(canvas);
  const win = doc.defaultView;
  function onWindowResize() {
    measureGrid();
  }
  if (grid && win) {
    const Observer = win.ResizeObserver;
    if (Observer) {
      resizeObserver = new Observer(measureGrid);
      resizeObserver.observe(grid);
    } else win.addEventListener("resize", onWindowResize);
    measureFrame = win.requestAnimationFrame(() => {
      measureFrame = undefined;
      measureGrid();
    });
  }
  const destroy = (() => {
    if (disposed) return;
    disposed = true;
    cancelResize?.();
    resizeObserver?.disconnect();
    if (measureFrame !== undefined) win?.cancelAnimationFrame(measureFrame);
    win?.removeEventListener("resize", onWindowResize);
    closeAll();
    container.removeEventListener("click", stop);
    container.removeEventListener("pointerdown", stop);
  }) as DatabaseChartsHandle;
  destroy.openPicker = openPicker;
  return destroy;
}
