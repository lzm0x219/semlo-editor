export const MAX_INDENT = 8;

export function safeIndent(value: unknown): number {
  if (typeof value !== "number" && (typeof value !== "string" || !/^\d+$/.test(value))) return 0;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= MAX_INDENT ? number : 0;
}
