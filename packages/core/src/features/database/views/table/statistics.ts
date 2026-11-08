import { dateFromISO, toISO } from "../../../../shared/date/date-utils";
import { databaseValueText, type DatabaseField, type DatabaseRecord, type DatabaseStatistic } from "../../model";

// 在安全整数范围内按小数位数缩放后求和。
const safeDecimalSum = (values: string[]): number | undefined => {
  const decimals = values.map((value) => /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value.trim()));
  if (!decimals.every((entry) => entry && entry[2].length <= 16 && (entry[3]?.length ?? 0) <= 12)) return undefined;
  const scale = decimals.reduce((max, entry) => Math.max(max, entry?.[3]?.length ?? 0), 0);
  let units = 0n;
  const limit = BigInt(Number.MAX_SAFE_INTEGER);
  for (const entry of decimals) {
    if (!entry) continue;
    const magnitude = BigInt(entry[2] + (entry[3] ?? "").padEnd(scale, "0"));
    if (magnitude > limit) return undefined;
    units += entry[1] === "-" ? -magnitude : magnitude;
    if (units > limit || units < -limit) return undefined;
  }
  return Number(units) / 10 ** scale;
};

export const statisticText = (
  field: DatabaseField,
  records: DatabaseRecord[],
  statistic: DatabaseStatistic,
): string => {
  const values = records.map((record) => databaseValueText(field, record.values[field.id])).filter(Boolean);
  if (
    statistic === "earliestDate" ||
    statistic === "latestDate" ||
    statistic === "dateRangeDays" ||
    statistic === "dateRangeMonths"
  ) {
    const dates = (
      field.type === "createdTime" || field.type === "modifiedTime"
        ? records.flatMap((record) => {
            const value = record.values[field.id];
            if (typeof value !== "string" || !value) return [];
            const timestamp = new Date(value);
            return Number.isNaN(timestamp.getTime()) ? [] : [toISO(timestamp)];
          })
        : values.filter((value) => dateFromISO(value) !== null)
    ).sort();
    if (statistic === "earliestDate")
      return `最早时间 ${dates[0] ?? (field.type === "date" && values.length === 0 ? "Invalid Date" : "—")}`;
    if (statistic === "latestDate") return `最晚时间 ${dates.at(-1) ?? "—"}`;
    if (statistic === "dateRangeMonths") {
      if (!dates.length) return "时间范围 0 月";
      const [startYear, startMonth, startDay] = dates[0].split("-").map(Number);
      const [endYear, endMonth, endDay] = dates[dates.length - 1].split("-").map(Number);
      const endOfMonth = new Date(0);
      endOfMonth.setUTCFullYear(endYear, endMonth, 0);
      const boundaryDay = Math.min(startDay, endOfMonth.getUTCDate());
      const months = (endYear - startYear) * 12 + endMonth - startMonth - (endDay < boundaryDay ? 1 : 0);
      return `时间范围 ${months} 月`;
    }
    const calendarDay = (value: string) => {
      const [year, month, day] = value.split("-").map(Number);
      const utc = new Date(0);
      utc.setUTCFullYear(year, month - 1, day);
      utc.setUTCHours(0, 0, 0, 0);
      return utc.getTime() / 86_400_000;
    };
    const days = dates.length ? calendarDay(dates[dates.length - 1]) - calendarDay(dates[0]) : 0;
    return `时间范围 ${days} 天`;
  }
  if (statistic === "count") return `${records.length} 条记录`;
  if (statistic === "empty")
    return `${field.type === "checkbox" ? "未勾选" : field.type === "text" ? "未填写" : "空"} ${records.length - values.length}`;
  if (statistic === "notEmpty")
    return `${field.type === "checkbox" ? "已勾选" : field.type === "text" ? "已填写" : "非空"} ${values.length}`;
  const unique = new Set(values).size;
  if (statistic === "unique") return `唯一数 ${unique}`;
  const percent = (count: number) => `${records.length ? Number(((count / records.length) * 100).toFixed(2)) : 0}%`;
  if (statistic === "emptyPercent")
    return `${field.type === "checkbox" ? "未勾选占比" : "未填写占比"} ${percent(records.length - values.length)}`;
  if (statistic === "notEmptyPercent")
    return `${field.type === "checkbox" ? "已勾选占比" : "已填写占比"} ${percent(values.length)}`;
  if (statistic === "uniquePercent") return `唯一数占比 ${percent(unique)}`;
  if (statistic === "median" || statistic === "maximum" || statistic === "minimum") {
    const numericValues = values.filter((value) => value.trim() !== "" && Number.isFinite(Number(value)));
    numericValues.sort((left, right) => Number(left) - Number(right));
    const name = statistic === "median" ? "中位数" : statistic === "maximum" ? "最大值" : "最小值";
    if (!numericValues.length)
      return `${name} ${statistic === "median" && field.type === "number" && values.length === 0 ? "NaN" : "—"}`;
    const middle = Math.floor(numericValues.length / 2);
    const pairSum =
      numericValues.length % 2 ? undefined : safeDecimalSum([numericValues[middle - 1], numericValues[middle]]);
    const median =
      numericValues.length % 2
        ? Number(numericValues[middle])
        : pairSum !== undefined
          ? pairSum / 2
          : Number(numericValues[middle - 1]) / 2 + Number(numericValues[middle]) / 2;
    const result =
      statistic === "median" ? median : Number(statistic === "maximum" ? numericValues.at(-1) : numericValues[0]);
    return `${name} ${result}`;
  }
  if (statistic === "sum" || statistic === "average") {
    const numericValues = values.filter((value) => Number.isFinite(Number(value)));
    const numbers = numericValues.map(Number);
    const total = numbers.reduce((sum, number) => sum + number, 0);
    const exactTotal = statistic === "sum" ? safeDecimalSum(numericValues) : undefined;
    return `${statistic === "sum" ? "求和" : "平均值"} ${statistic === "sum" ? (exactTotal ?? total) : numbers.length ? Number((total / numbers.length).toFixed(2)) : 0}`;
  }
  return "统计";
};
