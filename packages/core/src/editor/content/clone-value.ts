/** 复制文档中的可变值，避免宿主和编辑器通过嵌套属性共享状态。 */
export function cloneContentValue<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== "object") return value;
  const existing = seen.get(value);
  if (existing) return existing as T;
  if (Array.isArray(value)) {
    const result: unknown[] = [];
    seen.set(value, result);
    for (const item of value) result.push(cloneContentValue(item, seen));
    return result as T;
  }
  const prototype = Object.getPrototypeOf(value);
  // 不同窗口的普通对象原型不同；逐项复制也可处理框架的响应式代理。
  if (prototype !== null && Object.getPrototypeOf(prototype) !== null) return structuredClone(value);
  const result: Record<string, unknown> = {};
  seen.set(value, result);
  for (const [key, item] of Object.entries(value))
    Object.defineProperty(result, key, {
      value: cloneContentValue(item, seen),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  return result as T;
}
