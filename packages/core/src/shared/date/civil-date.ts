import { dateFromISO } from "./date-utils";

const dayMilliseconds = 86_400_000;

/** Compare civil dates without daylight-saving offsets or the Date.UTC 0–99 year special case. */
export function calendarDayNumber(value: string): number | null {
  if (!dateFromISO(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const result = new Date(0);
  result.setUTCHours(0, 0, 0, 0);
  result.setUTCFullYear(year, month - 1, day);
  return result.getTime() / dayMilliseconds;
}

export function shiftCalendarDate(value: string, amount: number): string | null {
  const day = calendarDayNumber(value);
  if (day === null || !Number.isInteger(amount)) return null;
  const result = new Date((day + amount) * dayMilliseconds);
  const year = result.getUTCFullYear();
  if (!Number.isFinite(year) || year < 0 || year > 9999) return null;
  const output = `${String(year).padStart(4, "0")}-${String(result.getUTCMonth() + 1).padStart(2, "0")}-${String(result.getUTCDate()).padStart(2, "0")}`;
  return dateFromISO(output) ? output : null;
}
