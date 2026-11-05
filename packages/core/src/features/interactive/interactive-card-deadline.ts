/** A date or local wall-clock date-time; the host defines the applicable time zone. */
export function interactiveDeadline(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:T((?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?))?$/.exec(value);
  if (!match) return null;
  const parsed = new Date(`${match[1]}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === match[1] ? value : null;
}

/** 空值表示没有截止日期；其他值必须能被当前版本识别。 */
export function supportedInteractiveDeadline(value: unknown): boolean {
  return value == null || interactiveDeadline(value) !== null;
}

/** 旧 HTML 使用 data-deadline，非字符串载荷通过 JSON 属性无损保留。 */
export function readInteractiveDeadline(element: HTMLElement): unknown {
  const encoded = element.getAttribute("data-deadline-json");
  if (encoded !== null) {
    try {
      return JSON.parse(encoded) as unknown;
    } catch {
      return encoded;
    }
  }
  return element.getAttribute("data-deadline");
}

export function interactiveDeadlineAttributes(value: unknown): Record<string, string> {
  if (value == null) return {};
  const deadline = interactiveDeadline(value);
  return deadline === null ? { "data-deadline-json": JSON.stringify(value) ?? "null" } : { "data-deadline": deadline };
}

export function splitInteractiveDeadline(value: unknown): { date: string; time: string } {
  const deadline = interactiveDeadline(value);
  const [date = "", time = ""] = deadline?.split("T") ?? [];
  return { date, time };
}

export function formatInteractiveDeadline(value: string): string {
  return value.replace("T", " ");
}
