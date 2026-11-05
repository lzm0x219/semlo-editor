export interface DatabaseHeatmapDay {
  /** Local calendar date, independent of timezone offset. */
  date: string;
  /** A null value means there were no records for this day. */
  value: number | null;
  /** Empty days are -1; observed values use levels 0 through 5. */
  level: number;
}

/** Reproduce the observed six-level heat scale, including a zero threshold. */
export function heatmapLevel(value: number, maximum: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const safeMax = Number.isFinite(maximum) && maximum >= 0 ? maximum : 100;
  const step = Math.floor(safeMax / 6);
  return step > 0 ? Math.max(0, Math.min(5, Math.floor(value / step))) : 5;
}

function utcDate(year: number, month: number, day: number): Date {
  // setUTCFullYear avoids Date.UTC's special treatment of years 0..99.
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month, day);
  return date;
}

function dateKey(date: Date): string {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Return Sunday-through-Saturday columns ending at the current week's Saturday.
 * Buckets are already aggregated and filtered by the chart's existing calculator.
 */
export function calculateHeatmapCalendar(
  buckets: readonly { key: string; value: number }[],
  weeks: number,
  maximum: number,
  today = new Date(),
): DatabaseHeatmapDay[][] {
  const weekCount = Number.isFinite(weeks) ? Math.max(4, Math.min(52, Math.round(weeks))) : 52;
  const current = Number.isFinite(today.getTime()) ? today : new Date();
  const cursor = utcDate(current.getFullYear(), current.getMonth(), current.getDate());
  // Walk civil days in UTC so the local timezone's daylight-saving transitions
  // cannot skip or duplicate a date.
  cursor.setUTCDate(cursor.getUTCDate() - cursor.getUTCDay() - (weekCount - 1) * 7);
  const values = new Map<string, number>();
  for (const bucket of buckets) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(bucket.key) && Number.isFinite(bucket.value)) values.set(bucket.key, bucket.value);
  }
  return Array.from({ length: weekCount }, () =>
    Array.from({ length: 7 }, () => {
      const date = dateKey(cursor);
      const value = values.get(date) ?? null;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      return { date, value, level: value === null ? -1 : heatmapLevel(value, maximum) };
    }),
  );
}
