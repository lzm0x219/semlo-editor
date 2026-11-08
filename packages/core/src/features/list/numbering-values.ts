import { MAX_INDENT, safeIndent } from "../../shared/indent";

/** 旧格式的分层起点只接受可保存的数据字段，不读取访问器。 */
export function normalizeOrderedListLevelStarts(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors);
    if (!keys.length || keys.length > MAX_INDENT + 1 || Object.getOwnPropertySymbols(value).length) return null;
    const result: Record<string, number> = {};
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!/^[0-8]$/.test(key) || !("value" in descriptor)) return null;
      const start = descriptor.value;
      if (typeof start !== "number" || !Number.isSafeInteger(start) || start < -2147483648 || start > 2147483647)
        return null;
      result[key] = start;
    }
    return result;
  } catch {
    return null;
  }
}

export function validOrderedListStart(value: unknown): number | null {
  const parsed =
    typeof value === "number" || (typeof value === "string" && /^[+-]?\d+$/.test(value.trim())) ? Number(value) : NaN;
  return Number.isSafeInteger(parsed) && parsed >= -2147483648 && parsed <= 2147483647 ? parsed : null;
}

/** 保持旧计数、异常输入回退和上界饱和语义，读取不会物化新身份。 */
export function deriveOrderedListValues(
  indents: readonly unknown[],
  start: unknown,
  levelStarts?: unknown,
  restarts?: readonly unknown[],
): number[] {
  if (!indents.length) return [];
  const counters: number[] = Array(MAX_INDENT + 1).fill(0);
  const started: boolean[] = Array(MAX_INDENT + 1).fill(false);
  const starts = normalizeOrderedListLevelStarts(levelStarts);
  const initialLevel = safeIndent(indents[0]);
  const first = validOrderedListStart(start) ?? 1;
  let restartValues: readonly unknown[] | undefined;
  try {
    if (Array.isArray(restarts)) restartValues = restarts;
  } catch {
    // 异常旧值继续走既有编号，不影响其他内容读取。
  }
  return indents.map((indent, index) => {
    const level = safeIndent(indent);
    let restart = false;
    try {
      if (restartValues) {
        const descriptor = Object.getOwnPropertyDescriptor(restartValues, String(index));
        restart = !!descriptor && "value" in descriptor && descriptor.value === true;
      }
    } catch {
      // 失效 Proxy 等旧值不具有重启含义。
    }
    if (restart) {
      counters[level] = 0;
      started[level] = true;
    } else if (!started[level]) {
      counters[level] = (level === initialLevel ? first : (starts?.[String(level)] ?? 1)) - 1;
      started[level] = true;
    }
    counters[level] = Math.min(2147483647, counters[level] + 1);
    for (let deeper = level + 1; deeper <= MAX_INDENT; deeper += 1) if (started[deeper]) counters[deeper] = 0;
    return counters[level];
  });
}
