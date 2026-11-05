import { LINE_HEIGHT_VALUES } from "../text/paragraph-layout";

export function cellBackground(value: unknown): string | null {
  return typeof value === "string" && value.length <= 128 && /^[\w\s#.,()%+/-]+$/.test(value) ? value : null;
}

export function parsedCellBackground(element: HTMLElement): string | null {
  let current: HTMLElement | null = element;
  while (current) {
    const value = ["TD", "TH", "TR", "TABLE"].includes(current.tagName)
      ? cellBackground(current.style.backgroundColor)
      : null;
    if (value) return value;
    if (current.tagName === "TABLE") break;
    current = current.parentElement;
  }
  return null;
}

export function parsedCellTextAlign(element: HTMLElement): string | null {
  for (const current of [element, element.parentElement]) {
    if (!current || (current !== element && current.tagName !== "TR")) continue;
    const value = current.style.textAlign;
    if (["left", "center", "right", "justify"].includes(value)) return value;
  }
  return null;
}

export function parsedCellTextColor(element: HTMLElement): string | null {
  let current: HTMLElement | null = element;
  while (current) {
    const value = ["TD", "TH", "TR", "TABLE"].includes(current.tagName) ? cellBackground(current.style.color) : null;
    if (value) return value;
    if (current.tagName === "TABLE") break;
    current = current.parentElement;
  }
  return null;
}

export function cellVerticalAlign(value: unknown): string | null {
  return typeof value === "string" && ["top", "middle", "bottom"].includes(value) ? value : null;
}

export function cellLineHeight(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^(?:normal|(?:\d+(?:\.\d+)?|\.\d+)(?:px|pt|%|em|rem)?)$/i.test(trimmed) ? trimmed : null;
}

export function yuqueLineHeight(value: string): string | null {
  const number = parseFloat(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return LINE_HEIGHT_VALUES.reduce((best, item) =>
    Math.abs(Number(item) - number) < Math.abs(Number(best) - number) ? item : best,
  );
}

export function pastedFontSize(value: unknown, normalize: boolean): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!normalize) {
    if (/^(?:\d+(?:\.\d+)?|\.\d+)(?:px|pt|%|em|rem|vh|vw|vmin|vmax)$/i.test(trimmed)) return trimmed;
    if (
      /^(?:xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger|inherit|initial|unset|revert|revert-layer)$/i.test(
        trimmed,
      )
    )
      return trimmed;
    return trimmed.length <= 256 && /^(?:calc|var|min|max|clamp)\([\w\s.,%+*/()-]+\)$/i.test(trimmed) ? trimmed : null;
  }
  const match = /^(\d+(?:\.\d+)?)(px|pt)$/i.exec(trimmed);
  if (!match) return null;
  const pixels = Number(match[1]) * (match[2].toLowerCase() === "pt" ? 4 / 3 : 1);
  if (!Number.isFinite(pixels) || pixels <= 0) return null;
  const sizes = [12, 13, 14, 15, 16, 19, 22, 24, 29, 32, 40, 48];
  return `${sizes.reduce((best, size) => (Math.abs(size - pixels) < Math.abs(best - pixels) ? size : best))}px`;
}

export function cellFontSizeChain(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.length || value.length > 4) return null;
  const sizes = value.map((item) => (typeof item === "string" ? pastedFontSize(item, false) : null));
  return sizes.every((item) => item !== null) ? (sizes as string[]) : null;
}

export function cellFontVariables(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (!entries.length || entries.length > 32) return null;
  if (
    entries.some(
      ([name, item]) =>
        !/^--[a-z0-9_-]+$/i.test(name) ||
        typeof item !== "string" ||
        item.length > 256 ||
        !/^[\w\s.,%+*/()'"-]+$/.test(item),
    )
  )
    return null;
  return Object.fromEntries(entries) as Record<string, string>;
}

export function resolvedCellFontSize(chain: string[]): string | null {
  let factor = 1;
  for (const size of chain) {
    const match = /^(\d+(?:\.\d+)?|\.\d+)(px|pt|%|em|rem|vh|vw|vmin|vmax)$/i.exec(size);
    if (!match) {
      if (factor === 1) return size;
      const expression = `calc(${size} * ${factor})`;
      return typeof CSS !== "undefined" && CSS.supports("font-size", expression) ? expression : null;
    }
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return null;
    const unit = match[2].toLowerCase();
    if (unit === "%" || unit === "em") {
      factor *= unit === "%" ? amount / 100 : amount;
      if (!Number.isFinite(factor)) return null;
      continue;
    }
    const resolved = amount * factor;
    if (!Number.isFinite(resolved)) return null;
    const rounded = Math.round(resolved * 10000) / 10000;
    return Number.isFinite(rounded) ? `${rounded}${unit}` : null;
  }
  const percent = Math.round(factor * 1000000) / 10000;
  return Number.isFinite(percent) ? `${percent}%` : null;
}
