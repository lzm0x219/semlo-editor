import { ContentValidationError } from "../../shared/content-error";

/** The data table is stored in the document, independent of the editor UI. */
export const databaseFieldTypes = [
  "text",
  "number",
  "singleSelect",
  "multiSelect",
  "person",
  "image",
  "attachment",
  "date",
  "createdTime",
  "modifiedTime",
  "createdBy",
  "modifiedBy",
  "checkbox",
  "link",
  "email",
  "phone",
  "rating",
  "progress",
] as const;
export type DatabaseFieldType = (typeof databaseFieldTypes)[number];
export interface DatabaseFile {
  id: string;
  name: string;
  url: string;
  size: number;
  mimeType: string;
}
export interface DatabaseActor {
  id: string;
  label: string;
}
export type DatabaseValue = string | boolean | string[] | DatabaseFile[] | DatabaseActor;

export interface DatabaseOption {
  id: string;
  label: string;
  color: number;
  externalId?: string;
}
export interface DatabaseField {
  id: string;
  name: string;
  type: DatabaseFieldType;
  options: DatabaseOption[];
  defaultValue: DatabaseValue;
  timeFormat?: DatabaseTimeFormat;
}
export const databaseTimeFormats = [
  "datetimeSeconds",
  "datetime",
  "date",
  "slashDatetime",
  "slashDate",
  "monthDay",
  "time",
  "year",
  "yearMonth",
] as const;
export type DatabaseTimeFormat = (typeof databaseTimeFormats)[number];
export interface DatabaseRecord {
  id: string;
  createdAt?: string;
  modifiedAt?: string;
  createdBy?: DatabaseActor;
  modifiedBy?: DatabaseActor;
  values: Record<string, DatabaseValue>;
}
export type DatabaseFilterOperator =
  | "startsWith"
  | "notStartsWith"
  | "endsWith"
  | "notEndsWith"
  | "contains"
  | "notContains"
  | "equals"
  | "notEquals"
  | "greater"
  | "less"
  | "empty"
  | "notEmpty";
export interface DatabaseFilter {
  id: string;
  fieldId: string;
  operator: DatabaseFilterOperator;
  value: string;
  /** Stable selected option identity; absent on legacy text filters. */
  optionId?: string;
}
export interface DatabaseSort {
  fieldId: string;
  direction: "asc" | "desc";
}
export type DatabaseStatistic =
  | "none"
  | "count"
  | "empty"
  | "notEmpty"
  | "unique"
  | "emptyPercent"
  | "notEmptyPercent"
  | "uniquePercent"
  | "sum"
  | "average"
  | "median"
  | "maximum"
  | "minimum"
  | "earliestDate"
  | "latestDate"
  | "dateRangeDays"
  | "dateRangeMonths";
export interface DatabaseCalendarSettings {
  titleFieldId: string;
  startFieldId: string;
  endFieldId: string;
  /** Empty means the calendar uses its chosen custom color. */
  colorFieldId: string;
  color: number;
  showLunar: boolean;
  sundayFirst: boolean;
}
export const databaseChartKinds = [
  "column",
  "bar",
  "area",
  "line",
  "pie",
  "funnel",
  "scatter",
  "heatmap",
  "number",
  "wordcloud",
] as const;
export type DatabaseChartKind = (typeof databaseChartKinds)[number];
export type DatabaseChartSort = "default" | "text-asc" | "text-desc" | "count-asc" | "count-desc";
export type DatabaseChartStatistic =
  | "count"
  | "filled"
  | "empty"
  | "unique"
  | "filledPercent"
  | "emptyPercent"
  | "uniquePercent"
  | "sum"
  | "average"
  | "min"
  | "max"
  | "median"
  | "distinct";
export type DatabaseChartLegend = "top" | "bottom" | "left" | "right" | "none";
export type DatabaseWordcloudShape = "cloud" | "circle" | "ellipse";
export const databaseChartGridColumns = 12;
export const databaseChartGridMaxY = 100_000;
export const databaseChartGridMaxHeight = 500;
/** Coordinates in the chart dashboard's twelve-column grid. */
export interface DatabaseChartLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** Each chart has its own configuration while sharing this database's records. */
export interface DatabaseChart {
  id: string;
  kind: DatabaseChartKind;
  title: string;
  /** Dimension field, or the field measured by a number component. */
  fieldId: string;
  /** Empty means the number of records, otherwise the selected measure field. */
  metricFieldId: string;
  statistic: DatabaseChartStatistic;
  groupFieldId: string;
  sort: DatabaseChartSort;
  filters: DatabaseFilter[];
  filterMode: "and" | "or";
  legend: DatabaseChartLegend;
  stacked: boolean;
  smooth: boolean;
  barWidth: number;
  heatmapWeeks: number;
  heatmapMax: number;
  /** Funnel layer ordering uses the dimension bucket's stable key. */
  funnelCumulative: boolean;
  funnelOrder: string[];
  wordcloudShape: DatabaseWordcloudShape;
  wordcloudMaxWords: number;
  wordcloudExclude: string;
  precision: number;
  description: string;
  color: string;
  /** Saved component dimensions in CSS pixels. */
  /** Assigned when the chart is placed on the grid. */
  layout?: DatabaseChartLayout;
}
export interface DatabaseView {
  id: string;
  name: string;
  kind: "table" | "gallery" | "kanban" | "calendar" | "chart";
  hiddenFields: string[];
  fieldOrder: string[];
  recordOrder: string[];
  showFieldNames: boolean;
  filters: DatabaseFilter[];
  filterMode: "and" | "or";
  sorts: DatabaseSort[];
  groupFieldId: string;
  groupDirection: "asc" | "desc";
  boardOrder: string[];
  rowHeight: "small" | "medium" | "large";
  statistics: Record<string, DatabaseStatistic>;
  calendar: DatabaseCalendarSettings;
  charts: DatabaseChart[];
}
export interface DatabaseData {
  id: string;
  fields: DatabaseField[];
  records: DatabaseRecord[];
  views: DatabaseView[];
  activeViewId: string;
}

const operators: DatabaseFilterOperator[] = [
  "startsWith",
  "notStartsWith",
  "endsWith",
  "notEndsWith",
  "contains",
  "notContains",
  "equals",
  "notEquals",
  "greater",
  "less",
  "empty",
  "notEmpty",
];
const statistics: DatabaseStatistic[] = [
  "none",
  "count",
  "empty",
  "notEmpty",
  "unique",
  "emptyPercent",
  "notEmptyPercent",
  "uniquePercent",
  "sum",
  "average",
  "median",
  "maximum",
  "minimum",
  "earliestDate",
  "latestDate",
  "dateRangeDays",
  "dateRangeMonths",
];
const chartSorts: DatabaseChartSort[] = ["default", "text-asc", "text-desc", "count-asc", "count-desc"];
const chartStatistics: DatabaseChartStatistic[] = [
  "count",
  "filled",
  "empty",
  "unique",
  "filledPercent",
  "emptyPercent",
  "uniquePercent",
  "sum",
  "average",
  "min",
  "max",
  "median",
  "distinct",
];
const chartLegends: DatabaseChartLegend[] = ["top", "bottom", "left", "right", "none"];
let sequence = 0;
export function createDatabaseId(prefix = "db"): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${(++sequence).toString(36)}`}`;
}

export function createDatabaseField(name: string, type: DatabaseFieldType = "text"): DatabaseField {
  return {
    id: createDatabaseId("field"),
    name,
    type,
    options: [],
    defaultValue:
      type === "checkbox" ? false : ["multiSelect", "person", "image", "attachment"].includes(type) ? [] : "",
  };
}
export function createDatabaseRecord(fields: DatabaseField[], actor?: DatabaseActor | null): DatabaseRecord {
  const createdAt = new Date().toISOString();
  const user = normalizeDatabaseActor(actor);
  return {
    id: createDatabaseId("record"),
    createdAt,
    modifiedAt: createdAt,
    ...(user ? { createdBy: user, modifiedBy: user } : {}),
    values: Object.fromEntries(
      fields.map((field) => [
        field.id,
        field.type === "createdBy" || field.type === "modifiedBy"
          ? (user ?? "")
          : field.type === "createdTime" || field.type === "modifiedTime"
            ? createdAt
            : structuredClone(field.defaultValue),
      ]),
    ),
  };
}
/** Initial fields follow the defaults of each supported chart configuration. */
export function createDatabaseChart(kind: DatabaseChartKind, fields: DatabaseField[]): DatabaseChart {
  const area = kind === "area";
  const heatmap = kind === "heatmap";
  const areaText = fields.find((field) => field.type === "text") ?? fields[0];
  const dimension = heatmap
    ? fields.find((field) => field.type === "date")
    : area
      ? (fields.find((field) => field.type === "date") ??
        fields.find((field) => field.type === "text" || field.type === "singleSelect"))
      : kind === "number"
        ? fields[0]
        : (fields.find((field) => field.type === "singleSelect") ?? fields[0]);
  return {
    id: createDatabaseId("chart"),
    kind,
    title: "",
    fieldId: dimension?.id ?? "",
    metricFieldId: area ? (areaText?.id ?? "") : "",
    statistic: "count",
    groupFieldId: area ? (areaText?.id ?? "") : "",
    sort: "default",
    filters: [],
    filterMode: "and",
    legend: area ? "right" : "bottom",
    stacked: area,
    smooth: false,
    barWidth: 40,
    heatmapWeeks: 52,
    heatmapMax: 100,
    funnelCumulative: true,
    funnelOrder: [],
    wordcloudShape: "cloud",
    wordcloudMaxWords: 20,
    wordcloudExclude: "",
    precision: 0,
    description: "",
    color: "#262626",
  };
}
export function createDatabaseView(name = "表格视图", kind: DatabaseView["kind"] = "table"): DatabaseView {
  return {
    id: createDatabaseId("view"),
    name,
    kind,
    hiddenFields: [],
    fieldOrder: [],
    recordOrder: [],
    showFieldNames: false,
    filters: [],
    filterMode: "and",
    sorts: [],
    groupFieldId: "",
    groupDirection: "asc",
    boardOrder: [],
    rowHeight: "small",
    statistics: {},
    calendar: {
      titleFieldId: "",
      startFieldId: "",
      endFieldId: "",
      colorFieldId: "",
      color: 0,
      showLunar: false,
      sundayFirst: false,
    },
    charts: [],
  };
}
export function createDatabaseData(actor?: DatabaseActor | null): DatabaseData {
  const fields = [
    createDatabaseField("文本"),
    createDatabaseField("单选", "singleSelect"),
    createDatabaseField("日期", "date"),
  ];
  fields[1].options = ["待开始", "进行中", "已完成"].map((label, color) => ({
    id: createDatabaseId("option"),
    label,
    color,
  }));
  const view = createDatabaseView();
  return {
    id: createDatabaseId(),
    fields,
    records: Array.from({ length: 3 }, () => createDatabaseRecord(fields, actor)),
    views: [view],
    activeViewId: view.id,
  };
}

export class DatabaseContentError extends ContentValidationError {
  constructor(reason: string) {
    super(`数据表内容无效：${reason}`);
    this.name = "DatabaseContentError";
  }
}

export const databaseLimits = {
  fields: 200,
  records: 10_000,
  views: 100,
  options: 200,
  selections: 100,
  files: 100,
  filters: 50,
  sorts: 50,
  charts: 100,
  funnelOrder: 10_000,
  text: 10_000,
} as const;

function boundedItems<T>(items: T[], limit: number, name: string): T[] {
  if (items.length > limit) throw new DatabaseContentError(`${name}不能超过 ${limit} 项`);
  return items;
}

const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const str = (value: unknown, limit = 1000): string => {
  if (typeof value !== "string") return "";
  if (value.length > limit) throw new DatabaseContentError(`文本长度不能超过 ${limit} 个字符`);
  return value;
};
export function normalizeDatabaseActor(value: unknown): DatabaseActor | null {
  const actor = object(value);
  const id = str(actor.id, 500).trim();
  const label = str(actor.label, 200).trim();
  return id && label ? { id, label } : null;
}
const safeId = (value: unknown, fallback: string): string => {
  const id = str(value, 100);
  return /^[a-zA-Z0-9_-]+$/.test(id) ? id : fallback;
};
function valueFor(value: unknown, type: DatabaseFieldType): DatabaseValue {
  if (type === "checkbox") return value === true;
  if (type === "createdBy" || type === "modifiedBy") return normalizeDatabaseActor(value) ?? "";
  if (type === "image" || type === "attachment") return databaseFiles(value);
  if (type === "multiSelect" || type === "person")
    return Array.isArray(value)
      ? boundedItems(value, databaseLimits.selections, "选中项")
          .filter((item): item is string => typeof item === "string")
          .map((item) => str(item, 100))
      : [];
  return typeof value === "number" && Number.isFinite(value) ? String(value) : str(value, databaseLimits.text);
}
export function databaseFiles(value: unknown): DatabaseFile[] {
  if (!Array.isArray(value)) return [];
  const ids = new Set<string>();
  return boundedItems(value, databaseLimits.files, "文件").flatMap((entry, index) => {
    const file = object(entry);
    const url = str(file.url, 10000).trim();
    let valid = url.startsWith("/") && !url.startsWith("//");
    if (!valid) {
      try {
        valid = ["http:", "https:", "blob:"].includes(new URL(url).protocol);
      } catch {
        /* invalid URL */
      }
    }
    if (!valid) return [];
    return [
      {
        id: uniqueId(file.id, `file-${index}`, ids),
        name: str(file.name, 500) || "未命名文件",
        url,
        size: typeof file.size === "number" && Number.isFinite(file.size) ? Math.max(0, file.size) : 0,
        mimeType: str(file.mimeType, 200),
      },
    ];
  });
}
function uniqueId(value: unknown, fallback: string, used: Set<string>): string {
  let id = safeId(value, fallback);
  while (used.has(id)) id += "-copy";
  used.add(id);
  return id;
}
function normalizeFilters(value: unknown, fieldIds: Set<string>): DatabaseFilter[] {
  return boundedItems(Array.isArray(value) ? value : [], databaseLimits.filters, "筛选条件").flatMap(
    (entry, index): DatabaseFilter[] => {
      const filter = object(entry);
      const fieldId = str(filter.fieldId, 100);
      if (!fieldIds.has(fieldId)) return [];
      return [
        {
          id: safeId(filter.id, `filter-${index}`),
          fieldId,
          operator: operators.includes(filter.operator as DatabaseFilterOperator)
            ? (filter.operator as DatabaseFilterOperator)
            : "startsWith",
          value: str(filter.value, 10000),
          ...(typeof filter.optionId === "string" && filter.optionId ? { optionId: str(filter.optionId, 100) } : {}),
        },
      ];
    },
  );
}
function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

function heatmapWeeks(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(4, Math.min(52, Math.round(value))) : 52;
}

function heatmapMax(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 100;
}

function funnelOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      boundedItems(value, databaseLimits.funnelOrder, "漏斗顺序").filter((key): key is string => {
        if (typeof key !== "string") return false;
        str(key, databaseLimits.text);
        return true;
      }),
    ),
  ];
}

function wordcloudShape(value: unknown): DatabaseWordcloudShape {
  return value === "circle" || value === "ellipse" ? value : "cloud";
}

function wordcloudMaxWords(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.min(100, Math.round(value))) : 20;
}

/** Reject malformed grid data while leaving older pixel-only charts untouched. */
export function normalizeDatabaseChartLayout(value: unknown): DatabaseChartLayout | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const layout = object(value);
  const x = boundedInteger(layout.x, -1, 0, databaseChartGridColumns - 1);
  const y = boundedInteger(layout.y, -1, 0, databaseChartGridMaxY);
  const w = boundedInteger(layout.w, -1, 1, databaseChartGridColumns);
  const h = boundedInteger(layout.h, -1, 1, databaseChartGridMaxHeight);
  return x < 0 || y < 0 || w < 0 || h < 0 || x + w > databaseChartGridColumns ? undefined : { x, y, w, h };
}

/** Validate imported data before using it for controls, CSS or DOM attributes. */
export function normalizeDatabaseData(value: unknown): DatabaseData {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DatabaseContentError("缺少有效的数据载荷");
  const data = object(value);
  if (!Array.isArray(data.fields) || !Array.isArray(data.records) || !Array.isArray(data.views))
    throw new DatabaseContentError("字段、记录或视图结构无效");
  const fieldIds = new Set<string>();
  const fields = boundedItems(Array.isArray(data.fields) ? data.fields : [], databaseLimits.fields, "字段").map(
    (entry, index): DatabaseField => {
      const field = object(entry);
      const type = databaseFieldTypes.includes(field.type as DatabaseFieldType)
        ? (field.type as DatabaseFieldType)
        : "text";
      const optionIds = new Set<string>();
      const options = boundedItems(
        Array.isArray(field.options) ? field.options : [],
        databaseLimits.options,
        "字段选项",
      ).map((entry, optionIndex) => {
        const option = object(entry);
        return {
          id: uniqueId(option.id, `option-${optionIndex}`, optionIds),
          label: str(option.label, 200),
          ...(type === "person" && typeof option.externalId === "string"
            ? { externalId: str(option.externalId, 500) }
            : {}),
          color:
            Number.isInteger(option.color) && Number(option.color) >= 0 && Number(option.color) < 8
              ? Number(option.color)
              : optionIndex % 8,
        };
      });
      return {
        id: uniqueId(field.id, `field-${index}`, fieldIds),
        name: str(field.name, 200) || "未命名列",
        type,
        options,
        defaultValue: valueFor(field.defaultValue, type),
        ...(type === "createdTime" || type === "modifiedTime"
          ? {
              timeFormat: databaseTimeFormats.includes(field.timeFormat as DatabaseTimeFormat)
                ? (field.timeFormat as DatabaseTimeFormat)
                : ("datetimeSeconds" as const),
            }
          : {}),
      };
    },
  );
  const recordIds = new Set<string>();
  const records = boundedItems(Array.isArray(data.records) ? data.records : [], databaseLimits.records, "记录").map(
    (entry, index): DatabaseRecord => {
      const record = object(entry);
      const values = object(record.values);
      const createdBy = normalizeDatabaseActor(record.createdBy);
      const modifiedBy = normalizeDatabaseActor(record.modifiedBy);
      const createdAt =
        typeof record.createdAt === "string" && !Number.isNaN(Date.parse(record.createdAt))
          ? new Date(record.createdAt).toISOString()
          : undefined;
      const modifiedAt =
        typeof record.modifiedAt === "string" && !Number.isNaN(Date.parse(record.modifiedAt))
          ? new Date(record.modifiedAt).toISOString()
          : undefined;
      return {
        id: uniqueId(record.id, `record-${index}`, recordIds),
        ...(createdBy ? { createdBy } : {}),
        ...(modifiedBy ? { modifiedBy } : {}),
        ...(createdAt ? { createdAt } : {}),
        ...(modifiedAt ? { modifiedAt } : {}),
        values: Object.fromEntries(
          fields.map((field) => [
            field.id,
            valueFor(
              field.type === "createdBy"
                ? (createdBy ?? values[field.id])
                : field.type === "modifiedBy"
                  ? (modifiedBy ?? values[field.id])
                  : field.type === "createdTime"
                    ? (createdAt ?? values[field.id])
                    : field.type === "modifiedTime"
                      ? (modifiedAt ?? values[field.id])
                      : values[field.id],
              field.type,
            ),
          ]),
        ),
      };
    },
  );
  const viewIds = new Set<string>();
  const views = boundedItems(Array.isArray(data.views) ? data.views : [], databaseLimits.views, "视图").map(
    (entry, index): DatabaseView => {
      const view = object(entry);
      const filters = normalizeFilters(view.filters, fieldIds);
      const sorts = boundedItems(Array.isArray(view.sorts) ? view.sorts : [], databaseLimits.sorts, "排序条件").flatMap(
        (entry): DatabaseSort[] => {
          const sort = object(entry);
          const fieldId = str(sort.fieldId, 100);
          return fieldIds.has(fieldId) ? [{ fieldId, direction: sort.direction === "desc" ? "desc" : "asc" }] : [];
        },
      );
      const stats = object(view.statistics);
      const calendar = object(view.calendar);
      const isCalendar = view.kind === "calendar";
      const validField = (id: unknown, types: DatabaseFieldType[]) => {
        const value = str(id, 100);
        return fields.some((field) => field.id === value && types.includes(field.type)) ? value : "";
      };
      const titleFieldId = validField(calendar.titleFieldId, ["text"]);
      const startFieldId = validField(calendar.startFieldId, ["date", "createdTime", "modifiedTime"]);
      const endFieldId = validField(calendar.endFieldId, ["date", "createdTime", "modifiedTime"]);
      const defaultTitle = isCalendar ? (fields.find((field) => field.type === "text")?.id ?? "") : "";
      const defaultDate = isCalendar ? (fields.find((field) => field.type === "date")?.id ?? "") : "";
      const chartIds = new Set<string>();
      const charts = boundedItems(Array.isArray(view.charts) ? view.charts : [], databaseLimits.charts, "图表").map(
        (entry, chartIndex): DatabaseChart => {
          const chart = object(entry);
          const chartField = (value: unknown) => {
            const id = str(value, 100);
            return fieldIds.has(id) ? id : "";
          };
          const chartColor = str(chart.color, 9);
          const layout = normalizeDatabaseChartLayout(chart.layout);
          const fieldId = chartField(chart.fieldId);
          return {
            id: uniqueId(chart.id, `chart-${chartIndex}`, chartIds),
            kind: databaseChartKinds.includes(chart.kind as DatabaseChartKind)
              ? (chart.kind as DatabaseChartKind)
              : "column",
            title: str(chart.title, 200),
            fieldId,
            metricFieldId: chartField(chart.metricFieldId),
            statistic: chartStatistics.includes(chart.statistic as DatabaseChartStatistic)
              ? (chart.statistic as DatabaseChartStatistic)
              : "count",
            groupFieldId: chartField(chart.groupFieldId),
            sort: chartSorts.includes(chart.sort as DatabaseChartSort) ? (chart.sort as DatabaseChartSort) : "default",
            filters: normalizeFilters(chart.filters, fieldIds),
            filterMode: chart.filterMode === "or" ? "or" : "and",
            legend: chartLegends.includes(chart.legend as DatabaseChartLegend)
              ? (chart.legend as DatabaseChartLegend)
              : chart.kind === "area"
                ? "right"
                : "bottom",
            stacked: typeof chart.stacked === "boolean" ? chart.stacked : chart.kind === "area",
            smooth: chart.smooth === true,
            barWidth: boundedInteger(chart.barWidth, 40, 1, 1000),
            heatmapWeeks: heatmapWeeks(chart.heatmapWeeks),
            heatmapMax: heatmapMax(chart.heatmapMax),
            funnelCumulative: typeof chart.funnelCumulative === "boolean" ? chart.funnelCumulative : true,
            funnelOrder: fieldId ? funnelOrder(chart.funnelOrder) : [],
            wordcloudShape: wordcloudShape(chart.wordcloudShape),
            wordcloudMaxWords: wordcloudMaxWords(chart.wordcloudMaxWords),
            wordcloudExclude: str(chart.wordcloudExclude, 10_000),
            precision: boundedInteger(chart.precision, 0, 0, 10),
            description: str(chart.description, 1000),
            color: /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(chartColor) ? chartColor : "#262626",
            ...(layout ? { layout } : {}),
          };
        },
      );
      return {
        id: uniqueId(view.id, `view-${index}`, viewIds),
        name: str(view.name, 200) || "表格视图",
        kind:
          view.kind === "gallery" || view.kind === "kanban" || view.kind === "calendar" || view.kind === "chart"
            ? view.kind
            : "table",
        hiddenFields: boundedItems(
          Array.isArray(view.hiddenFields) ? view.hiddenFields : [],
          databaseLimits.fields,
          "隐藏字段",
        ).filter((id): id is string => typeof id === "string" && fieldIds.has(id)),
        fieldOrder: [
          ...new Set(
            boundedItems(
              Array.isArray(view.fieldOrder) ? view.fieldOrder : [],
              databaseLimits.fields,
              "字段顺序",
            ).filter((id): id is string => typeof id === "string" && fieldIds.has(id)),
          ),
        ],
        recordOrder: [
          ...new Set(
            boundedItems(
              Array.isArray(view.recordOrder) ? view.recordOrder : [],
              databaseLimits.records,
              "记录顺序",
            ).filter((id): id is string => typeof id === "string" && recordIds.has(id)),
          ),
        ],
        showFieldNames: view.showFieldNames === true,
        filters,
        filterMode: view.filterMode === "or" ? "or" : "and",
        sorts,
        groupFieldId: fieldIds.has(str(view.groupFieldId, 100)) ? str(view.groupFieldId, 100) : "",
        groupDirection: view.groupDirection === "desc" ? "desc" : "asc",
        boardOrder: [
          ...new Set(
            boundedItems(
              Array.isArray(view.boardOrder) ? view.boardOrder : [],
              databaseLimits.records,
              "看板顺序",
            ).filter((id): id is string => typeof id === "string" && recordIds.has(id)),
          ),
        ],
        rowHeight: view.rowHeight === "medium" || view.rowHeight === "large" ? view.rowHeight : "small",
        statistics: Object.fromEntries(
          fields.flatMap((field) =>
            statistics.includes(stats[field.id] as DatabaseStatistic)
              ? [[field.id, stats[field.id] as DatabaseStatistic]]
              : [],
          ),
        ),
        calendar: {
          titleFieldId: titleFieldId || defaultTitle,
          startFieldId: startFieldId || defaultDate,
          endFieldId: endFieldId || startFieldId || defaultDate,
          colorFieldId: validField(calendar.colorFieldId, ["singleSelect"]),
          color:
            Number.isInteger(calendar.color) && Number(calendar.color) >= 0 && Number(calendar.color) < 10
              ? Number(calendar.color)
              : 0,
          showLunar: calendar.showLunar === true,
          sundayFirst: calendar.sundayFirst === true,
        },
        charts,
      };
    },
  );
  if (!views.length) views.push({ ...createDatabaseView(), id: "view-0" });
  const activeViewId = str(data.activeViewId, 100);
  return {
    id: safeId(data.id, "database"),
    fields,
    records,
    views,
    activeViewId: viewIds.has(activeViewId) ? activeViewId : views[0].id,
  };
}

export function databaseValueText(field: DatabaseField, value: DatabaseValue | undefined): string {
  if (field.type === "createdBy" || field.type === "modifiedBy") return normalizeDatabaseActor(value)?.label ?? "";
  if (field.type === "image" || field.type === "attachment")
    return databaseFiles(value)
      .map((file) => file.name)
      .join("、");
  if (field.type === "createdTime" || field.type === "modifiedTime") {
    if (typeof value !== "string" || !value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    const two = (part: number) => String(part).padStart(2, "0");
    const year = String(date.getFullYear()).padStart(4, "0");
    const month = two(date.getMonth() + 1),
      day = two(date.getDate());
    const hour = two(date.getHours()),
      minute = two(date.getMinutes()),
      second = two(date.getSeconds());
    const formats: Record<DatabaseTimeFormat, string> = {
      datetimeSeconds: `${year}-${month}-${day} ${hour}:${minute}:${second}`,
      datetime: `${year}-${month}-${day} ${hour}:${minute}`,
      date: `${year}-${month}-${day}`,
      slashDatetime: `${year}/${month}/${day} ${hour}:${minute}`,
      slashDate: `${year}/${month}/${day}`,
      monthDay: `${month}-${day}`,
      time: `${hour}:${minute}`,
      year,
      yearMonth: `${year}/${month}`,
    };
    return formats[field.timeFormat ?? "datetimeSeconds"];
  }
  if (field.type === "checkbox") return value === true ? "已勾选" : "";
  if (field.type === "singleSelect") return field.options.find((option) => option.id === value)?.label ?? "";
  if (field.type === "multiSelect" || field.type === "person")
    return (Array.isArray(value) ? value : [])
      .map((id) => field.options.find((option) => option.id === id)?.label ?? "")
      .filter(Boolean)
      .join("、");
  return typeof value === "string" ? value : "";
}

/** Group by stable identity when multiple values can share the same displayed label. */
export function databaseGroupKey(field: DatabaseField, value: DatabaseValue | undefined): string {
  const text = databaseValueText(field, value);
  if (!text) return "empty";
  if (field.type === "createdBy" || field.type === "modifiedBy")
    return `identity:${JSON.stringify(normalizeDatabaseActor(value)?.id)}`;
  if (["singleSelect", "multiSelect", "person"].includes(field.type)) return `identity:${JSON.stringify(value)}`;
  return `value:${text}`;
}

/** Convert without silently rebinding a selected option to another option. */
export function convertDatabaseValue(
  source: DatabaseField,
  target: DatabaseField,
  value: DatabaseValue | undefined,
): { value: DatabaseValue; lost: boolean } {
  const original = value ?? source.defaultValue;
  const sourceEmpty = original === "" || original === false || (Array.isArray(original) && original.length === 0);
  const empty: DatabaseValue =
    target.type === "checkbox"
      ? false
      : ["multiSelect", "person", "image", "attachment"].includes(target.type)
        ? []
        : "";
  const fail = () => ({ value: empty, lost: !sourceEmpty });
  if (target.type === "createdBy" || target.type === "modifiedBy")
    return source.type === target.type ? { value: normalizeDatabaseActor(original) ?? "", lost: false } : fail();
  if (target.type === "image" || target.type === "attachment")
    return source.type === target.type ? { value: databaseFiles(original), lost: false } : fail();
  if (
    (source.type === "image" || source.type === "attachment") &&
    ["singleSelect", "multiSelect", "person"].includes(target.type)
  )
    return fail();
  if (
    source.type === target.type &&
    source.type !== "singleSelect" &&
    source.type !== "multiSelect" &&
    source.type !== "person"
  ) {
    return { value: valueFor(original, target.type), lost: false };
  }
  const selectedIds =
    source.type === "singleSelect"
      ? typeof original === "string" && original
        ? [original]
        : []
      : (source.type === "multiSelect" || source.type === "person") && Array.isArray(original)
        ? original
        : [];
  if (target.type === "singleSelect" || target.type === "multiSelect" || target.type === "person") {
    const labels =
      source.type === "singleSelect" || source.type === "multiSelect" || source.type === "person"
        ? selectedIds.map((id) => ({ id, label: source.options.find((option) => option.id === id)?.label ?? "" }))
        : typeof original === "string" && original
          ? original.split("、").map((label) => ({ id: "", label: label.trim() }))
          : [];
    const selected = labels
      .map(({ id, label }) =>
        id
          ? target.options.find((option) => option.id === id)
          : target.options.find((option) => option.label === label),
      )
      .filter((option): option is DatabaseOption => !!option);
    return {
      value: target.type === "singleSelect" ? (selected[0]?.id ?? "") : selected.map((option) => option.id),
      lost: selected.length !== labels.length || (target.type === "singleSelect" && selected.length > 1),
    };
  }
  let text: string;
  if (source.type === "checkbox") text = original === true ? "是" : "";
  else if (source.type === "singleSelect" || source.type === "multiSelect" || source.type === "person") {
    const selected = selectedIds.map((id) => source.options.find((option) => option.id === id)?.label);
    if (selected.some((label) => label === undefined)) return fail();
    text = selected.join("、");
  } else if (source.type === "createdBy" || source.type === "modifiedBy")
    text = normalizeDatabaseActor(original)?.label ?? "";
  else if (source.type === "image" || source.type === "attachment")
    text = databaseFiles(original)
      .map((file) => file.name)
      .join("、");
  else text = typeof original === "string" ? original : "";
  if (target.type === "checkbox") {
    if (["", "否", "false", "0"].includes(text.trim().toLowerCase())) return { value: false, lost: false };
    if (["是", "true", "1"].includes(text.trim().toLowerCase())) return { value: true, lost: false };
    return fail();
  }
  if (target.type === "number" || target.type === "rating" || target.type === "progress") {
    // Yuque retains existing text when a text field changes to a number field.
    return { value: text, lost: false };
  }
  return { value: text, lost: false };
}

function matchesFilter(
  field: DatabaseField,
  value: DatabaseValue | undefined,
  filter: DatabaseFilter,
  optionExists: boolean,
): boolean {
  if (filter.optionId && (field.type === "singleSelect" || field.type === "multiSelect")) {
    const selected =
      optionExists &&
      (Array.isArray(value)
        ? value.some((item) => typeof item === "string" && item === filter.optionId)
        : value === filter.optionId);
    if (filter.operator === "contains" || filter.operator === "equals") return selected;
    if (filter.operator === "notContains" || filter.operator === "notEquals") return !selected;
  }
  const text = databaseValueText(field, value).toLocaleLowerCase();
  const needle = filter.value.toLocaleLowerCase();
  switch (filter.operator) {
    case "startsWith":
      return text.startsWith(needle);
    case "notStartsWith":
      return !text.startsWith(needle);
    case "endsWith":
      return text.endsWith(needle);
    case "notEndsWith":
      return !text.endsWith(needle);
    case "contains":
      return text.includes(needle);
    case "notContains":
      return !text.includes(needle);
    case "equals":
      return text === needle;
    case "notEquals":
      return text !== needle;
    case "greater":
      return field.type === "number" || field.type === "rating" || field.type === "progress"
        ? text !== "" && needle !== "" && Number(text) > Number(needle)
        : text > needle;
    case "less":
      return field.type === "number" || field.type === "rating" || field.type === "progress"
        ? text !== "" && needle !== "" && Number(text) < Number(needle)
        : text !== "" && needle !== "" && text < needle;
    case "empty":
      return text === "";
    case "notEmpty":
      return text !== "";
  }
}

/** Manual board order belongs to its view; newly added records appear first. */
export function databaseBoardRecordIds(data: DatabaseData, view: DatabaseView): string[] {
  const known = new Set(view.boardOrder);
  const existing = new Set(data.records.map((record) => record.id));
  return [
    ...data.records
      .map((record) => record.id)
      .reverse()
      .filter((id) => !known.has(id)),
    ...view.boardOrder.filter((id) => existing.has(id)),
  ];
}

export function databaseTableRecordIds(data: DatabaseData, view: DatabaseView): string[] {
  const existing = new Set(data.records.map((record) => record.id));
  const ordered = (view.recordOrder ?? []).filter((id) => existing.has(id));
  const known = new Set(ordered);
  return [...ordered, ...data.records.map((record) => record.id).filter((id) => !known.has(id))];
}

export function orderedDatabaseFields(data: DatabaseData, view: DatabaseView): DatabaseField[] {
  const fields = new Map(data.fields.map((field) => [field.id, field]));
  const ordered = (view.fieldOrder ?? []).flatMap((id) => {
    const field = fields.get(id);
    if (!field) return [];
    fields.delete(id);
    return [field];
  });
  return [...ordered, ...fields.values()];
}

export function visibleDatabaseRecords(data: DatabaseData, view: DatabaseView, query = ""): DatabaseRecord[] {
  const search = query.trim().toLocaleLowerCase();
  const filters = view.filters.map((filter) => {
    const field = data.fields.find((item) => item.id === filter.fieldId);
    return {
      filter,
      field,
      optionExists: !!filter.optionId && !!field?.options.some((item) => item.id === filter.optionId),
    };
  });
  const filtered = data.records.filter((record) => {
    const matches = ({ filter, field, optionExists }: (typeof filters)[number]) =>
      !field || matchesFilter(field, record.values[field.id], filter, optionExists);
    return (
      (!filters.length || (view.filterMode === "or" ? filters.some(matches) : filters.every(matches))) &&
      (!search ||
        data.fields.some((field) =>
          databaseValueText(field, record.values[field.id]).toLocaleLowerCase().includes(search),
        ))
    );
  });
  const manualRank =
    view.kind === "kanban"
      ? new Map(databaseBoardRecordIds(data, view).map((id, index) => [id, index]))
      : view.kind === "table"
        ? new Map(databaseTableRecordIds(data, view).map((id, index) => [id, index]))
        : null;
  return filtered.sort((a, b) => {
    for (const sort of view.sorts) {
      const field = data.fields.find((item) => item.id === sort.fieldId);
      if (!field) continue;
      const left =
        field.type === "createdTime" || field.type === "modifiedTime"
          ? String(a.values[field.id] ?? "")
          : databaseValueText(field, a.values[field.id]);
      const right =
        field.type === "createdTime" || field.type === "modifiedTime"
          ? String(b.values[field.id] ?? "")
          : databaseValueText(field, b.values[field.id]);
      const numeric = field.type === "number" || field.type === "rating" || field.type === "progress";
      let comparison: number;
      if (numeric) {
        // Text-to-number conversion preserves nonnumeric values. Compare each
        // category consistently so mixed values cannot form a sorting cycle.
        const category = (value: string) => (value.trim() === "" ? 0 : Number.isFinite(Number(value)) ? 1 : 2);
        const leftCategory = category(left);
        const rightCategory = category(right);
        comparison = leftCategory - rightCategory;
        if (!comparison && leftCategory === 1) comparison = Number(left) - Number(right);
        if (!comparison && leftCategory === 2)
          comparison = left.localeCompare(right, "zh-CN", { numeric: true, sensitivity: "base" });
      } else comparison = left.localeCompare(right, "zh-CN", { numeric: true, sensitivity: "base" });
      if (comparison) return sort.direction === "desc" ? -comparison : comparison;
    }
    return manualRank ? (manualRank.get(a.id) ?? 0) - (manualRank.get(b.id) ?? 0) : 0;
  });
}
