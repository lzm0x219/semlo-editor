import { DatabaseContentError, normalizeDatabaseData, type DatabaseData } from "./model";

// 数据表归一化允许补齐缺省值，但不能抹掉或改变调用方提供的有效内容。
function assertPreserved(value: unknown, normalized: unknown, path: string, visiting: WeakSet<object>): void {
  if (value === undefined || Object.is(value, normalized)) return;
  if (typeof value === "number" && Number.isFinite(value) && normalized === String(value)) return;
  if (value === "" && Array.isArray(normalized) && normalized.length === 0) return;
  if (typeof value === "string" && typeof normalized === "string") {
    if (!value && !path.endsWith(".id")) return;
    if (/\.(?:createdAt|modifiedAt)$/.test(path)) {
      const before = Date.parse(value);
      if (!Number.isNaN(before) && before === Date.parse(normalized)) return;
    }
  }
  if (!value || typeof value !== "object" || !normalized || typeof normalized !== "object")
    throw new DatabaseContentError(`${path} 无法安全保留`);
  if (visiting.has(value)) throw new DatabaseContentError(`${path} 包含循环引用`);
  visiting.add(value);
  try {
    if (Array.isArray(value)) {
      if (!Array.isArray(normalized) || normalized.length < value.length)
        throw new DatabaseContentError(`${path} 包含无法保留的项目`);
      for (let index = 0; index < value.length; index++) {
        if (!(index in value) || value[index] === undefined)
          throw new DatabaseContentError(`${path}[${index}] 缺少有效内容`);
        assertPreserved(value[index], normalized[index], `${path}[${index}]`, visiting);
      }
      return;
    }
    if (Array.isArray(normalized)) throw new DatabaseContentError(`${path} 结构无效`);
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) continue;
      if (!Object.hasOwn(normalized, key)) throw new DatabaseContentError(`${path}.${key} 无法安全保留`);
      assertPreserved(entry, (normalized as Record<string, unknown>)[key], `${path}.${key}`, visiting);
    }
  } finally {
    visiting.delete(value);
  }
}

export function validateDatabaseData(value: unknown): DatabaseData {
  const normalized = normalizeDatabaseData(value);
  assertPreserved(value, normalized, "数据", new WeakSet());
  return normalized;
}
