/** Calendar dates are stored as local YYYY-MM-DD values, without timezone conversion. */
export function toISO(date: Date): string {
  return `${date.getFullYear().toString().padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function dateFromISO(value: unknown): Date | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const result = new Date(0);
  result.setFullYear(year, month - 1, day);
  result.setHours(12, 0, 0, 0);
  return result.getFullYear() === year && result.getMonth() === month - 1 && result.getDate() === day ? result : null;
}
export function todayISO(): string {
  return toISO(new Date());
}
export function addDays(value: string, days: number): string {
  const date = dateFromISO(value) ?? new Date();
  date.setDate(date.getDate() + days);
  return toISO(date);
}
export function monthGrid(
  year: number,
  month: number,
  fixedSix = false,
): Array<{ date: string; day: number; current: boolean }> {
  const first = new Date(0);
  first.setFullYear(year, month, 1);
  first.setHours(12, 0, 0, 0);
  const last = new Date(0);
  last.setFullYear(year, month + 1, 0);
  last.setHours(12, 0, 0, 0);
  const offset = first.getDay();
  const size = fixedSix ? 42 : Math.ceil((offset + last.getDate()) / 7) * 7;
  return Array.from({ length: size }, (_, index) => {
    const date = new Date(first);
    date.setDate(1 - offset + index);
    return { date: toISO(date), day: date.getDate(), current: date.getMonth() === month };
  });
}
export function dateLabel(value: unknown): string {
  const date = dateFromISO(value) ?? new Date();
  const now = new Date();
  return `${date.getFullYear() === now.getFullYear() ? "" : `${date.getFullYear()}年`}${date.getMonth() + 1}月${String(date.getDate()).padStart(2, "0")}日`;
}
