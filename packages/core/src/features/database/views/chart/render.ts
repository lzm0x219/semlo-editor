import { dateFromISO, toISO } from "../../../../shared/date/date-utils";
import {
  createDatabaseView,
  databaseValueText,
  visibleDatabaseRecords,
  type DatabaseChart,
  type DatabaseChartStatistic,
  type DatabaseData,
  type DatabaseField,
  type DatabaseRecord,
  type DatabaseValue,
} from "../../model";
import { calculateHeatmapCalendar } from "./heatmap";
import { calculateFunnelLevels, calculateWordcloudWords } from "./special-charts";
import { layoutWordcloud } from "./wordcloud-layout";

/** Calculated data stays separate from the document and may be reused for a live preview. */
export interface DatabaseChartBucket {
  key: string;
  label: string;
  value: number;
  recordIds: string[];
  series: { key: string; label: string; value: number }[];
}
export interface DatabaseChartResult {
  records: DatabaseRecord[];
  buckets: DatabaseChartBucket[];
  series: { key: string; label: string }[];
  value: number;
  formattedValue: string;
}

const colors = ["#7092f1", "#82d5b1", "#f6c961", "#8d9cb4", "#fa916b", "#9575de", "#58b3d9", "#e781b6"];
const funnelColors = ["#7092f1", "#82d5b1", "#8d9cb4", "#f6c961", "#fa916b", "#9575de", "#58b3d9", "#e781b6"];
const heatmapColors = ["#f4f5f5", "#daf6ea", "#c7f0df", "#82edc0", "#009456", "#00663b"];
const svgNS = "http://www.w3.org/2000/svg";

function labels(field: DatabaseField, value: DatabaseValue | undefined): { key: string; label: string }[] {
  if (field.type === "singleSelect" || field.type === "multiSelect") {
    const ids = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : typeof value === "string" && value
        ? [value]
        : [];
    return [...new Set(ids)].flatMap((id) => {
      const option = field.options.find((entry) => entry.id === id);
      return option && option.label ? [{ key: option.id, label: option.label }] : [];
    });
  }
  const label = databaseValueText(field, value);
  return label.trim() ? [{ key: label, label }] : [];
}

function numeric(value: DatabaseValue | undefined): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function statistic(records: DatabaseRecord[], field: DatabaseField | undefined, mode: DatabaseChartStatistic): number {
  if (mode === "count") return records.length;
  const values = field ? records.map((record) => databaseValueText(field, record.values[field.id])) : [];
  const filled = values.filter((value) => value.trim() !== "");
  const empty = records.length - filled.length;
  const unique = new Set(filled).size;
  const denominator = records.length || 1;
  switch (mode) {
    case "filled":
      return filled.length;
    case "empty":
      return empty;
    case "unique":
      return unique;
    case "distinct": {
      if (field && ["number", "rating", "progress"].includes(field.type)) {
        const numbers = records.flatMap((record) => {
          const value = numeric(record.values[field.id]);
          return value === undefined ? [] : [value];
        });
        return new Set(numbers).size;
      }
      return unique;
    }
    case "filledPercent":
      return (filled.length / denominator) * 100;
    case "emptyPercent":
      return (empty / denominator) * 100;
    case "uniquePercent":
      return (unique / denominator) * 100;
    case "sum":
    case "average":
    case "min":
    case "max":
    case "median": {
      const numbers = field
        ? records.flatMap((record) => {
            const value = numeric(record.values[field.id]);
            return value === undefined ? [] : [value];
          })
        : [];
      if (!numbers.length) return 0;
      if (mode === "min") return Math.min(...numbers);
      if (mode === "max") return Math.max(...numbers);
      if (mode === "median") {
        numbers.sort((left, right) => left - right);
        const middle = Math.floor(numbers.length / 2);
        return numbers.length % 2 ? numbers[middle] : numbers[middle - 1] / 2 + numbers[middle] / 2;
      }
      const sum = numbers.reduce((left, right) => left + right, 0);
      return mode === "average" ? sum / numbers.length : sum;
    }
  }
}

function formatted(value: number, precision: number, percent = false) {
  const places = Math.max(0, Math.min(10, Number.isFinite(precision) ? Math.floor(precision) : 0));
  return `${value.toLocaleString("zh-CN", { minimumFractionDigits: percent ? places : 0, maximumFractionDigits: places })}${percent ? "%" : ""}`;
}

/** Apply component filters to records already filtered by the parent view. */
export function calculateDatabaseChart(
  data: DatabaseData,
  chart: DatabaseChart,
  source: DatabaseRecord[],
): DatabaseChartResult {
  const filterView = createDatabaseView();
  filterView.filters = chart.filters;
  filterView.filterMode = chart.filterMode;
  const records = visibleDatabaseRecords({ ...data, records: source }, filterView);
  const field = data.fields.find((item) => item.id === chart.fieldId);
  const measure = data.fields.find((item) => item.id === chart.metricFieldId);
  const group = data.fields.find((item) => item.id === chart.groupFieldId);
  const numberField = field ?? measure;
  const mode = chart.statistic;
  const value = statistic(records, numberField, mode);
  const isPercent = mode === "filledPercent" || mode === "emptyPercent" || mode === "uniquePercent";
  const buckets = new Map<
    string,
    { label: string; records: DatabaseRecord[]; groups: Map<string, DatabaseRecord[]> }
  >();
  const groupLabels = new Map<string, string>();
  if (field) {
    for (const record of records) {
      let items = labels(field, record.values[field.id]);
      if (chart.kind === "heatmap") {
        const raw = record.values[field.id];
        const value = typeof raw === "string" ? raw : "";
        const timestamp = field.type === "createdTime" || field.type === "modifiedTime" ? new Date(value) : null;
        const date =
          timestamp && !Number.isNaN(timestamp.getTime()) ? toISO(timestamp) : dateFromISO(value) ? value : "";
        items = date ? [{ key: date, label: date }] : [];
      }
      for (const item of items) {
        let bucket = buckets.get(item.key);
        if (!bucket) {
          bucket = { label: item.label, records: [], groups: new Map() };
          buckets.set(item.key, bucket);
        }
        bucket.records.push(record);
        if (group) {
          const groups = labels(group, record.values[group.id]);
          for (const current of groups.length ? groups : [{ key: "", label: "（空）" }]) {
            groupLabels.set(current.key, current.label);
            const entries = bucket.groups.get(current.key) ?? [];
            entries.push(record);
            bucket.groups.set(current.key, entries);
          }
        }
      }
    }
  }
  let entries: DatabaseChartBucket[] = [...buckets].map(([key, bucket]) => ({
    key,
    label: bucket.label,
    value: statistic(bucket.records, measure, measure ? mode : "count"),
    recordIds: bucket.records.map((record) => record.id),
    series: [...bucket.groups].map(([groupKey, grouped]) => ({
      key: groupKey,
      label: groupLabels.get(groupKey) ?? "",
      value: statistic(grouped, measure, measure ? mode : "count"),
    })),
  }));
  const labelCompare = (left: DatabaseChartBucket, right: DatabaseChartBucket) =>
    left.label.localeCompare(right.label, "zh-CN");
  if (chart.sort === "text-asc") entries.sort(labelCompare);
  if (chart.sort === "text-desc") entries.sort((left, right) => labelCompare(right, left));
  if (chart.sort === "count-asc") entries.sort((left, right) => left.value - right.value);
  if (chart.sort === "count-desc") entries.sort((left, right) => right.value - left.value);
  if (chart.sort === "default" && field && (field.type === "singleSelect" || field.type === "multiSelect")) {
    const rank = new Map(field.options.map((option, index) => [option.id, index]));
    entries = entries.sort((left, right) => (rank.get(left.key) ?? Infinity) - (rank.get(right.key) ?? Infinity));
  }
  const series = group
    ? [...groupLabels].map(([key, label]) => ({ key, label }))
    : entries.map(({ key, label }) => ({ key, label }));
  // Number components have no decimal-precision control in the reference UI.
  // Keep ordinary fractional statistics readable even with the default setting.
  const valuePrecision = chart.kind === "number" && mode !== "count" ? Math.max(chart.precision, 2) : chart.precision;
  return { records, buckets: entries, series, value, formattedValue: formatted(value, valuePrecision, isPercent) };
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  doc: Document,
  tag: K,
  attributes: Record<string, string | number>,
  text?: string,
): SVGElementTagNameMap[K] {
  const element = doc.createElementNS(svgNS, tag);
  for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, String(value));
  if (text !== undefined) element.textContent = text;
  return element;
}

function legend(doc: Document, result: DatabaseChartResult, chart: DatabaseChart): HTMLElement | undefined {
  // Scatter colors identify X categories even when a separate field is used to group their values.
  const entries = chart.kind === "scatter" ? result.buckets : result.series;
  if (chart.legend === "none" || !entries.length || (chart.kind === "line" && !chart.groupFieldId)) return undefined;
  const node = doc.createElement("div");
  node.className = "semlo-editor-database-chart-legend";
  for (const [index, item] of entries.entries()) {
    const entry = doc.createElement("span");
    const swatch = doc.createElement("i");
    swatch.style.background = colors[index % colors.length];
    const label = doc.createElement("span");
    label.textContent = item.label;
    entry.append(swatch, label);
    node.append(entry);
  }
  return node;
}

function chartSvg(doc: Document, chart: DatabaseChart, result: DatabaseChartResult): SVGSVGElement {
  const svg = svgElement(doc, "svg", {
    viewBox: "0 0 320 200",
    preserveAspectRatio: chart.kind === "pie" ? "xMidYMid meet" : "none",
    role: "img",
  });
  const summary = result.buckets
    .map((bucket) => {
      const total = `${bucket.label}：${formatted(bucket.value, chart.precision)}`;
      if (!chart.groupFieldId || chart.kind === "pie" || !bucket.series.length) return total;
      const series = bucket.series.map((item) => `${item.label}：${formatted(item.value, chart.precision)}`).join("，");
      return `${total}（${series}）`;
    })
    .join("，");
  svg.setAttribute("aria-label", `${chart.title || "图表"}${summary ? `：${summary}` : "：暂无数据"}`);
  return svg;
}

interface CartesianSeriesPoint {
  category: string;
  value: number;
  /** Baseline is nonzero for a stacked area. */
  base: number;
  top: number;
}
interface CartesianSeries {
  key: string;
  points: Array<CartesianSeriesPoint | null>;
}

/** Missing group/category combinations are gaps, not zero-valued observations. */
function cartesianSeries(chart: DatabaseChart, result: DatabaseChartResult): CartesianSeries[] {
  const grouped = !!chart.groupFieldId;
  const keys = grouped ? result.series.map((item) => item.key) : [""];
  const positive = result.buckets.map(() => 0);
  const negative = result.buckets.map(() => 0);
  const stacked = chart.kind === "area" && chart.stacked;
  return keys.map((key) => ({
    key,
    points: result.buckets.map((bucket, index) => {
      const value = grouped ? bucket.series.find((item) => item.key === key)?.value : bucket.value;
      if (value === undefined) return null;
      const totals = value >= 0 ? positive : negative;
      const base = stacked ? totals[index] : 0;
      const top = base + value;
      if (stacked) totals[index] = top;
      return { category: bucket.key, value, base, top };
    }),
  }));
}

type PlotPoint = CartesianSeriesPoint & { x: number; y: number; baseY: number };

/** Break the line at missing points so neither line nor fill bridges the gap. */
function segments(points: Array<PlotPoint | null>): PlotPoint[][] {
  const groups: PlotPoint[][] = [];
  let active: PlotPoint[] = [];
  for (const point of points) {
    if (point) active.push(point);
    else if (active.length) {
      groups.push(active);
      active = [];
    }
  }
  if (active.length) groups.push(active);
  return groups;
}

function pathThrough(points: Array<{ x: number; y: number }>, smooth: boolean, first = true): string {
  if (!points.length) return "";
  let path = `${first ? "M" : "L"} ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length; index++) {
    const previous = points[index - 1];
    const next = points[index];
    if (smooth) {
      const midpoint = (previous.x + next.x) / 2;
      path += ` C ${midpoint} ${previous.y} ${midpoint} ${next.y} ${next.x} ${next.y}`;
    } else path += ` L ${next.x} ${next.y}`;
  }
  return path;
}

function cartesian(doc: Document, chart: DatabaseChart, result: DatabaseChartResult): SVGSVGElement {
  const svg = chartSvg(doc, chart, result);
  const { buckets } = result;
  const grouped = !!chart.groupFieldId;
  const lines = chart.kind === "line" || chart.kind === "area" ? cartesianSeries(chart, result) : [];
  const values = lines.length
    ? lines.flatMap((series) => series.points.flatMap((point) => (point ? [point.base, point.top] : [])))
    : buckets.flatMap((bucket) => (grouped ? bucket.series.map((item) => item.value) : [bucket.value]));
  // Scatter plots in the reference use the observed value extent rather than
  // forcing the axis through zero, unlike the column and area charts.
  const scatter = chart.kind === "scatter";
  let min = scatter && values.length ? Infinity : 0;
  let max = scatter && values.length ? -Infinity : 1;
  for (const value of values) {
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  if (max === min) {
    if (scatter) {
      const padding = Math.abs(min) || 1;
      min -= padding;
      max += padding;
    } else max = min + (Math.abs(min) || 1);
  }
  const left = 38,
    top = 12,
    width = 264,
    height = 148;
  if (!buckets.length) {
    svg.append(
      svgElement(doc, "line", {
        x1: left,
        y1: top + height,
        x2: left + width,
        y2: top + height,
        class: "semlo-editor-chart-grid-line",
      }),
      svgElement(
        doc,
        "text",
        { x: left - 7, y: top + height + 3, "text-anchor": "end", class: "semlo-editor-chart-axis-label" },
        "0",
      ),
    );
    if (scatter) {
      svg.append(
        svgElement(doc, "text", { x: left, y: top + height + 15, class: "semlo-editor-chart-axis-label" }, "0"),
        svgElement(doc, "rect", { x: 116, y: 187, width: 88, height: 8, fill: "#dcdcdc" }),
        svgElement(doc, "text", { x: 109, y: 195, "text-anchor": "end", class: "semlo-editor-chart-axis-label" }, "0"),
        svgElement(doc, "text", { x: 211, y: 195, class: "semlo-editor-chart-axis-label" }, "0"),
      );
    }
    return svg;
  }
  const range = max - min || 1;
  const y = (value: number) => top + ((max - value) / range) * height;
  for (let line = 0; line <= 4; line++) {
    const value = max - (range * line) / 4;
    const position = top + (height * line) / 4;
    svg.append(
      svgElement(doc, "line", {
        x1: left,
        y1: position,
        x2: left + width,
        y2: position,
        class: "semlo-editor-chart-grid-line",
      }),
      svgElement(
        doc,
        "text",
        { x: left - 7, y: position + 3, "text-anchor": "end", class: "semlo-editor-chart-axis-label" },
        formatted(value, 2),
      ),
    );
  }
  const band = width / Math.max(1, buckets.length);
  const bottom = y(0);
  buckets.forEach((bucket, index) => {
    const center = left + band * (index + 0.5);
    svg.append(
      svgElement(
        doc,
        "text",
        { x: center, y: top + height + 16, "text-anchor": "middle", class: "semlo-editor-chart-axis-label" },
        bucket.label,
      ),
    );
    if (chart.kind === "column") {
      const items = grouped
        ? result.series.map(
            (series) => bucket.series.find((item) => item.key === series.key) ?? { ...series, value: 0 },
          )
        : [{ key: bucket.key, label: bucket.label, value: bucket.value }];
      const itemBand = Math.min(band * 0.7, Math.max(2, chart.barWidth)) / Math.max(items.length, 1);
      items.forEach((item, itemIndex) => {
        const colorIndex = grouped
          ? Math.max(
              0,
              result.series.findIndex((series) => series.key === item.key),
            )
          : index;
        const valueY = y(item.value);
        const barHeight = Math.abs(bottom - valueY);
        const x = center - (itemBand * items.length) / 2 + itemIndex * itemBand;
        const rect = svgElement(doc, "rect", {
          x,
          y: Math.min(bottom, valueY),
          width: Math.max(1, itemBand - 1),
          height: barHeight,
          fill: colors[colorIndex % colors.length],
          "data-chart-value": item.value,
        });
        rect.append(svgElement(doc, "title", {}, `${item.label}：${formatted(item.value, chart.precision)}`));
        svg.append(rect);
        if (barHeight > 20)
          svg.append(
            svgElement(
              doc,
              "text",
              {
                x: x + itemBand / 2,
                y: Math.min(bottom, valueY) + barHeight / 2 + 4,
                "text-anchor": "middle",
                class: "semlo-editor-chart-bar-label",
              },
              formatted(item.value, chart.precision),
            ),
          );
      });
    }
    if (scatter) {
      const items = grouped ? bucket.series : [{ key: bucket.key, label: bucket.label, value: bucket.value }];
      for (const item of items) {
        const dot = svgElement(doc, "circle", {
          cx: center,
          cy: y(item.value),
          r: 4,
          fill: colors[index % colors.length],
          "data-chart-category": bucket.key,
          "data-chart-series": item.key,
          "data-chart-value": item.value,
        });
        dot.append(svgElement(doc, "title", {}, `${item.label}：${formatted(item.value, chart.precision)}`));
        svg.append(dot);
      }
    }
  });
  if (chart.kind === "line" || chart.kind === "area") {
    lines.forEach((series, seriesIndex) => {
      const points = series.points.map((point, index): PlotPoint | null =>
        point ? { ...point, x: left + band * (index + 0.5), y: y(point.top), baseY: y(point.base) } : null,
      );
      const color = colors[seriesIndex % colors.length];
      for (const run of segments(points)) {
        if (run.length > 1) {
          const upper = run.map((point) => ({ x: point.x, y: point.y }));
          const lower = [...run].reverse().map((point) => ({ x: point.x, y: point.baseY }));
          if (chart.kind === "area") {
            const fill = svgElement(doc, "path", {
              d: `${pathThrough(upper, chart.smooth)} ${pathThrough(lower, chart.smooth, false)} Z`,
              fill: color,
              opacity: 0.2,
              "data-chart-series": series.key,
              "data-chart-area": "true",
            });
            svg.append(fill);
          }
          svg.append(
            svgElement(doc, "path", {
              d: pathThrough(upper, chart.smooth),
              fill: "none",
              stroke: color,
              "stroke-width": 2,
              "data-chart-series": series.key,
              "data-chart-line": "true",
            }),
          );
        }
        // A continuous line has no permanent dots in the reference view. Keep
        // an isolated point visible when a series has no line segment.
        if (chart.kind !== "line" || run.length === 1)
          for (const point of run)
            svg.append(
              svgElement(doc, "circle", {
                cx: point.x,
                cy: point.y,
                r: chart.kind === "line" ? 2 : 3,
                fill: color,
                "data-chart-series": series.key,
                "data-chart-category": point.category,
                "data-chart-value": point.value,
                "data-chart-stack-base": point.base,
              }),
            );
      }
    });
  }
  return svg;
}

function horizontalBars(doc: Document, chart: DatabaseChart, result: DatabaseChartResult): SVGSVGElement {
  const svg = chartSvg(doc, chart, result);
  const { buckets } = result;
  const grouped = !!chart.groupFieldId;
  const values = buckets.flatMap((bucket) => (grouped ? bucket.series.map((item) => item.value) : [bucket.value]));
  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values, 1);
  const left = 78,
    top = 12,
    width = 224,
    height = 148;
  if (!buckets.length) {
    svg.append(
      svgElement(doc, "line", { x1: left, y1: top, x2: left, y2: top + height, class: "semlo-editor-chart-grid-line" }),
      svgElement(
        doc,
        "text",
        { x: left, y: top + height + 15, "text-anchor": "middle", class: "semlo-editor-chart-axis-label" },
        "0",
      ),
    );
    return svg;
  }
  const range = max - min || 1;
  const x = (value: number) => left + ((value - min) / range) * width;
  const zero = x(0);
  for (let line = 0; line <= 4; line++) {
    const value = min + (range * line) / 4;
    const position = left + (width * line) / 4;
    svg.append(
      svgElement(doc, "line", {
        x1: position,
        y1: top,
        x2: position,
        y2: top + height,
        class: "semlo-editor-chart-grid-line",
      }),
      svgElement(
        doc,
        "text",
        { x: position, y: top + height + 15, "text-anchor": "middle", class: "semlo-editor-chart-axis-label" },
        formatted(value, 2),
      ),
    );
  }
  const band = height / Math.max(1, buckets.length);
  buckets.forEach((bucket, index) => {
    const center = top + band * (index + 0.5);
    svg.append(
      svgElement(
        doc,
        "text",
        { x: left - 8, y: center + 3, "text-anchor": "end", class: "semlo-editor-chart-axis-label" },
        bucket.label,
      ),
    );
    const items: { key: string; label: string; value?: number }[] = grouped
      ? result.series.map((series) => bucket.series.find((item) => item.key === series.key) ?? series)
      : [{ key: bucket.key, label: bucket.label, value: bucket.value }];
    const itemBand = Math.min(band * 0.7, Math.max(2, chart.barWidth)) / Math.max(items.length, 1);
    items.forEach((item, itemIndex) => {
      if (item.value === undefined) return;
      const colorIndex = grouped
        ? Math.max(
            0,
            result.series.findIndex((series) => series.key === item.key),
          )
        : index;
      const end = x(item.value);
      const barWidth = Math.abs(zero - end);
      const y = center - (itemBand * items.length) / 2 + itemIndex * itemBand;
      const rect = svgElement(doc, "rect", {
        x: Math.min(zero, end),
        y,
        width: barWidth,
        height: Math.max(1, itemBand - 1),
        fill: colors[colorIndex % colors.length],
        "data-chart-value": item.value,
        "data-chart-category": bucket.key,
        "data-chart-series": item.key,
      });
      rect.append(svgElement(doc, "title", {}, `${item.label}：${formatted(item.value, chart.precision)}`));
      svg.append(rect);
    });
  });
  return svg;
}

function pie(doc: Document, chart: DatabaseChart, result: DatabaseChartResult): SVGSVGElement {
  const svg = chartSvg(doc, chart, result);
  const values = result.buckets.map((bucket) => Math.max(0, bucket.value));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!total) return svg;
  const cx = 160,
    cy = 95,
    radius = 78;
  let angle = -Math.PI / 2;
  result.buckets.forEach((bucket, index) => {
    const portion = values[index] / total;
    if (!portion) return;
    const end = angle + portion * 2 * Math.PI;
    const point = (at: number) => `${cx + radius * Math.cos(at)} ${cy + radius * Math.sin(at)}`;
    const shape =
      portion >= 1 - 1e-9
        ? svgElement(doc, "circle", { cx, cy, r: radius, fill: colors[index % colors.length] })
        : svgElement(doc, "path", {
            d: `M ${cx} ${cy} L ${point(angle)} A ${radius} ${radius} 0 ${portion > 0.5 ? 1 : 0} 1 ${point(end)} Z`,
            fill: colors[index % colors.length],
            stroke: "#fff",
            "stroke-width": 1,
          });
    shape.append(
      svgElement(
        doc,
        "title",
        {},
        `${bucket.label}：${formatted(bucket.value, chart.precision)}（${formatted(portion * 100, chart.precision, true)}）`,
      ),
    );
    svg.append(shape);
    if (portion >= 0.035) {
      const middle = angle + (end - angle) / 2;
      svg.append(
        svgElement(
          doc,
          "text",
          {
            x: cx + radius * 0.6 * Math.cos(middle),
            y: cy + radius * 0.6 * Math.sin(middle) + 4,
            "text-anchor": "middle",
            class: "semlo-editor-chart-bar-label",
          },
          formatted(portion * 100, chart.precision, true),
        ),
      );
    }
    angle = end;
  });
  return svg;
}

function funnel(doc: Document, chart: DatabaseChart, result: DatabaseChartResult): SVGSVGElement {
  const levels = calculateFunnelLevels(result.buckets, chart.funnelOrder ?? [], chart.funnelCumulative ?? true);
  const summary = levels.map((level) => `${level.label}：${formatted(level.value, chart.precision)}`).join("，");
  const svg = svgElement(doc, "svg", {
    role: "img",
    "aria-label": `${chart.title || "漏斗图"}：${summary || "暂无数据"}`,
  });
  if (!levels.length) return svg;

  const maximum = Math.max(0, ...levels.map((level) => level.value));
  const maxWidth = 218;
  const center = maxWidth / 2;
  const layerHeight = 170 / levels.length;
  const layerWidth = (value: number) => (maximum ? (Math.max(0, value) / maximum) * maxWidth : 0);
  // The reference keeps a 90px margin on either side as the card or dialog
  // grows. A nested viewport lets the funnel use the remaining width without
  // measuring the DOM or registering a resize listener.
  const viewport = {
    x: "min(90px, 50%)",
    y: 15,
    width: "max(1px, calc(100% - 180px))",
    height: "max(1px, calc(100% - 30px))",
  };
  const labelArea = svgElement(doc, "foreignObject", viewport);
  const frame = doc.createElement("div");
  frame.className = "semlo-editor-chart-funnel-viewport";
  const shapes = svgElement(doc, "svg", {
    width: "100%",
    height: "100%",
    viewBox: "0 0 218 170",
    preserveAspectRatio: "none",
    "aria-hidden": "true",
    class: "semlo-editor-chart-funnel-shapes",
  });
  const labels = doc.createElement("div");
  labels.className = "semlo-editor-chart-funnel-labels";
  frame.append(shapes, labels);
  labelArea.append(frame);
  const guideArea = svgElement(doc, "foreignObject", {
    x: 0,
    y: 0,
    width: "100%",
    height: "100%",
    "aria-hidden": "true",
    "pointer-events": "none",
  });
  const guides = doc.createElement("div");
  guides.className = "semlo-editor-chart-funnel-guides";
  guideArea.append(guides);
  levels.forEach((level, index) => {
    const next = levels[index + 1];
    const upper = layerWidth(level.value);
    const lower = layerWidth(next?.value ?? level.value);
    const y = index * layerHeight;
    const polygon = svgElement(doc, "polygon", {
      points: `${center - upper / 2},${y} ${center + upper / 2},${y} ${center + lower / 2},${y + layerHeight} ${center - lower / 2},${y + layerHeight}`,
      fill: funnelColors[index % funnelColors.length],
      "data-chart-category": level.key,
      "data-chart-value": level.value,
      "data-chart-raw-value": level.rawValue,
    });
    polygon.append(svgElement(doc, "title", {}, `${level.label}：${formatted(level.value, chart.precision)}`));
    shapes.append(polygon);
    if (Math.max(upper, lower) > 0) {
      const label = doc.createElement("div");
      label.className = "semlo-editor-chart-funnel-label";
      label.dataset.chartLabel = level.key;
      label.style.top = `${(index / levels.length) * 100}%`;
      label.style.height = `${100 / levels.length}%`;
      label.style.width = `max(0px, calc(${(((upper + lower) / 2) * 100) / maxWidth}% - 8px))`;
      const text = doc.createElement("span");
      text.textContent = `${level.label} ${formatted(level.value, chart.precision)}`;
      label.append(text);
      labels.append(label);
    }
    if (next && maximum > 0) {
      const position = (index + 1) / levels.length;
      const nextRatio = Math.max(0, next.value) / maximum;
      const seam = `calc(${position * 100}% + 15px - ${position * 30}px)`;
      const guide = doc.createElement("div");
      guide.className = "semlo-editor-chart-funnel-guide";
      guide.style.left = `calc(${50 + nextRatio * 50}% - ${nextRatio * 90}px + 2px)`;
      guide.style.top = seam;
      const percent = doc.createElement("div");
      percent.className = "semlo-editor-chart-funnel-percent";
      percent.dataset.chartPercent = next.key;
      percent.style.top = seam;
      percent.textContent = formatted(nextRatio * 100, 0, true);
      guides.append(guide, percent);
    }
  });
  svg.append(labelArea, guideArea);
  return svg;
}

function wordcloud(
  doc: Document,
  data: DatabaseData,
  chart: DatabaseChart,
  result: DatabaseChartResult,
): SVGSVGElement {
  const fieldType = data.fields.find((field) => field.id === chart.fieldId)?.type;
  const words = calculateWordcloudWords(
    result.buckets,
    fieldType,
    chart.wordcloudMaxWords ?? 20,
    chart.wordcloudExclude ?? "",
  );
  const summary = words.map((word) => `${word.label}：${formatted(word.value, chart.precision)}`).join("，");
  const svg = svgElement(doc, "svg", {
    viewBox: "0 0 320 200",
    preserveAspectRatio: "xMidYMid meet",
    role: "img",
    "aria-label": `${chart.title || "词云"}：${summary || "暂无数据"}`,
  });
  if (!words.length) return svg;

  // Canvas uses the same system font as the SVG. Its measurement works even
  // when the chart is mounted in a hidden editor or before it has a size.
  let context: CanvasRenderingContext2D | null = null;
  try {
    context = doc.createElement("canvas").getContext("2d");
  } catch {
    // A DOM implementation without canvas support can still render the chart.
  }
  const measure = (label: string, fontSize: number) => {
    if (!context) return Array.from(label).length * fontSize;
    context.font = `500 ${fontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
    return context.measureText(label).width;
  };
  const placement = layoutWordcloud(words, chart.wordcloudShape ?? "cloud", measure);
  for (const [index, word] of placement.entries()) {
    const text = svgElement(
      doc,
      "text",
      {
        x: word.x,
        y: word.y,
        "text-anchor": "middle",
        "dominant-baseline": "central",
        "font-size": word.fontSize,
        transform: `rotate(${word.rotation} ${word.x} ${word.y})`,
        fill: colors[index % colors.length],
        class: "semlo-editor-chart-wordcloud-word",
        "data-chart-word": word.key,
        "data-chart-value": word.value,
      },
      word.label,
    );
    text.append(svgElement(doc, "title", {}, `${word.label}：${formatted(word.value, chart.precision)}`));
    svg.append(text);
  }
  return svg;
}

function heatmap(doc: Document, chart: DatabaseChart, result: DatabaseChartResult): HTMLElement {
  const weeks = calculateHeatmapCalendar(result.buckets, chart.heatmapWeeks, chart.heatmapMax);
  const days = weeks.flat();
  const summary = days
    .filter((day) => day.value !== null)
    .map((day) => `${day.date}：${formatted(day.value!, 10)}`)
    .join("，");
  const scroll = doc.createElement("div");
  scroll.className = "semlo-editor-database-heatmap-scroll";
  const svg = svgElement(doc, "svg", {
    width: weeks.length * 19 - 5,
    height: 151,
    viewBox: `0 0 ${weeks.length * 19 - 5} 151`,
    role: "img",
    "aria-label": `${chart.title || "热力图"}：${summary || "暂无数据"}`,
  });
  svg.classList.add("semlo-editor-database-heatmap-svg");
  weeks.forEach((week, column) => {
    week.forEach((day, row) => {
      const box = svgElement(doc, "rect", {
        x: column * 19,
        y: row * 19,
        width: 14,
        height: 14,
        rx: 2,
        fill: day.level < 0 ? "#fff" : heatmapColors[day.level],
        stroke: day.level < 0 ? "#f1f2f2" : "none",
        "data-date": day.date,
        "data-level": day.level,
        ...(day.value !== null ? { "data-value": day.value } : {}),
      });
      box.append(
        svgElement(doc, "title", {}, `${day.date}：${day.value === null ? "暂无数据" : formatted(day.value, 10)}`),
      );
      svg.append(box);
      if (day.date.endsWith("-01"))
        svg.append(
          svgElement(
            doc,
            "text",
            {
              x: column === weeks.length - 1 ? weeks.length * 19 - 5 : column * 19,
              y: 145,
              "text-anchor": column === weeks.length - 1 ? "end" : "start",
              class: "semlo-editor-database-heatmap-month",
              "data-month": day.date.slice(0, 7),
            },
            `${Number(day.date.slice(5, 7))}月`,
          ),
        );
    });
  });
  scroll.append(svg);
  return scroll;
}

/** Render a read-only chart without attaching global listeners or retaining a node view. */
export function renderDatabaseChart(
  doc: Document,
  data: DatabaseData,
  chart: DatabaseChart,
  records: DatabaseRecord[],
): HTMLElement {
  const result = calculateDatabaseChart(data, chart, records);
  const root = doc.createElement("div");
  root.className = "semlo-editor-database-chart-render";
  root.dataset.chartKind = chart.kind;
  root.dataset.chartLegend = chart.legend;
  if (chart.kind === "number") {
    const value = doc.createElement("div");
    value.className = "semlo-editor-database-chart-number";
    value.style.color = chart.color;
    value.textContent = result.formattedValue;
    root.append(value);
    if (chart.description) {
      const description = doc.createElement("div");
      description.className = "semlo-editor-database-chart-number-description";
      description.textContent = chart.description;
      root.append(description);
    }
    root.setAttribute("role", "img");
    root.setAttribute(
      "aria-label",
      `${chart.title || "统计数字"}：${result.formattedValue}${chart.description ? `，${chart.description}` : ""}`,
    );
    return root;
  }
  if (chart.kind === "heatmap") {
    root.append(heatmap(doc, chart, result));
    return root;
  }
  if (chart.kind === "funnel" || chart.kind === "wordcloud") {
    const graphic = chart.kind === "funnel" ? funnel(doc, chart, result) : wordcloud(doc, data, chart, result);
    graphic.classList.add("semlo-editor-database-chart-svg");
    root.append(graphic);
    return root;
  }
  if (!["column", "bar", "area", "line", "pie", "scatter"].includes(chart.kind)) {
    const unsupported = doc.createElement("span");
    unsupported.className = "semlo-editor-database-chart-unsupported";
    unsupported.textContent = "此图表类型尚未实现";
    root.append(unsupported);
    return root;
  }
  const graphic =
    chart.kind === "pie"
      ? pie(doc, chart, result)
      : chart.kind === "bar"
        ? horizontalBars(doc, chart, result)
        : cartesian(doc, chart, result);
  graphic.classList.add("semlo-editor-database-chart-svg");
  const labels = legend(doc, result, chart);
  if (labels && (chart.legend === "top" || chart.legend === "left")) root.append(labels);
  root.append(graphic);
  if (labels && (chart.legend === "bottom" || chart.legend === "right")) root.append(labels);
  return root;
}
